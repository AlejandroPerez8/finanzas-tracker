/** Presupuesto por categoría, recurrentes y panel de patrimonio. */

import { aEntero, sumar } from './money.js';
import { sumarMeses } from './fechas.js';
import { cuenta, estadisticasMes, saldoCuenta, TIPOS_GASTO } from './movimientos.js';
import { saldoTarjeta } from './tarjetas.js';
import { normalizarComercio } from './categorias.js';

/** Avance por categoría; alerta al 80 % y al 100 %. */
export function avancePresupuestos(presupuestos, transacciones, mes) {
  const { byCategory } = estadisticasMes(transacciones, mes);
  return presupuestos.map((p) => {
    const limite = aEntero(p.limite);
    const gastado = byCategory[p.categoria] || 0;
    const porcentaje = limite > 0 ? Math.round((gastado / limite) * 100) : 0;
    const nivel = porcentaje >= 100 ? 'excedido' : porcentaje >= 80 ? 'alerta' : 'ok';
    return { categoria: p.categoria, limite, gastado, porcentaje, nivel };
  });
}

/**
 * Detecta recurrentes: mismo comercio en al menos 3 meses consecutivos terminados y montos a ±15 %
 * de la mediana. Se excluye el mes en curso porque puede no haber llegado el cobro.
 */
export function detectarRecurrentes(transacciones, mesActual) {
  const grupos = new Map();
  for (const t of transacciones) {
    if (!cuenta(t) || !TIPOS_GASTO.has(t.type)) continue;
    const clave = normalizarComercio(t.comercio || t.note);
    if (!clave) continue;
    const mes = String(t.date).slice(0, 7);
    if (mes >= mesActual) continue;
    if (!grupos.has(clave)) grupos.set(clave, new Map());
    const porMes = grupos.get(clave);
    porMes.set(mes, (porMes.get(mes) || 0) + aEntero(t.amount));
  }
  const salida = [];
  for (const [comercio, porMes] of grupos) {
    const meses = [...porMes.keys()].sort();
    let racha = 1;
    let mejor = 1;
    for (let i = 1; i < meses.length; i++) {
      racha = sumarMeses(meses[i - 1], 1) === meses[i] ? racha + 1 : 1;
      mejor = Math.max(mejor, racha);
    }
    if (mejor < 3) continue;
    const montos = [...porMes.values()].sort((a, b) => a - b);
    const mediana = montos[Math.floor(montos.length / 2)];
    if (!montos.every((m) => Math.abs(m - mediana) <= mediana * 0.15)) continue;
    salida.push({ comercio, monto: mediana, meses: montos.length, costoAnual: mediana * 12 });
  }
  return salida.sort((a, b) => b.monto - a.monto);
}

/** Saldo de un recurso (bolsillo, meta, CDT) a partir de sus abonos y retiros. */
function saldoRecurso(transacciones, tipo, id) {
  return transacciones.reduce((s, t) => {
    if (t.targetType !== tipo || t.targetId !== id) return s;
    if (t.type === 'transfer_in') return s + aEntero(t.amount);
    if (t.type === 'withdraw_out') return s - aEntero(t.amount);
    return s;
  }, 0);
}

/** Activos, pasivos y patrimonio neto. */
export function patrimonio(datos) {
  const tx = datos.transactions;
  const cuentas = sumar(datos.accounts.map((a) => saldoCuenta(a, tx)));
  const bolsillos = sumar(datos.pockets.map((p) => aEntero(p.startBalance) + saldoRecurso(tx, 'pocket', p.id)));
  const metas = sumar(
    datos.goals.map((g) => sumar((g.contributions || []).map((c) => c.amount)) + saldoRecurso(tx, 'goal', g.id)),
  );
  const inversiones = sumar(datos.investments.map((i) => aEntero(i.amount) + saldoRecurso(tx, 'investment', i.id)));
  const tarjetas = sumar((datos.tarjetas || []).filter((t) => t.estado !== 'cerrada').map((t) => Math.max(0, saldoTarjeta(t, tx))));
  const otrasDeudas = sumar((datos.deudas || []).map((d) => d.saldo));
  const activos = cuentas + bolsillos + metas + inversiones;
  const pasivos = tarjetas + otrasDeudas;
  return { activos, pasivos, neto: activos - pasivos, desglose: { cuentas, bolsillos, metas, inversiones, tarjetas, otrasDeudas } };
}
