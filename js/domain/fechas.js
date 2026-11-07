/** Fechas en zona America/Bogota (UTC-5 fijo: Colombia no tiene horario de verano). */

const OFFSET_BOGOTA_MS = 5 * 3600 * 1000;
const pad = (n) => String(n).padStart(2, '0');

/** Devuelve `AAAA-MM-DD` del instante dado, visto en Bogotá. */
export function diaBogota(instante = new Date()) {
  const d = new Date(new Date(instante).getTime() - OFFSET_BOGOTA_MS);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** Devuelve `HH:MM` del instante dado, visto en Bogotá. */
export function horaBogota(instante = new Date()) {
  const d = new Date(new Date(instante).getTime() - OFFSET_BOGOTA_MS);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/** Instante (ms) de un día y hora de Bogotá. Hora ausente = mediodía, para no cambiar de día. */
export function instanteBogota(dia, hora) {
  return Date.parse(`${dia}T${hora || '12:00'}:00-05:00`);
}

/** Serializa un instante en ISO 8601 con la zona de Bogotá. */
export function isoBogota(instante = new Date()) {
  const d = new Date(new Date(instante).getTime() - OFFSET_BOGOTA_MS);
  return `${diaBogota(instante)}T${horaBogota(instante)}:${pad(d.getUTCSeconds())}-05:00`;
}

/** ¿Es una fecha de calendario existente? Rechaza 31/02 y similares. */
export function esDiaValido(a, m, d) {
  const f = new Date(Date.UTC(a, m - 1, d));
  return f.getUTCFullYear() === a && f.getUTCMonth() === m - 1 && f.getUTCDate() === d;
}

/** Diferencia en días `b - a` entre dos `AAAA-MM-DD`. */
export function diasEntre(a, b) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
}

/** Suma días a un `AAAA-MM-DD`. */
export function sumarDias(dia, n) {
  return new Date(Date.parse(`${dia}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
}

/** Suma meses a un `AAAA-MM` (`2026-11` + 2 → `2027-01`). */
export function sumarMeses(mes, n) {
  const [a, m] = mes.split('-').map(Number);
  const d = new Date(Date.UTC(a, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
}

/** Último día del mes `AAAA-MM`. */
export function ultimoDiaMes(mes) {
  const [a, m] = mes.split('-').map(Number);
  return new Date(Date.UTC(a, m, 0)).getUTCDate();
}

/** Arma `AAAA-MM-DD` con el día ajustado al último del mes (día 31 en febrero → 28/29). */
export function diaDelMes(mes, dia) {
  return `${mes}-${pad(Math.min(dia, ultimoDiaMes(mes)))}`;
}

/**
 * Interpreta la fecha de un mensaje (`dd/mm/aaaa`, `dd/mm/aa`, `dd-mm-aaaa`, `dd/mm`).
 * Sin año, usa el más reciente que no quede en el futuro respecto a `referencia`
 * (un mensaje del 31/12 leído el 2 de enero es del año pasado).
 * @returns {string|null} `AAAA-MM-DD` o null si no es una fecha válida
 */
export function interpretarFecha(texto, referencia = new Date()) {
  const m = /^\s*(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\s*$/.exec(String(texto ?? ''));
  if (!m) return null;
  const dia = Number(m[1]);
  const mes = Number(m[2]);
  const hoy = diaBogota(referencia);
  let anio;
  if (m[3]) {
    anio = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  } else {
    anio = Number(hoy.slice(0, 4));
    if (`${anio}-${pad(mes)}-${pad(dia)}` > hoy) anio -= 1;
  }
  return esDiaValido(anio, mes, dia) ? `${anio}-${pad(mes)}-${pad(dia)}` : null;
}

/** Interpreta `HH:MM`, `HH:MM:SS` y `H:MM am/pm`; devuelve `HH:MM` o null. */
export function interpretarHora(texto) {
  const m = /^\s*(\d{1,2}):(\d{2})(?::\d{2})?\s*([ap])?\.?\s*m?\.?\s*$/i.exec(String(texto ?? ''));
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2]);
  const sufijo = m[3]?.toLowerCase();
  if (sufijo === 'p' && h < 12) h += 12;
  if (sufijo === 'a' && h === 12) h = 0;
  return h <= 23 && min <= 59 ? `${pad(h)}:${pad(min)}` : null;
}
