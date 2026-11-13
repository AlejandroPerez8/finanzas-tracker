/** Parser de texto pegado a mano: evalúa el mensaje tal como se pegó, sin recortes. */

import { mejor, normalizarTexto } from './comun.js';

/** @param {Array} patrones compilados */
export function crearParserTexto(patrones) {
  return {
    id: 'bancolombia_texto',
    fuentes: ['manual'],
    analizar(texto, recibidoEn) {
      const normalizado = normalizarTexto(texto);
      if (!/bancolombia/i.test(normalizado) && !/\$|cop/i.test(normalizado)) return null;
      return mejor(patrones, normalizado, recibidoEn);
    },
  };
}
