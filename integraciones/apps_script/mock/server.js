/**
 * Mock local del script de ingesta. Mismo contrato que Code.gs (docs/API_INGESTA.md).
 * Uso: node integraciones/apps_script/mock/server.js [--static] [--port 8787]
 * Con --static también sirve la app.
 */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.webmanifest': 'application/json',
};
export const TOKEN_MOCK = 'token-de-prueba-local-0123456789abcdef';

/** Crea el servidor con estado propio, para que cada prueba quede aislada. */
export function crearMock({
  token = TOKEN_MOCK,
  servirApp = false,
  limitePorMinuto = Infinity,
  // `legado`: imita un Code.gs anterior a 5.2, que solo aceptaba SMS por POST.
  legado = false,
} = {}) {
  const filas = [];
  let peticiones = 0;
  const estado = { filas, peticionesAck: [], fallarProximas: 0, tokensEnUrl: 0 };

  function agregar(source, messageId, receivedAt, textoRelevante) {
    const existente = filas.find((f) => f.messageId === messageId);
    if (existente) return existente.rowId;
    const rowId = `r_${String(filas.length + 1).padStart(6, '0')}`;
    filas.push({
      rowId,
      source,
      messageId,
      receivedAt,
      senderTag: 'bancolombia',
      textoRelevante: textoRelevante.slice(0, 600),
      estado: 'nuevo',
    });
    return rowId;
  }
  estado.agregar = agregar;

  /** ping, pending y ack: mismos parámetros por GET (legado) o en el cuerpo de un POST. */
  function atender(q) {
    const accion = q.action;
    if (accion === 'ping')
      return {
        ok: true,
        version: 1,
        serverTime: new Date().toISOString(),
        pendientes: filas.filter((f) => f.estado === 'nuevo').length,
      };
    if (accion === 'pending') {
      const limite = Math.min(Math.max(Number(q.limit) || 50, 1), 100);
      let i = Number(q.cursor) || 0;
      const items = [];
      for (; i < filas.length && items.length < limite; i++) {
        if (filas[i].estado !== 'nuevo') continue;
        const item = { ...filas[i] };
        delete item.estado;
        items.push(item);
      }
      return { ok: true, version: 1, serverTime: new Date().toISOString(), cursor: String(i), items };
    }
    if (accion === 'ack') {
      const ids = (Array.isArray(q.ids) ? q.ids : String(q.ids ?? '').split(',')).filter(Boolean);
      if (!ids.length) return { ok: false, error: 'bad_request' };
      estado.peticionesAck.push(ids);
      let acked = 0;
      for (const f of filas) {
        if (ids.includes(f.rowId)) {
          f.estado = 'importado';
          acked++;
        }
      }
      return { ok: true, acked };
    }
    return { ok: false, error: 'bad_request' };
  }

  const servidor = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const json = (o, status = 200) => {
      res.writeHead(status, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
      res.end(JSON.stringify(o));
    };
    if (url.pathname === '/exec') {
      peticiones++;
      if (estado.fallarProximas > 0) {
        estado.fallarProximas--;
        return json({ ok: false, error: 'internal' }, 500);
      }
      if (peticiones > limitePorMinuto) return json({ ok: false, error: 'rate_limited' });
      if (req.method === 'POST') {
        let cuerpo = '';
        for await (const trozo of req) cuerpo += trozo;
        let p;
        try {
          p = JSON.parse(cuerpo);
        } catch {
          return json({ ok: false, error: 'bad_request' });
        }
        if (p.token !== token) return json({ ok: false, error: 'unauthorized' });
        if (p.action && !legado) return json(atender(p));
        if (p.source !== 'sms' || typeof p.text !== 'string' || !p.text.trim())
          return json({ ok: false, error: 'bad_request' });
        return json({
          ok: true,
          rowId: agregar(
            'sms',
            `sms_${p.text}|${p.receivedAt}`,
            p.receivedAt ?? new Date().toISOString(),
            p.text,
          ),
        });
      }
      const q = url.searchParams;
      if (q.has('token')) estado.tokensEnUrl++;
      if (q.get('token') !== token) return json({ ok: false, error: 'unauthorized' });
      return json(atender(Object.fromEntries(q)));
    }
    if (!servirApp) return json({ ok: false, error: 'bad_request' }, 404);
    try {
      const ruta = normalize(url.pathname === '/' ? '/index.html' : url.pathname);
      const archivo = join(RAIZ, ruta);
      if (!archivo.startsWith(RAIZ) || /(^|\/)\.[^/]/.test(ruta)) throw new Error('fuera de la raíz');
      const contenido = await readFile(archivo);
      res.writeHead(200, { 'content-type': TIPOS[extname(archivo)] ?? 'application/octet-stream' });
      res.end(contenido);
    } catch {
      res.writeHead(404);
      res.end('No encontrado');
    }
  });
  return { servidor, estado };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const iPuerto = process.argv.indexOf('--port');
  const puerto = iPuerto > 0 ? Number(process.argv[iPuerto + 1]) : 8787;
  const { servidor } = crearMock({ servirApp: process.argv.includes('--static') });
  servidor.listen(puerto, '127.0.0.1', () => {
    console.log(`Mock en http://localhost:${puerto}/exec (token: ${TOKEN_MOCK})`);
    if (process.argv.includes('--static')) console.log(`App en http://localhost:${puerto}/`);
  });
}
