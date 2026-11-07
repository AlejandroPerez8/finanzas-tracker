/**
 * Deduplicación de movimientos ingeridos.
 *
 * La misma compra puede llegar por SMS y por correo, pero dos compras iguales de una misma
 * fuente son compras distintas. Por eso solo se fusionan mensajes de fuentes diferentes.
 */

import { instanteBogota } from '../domain/fechas.js';
import { normalizarComercio } from '../domain/categorias.js';

const VENTANA_MS = 10 * 60 * 1000;

/** Huella estable para consultas y exportes; la decisión real la toma `esMismoMovimiento`. */
export function huella(m) {
  if (m.referenciaBanco) return `ref|${m.referenciaBanco}`;
  return [m.type, m.amount, m.ultimos4 ?? '', normalizarComercio(m.comercio), m.date].join('|');
}

/** Distancia de edición, para tolerar comercios escritos distinto en SMS y correo. */
function distancia(a, b) {
  let previa = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const actual = [i];
    for (let j = 1; j <= b.length; j++) {
      actual[j] = Math.min(previa[j] + 1, actual[j - 1] + 1, previa[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    previa = actual;
  }
  return previa[b.length];
}

/** Comercios equivalentes: vacío en alguno, contención, o al menos 80 % de similitud. */
export function comerciosParecidos(a, b) {
  const x = normalizarComercio(a);
  const y = normalizarComercio(b);
  if (!x || !y || x === y || x.includes(y) || y.includes(x)) return true;
  return 1 - distancia(x, y) / Math.max(x.length, y.length) >= 0.8;
}

/** ¿Son el mismo movimiento bancario? Ver reglas al inicio del archivo. */
export function esMismoMovimiento(a, b) {
  if (a.referenciaBanco && b.referenciaBanco) return a.referenciaBanco === b.referenciaBanco;
  // Tras dividir un movimiento, sigue valiendo el monto que informó el banco.
  if (a.type !== b.type || (a.montoIngerido ?? a.amount) !== (b.montoIngerido ?? b.amount)) return false;
  if (a.ultimos4 && b.ultimos4 && a.ultimos4 !== b.ultimos4) return false;
  const ta = instanteBogota(a.date, a.hora);
  const tb = instanteBogota(b.date, b.hora);
  // Sin hora en alguno de los dos, basta con el mismo día.
  const cerca = a.hora && b.hora ? Math.abs(ta - tb) <= VENTANA_MS : a.date === b.date;
  return cerca && comerciosParecidos(a.comercio, b.comercio);
}

/**
 * Busca el movimiento existente con el que fusionar el nuevo.
 * Se descartan los que ya tienen un mensaje de esa fuente.
 * @param {object} nuevo candidato
 * @param {string} fuente 'sms' | 'gmail'
 * @param {object[]} existentes
 * @returns {object|null}
 */
export function buscarDuplicado(nuevo, fuente, existentes) {
  for (const t of existentes) {
    // Sin fuentes: es manual o una parte dividida; lo manual se ofrece en Conciliación.
    if (!t.fuentes?.length || t.estado === 'descartado') continue;
    if (t.fuentes.some((f) => f.fuente === fuente)) continue;
    if (esMismoMovimiento(nuevo, t)) return t;
  }
  return null;
}
