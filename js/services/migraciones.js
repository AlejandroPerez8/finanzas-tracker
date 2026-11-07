/**
 * Migraciones versionadas del esquema. Son puras, ordenadas e idempotentes.
 * Sin `schemaVersion`, el dato viene de la v4 de la app (versión 1 del esquema).
 */

import { aEntero } from '../domain/money.js';

export const VERSION_ACTUAL = 2;

/** Mapea el tipo libre de cuenta al vocabulario nuevo sin borrar el original. */
const TIPO_CUENTA = { Ahorros: 'ahorros', Corriente: 'corriente', Efectivo: 'efectivo', Digital: 'billetera' };

const migraciones = {
  /** v1 → v2: montos enteros, campos de ingesta, tarjetas, deudas y presupuestos. */
  1(d) {
    d.accounts = (d.accounts ?? []).map((a) => ({ ...a, startBalance: aEntero(a.startBalance), tipo: a.tipo ?? TIPO_CUENTA[a.type] ?? 'ahorros', alias: a.alias ?? a.name, ultimos4: a.ultimos4 ?? null }));
    d.pockets = (d.pockets ?? []).map((p) => {
      const { balance, ...resto } = p;
      return { ...resto, startBalance: aEntero(p.startBalance ?? balance) };
    });
    d.transactions = (d.transactions ?? []).map((t) => ({
      ...t,
      amount: aEntero(t.amount),
      origen: t.origen ?? 'manual',
      estado: t.estado ?? 'confirmado',
      fuentes: t.fuentes ?? [],
      comercio: t.comercio ?? '',
      tarjetaId: t.tarjetaId ?? null,
      esCuota: t.esCuota ?? false,
    }));
    d.goals = (d.goals ?? []).map((g) => ({ ...g, target: aEntero(g.target), contributions: (g.contributions ?? []).map((c) => ({ ...c, amount: aEntero(c.amount) })) }));
    d.investments = (d.investments ?? []).map((i) => ({ ...i, amount: aEntero(i.amount), termMonths: i.termMonths ?? (i.termDays != null ? Math.max(1, Math.round(i.termDays / 30)) : 12), startDate: i.startDate ?? i.start }));
    d.reports ??= [];
    d.settings ??= { reminderOn: false, reminderHour: 20, lastNotified: null, lastReportMonth: null };
    d.tarjetas ??= [];
    d.ciclos ??= [];
    d.comprasDiferidas ??= [];
    d.deudas ??= [];
    d.ingesta ??= [];
    d.reglas ??= [];
    d.reglasParser ??= [];
    d.presupuestos ??= [];
    d.log ??= [];
    d.settings.ingesta ??= { activa: false, url: '', token: '', intervaloMin: 0, autoConfirmar: true, umbralAutoConfirmar: 0.9, conservarTexto: false, diasTexto: 30 };
    d.settings.sync ??= { cursor: null, ackPendientes: [], ultima: null };
    return d;
  },
};

/**
 * Aplica las migraciones pendientes sobre una copia; el original no se toca.
 * @param {object} original
 * @returns {{datos:object, desde:number, hasta:number, migro:boolean}}
 * @throws si algún paso falla o la versión es más nueva que la app
 */
export function migrar(original) {
  const desde = original.schemaVersion ?? 1;
  if (desde > VERSION_ACTUAL) throw new Error(`Los datos son de una versión más nueva (${desde}). Actualiza la app.`);
  let datos = structuredClone(original);
  for (let v = desde; v < VERSION_ACTUAL; v++) {
    datos = migraciones[v](datos);
    datos.schemaVersion = v + 1;
  }
  datos.schemaVersion = VERSION_ACTUAL;
  return { datos, desde, hasta: VERSION_ACTUAL, migro: desde !== VERSION_ACTUAL };
}
