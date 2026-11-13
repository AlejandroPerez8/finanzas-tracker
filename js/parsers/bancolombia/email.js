/** Parser de correos de Bancolombia. Corta encabezados y pies para evaluar solo la alerta. */

import { mejor, normalizarTexto } from './comun.js';

/** Conserva el texto desde "Bancolombia:" hasta el pie de seguridad o publicitario. */
export function recortarCorreo(texto) {
  const n = normalizarTexto(texto);
  const inicio = n.search(/bancolombia\s*(?::|le informa)/i);
  if (inicio < 0) return '';
  const cuerpo = n.slice(inicio);
  const fin = cuerpo.search(
    /esto es un mensaje automatico|tu seguridad es nuestra|tus gastos tienen nombre/i,
  );
  return fin > 0 ? cuerpo.slice(0, fin).trim() : cuerpo;
}

/** @param {Array} patrones compilados */
export function crearParserEmail(patrones) {
  return {
    id: 'bancolombia_email',
    fuentes: ['gmail', 'manual'],
    analizar(texto, recibidoEn) {
      const recortado = recortarCorreo(texto);
      return recortado ? mejor(patrones, recortado, recibidoEn) : null;
    },
  };
}
