/** Conciliación: vincula un movimiento ingerido con uno que el usuario ya registró a mano. */

import { diasEntre } from '../domain/fechas.js';

/**
 * Busca un movimiento manual sin vincular, del mismo tipo y monto, a ±1 día.
 * @returns {object|null}
 */
export function buscarCandidatoManual(mov, transacciones) {
  return (
    transacciones.find(
      (t) =>
        (t.origen === 'manual' || !t.origen) &&
        !t.fuentes?.length &&
        t.type === mov.type &&
        t.amount === mov.amount &&
        Math.abs(diasEntre(t.date, mov.date)) <= 1,
    ) ?? null
  );
}

/** Lista los pendientes con su posible registro manual. */
export function paresPorConciliar(transacciones) {
  return transacciones
    .filter((t) => t.conciliarCon && t.estado === 'pendiente_revision')
    .map((ingerido) => ({ ingerido, manual: transacciones.find((t) => t.id === ingerido.conciliarCon) ?? null }))
    .filter((par) => par.manual);
}

/** Vincula: el registro manual conserva sus datos y gana las fuentes; el ingerido desaparece. */
export function vincular(datos, ingeridoId) {
  const ingerido = datos.transactions.find((t) => t.id === ingeridoId);
  const manual = ingerido && datos.transactions.find((t) => t.id === ingerido.conciliarCon);
  if (!ingerido || !manual) throw new Error('No hay un movimiento manual para vincular');
  manual.fuentes = [...(manual.fuentes || []), ...ingerido.fuentes];
  manual.comercio = manual.comercio || ingerido.comercio;
  for (const item of datos.ingesta) {
    if (item.movimientoId === ingerido.id) item.movimientoId = manual.id;
  }
  datos.transactions = datos.transactions.filter((t) => t.id !== ingerido.id);
  return manual;
}

/** Son movimientos distintos: quita la sugerencia y deja el ingerido en revisión normal. */
export function mantenerSeparados(datos, ingeridoId) {
  const ingerido = datos.transactions.find((t) => t.id === ingeridoId);
  if (!ingerido) throw new Error('El movimiento ya no existe');
  delete ingerido.conciliarCon;
  return ingerido;
}
