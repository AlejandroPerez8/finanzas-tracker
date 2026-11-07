/** Exportación plana para Power BI: hechos y dimensiones. Ver docs/EXPORT_POWERBI.md. */

import { tipoCanonico, cuenta } from '../domain/movimientos.js';
import { aEntero } from '../domain/money.js';
import { saldoTarjeta } from '../domain/tarjetas.js';
import { saldoCuenta } from '../domain/movimientos.js';

/** Escapa una celda; neutraliza fórmulas para que abrirla en Excel no ejecute nada. */
export function celdaCsv(valor) {
  let t = valor == null ? '' : String(valor);
  if (typeof valor === 'string' && /^[=+\-@\t\r]/.test(t)) t = `'${t}`;
  return /[",\n\r;]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}

/** Convierte filas en CSV con cabecera. */
export function aCsv(columnas, filas) {
  const lineas = [columnas.map(celdaCsv).join(',')];
  for (const f of filas) lineas.push(columnas.map((c) => celdaCsv(f[c])).join(','));
  return lineas.join('\r\n');
}

/** Tablas normalizadas. Sin texto de mensajes, tokens ni últimos 4 de cuentas. */
export function tablasPowerBi(datos, hoy) {
  const tx = datos.transactions;
  const movimientos = tx.filter(cuenta).map((t) => ({
    id: t.id,
    fecha: t.date,
    hora: t.hora ?? '',
    monto: aEntero(t.amount),
    tipo: tipoCanonico(t.type),
    cuenta_id: t.accountId ?? '',
    tarjeta_id: t.tarjetaId ?? '',
    categoria: t.category ?? '',
    comercio: t.comercio ?? '',
    origen: t.origen ?? 'manual',
    es_cuota: t.esCuota ? 1 : 0,
  }));
  const fechas = tx.map((t) => t.date).filter(Boolean).sort();
  const calendario = [];
  if (fechas.length) {
    const hasta = hoy > fechas[fechas.length - 1] ? hoy : fechas[fechas.length - 1];
    for (let d = new Date(`${fechas[0].slice(0, 7)}-01T00:00:00Z`); d.toISOString().slice(0, 10) <= hasta; d = new Date(d.getTime() + 86400000)) {
      const iso = d.toISOString().slice(0, 10);
      calendario.push({ fecha: iso, anio: iso.slice(0, 4), mes: iso.slice(5, 7), anio_mes: iso.slice(0, 7), dia: iso.slice(8, 10), dia_semana: d.getUTCDay() });
    }
  }
  return {
    movimientos,
    cuentas: datos.accounts.map((a) => ({ id: a.id, nombre: a.name, tipo: a.tipo ?? a.type ?? '', saldo: saldoCuenta(a, tx) })),
    categorias: [...new Set(movimientos.map((m) => m.categoria).filter(Boolean))].sort().map((c) => ({ categoria: c })),
    tarjetas: (datos.tarjetas || []).map((t) => ({ id: t.id, alias: t.alias, banco: t.banco ?? '', cupo_total: aEntero(t.cupoTotal), saldo: saldoTarjeta(t, tx), tasa_ea: t.tasaEA })),
    deudas: (datos.deudas || []).map((d) => ({ id: d.id, nombre: d.nombre ?? '', tipo: d.tipo, saldo: aEntero(d.saldo), tasa_ea: d.tasaEA })),
    calendario,
  };
}

/** Cada tabla como CSV: `{ "movimientos.csv": "...", ... }`. */
export function archivosCsv(tablas) {
  const salida = {};
  for (const [nombre, filas] of Object.entries(tablas)) {
    salida[`${nombre}.csv`] = filas.length ? aCsv(Object.keys(filas[0]), filas) : '';
  }
  return salida;
}
