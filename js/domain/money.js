/**
 * Dinero en COP como enteros (pesos sin decimales). Nunca usar float para acumular:
 * todo redondeo ocurre aquí, una vez por operación.
 */

/** Convierte un número o texto numérico a entero de pesos (mitad hacia arriba). No numérico → 0. */
export function aEntero(valor) {
  const n = typeof valor === 'number' ? valor : Number(valor);
  if (!Number.isFinite(n)) return 0;
  // El signo se trata aparte: Math.round(-2.5) daría -2 y rompería la simetría.
  return n < 0 ? -Math.round(-n) || 0 : Math.round(n);
}

/** Suma una lista de montos y devuelve un entero. */
export function sumar(montos) {
  return montos.reduce((total, m) => total + aEntero(m), 0);
}

/**
 * Formato colombiano: `$1.234.567`, negativos `-$1.234`.
 * Manual para no depender de los datos de locale del navegador.
 */
export function formatear(valor) {
  const n = aEntero(valor);
  const digitos = String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${n < 0 ? '-' : ''}$${digitos}`;
}

/**
 * Reparte un total en partes enteras proporcionales a `pesos`; la suma da exactamente el total.
 * Método del mayor residuo.
 * @param {number} total
 * @param {number[]} pesos
 * @returns {number[]}
 */
export function prorratear(total, pesos) {
  const entero = aEntero(total);
  const sumaPesos = pesos.reduce((s, p) => s + p, 0);
  if (!pesos.length) return [];
  if (sumaPesos <= 0) throw new RangeError('Los pesos del prorrateo deben sumar más de cero');
  const exactos = pesos.map((p) => (entero * p) / sumaPesos);
  const partes = exactos.map((x) => Math.floor(x));
  let faltante = entero - partes.reduce((s, x) => s + x, 0);
  const orden = exactos.map((x, i) => ({ i, r: x - Math.floor(x) })).sort((a, b) => b.r - a.r || a.i - b.i);
  for (let k = 0; faltante > 0; k = (k + 1) % orden.length, faltante--) partes[orden[k].i] += 1;
  return partes;
}

/**
 * Interpreta un monto escrito por un banco. Acepta `$1,550,555.00`, `$1.234.567`, `1.234.567,89`,
 * `COP 19000`, `$116,500`. Regla: con dos separadores distintos, el último es el decimal; con uno
 * solo, es decimal únicamente si lo siguen 1 o 2 dígitos una sola vez.
 * @param {string} texto
 * @returns {number|null} entero de pesos, o null si no es un monto
 */
export function interpretarMonto(texto) {
  if (texto == null) return null;
  const limpio = String(texto)
    .replace(/cop|\$|\s/gi, '')
    .replace(/[^\d.,]/g, '');
  if (!/\d/.test(limpio)) return null;
  const ultimoPunto = limpio.lastIndexOf('.');
  const ultimaComa = limpio.lastIndexOf(',');
  let parteEntera = limpio;
  let parteDecimal = '';
  if (ultimoPunto >= 0 && ultimaComa >= 0) {
    const corte = Math.max(ultimoPunto, ultimaComa);
    parteEntera = limpio.slice(0, corte);
    parteDecimal = limpio.slice(corte + 1);
  } else if (ultimoPunto >= 0 || ultimaComa >= 0) {
    const sep = ultimoPunto >= 0 ? '.' : ',';
    const trozos = limpio.split(sep);
    const cola = trozos[trozos.length - 1];
    if (trozos.length === 2 && cola.length > 0 && cola.length <= 2) {
      parteEntera = trozos[0];
      parteDecimal = cola;
    }
  }
  const entero = Number(parteEntera.replace(/[.,]/g, '') || '0');
  const decimal = parteDecimal ? Number(`0.${parteDecimal.replace(/\D/g, '') || '0'}`) : 0;
  return Math.round(entero + decimal);
}
