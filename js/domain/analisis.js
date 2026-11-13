/**
 * Análisis para decidir: cómo va a cerrar el mes, en qué categorías se está gastando distinto,
 * qué pagos vienen y cómo se ha movido el patrimonio. Todo son funciones puras sobre los datos.
 */

import { aEntero, sumar } from './money.js';
import { sumarMeses, ultimoDiaMes, diaDelMes, diasEntre } from './fechas.js';
import { cuenta, estadisticasMes, saldoDeuda, TIPOS_GASTO } from './movimientos.js';
import { detectarRecurrentes, patrimonio } from './presupuesto.js';
import { normalizarComercio } from './categorias.js';
import { promediosMensuales } from './salud.js';
import { saldoTarjeta, proximasFechas, pagoMinimoEstimado, cicloVigente } from './tarjetas.js';
import { proyeccionCdt } from './deudas.js';

/** Comercios (normalizados) con algún gasto en el mes. */
function comerciosDelMes(transacciones, mes) {
  const vistos = new Map();
  for (const t of transacciones) {
    if (!cuenta(t) || !TIPOS_GASTO.has(t.type) || String(t.date).slice(0, 7) !== mes) continue;
    const clave = normalizarComercio(t.comercio || t.note);
    if (clave) vistos.set(clave, (vistos.get(clave) || 0) + aEntero(t.amount));
  }
  return vistos;
}

/**
 * Proyección del gasto al cierre del mes.
 *
 * Separa lo fijo de lo variable: los cobros recurrentes que aún no llegan se suman completos, y el
 * gasto variable se proyecta con el ritmo diario que llevas. En los primeros días del mes ese ritmo
 * es poco fiable, así que se mezcla con tu promedio histórico (peso total a partir del día 10).
 * @param {string} hoy `AAAA-MM-DD`
 * @returns {{gastado:number, proyectado:number, promedio:number, ingresoEsperado:number,
 *   ahorroProyectado:number, tasaProyectada:number|null, fijosPendientes:number, hayBase:boolean}}
 */
export function proyeccionCierre(datos, hoy) {
  const mes = hoy.slice(0, 7);
  const dia = Number(hoy.slice(8, 10));
  const diasMes = ultimoDiaMes(mes);
  const tx = datos.transactions;
  const s = estadisticasMes(tx, mes);
  const prom = promediosMensuales(tx, mes);
  const recurrentes = detectarRecurrentes(tx, mes);
  const cobrados = comerciosDelMes(tx, mes);

  const fijosPendientes = sumar(recurrentes.filter((r) => !cobrados.has(r.comercio)).map((r) => r.monto));
  const fijosCobrados = sumar(recurrentes.map((r) => cobrados.get(r.comercio) || 0));
  const totalFijos = sumar(recurrentes.map((r) => r.monto));

  const variableHastaHoy = Math.max(0, s.expense - fijosCobrados);
  const ritmoActual = variableHastaHoy / dia;
  const ritmoHistorico = prom.meses ? Math.max(0, prom.gasto - totalFijos) / diasMes : ritmoActual;
  const peso = prom.meses ? Math.min(1, dia / 10) : 1;
  const ritmo = peso * ritmoActual + (1 - peso) * ritmoHistorico;

  const proyectado = s.expense + Math.round(ritmo * (diasMes - dia)) + fijosPendientes;
  const ingresoEsperado = Math.max(s.income, prom.ingreso);
  const ahorroProyectado = ingresoEsperado - proyectado;
  return {
    gastado: s.expense,
    proyectado,
    promedio: prom.gasto,
    ingresoEsperado,
    ahorroProyectado,
    tasaProyectada: ingresoEsperado > 0 ? Math.round((ahorroProyectado / ingresoEsperado) * 100) : null,
    fijosPendientes,
    hayBase: s.expense > 0 || prom.meses > 0,
  };
}

/**
 * Gasto por categoría del mes frente al promedio de los últimos meses cerrados con datos.
 * @returns {Array<{categoria:string, actual:number, promedio:number|null, delta:number|null, parte:number}>}
 *   `parte` es el porcentaje del gasto del mes; `promedio` y `delta` son null si no hay historia.
 */
export function comparativoCategorias(transacciones, mes, meses = 3) {
  const actual = estadisticasMes(transacciones, mes);
  const previos = [];
  for (let k = 1; k <= 12 && previos.length < meses; k++) {
    const s = estadisticasMes(transacciones, sumarMeses(mes, -k));
    if (s.income > 0 || s.expense > 0) previos.push(s);
  }
  const categorias = new Set(Object.keys(actual.byCategory));
  return [...categorias]
    .map((categoria) => {
      const valor = actual.byCategory[categoria] || 0;
      const promedio = previos.length
        ? Math.round(sumar(previos.map((s) => s.byCategory[categoria] || 0)) / previos.length)
        : null;
      return {
        categoria,
        actual: valor,
        promedio,
        delta: promedio == null ? null : valor - promedio,
        parte: actual.expense > 0 ? Math.round((valor / actual.expense) * 100) : 0,
      };
    })
    .sort((a, b) => b.actual - a.actual);
}

