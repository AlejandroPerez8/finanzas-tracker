import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { crearMock, TOKEN_MOCK } from '../../integraciones/apps_script/mock/server.js';
import { crearCliente, sincronizar, validarItem, urlValida, ErrorSync } from '../../js/services/sync.js';
import { crearRegistro } from '../../js/parsers/registry.js';
import { migrar } from '../../js/services/migraciones.js';
import { saldoCuenta } from '../../js/domain/movimientos.js';

const leer = (r) => JSON.parse(readFileSync(new URL(r, import.meta.url), 'utf8'));
const registro = crearRegistro(leer('../../js/parsers/bancolombia/patrones.json'));
const PAGO = 'Bancolombia: Pagaste $5,500.00 a COMUNICACION CELULAR COMCEL S desde tu producto 1234 el 05/11/2026 07:02:40.';
const TRANSF = 'Bancolombia: Recibiste una transferencia por $116,500 de PERSONA EJEMPLO en tu cuenta **1234, el 01/11/2026 a las 14:23.';
const FECHA = '2026-11-07T07:58:12-05:00';

async function escenario(t, opciones = {}) {
  const { servidor, estado } = crearMock(opciones);
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
  t.after(() => servidor.close());
  const url = `http://127.0.0.1:${servidor.address().port}/exec`;
  const { datos } = migrar({ accounts: [{ id: 'a', name: 'Ahorros', type: 'Ahorros', startBalance: 0 }] });
  datos.accounts[0].ultimos4 = '1234';
  let i = 0;
  const contexto = { registro, diccionario: leer('../../data/comercios.json'), nuevoId: () => `m${++i}` };
  const cliente = crearCliente({ url, token: TOKEN_MOCK, esperar: async () => {}, timeoutMs: 2000 });
  return { url, estado, datos, contexto, cliente };
}

test('un mensaje llega, se guarda y solo entonces se confirma', async (t) => {
  const e = await escenario(t);
  e.estado.agregar('gmail', 'g1', FECHA, PAGO);
  e.estado.agregar('gmail', 'g2', FECHA, TRANSF);
  const orden = [];
  const r = await sincronizar({ ...e, guardar: async () => orden.push(`guardar:${e.estado.peticionesAck.length}`) });
  assert.equal(r.nuevos, 2);
  assert.equal(r.confirmados, 1);
  assert.equal(r.pendientes, 1);
  assert.deepEqual(e.estado.peticionesAck, [['r_000001', 'r_000002']]);
  assert.equal(orden[0], 'guardar:0', 'guardó antes del ack');
  assert.equal(saldoCuenta(e.datos.accounts[0], e.datos.transactions), -5500);
  assert.ok(e.datos.settings.sync.ultima);
});

test('si guardar falla no se confirma, y el reintento no duplica', async (t) => {
  const e = await escenario(t);
  e.estado.agregar('gmail', 'g1', FECHA, PAGO);
  await assert.rejects(sincronizar({ ...e, guardar: async () => { throw new Error('disco lleno'); } }), /disco lleno/);
  assert.equal(e.estado.peticionesAck.length, 0);
  // Simula la recarga: el cursor en memoria no llegó a persistirse.
  e.datos.settings.sync.cursor = null;
  e.datos.settings.sync.ackPendientes = [];
  await sincronizar({ ...e, guardar: async () => {} });
  assert.equal(e.datos.transactions.length, 1);
  assert.equal(e.estado.peticionesAck.length, 1);
});

test('un ack fallido se reintenta en la siguiente sincronización', async (t) => {
  const e = await escenario(t);
  e.estado.agregar('gmail', 'g1', FECHA, PAGO);
  const fallando = { ...e.cliente, ack: async () => { throw new ErrorSync('red', true); } };
  await assert.rejects(sincronizar({ ...e, cliente: fallando, guardar: async () => {} }));
  assert.deepEqual(e.datos.settings.sync.ackPendientes, ['r_000001']);
  await sincronizar({ ...e, guardar: async () => {} });
  assert.deepEqual(e.datos.settings.sync.ackPendientes, []);
  assert.equal(e.estado.filas[0].estado, 'importado');
  assert.equal(e.datos.transactions.length, 1);
});

test('SMS por POST y correo del mismo movimiento quedan como uno', async (t) => {
  const e = await escenario(t);
  const res = await fetch(e.url, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: JSON.stringify({ token: TOKEN_MOCK, source: 'sms', receivedAt: FECHA, text: PAGO }) });
  assert.equal((await res.json()).ok, true);
  e.estado.agregar('gmail', 'g1', FECHA, PAGO);
  const r = await sincronizar({ ...e, guardar: async () => {} });
  assert.equal(r.duplicados, 1);
  assert.equal(e.datos.transactions.length, 1);
  assert.equal(e.datos.transactions[0].fuentes.length, 2);
});

