/** Registro local acotado de eventos y errores. No se envía a terceros. */

const MAX = 200;
const RE_SECRETO = /([?&]token=)[^&\s]+|\b[a-f0-9]{32,}\b/gi;

/** Agrega un evento al arreglo y recorta a los últimos N. Los tokens nunca quedan en el log. */
export function registrar(log, nivel, mensaje, ahora = new Date().toISOString()) {
  log.push({ nivel, mensaje: String(mensaje).replace(RE_SECRETO, (_, p) => `${p ?? ''}[oculto]`).slice(0, 300), fecha: ahora });
  if (log.length > MAX) log.splice(0, log.length - MAX);
  return log;
}
