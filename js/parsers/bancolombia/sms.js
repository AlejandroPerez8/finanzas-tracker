/** Parser de SMS de Bancolombia. Usa el texto tal como llega, sin recortes. */

import { aplicarPatron, normalizarTexto } from './comun.js';

/** @param {Array} patrones compilados */
export function crearParserSms(patrones) {
  return {
    id: 'bancolombia_sms',
    fuentes: ['sms', 'manual'],
    analizar(texto, recibidoEn) {
      const normalizado = normalizarTexto(texto);
      if (!/bancolombia/i.test(normalizado) && !/\$|cop/i.test(normalizado)) return null;
      return mejor(patrones, normalizado, recibidoEn);
    },
  };
}

/** El primer patrón con la confianza más alta gana; el orden del JSON resuelve empates. */
export function mejor(patrones, normalizado, recibidoEn) {
  let ganador = null;
  for (const p of patrones) {
    const r = aplicarPatron(p, normalizado, recibidoEn);
    if (r && (!ganador || r.confianza > ganador.confianza)) ganador = r;
  }
  return ganador;
}
