/**
 * Code.gs corre en Google; aquí se ejecuta con dobles mínimos de las APIs de Apps Script para
 * verificar el contrato: POST con token en el cuerpo, cursor estable y archivo de filas viejas.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createHash } from 'node:crypto';

const CODIGO = readFileSync(new URL('../../integraciones/apps_script/Code.gs', import.meta.url), 'utf8');
const TOKEN = 't'.repeat(48);

function crearHoja() {
  const celdas = [
    ['rowId', 'source', 'messageId', 'receivedAt', 'senderTag', 'textoRelevante', 'estado', 'ackEn'],
  ];
  const rango = (r, c, nr = 1, nc = 1) => ({
    getValues: () => celdas.slice(r - 1, r - 1 + nr).map((f) => f.slice(c - 1, c - 1 + nc)),
    setValues: (v) =>
      v.forEach((fila, i) => {
        celdas[r - 1 + i] ??= Array(8).fill('');
        fila.forEach((x, j) => (celdas[r - 1 + i][c - 1 + j] = x));
      }),
    setValue: (x) => (celdas[r - 1][c - 1] = x),
    setNumberFormat: () => {},
    clearContent: () => {
      for (let i = 0; i < nr; i++)
        for (let j = 0; j < nc; j++) if (celdas[r - 1 + i]) celdas[r - 1 + i][c - 1 + j] = '';
    },
  });
  return {
    celdas,
    getLastRow: () => {
      let n = celdas.length;
      while (n > 1 && celdas[n - 1].every((x) => x === '')) n--;
      return n;
    },
    getRange: rango,
    // appendRow escribe después de la última fila con datos, como en Sheets.
    appendRow(fila) {
      const n = this.getLastRow();
      celdas[n] = fila.map((x) => (typeof x === 'string' ? x.replace(/^'/, '') : x));
    },
  };
}

function cargarScript() {
  const props = new Map([
    ['SHEET_ID', 'hoja'],
    ['TOKEN', TOKEN],
  ]);
  const hoja = crearHoja();
  const ctx = {
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => props.get(k) ?? null,
        setProperty: (k, v) => props.set(k, v),
      }),
    },
    SpreadsheetApp: { openById: () => ({ getSheetByName: () => hoja }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    CacheService: { getScriptCache: () => ({ get: () => null, put() {} }) },
    ContentService: {
      MimeType: { JSON: 'json' },
      createTextOutput: (t) => ({ setMimeType: () => JSON.parse(t) }),
    },
    Utilities: {
      formatDate: (d) => new Date(d).toISOString(),
      computeDigest: (_a, t) => Array.from(createHash('sha256').update(t).digest()),
      DigestAlgorithm: { SHA_256: 'sha' },
      getUuid: () => crypto.randomUUID(),
    },
    Logger: { log() {} },
    console,
  };
  vm.createContext(ctx);
  vm.runInContext(CODIGO, ctx);
  const post = (cuerpo) =>
    ctx.doPost({ postData: { contents: JSON.stringify({ token: TOKEN, ...cuerpo }) } });
  const sms = (text, receivedAt) => post({ source: 'sms', text, receivedAt });
  return { ctx, hoja, props, post, sms };
}

test('Apps Script: ping, pending y ack por POST con el token en el cuerpo', () => {
  const s = cargarScript();
  assert.equal(s.sms('Bancolombia: Compraste $1.000 en X', '2026-11-01T10:00:00-05:00').rowId, 'r_000001');
  assert.equal(s.post({ action: 'ping' }).pendientes, 1);
  const p = s.post({ action: 'pending', cursor: '', limit: 50 });
  assert.deepEqual(
    p.items.map((i) => i.rowId),
    ['r_000001'],
  );
  assert.equal(p.cursor, '1');
  assert.equal(s.post({ action: 'ack', ids: 'r_000001' }).acked, 1);
  assert.equal(s.post({ action: 'ping' }).pendientes, 0);
  assert.equal(s.post({ action: 'ping', token: 'x'.repeat(48) }).error, 'unauthorized');
  // GET sigue funcionando para apps anteriores a 5.2.
  assert.equal(s.ctx.doGet({ parameter: { token: TOKEN, action: 'ping' } }).ok, true);
});

test('Apps Script: archivar lo importado viejo no mueve el cursor ni repite rowId', () => {
  const s = cargarScript();
  const viejo = new Date(Date.now() - 200 * 86400000).toISOString();
  const nuevo = new Date().toISOString();
  s.sms('Bancolombia: A $1', viejo);
  s.sms('Bancolombia: B $2', viejo);
  s.sms('Bancolombia: C $3', nuevo);
  s.post({ action: 'ack', ids: 'r_000001,r_000002' });
  const antes = s.post({ action: 'pending', cursor: '', limit: 50 });
  assert.deepEqual(
    antes.items.map((i) => i.rowId),
    ['r_000003'],
  );

  s.ctx.purgarTexto();
  assert.equal(s.hoja.getLastRow(), 2, 'solo queda la fila sin confirmar');

  // Un SMS nuevo no reutiliza números ya entregados, y el cursor anterior sigue sirviendo.
  assert.equal(s.sms('Bancolombia: D $4', nuevo).rowId, 'r_000004');
  const despues = s.post({ action: 'pending', cursor: antes.cursor, limit: 50 });
  assert.deepEqual(
    despues.items.map((i) => i.rowId),
    ['r_000004'],
  );
  // Desde cero devuelve todo lo pendiente, sin huecos.
  const todo = s.post({ action: 'pending', cursor: '', limit: 50 });
  assert.deepEqual(
    todo.items.map((i) => i.rowId),
    ['r_000003', 'r_000004'],
  );
});

test('Apps Script: una hoja existente sin contador continúa la numeración', () => {
  const s = cargarScript();
  s.sms('Bancolombia: A $1', new Date().toISOString());
  s.sms('Bancolombia: B $2', new Date().toISOString());
  s.props.delete('ULTIMO_ROW'); // como una instalación anterior a 5.2
  assert.equal(s.sms('Bancolombia: C $3', new Date().toISOString()).rowId, 'r_000003');
});
