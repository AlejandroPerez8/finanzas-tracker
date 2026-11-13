/** Registro de parsers: prueba los aplicables a la fuente y elige el de mayor confianza. */

import { compilarPatrones, normalizarTexto } from './bancolombia/comun.js';
import { crearParserEmail } from './bancolombia/email.js';
import { crearParserTexto } from './bancolombia/texto.js';

/**
 * @param {{patrones:Array}} definicion contenido de patrones.json
 * @param {Array} reglasUsuario patrones creados con "Enseñar a la app"
 * @param {(mensaje:string)=>void} [alError]
 */
export function crearRegistro(definicion, reglasUsuario = [], alError) {
  // Las reglas del usuario van primero: en un empate de confianza prevalece lo que enseñó.
  const patrones = compilarPatrones([...reglasUsuario, ...definicion.patrones], alError);
  const parsers = [crearParserEmail(patrones), crearParserTexto(patrones)];
  const publicidad = (definicion.ignorar ?? []).map((r) => new RegExp(r, 'i'));
  return {
    /** ¿Es publicidad del banco? Se compara sin tildes. */
    esPublicidad: (texto) => {
      const n = normalizarTexto(texto);
      return publicidad.some((re) => re.test(n));
    },
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
