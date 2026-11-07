/**
 * Cliente del endpoint de ingesta (docs/API_INGESTA.md) y sincronización.
 * Garantía: el `ack` y el cursor solo avanzan después de guardar localmente.
 */

import { procesarMensaje } from './ingesta.js';

const FUENTES = new Set(['gmail', 'sms']);
const RE_ROWID = /^[\w-]{1,64}$/;
const MAX_TEXTO = 2000;

export class ErrorSync extends Error {
  /** @param {string} codigo @param {boolean} reintentable */
  constructor(codigo, reintentable, mensaje) {
    super(mensaje ?? codigo);
    this.name = 'ErrorSync';
    this.codigo = codigo;
    this.reintentable = reintentable;
  }
}

/** Valida la URL del script: solo HTTPS en dominios de Google, salvo localhost para desarrollo. */
export function urlValida(url) {
  try {
    const u = new URL(url);
    if (u.protocol === 'https:' && u.hostname === 'script.google.com') return true;
    return u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1');
  } catch {
    return false;
  }
}

/** Valida un elemento recibido y devuelve solo los campos conocidos; inválido → null. */
export function validarItem(item) {
  if (!item || typeof item !== 'object') return null;
  const { rowId, source, receivedAt, textoRelevante, messageId, senderTag } = item;
  if (typeof rowId !== 'string' || !RE_ROWID.test(rowId)) return null;
  if (!FUENTES.has(source)) return null;
  if (typeof textoRelevante !== 'string' || !textoRelevante.trim() || textoRelevante.length > MAX_TEXTO) return null;
  if (typeof receivedAt !== 'string' || Number.isNaN(Date.parse(receivedAt))) return null;
  return { rowId, source, receivedAt, textoRelevante, messageId: String(messageId ?? ''), senderTag: String(senderTag ?? '') };
}

/**
 * @param {{url:string, token:string, fetch?:Function, timeoutMs?:number, reintentos?:number, esperar?:(ms:number)=>Promise<void>}} opciones
 */
