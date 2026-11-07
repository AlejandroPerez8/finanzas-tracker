/** Categorización: reglas del usuario > diccionario > sugerencia por tipo. */

import { normalizarComercio } from '../domain/categorias.js';

const POR_TIPO = {
  nomina: 'Salario',
  transferencia_recibida: 'Transferencias recibidas',
  consignacion: 'Otros ingresos',
  transferencia_enviada: 'Transferencias',
  cuota_manejo: 'Cobros bancarios',
  intereses: 'Deudas',
  comision: 'Cobros bancarios',
  cuatro_por_mil: 'Cobros bancarios',
  iva: 'Cobros bancarios',
};

/**
 * @param {string|null} comercio
 * @param {string} tipo tipo devuelto por el parser
 * @param {Array<{comercioNormalizado:string,categoria:string}>} reglas
 * @param {Record<string,string>} diccionario
 * @returns {{categoria:string, fuente:'usuario'|'diccionario'|'tipo'|'defecto'}}
 */
export function categorizar(comercio, tipo, reglas = [], diccionario = {}) {
  const clave = normalizarComercio(comercio);
  if (clave) {
    const regla = reglas.find((r) => r.comercioNormalizado === clave);
    if (regla) return { categoria: regla.categoria, fuente: 'usuario' };
    if (diccionario[clave]) return { categoria: diccionario[clave], fuente: 'diccionario' };
    // Coincidencia por palabras completas: "EXITO CALLE 80" encuentra "EXITO". La más larga gana.
    let mejor = null;
    for (const nombre of Object.keys(diccionario)) {
      if ((` ${clave} `).includes(` ${nombre} `) && (!mejor || nombre.length > mejor.length)) mejor = nombre;
    }
    if (mejor) return { categoria: diccionario[mejor], fuente: 'diccionario' };
  }
  if (POR_TIPO[tipo]) return { categoria: POR_TIPO[tipo], fuente: 'tipo' };
  return { categoria: 'Otros', fuente: 'defecto' };
}

/** Aprende una corrección del usuario, reemplazando la regla previa del mismo comercio. */
export function aprender(reglas, comercio, categoria) {
  const comercioNormalizado = normalizarComercio(comercio);
  if (!comercioNormalizado || !categoria) return reglas;
  return [...reglas.filter((r) => r.comercioNormalizado !== comercioNormalizado), { comercioNormalizado, categoria, origen: 'usuario' }];
}
