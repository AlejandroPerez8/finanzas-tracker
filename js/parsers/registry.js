/** Registro de parsers: prueba los aplicables a la fuente y elige el de mayor confianza. */

import { compilarPatrones } from './bancolombia/comun.js';
import { crearParserSms } from './bancolombia/sms.js';
import { crearParserEmail } from './bancolombia/email.js';

/**
 * @param {{patrones:Array}} definicion contenido de patrones.json
 * @param {Array} reglasUsuario patrones creados con "Enseñar a la app"
 * @param {(mensaje:string)=>void} [alError]
 */
export function crearRegistro(definicion, reglasUsuario = [], alError) {
  // Las reglas del usuario van primero: en un empate de confianza prevalece lo que enseñó.
  const patrones = compilarPatrones([...reglasUsuario, ...definicion.patrones], alError);
  const parsers = [crearParserSms(patrones), crearParserEmail(patrones)];
  return {
    /**
     * @param {string} texto
     * @param {{fuente?:string, recibidoEn?:string}} [contexto]
     * @returns {object|null}
     */
    analizar(texto, { fuente = 'manual', recibidoEn } = {}) {
      let ganador = null;
      for (const parser of parsers) {
        if (!parser.fuentes.includes(fuente)) continue;
        const r = parser.analizar(texto, recibidoEn);
        if (r && (!ganador || r.confianza > ganador.confianza)) ganador = { ...r, parserId: parser.id };
      }
      return ganador;
    },
  };
}