export function crearCliente({ url, token, fetch: hacerFetch = (...a) => fetch(...a), timeoutMs = 20000, reintentos = 3, esperar = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  if (!urlValida(url)) throw new ErrorSync('url_invalida', false, 'La URL debe ser de script.google.com con HTTPS');
  if (!token || token.length < 32) throw new ErrorSync('token_invalido', false, 'El token debe tener al menos 32 caracteres');

  async function unaVez(params) {
    const q = new URLSearchParams({ ...params, token });
    const ctl = new AbortController();
    const reloj = setTimeout(() => ctl.abort(), timeoutMs);
    let res;
    try {
      res = await hacerFetch(`${url}?${q}`, { redirect: 'follow', signal: ctl.signal });
    } catch (err) {
      throw new ErrorSync(err.name === 'AbortError' ? 'timeout' : 'red', true, 'No se pudo conectar con el script');
    } finally {
      clearTimeout(reloj);
    }
    if (res.status === 429 || res.status >= 500) throw new ErrorSync('servidor', true, `El servidor respondió ${res.status}`);
    const cuerpo = await res.text();
    let json;
    try {
      json = JSON.parse(cuerpo);
    } catch {
      // Apps Script responde HTML cuando pide iniciar sesión o el despliegue cambió.
      throw new ErrorSync('respuesta_html', false, 'El script respondió una página, no datos. Revisa que el despliegue sea "Cualquier usuario".');
    }
    if (!json || typeof json !== 'object') throw new ErrorSync('respuesta_invalida', false, 'Respuesta no válida');
    if (json.ok !== true) {
      const codigo = String(json.error ?? 'desconocido');
      throw new ErrorSync(codigo, codigo === 'internal' || codigo === 'rate_limited', mensajeError(codigo));
    }
    return json;
  }

  async function llamar(params) {
    let ultimo;
    for (let intento = 0; intento <= reintentos; intento++) {
      try {
        return await unaVez(params);
      } catch (err) {
        ultimo = err;
        if (!err.reintentable || intento === reintentos) break;
        await esperar(1000 * 2 ** intento);
      }
    }
    throw ultimo;
  }

  return {
    probar: () => llamar({ action: 'ping' }),
    async pendientes(cursor, limit = 50) {
      const json = await llamar({ action: 'pending', cursor: cursor ?? '', limit: String(limit) });
      if (!Array.isArray(json.items)) throw new ErrorSync('respuesta_invalida', false, 'La lista de mensajes no es válida');
      return { cursor: typeof json.cursor === 'string' ? json.cursor : cursor, items: json.items };
    },
    ack: (ids) => llamar({ action: 'ack', ids: ids.join(',') }),
  };
}

function mensajeError(codigo) {
  return (
    { unauthorized: 'Token incorrecto o rotado', rate_limited: 'Demasiadas consultas; se reintentará', bad_request: 'Petición rechazada', internal: 'Error interno del script' }[codigo] ?? `Error del script: ${codigo}`
  );
}

/**
 * Trae mensajes, los procesa y confirma lo guardado. Repite hasta vaciar.
 * @param {{cliente:object, datos:object, guardar:()=>Promise<void>, contexto:object, enLinea?:()=>boolean, limite?:number, maxLotes?:number}} p
 * @returns {Promise<{estado:'ok'|'offline', nuevos:number, confirmados:number, pendientes:number, noReconocidos:number, invalidos:number, duplicados:number}>}
 */
export async function sincronizar({ cliente, datos, guardar, contexto, enLinea = () => true, limite = 50, maxLotes = 20 }) {
  const resumen = { estado: 'ok', nuevos: 0, confirmados: 0, pendientes: 0, noReconocidos: 0, invalidos: 0, duplicados: 0 };
  if (!enLinea()) return { ...resumen, estado: 'offline' };

  const estado = (datos.settings.sync ??= { cursor: null, ackPendientes: [], ultima: null });
  // Lo que quedó en memoria tras un fallo de guardado se persiste primero: nunca se confirma
  // al servidor algo que no esté en disco. Si vuelve a fallar, aquí se detiene todo.
  await guardar();
  await vaciarAcks(cliente, estado, guardar);

  for (let lote = 0; lote < maxLotes; lote++) {
    const { items, cursor } = await cliente.pendientes(estado.cursor, limite);
    if (!items.length) {
      estado.cursor = cursor ?? estado.cursor;
      break;
    }
    const porConfirmar = [];
    for (const crudo of items) {
      const v = validarItem(crudo);
      if (!v) {
        resumen.invalidos++;
        continue;
      }
      const { resultado } = procesarMensaje(datos, { rowId: v.rowId, fuente: v.source, recibidoEn: v.receivedAt, textoRelevante: v.textoRelevante }, contexto);
      porConfirmar.push(v.rowId);
      if (resultado === 'repetido') continue;
      resumen.nuevos++;
      if (resultado === 'confirmado') resumen.confirmados++;
      else if (resultado === 'pendiente') resumen.pendientes++;
      else if (resultado === 'no_reconocido') resumen.noReconocidos++;
      else if (resultado === 'duplicado') resumen.duplicados++;
    }
    estado.cursor = cursor;
    estado.ackPendientes = [...new Set([...estado.ackPendientes, ...porConfirmar])];
    // Punto clave: si guardar falla, se lanza el error y nunca se envía el ack.
    await guardar();
    await vaciarAcks(cliente, estado, guardar);
    if (items.length < limite) break;
  }
  estado.ultima = contexto.ahora ? contexto.ahora() : new Date().toISOString();
  await guardar();
  return resumen;
}

async function vaciarAcks(cliente, estado, guardar) {
  while (estado.ackPendientes.length) {
    const lote = estado.ackPendientes.slice(0, 50);
    await cliente.ack(lote);
    estado.ackPendientes = estado.ackPendientes.slice(lote.length);
    await guardar();
  }
}
