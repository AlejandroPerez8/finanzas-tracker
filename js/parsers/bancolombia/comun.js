/** Motor común de los parsers de Bancolombia: aplica patrones editables de patrones.json. */

import { interpretarMonto } from '../../domain/money.js';
import { interpretarFecha, interpretarHora, diaBogota, horaBogota } from '../../domain/fechas.js';
import { normalizarComercio } from '../../domain/categorias.js';

const MAX_ENTRADA = 2000;

/** Quita tildes y compacta espacios y saltos de línea. Conserva símbolos. */
export function normalizarTexto(texto) {
  return String(texto ?? '')
    .slice(0, MAX_ENTRADA)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/(\d)\s*cop\b/gi, '$1') // "$100 COP" → "$100": así los patrones cubren una sola forma
    .trim();
}

/** Compila patrones y descarta los inválidos: una regla mal escrita no debe tumbar la ingesta. */
export function compilarPatrones(definiciones, alError = () => {}) {
  const compilados = [];
  for (const def of definiciones) {
    try {
      compilados.push({
        ...def,
        re: new RegExp(def.regex, 'i'),
        reExige: def.exigeTexto ? new RegExp(def.exigeTexto, 'i') : null,
      });
    } catch (err) {
      alError(`Patrón inválido ${def.id}: ${err.message}`);
    }
  }
  return compilados;
}

/**
 * Aplica un patrón. La confianza baja cuando faltan datos que tuvieron que inferirse.
 * @returns {object|null} resultado con confianza entre 0 y 1
 */
export function aplicarPatron(patron, normalizado, recibidoEn) {
  if (patron.reExige && !patron.reExige.test(normalizado)) return null;
  const m = patron.re.exec(normalizado);
  if (!m) return null;
  const g = m.groups ?? {};
  const monto = interpretarMonto(g.monto);
  const rechazo = patron.tipo === 'rechazo';
  if (!rechazo && (monto == null || monto <= 0)) return null;

  const referencia = recibidoEn ? new Date(recibidoEn) : new Date();
  const fechaTexto = interpretarFecha(g.fecha, referencia);
  const horaTexto = interpretarHora(g.hora);
  let confianza = patron.confianza;
  if (!fechaTexto) confianza -= 0.2;
  if (!horaTexto) confianza -= 0.02;
  const ultimos4 = g.ultimos4 ?? g.ultimos4a ?? null;
  if (!ultimos4 && !patron.verificado) confianza -= 0.05;

  return {
    tipo: patron.tipo,
    patronId: patron.id,
    monto: monto ?? 0,
    moneda: 'COP',
    fecha: fechaTexto ?? diaBogota(referencia),
    hora: horaTexto ?? (fechaTexto ? null : horaBogota(referencia)),
    comercio: g.comercio ? normalizarComercio(g.comercio) : null,
    ultimos4,
    tipoCuenta: g.tipoCuenta ?? null,
    cuotas: g.cuotas ? Number(g.cuotas) : null,
    saldoPosterior: g.saldo ? interpretarMonto(g.saldo) : null,
    referencia: g.referencia ?? null,
    confianza: Math.max(0, Math.round(confianza * 100) / 100),
  };
}