/** Fecha de vencimiento y valor neto de un CDT (día de apertura ajustado al último del mes). */
export function vencimientoCdt(inv) {
  const inicio = String(inv.startDate);
  const plazo = Math.max(1, Number(inv.termMonths) || 1);
  const fecha = diaDelMes(sumarMeses(inicio.slice(0, 7), plazo), Number(inicio.slice(8, 10)));
  const cdt = proyeccionCdt({ monto: inv.amount, tasaEA: inv.rate, dias: diasEntre(inicio, fecha) });
  return { fecha, ...cdt };
}

/**
 * Pagos y vencimientos de los próximos días, en orden: tarjetas (pago mínimo), cobros recurrentes
 * que aún no llegan, cuotas de otras deudas y CDT que vencen (esos son dinero que entra).
 * @param {string} hoy `AAAA-MM-DD`
 * @returns {Array<{tipo:'tarjeta'|'recurrente'|'deuda'|'cdt', fecha:string|null, dias:number|null,
 *   titulo:string, monto:number, detalle:string, entra:boolean}>}
 */
export function proximosCompromisos(datos, hoy, horizonte = 30) {
  const mes = hoy.slice(0, 7);
  const tx = datos.transactions;
  const salida = [];
  const agregar = (item) => {
    const dias = item.fecha ? diasEntre(hoy, item.fecha) : null;
    if (dias != null && dias > horizonte) return;
    salida.push({ entra: false, ...item, dias });
  };

  for (const t of (datos.tarjetas || []).filter((x) => x.estado !== 'cerrada')) {
    const saldo = saldoTarjeta(t, tx);
    if (saldo <= 0) continue;
    const { limitePago } = proximasFechas(t, hoy);
    const ciclo = cicloVigente(datos.ciclos || [], t.id, hoy);
    const delCiclo = ciclo && ciclo.fechaLimitePago === limitePago;
    if (delCiclo && ciclo.pagado) continue;
    const minimo = delCiclo && aEntero(ciclo.pagoMinimo) > 0;
    agregar({
      tipo: 'tarjeta',
      fecha: limitePago,
      titulo: `Tarjeta ${t.alias}`,
      monto: minimo ? aEntero(ciclo.pagoMinimo) : pagoMinimoEstimado(saldo, t.tasaEA || 0),
      detalle: minimo ? 'pago mínimo del extracto' : 'pago mínimo estimado',
    });
  }

  const cobrados = comerciosDelMes(tx, mes);
  for (const r of detectarRecurrentes(tx, mes)) {
    // Si ya llegó este mes, el siguiente cobro es el del mes entrante.
    const mesCobro = cobrados.has(r.comercio) ? sumarMeses(mes, 1) : mes;
    agregar({
      tipo: 'recurrente',
      fecha: diaDelMes(mesCobro, r.dia),
      titulo: r.comercio,
      monto: r.monto,
      detalle: 'cobro recurrente',
    });
  }

  for (const d of datos.deudas || []) {
    if (!(aEntero(d.pagoMinimo) > 0) || saldoDeuda(d, tx) <= 0) continue;
    const abonoDelMes = tx.some(
      (t) => t.type === 'pago_deuda' && t.deudaId === d.id && cuenta(t) && String(t.date).slice(0, 7) === mes,
    );
    if (abonoDelMes) continue;
    agregar({
      tipo: 'deuda',
      fecha: null,
      titulo: d.nombre,
      monto: aEntero(d.pagoMinimo),
      detalle: 'cuota de este mes',
    });
  }

  for (const inv of datos.investments || []) {
    if (!inv.startDate) continue;
    const v = vencimientoCdt(inv);
    if (v.fecha < hoy) continue;
    agregar({
      tipo: 'cdt',
      fecha: v.fecha,
      titulo: `CDT ${inv.entity}`,
      monto: v.neto,
      detalle: 'vence y vuelve a tu cuenta',
      entra: true,
    });
  }

  // Lo atrasado primero; lo que no tiene fecha exacta, al final.
  return salida.sort((a, b) => (a.dias ?? Infinity) - (b.dias ?? Infinity) || b.monto - a.monto);
}

/**
 * Patrimonio neto al cierre de cada uno de los últimos meses (el actual, a la fecha).
 * Se reconstruye con los movimientos hasta cada corte. Es una aproximación: las deudas y tarjetas
 * se toman con su saldo inicial registrado, aunque se hayan creado después.
 * @returns {Array<{mes:string, neto:number, activos:number, pasivos:number}>}
 */
export function patrimonioHistorico(datos, mesActual, meses = 6) {
  const fechas = datos.transactions.map((t) => String(t.date).slice(0, 7)).filter((m) => m.length === 7);
  if (!fechas.length) return [];
  const primero = fechas.reduce((a, b) => (a < b ? a : b));
  const salida = [];
  for (let k = meses - 1; k >= 0; k--) {
    const mes = sumarMeses(mesActual, -k);
    if (mes < primero) continue;
    const corte = diaDelMes(mes, 31);
    const p = patrimonio({
      ...datos,
      transactions: datos.transactions.filter((t) => String(t.date) <= corte),
      investments: (datos.investments || []).filter((i) => !i.startDate || i.startDate <= corte),
    });
    salida.push({ mes, neto: p.neto, activos: p.activos, pasivos: p.pasivos });
  }
  return salida;
}