test('paginación: procesa varios lotes', async (t) => {
  const e = await escenario(t);
  for (let i = 0; i < 7; i++) e.estado.agregar('gmail', `g${i}`, FECHA, PAGO.replace('5,500.00', `${i + 1},000.00`));
  const r = await sincronizar({ ...e, guardar: async () => {}, limite: 3 });
  assert.equal(r.nuevos, 7);
  assert.equal(e.estado.filas.filter((f) => f.estado === 'nuevo').length, 0);
  const r2 = await sincronizar({ ...e, guardar: async () => {} });
  assert.equal(r2.nuevos, 0);
});

test('entradas maliciosas o inválidas se rechazan', async (t) => {
  assert.equal(validarItem(null), null);
  const ok = { rowId: 'r_1', source: 'gmail', receivedAt: FECHA, textoRelevante: 'x' };
  assert.ok(validarItem(ok));
  assert.equal(validarItem({ ...ok, rowId: '<img onerror=x>' }), null);
  assert.equal(validarItem({ ...ok, source: 'otro' }), null);
  assert.equal(validarItem({ ...ok, textoRelevante: 'x'.repeat(3000) }), null);
  assert.equal(validarItem({ ...ok, textoRelevante: 5 }), null);
  assert.equal(validarItem({ ...ok, receivedAt: 'ayer' }), null);
  const e = await escenario(t);
  const cliente = { pendientes: async () => ({ cursor: '1', items: [{ rowId: 'mal mal' }] }), ack: async () => assert.fail('no debe confirmar inválidos') };
  const r = await sincronizar({ ...e, cliente, guardar: async () => {} });
  assert.equal(r.invalidos, 1);
});

test('sin conexión no llama al servidor', async (t) => {
  const e = await escenario(t);
  const r = await sincronizar({ ...e, cliente: null, guardar: async () => assert.fail(), enLinea: () => false });
  assert.equal(r.estado, 'offline');
});

test('cliente: ping, token incorrecto, reintentos, HTML y tiempo agotado', async (t) => {
  const e = await escenario(t);
  assert.equal((await e.cliente.probar()).ok, true);
  const malo = crearCliente({ url: e.url, token: 'x'.repeat(32), esperar: async () => assert.fail('no reintenta') });
  await assert.rejects(malo.probar(), (err) => err.codigo === 'unauthorized');
  e.estado.fallarProximas = 2;
  assert.equal((await e.cliente.probar()).ok, true);
  e.estado.fallarProximas = 9;
  await assert.rejects(e.cliente.probar(), (err) => err.codigo === 'servidor');
  e.estado.fallarProximas = 0;

  const f = (texto, status = 200) => async () => new Response(texto, { status });
  const con = (fn, extra = {}) => crearCliente({ url: e.url, token: TOKEN_MOCK, fetch: fn, esperar: async () => {}, reintentos: 1, ...extra });
  await assert.rejects(con(f('<html>Iniciar sesión</html>')).probar(), (err) => err.codigo === 'respuesta_html' && !err.reintentable);
  await assert.rejects(con(f('5')).probar(), (err) => err.codigo === 'respuesta_invalida');
  await assert.rejects(con(f('{"ok":false,"error":"rate_limited"}')).probar(), (err) => err.codigo === 'rate_limited');
  await assert.rejects(con(f('{"ok":false,"error":"raro"}')).probar(), /raro/);
  await assert.rejects(con(f('{"ok":true,"items":"no"}')).pendientes(), (err) => err.codigo === 'respuesta_invalida');
  await assert.rejects(con(async () => { throw new TypeError('sin red'); }).probar(), (err) => err.codigo === 'red');
  const colgado = (_u, { signal }) => new Promise((_, rej) => signal.addEventListener('abort', () => rej(Object.assign(new Error('x'), { name: 'AbortError' }))));
  await assert.rejects(con(colgado, { timeoutMs: 5, reintentos: 0 }).probar(), (err) => err.codigo === 'timeout');
  assert.throws(() => crearCliente({ url: 'http://evil.example/exec', token: TOKEN_MOCK }), /script.google.com/);
  assert.throws(() => crearCliente({ url: e.url, token: 'corto' }), /32/);
});

test('urlValida', () => {
  assert.equal(urlValida('https://script.google.com/macros/s/x/exec'), true);
  assert.equal(urlValida('http://script.google.com/macros'), false);
  assert.equal(urlValida('https://script.google.com.evil.com/'), false);
  assert.equal(urlValida('no es url'), false);
});

test('mock: contrato de errores', async (t) => {
  const e = await escenario(t);
  const get = async (q) => (await fetch(`${e.url}?${q}`)).json();
  assert.deepEqual(await get('action=ping&token=x'), { ok: false, error: 'unauthorized' });
  assert.deepEqual(await get(`action=raro&token=${TOKEN_MOCK}`), { ok: false, error: 'bad_request' });
  assert.deepEqual(await get(`action=ack&token=${TOKEN_MOCK}`), { ok: false, error: 'bad_request' });
  const post = async (body) => (await fetch(e.url, { method: 'POST', body })).json();
  assert.equal((await post('no json')).error, 'bad_request');
  assert.equal((await post(JSON.stringify({ token: 'x', source: 'sms', text: 'a' }))).error, 'unauthorized');
  assert.equal((await post(JSON.stringify({ token: TOKEN_MOCK, source: 'x', text: 'a' }))).error, 'bad_request');
});
