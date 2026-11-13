/**
 * Salud financiera: los cinco indicadores que más predicen problemas de dinero, con su meta y
 * qué hacer. Usa promedios de meses cerrados para que un mes a medias no distorsione.
 *
 * Metas de referencia (prácticas comunes de planificación personal):
 * - Fondo de emergencia: 3 a 6 meses de gastos en dinero disponible.
 * - Tasa de ahorro: 20 % o más del ingreso.
 * - Uso de tarjetas: 30 % o menos del cupo.
 * - Carga de deuda: pagos mínimos de 20 % o menos del ingreso (más de 36 % es zona de riesgo).
 */

import { aEntero, sumar, formatear } from './money.js';
import { sumarMeses, ultimoDiaMes } from './fechas.js';
import { estadisticasMes, saldoCuenta, saldoDeuda } from './movimientos.js';
import { saldoTarjeta, pagoMinimoEstimado } from './tarjetas.js';
import { avancePresupuestos, saldoRecurso } from './presupuesto.js';

const MESES_PROMEDIO = 3;
const META_AHORRO_DEFECTO = 20;

/** Meta de ahorro del usuario en porcentaje del ingreso (5 a 80); por defecto, 20 %. */
export function metaAhorro(datos) {
  const m = Number(datos?.settings?.metaAhorro);
  return Number.isFinite(m) && m >= 5 && m <= 80 ? Math.round(m) : META_AHORRO_DEFECTO;
}

/** Promedios de ingreso y gasto de los últimos meses cerrados que tienen movimientos. */
export function promediosMensuales(transacciones, mesActual, meses = MESES_PROMEDIO) {
  const usados = [];
  for (let k = 1; k <= 12 && usados.length < meses; k++) {
    const mes = sumarMeses(mesActual, -k);
    const s = estadisticasMes(transacciones, mes);
    if (s.income > 0 || s.expense > 0) usados.push(s);
  }
  if (!usados.length) return { ingreso: 0, gasto: 0, meses: 0 };
  return {
    ingreso: Math.round(sumar(usados.map((s) => s.income)) / usados.length),
    gasto: Math.round(sumar(usados.map((s) => s.expense)) / usados.length),
    meses: usados.length,
  };
}

/** Dinero disponible de inmediato: cuentas, efectivo y bolsillos (no CDT ni metas). */
export function liquidez(datos) {
  const cuentas = sumar(datos.accounts.map((a) => saldoCuenta(a, datos.transactions)));
  const bolsillos = sumar(
    (datos.pockets || []).map(
      (p) => aEntero(p.startBalance) + saldoRecurso(datos.transactions, 'pocket', p.id),
    ),
  );
  return cuentas + bolsillos;
}

const nivel = (valor, bueno, regular, mayorEsMejor = true) =>
  mayorEsMejor
    ? valor >= bueno
      ? 'ok'
      : valor >= regular
        ? 'alerta'
        : 'mal'
    : valor <= bueno
      ? 'ok'
      : valor <= regular
        ? 'alerta'
        : 'mal';

/**
 * Indicadores de salud financiera.
 * @returns {Array<{id:string, titulo:string, valor:string, meta:string, estado:'ok'|'alerta'|'mal'|'sin_datos', consejo:string}>}
 */
