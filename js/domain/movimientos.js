/**
 * Reglas contables de los movimientos.
 *
 * El campo `type` conserva los valores en inglés que ya hay en los datos del usuario
 * (income, expense, transfer_*, withdraw_*) y agrega los nuevos (ver docs/DECISIONES.md).
 * Compra con tarjeta = `expense` con `tarjetaId` (gasto del mes + aumento de deuda).
 * Pago de tarjeta = `pago_tarjeta`: mueve dinero de cuenta a tarjeta y NO es gasto.
 */

import { aEntero } from './money.js';

export const TIPOS_GASTO = new Set(['expense', 'interes', 'cuota_manejo']);
export const ESTADOS_QUE_NO_CUENTAN = new Set(['pendiente_revision', 'descartado']);

/** Traducción al vocabulario del modelo de datos, usada en exportes. */
const TIPO_CANONICO = {
  income: 'ingreso',
  expense: 'gasto',
  transfer_in: 'abono',
  transfer_out: 'abono_salida',
  withdraw_in: 'retiro_entrada',
  withdraw_out: 'retiro',
  transferencia: 'transferencia',
  pago_tarjeta: 'pago_tarjeta',
  avance: 'avance',
  interes: 'interes',
  cuota_manejo: 'cuota_manejo',
};
export function tipoCanonico(type) {
  return TIPO_CANONICO[type] ?? type;
}

/** Un movimiento pendiente o descartado no afecta saldos ni reportes. */
export function cuenta(t) {
  return !ESTADOS_QUE_NO_CUENTAN.has(t.estado);
}

/** Efecto firmado del movimiento sobre una cuenta. */
export function efectoEnCuenta(t, cuentaId) {
  if (!cuenta(t)) return 0;
  const monto = aEntero(t.amount);
  if (t.cuentaDestinoId === cuentaId && t.type === 'transferencia') return monto;
  if (t.accountId !== cuentaId) return 0;
  // Un cobro cargado a una tarjeta sube la deuda; no toca la cuenta aunque traiga accountId.
  if (TIPOS_GASTO.has(t.type) && t.tarjetaId) return 0;
  if (t.type === 'income' || t.type === 'withdraw_in' || t.type === 'avance') return monto;
  if (TIPOS_GASTO.has(t.type) || ['transfer_out', 'pago_tarjeta', 'transferencia'].includes(t.type)) return -monto;
  return 0;
}

/** Saldo de cuenta: saldo inicial más movimientos. */
export function saldoCuenta(cuentaObj, transacciones) {
  return transacciones.reduce((s, t) => s + efectoEnCuenta(t, cuentaObj.id), aEntero(cuentaObj.startBalance));
}

/** Efecto firmado sobre la deuda de una tarjeta. */
export function efectoEnTarjeta(t, tarjetaId) {
  if (!cuenta(t) || t.tarjetaId !== tarjetaId) return 0;
  const monto = aEntero(t.amount);
  if (TIPOS_GASTO.has(t.type) || t.type === 'avance') return monto;
  if (t.type === 'pago_tarjeta') return -monto;
  return 0;
}

/** Estadísticas del mes `AAAA-MM`: pagos de tarjeta, transferencias y avances no son ingreso ni gasto. */
export function estadisticasMes(transacciones, mes) {
  const delMes = transacciones.filter((t) => cuenta(t) && String(t.date).slice(0, 7) === mes);
  let income = 0;
  let expense = 0;
  const byCategory = {};
  for (const t of delMes) {
    const monto = aEntero(t.amount);
    if (t.type === 'income') income += monto;
    else if (TIPOS_GASTO.has(t.type)) {
      expense += monto;
      const cat = t.category || 'Otros';
      byCategory[cat] = (byCategory[cat] || 0) + monto;
    }
  }
  const balance = income - expense;
  const savingsRate = income > 0 ? Math.round((balance / income) * 100) : 0;
  return { income, expense, balance, savingsRate, byCategory, count: delMes.length };
}