export function indicadoresSalud(datos, mesActual) {
  const prom = promediosMensuales(datos.transactions, mesActual);
  const meta = metaAhorro(datos);
  const salida = [];

  // 1. Fondo de emergencia
  const liquido = liquidez(datos);
  if (prom.gasto > 0) {
    const meses = Math.round((liquido / prom.gasto) * 10) / 10;
    const estado = nivel(meses, 3, 1);
    salida.push({
      id: 'emergencia',
      titulo: 'Fondo de emergencia',
      valor: `${meses.toLocaleString('es-CO')} meses`,
      meta: '3 a 6 meses de gastos',
      estado,
      consejo:
        estado === 'ok'
          ? 'Tienes colchón. Lo que pase de 6 meses puede rendir más en un CDT.'
          : `Te faltan ${formatear(Math.max(0, prom.gasto * 3 - liquido))} para 3 meses. Separa un bolsillo solo para esto y abónale apenas recibas ingresos.`,
    });
  } else {
    salida.push(sinDatos('emergencia', 'Fondo de emergencia', '3 a 6 meses de gastos'));
  }

  // 2. Tasa de ahorro (promedio de meses cerrados)
  if (prom.ingreso > 0) {
    const tasa = Math.round(((prom.ingreso - prom.gasto) / prom.ingreso) * 100);
    const estado = nivel(tasa, meta, meta / 2);
    salida.push({
      id: 'ahorro',
      titulo: 'Ahorro promedio (3 meses)',
      valor: `${tasa} %`,
      meta: `${meta} % o más del ingreso`,
      estado,
      consejo:
        estado === 'ok'
          ? 'Vas bien. Automatiza el ahorro el día de pago para mantenerlo.'
          : `Para llegar al ${meta} % necesitas gastar ${formatear(Math.round(prom.ingreso * (1 - meta / 100)))} al mes o menos (hoy ${formatear(prom.gasto)}). Revisa la categoría más alta y los recurrentes.`,
    });
  } else {
    salida.push(sinDatos('ahorro', 'Ahorro promedio (3 meses)', `${meta} % o más del ingreso`));
  }

  // 3. Uso de tarjetas
  const tarjetas = (datos.tarjetas || []).filter((t) => t.estado !== 'cerrada');
  const cupo = sumar(tarjetas.map((t) => t.cupoTotal));
  const deudaTarjetas = sumar(tarjetas.map((t) => Math.max(0, saldoTarjeta(t, datos.transactions))));
  if (cupo > 0) {
    const uso = Math.round((deudaTarjetas / cupo) * 100);
    const estado = nivel(uso, 30, 60, false);
    salida.push({
      id: 'tarjetas',
      titulo: 'Uso de tarjetas',
      valor: `${uso} %`,
      meta: '30 % o menos del cupo',
      estado,
      consejo:
        estado === 'ok'
          ? 'Uso sano. Paga el total de cada corte para no pagar intereses.'
          : `Bajar a 30 % es pagar ${formatear(Math.max(0, deudaTarjetas - Math.round(cupo * 0.3)))}. Prioriza la tarjeta con tasa más alta (simulador avalancha).`,
    });
  }

  // 4. Carga de deuda: pagos mínimos frente al ingreso
  const minimos =
    sumar(
      tarjetas.map((t) =>
        pagoMinimoEstimado(Math.max(0, saldoTarjeta(t, datos.transactions)), t.tasaEA || 0),
      ),
    ) +
    sumar(
      (datos.deudas || []).filter((d) => saldoDeuda(d, datos.transactions) > 0).map((d) => d.pagoMinimo || 0),
    );
  if (minimos > 0 && prom.ingreso > 0) {
    const carga = Math.round((minimos / prom.ingreso) * 100);
    const estado = nivel(carga, 20, 36, false);
    salida.push({
      id: 'deuda',
      titulo: 'Carga de deuda',
      valor: `${carga} %`,
      meta: '20 % o menos del ingreso',
      estado,
      consejo:
        estado === 'ok'
          ? 'Tus cuotas son manejables. Evita diferir compras pequeñas a varias cuotas.'
          : `Pagas ${formatear(minimos)} al mes solo en mínimos. No tomes deuda nueva y usa el simulador para ver cuándo sales.`,
    });
  }

  return salida;
}

function sinDatos(id, titulo, meta) {
  return {
    id,
    titulo,
    valor: '—',
    meta,
    estado: 'sin_datos',
    consejo: 'Aparece cuando tengas al menos un mes completo de ingresos y gastos registrados.',
  };
}

/**
 * Cuánto puedes gastar por día lo que resta del mes.
 * Con presupuestos, es lo que queda de ellos; sin presupuestos, lo que queda del ingreso promedio
 * después de reservar la meta de ahorro (20 % si no se ha cambiado).
 * @param {string} hoy `AAAA-MM-DD`
 * @returns {{base:'presupuesto'|'ingreso'|null, disponible:number, dias:number, porDia:number}}
 */
export function ritmoDelMes(datos, hoy) {
  const mes = hoy.slice(0, 7);
  const dias = ultimoDiaMes(mes) - Number(hoy.slice(8, 10)) + 1;
  const presupuestos = datos.presupuestos || [];
  let base = null;
  let disponible = 0;
  if (presupuestos.length) {
    base = 'presupuesto';
    const avance = avancePresupuestos(presupuestos, datos.transactions, mes);
    disponible = sumar(avance.map((a) => a.limite - a.gastado));
  } else {
    const prom = promediosMensuales(datos.transactions, mes);
    if (prom.ingreso > 0) {
      base = 'ingreso';
      disponible =
        Math.round(prom.ingreso * (1 - metaAhorro(datos) / 100)) -
        estadisticasMes(datos.transactions, mes).expense;
    }
  }
  return { base, disponible, dias, porDia: base && disponible > 0 ? Math.floor(disponible / dias) : 0 };
}

/**
 * Puntaje de salud de 0 a 100: promedio de los indicadores con datos (bien = 100, atención = 55,
 * actúa = 15). Sin ningún indicador con datos devuelve null: no se inventa una nota.
 * @returns {{puntaje:number, etiqueta:'Sólida'|'Estable'|'Frágil', evaluados:number}|null}
 */
export function puntajeSalud(indicadores) {
  const PUNTOS = { ok: 100, alerta: 55, mal: 15 };
  const conDatos = indicadores.filter((i) => i.estado in PUNTOS);
  if (!conDatos.length) return null;
  const puntaje = Math.round(sumar(conDatos.map((i) => PUNTOS[i.estado])) / conDatos.length);
  const etiqueta = puntaje >= 80 ? 'Sólida' : puntaje >= 50 ? 'Estable' : 'Frágil';
  return { puntaje, etiqueta, evaluados: conDatos.length };
}
