/**
 * Pruebas de humo en un navegador real contra el mock.
 * Uso: CHROMIUM=/ruta/chrome npm run test:smoke   (sale con 1 si alguna falla)
 */
import { chromium } from 'playwright-core';
import { readFileSync, mkdirSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { crearMock, TOKEN_MOCK } from '../../integraciones/apps_script/mock/server.js';

const SALIDA = process.env.SMOKE_SALIDA;
if (SALIDA) mkdirSync(SALIDA, { recursive: true });

function buscarChromium() {
  if (process.env.CHROMIUM) return process.env.CHROMIUM;
  const base = join(homedir(), '.cache/ms-playwright');
  const carpeta = readdirSync(base).find((n) => /^chromium-\d+/.test(n));
  return join(base, carpeta, 'chrome-linux64/chrome');
}

const { servidor, estado } = crearMock({ servirApp: true });
await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${servidor.address().port}/`;
const navegador = await chromium.launch({ executablePath: buscarChromium() });

const errores = [];
async function nuevaPagina(opciones = {}) {
  const contexto = await navegador.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block', ...opciones });
  const pagina = await contexto.newPage();
  // Las fuentes externas no están disponibles en la prueba; no son errores de la app.
  await contexto.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  pagina.on('pageerror', (e) => errores.push(`pageerror: ${e.message}`));
  pagina.on('console', (m) => {
    if (m.type() === 'error' && !/fonts|ERR_FAILED|net::/.test(m.text() + m.location().url)) errores.push(`console: ${m.text()}`);
  });
  return { contexto, pagina };
}
const tab = (p, nombre) => p.locator('#navInferior button', { hasText: nombre }).click();
const foto = async (p, nombre) => { if (SALIDA) await p.screenshot({ path: join(SALIDA, `${nombre}.png`), fullPage: true }); };
const datos = (p) => p.evaluate(() => new Promise((res) => {
  const r = indexedDB.open('finanzas-tracker-db', 1);
  r.onsuccess = () => { const g = r.result.transaction('kv').objectStore('kv').get('finance-data'); g.onsuccess = () => res(JSON.parse(g.result)); };
}));

const pruebas = [];
const prueba = (n, f) => pruebas.push([n, f]);
const COMPARTIDO = {};

prueba('abre datos v4 sin pérdida y conserva un respaldo', async () => {
  const { pagina: p, contexto } = await nuevaPagina();
  const v4 = readFileSync(new URL('../fixtures/export-v4-sintetico.json', import.meta.url), 'utf8');
  await p.addInitScript((d) => { if (!localStorage.getItem('sembrado')) { localStorage.setItem('finance-data', d); localStorage.setItem('sembrado', '1'); } }, v4);
  await p.goto(BASE);
  await p.waitForSelector('#vistaPanel .patrimonio-neto');
  const d = await datos(p);
  assert.equal(d.schemaVersion, 2);
  assert.equal(d.transactions.length, 6);
  assert.equal(await p.textContent('#headerTotalBalance'), '$2.919.999', 'saldo de ahorros y efectivo');
  assert.ok(await p.evaluate(() => localStorage.getItem('finance-data.respaldo.v1')), 'hay instantánea previa');
  await foto(p, '01-inicio');
  await contexto.close();
});

prueba('flujo completo: mensaje del script → pendiente → confirmado → ack', async () => {
  const { pagina: p } = await nuevaPagina();
  COMPARTIDO.p = p;
  await p.goto(BASE);
  await tab(p, 'Ahorro');
  await p.click('#accFormToggle');
  await p.fill('#accName', 'Ahorros');
  await p.fill('#accBalance', '1000000');
  await p.fill('#accUltimos4', '1234');
  await p.click('#addAccBtn');
  await p.waitForSelector('.acc-row');
  assert.ok(!(await p.textContent('#accountsList')).includes('undefined'));

  estado.agregar('gmail', 'g1', '2026-11-07T07:58:12-05:00', 'Bancolombia: Pagaste $5,500.00 a COMUNICACION CELULAR COMCEL S desde tu producto 1234 el 05/11/2026 07:02:40.');
  estado.agregar('gmail', 'g2', '2026-11-07T07:58:12-05:00', 'Bancolombia: Recibiste una transferencia por $116,500 de <img src=x onerror=alert(1)> EJEMPLO en tu cuenta **1234, el 01/11/2026 a las 14:23.');
  estado.agregar('gmail', 'g3', '2026-11-07T07:58:12-05:00', 'Bancolombia: formato <b>desconocido</b> nunca visto');

  await tab(p, 'Más');
  const url = p.locator('#vistaAjustesIngesta input[type=url]');
  await url.fill(`${BASE}exec`);
  await p.locator('#vistaAjustesIngesta input[type=password]').fill(TOKEN_MOCK);
  await p.getByRole('button', { name: 'Probar conexión y activar' }).click();
  await p.waitForFunction(() => document.querySelector('.nav-badge') && !document.querySelector('[aria-label*="por revisar"] .nav-badge')?.hidden);
  await tab(p, 'Movs');
  await foto(p, '02-pendientes');
  assert.equal(estado.filas.filter((f) => f.estado === 'nuevo').length, 0, 'ack tras guardar');
  const d = await datos(p);
  assert.equal(d.transactions.find((t) => t.amount === 5500).estado, 'confirmado');
  assert.equal(d.transactions.find((t) => t.amount === 116500).estado, 'pendiente_revision');
  assert.equal(await p.locator('#vistaIngesta img').count(), 0, 'sin HTML inyectado');
  assert.ok(!JSON.stringify(d.ingesta.find((i) => i.rowId === 'r_000001')).includes('COMCEL'), 'sin texto crudo');

  const fila = p.locator('.fila-pendiente').first();
  assert.equal(await fila.getByLabel('Cuenta de destino').isVisible(), false);
  await fila.getByLabel('Tipo').selectOption('transferencia');
  assert.equal(await fila.getByLabel('Cuenta de destino').isVisible(), true, 'el campo aparece al cambiar el tipo');
  await fila.getByLabel('Tipo').selectOption('income');
  await p.getByRole('button', { name: 'Confirmar' }).click();
  await p.waitForFunction(() => document.querySelectorAll('.subtab')[0].textContent.includes('(0)'));
  assert.equal((await datos(p)).transactions.find((t) => t.amount === 116500).estado, 'confirmado');
  await p.locator('.subtab', { hasText: 'No reconocidos' }).click();
  assert.ok((await p.textContent('#vistaIngesta')).includes('<b>desconocido</b>'), 'se ve como texto');
  await p.getByRole('button', { name: 'Ignorar' }).click();
});

prueba('tarjeta: compra a cuotas y pago no cuentan doble', async () => {
  const p = COMPARTIDO.p;
  await tab(p, 'Tarjetas');
  await p.locator('summary', { hasText: 'Agregar tarjeta' }).click();
  const v = p.locator('#vistaTarjetas');
  await v.getByLabel('Alias').fill('Visa prueba');
  await v.getByLabel('Últimos 4 dígitos').fill('5566');
  await v.getByLabel('Cupo total').fill('2000000');
  await v.getByLabel('Día de corte').fill('15');
  await v.getByLabel('Día límite de pago').fill('30');
  await v.getByLabel('Tasa efectiva anual (%)').first().fill('26.82');
  await p.getByRole('button', { name: 'Guardar tarjeta' }).click();
  await p.waitForSelector('.tarjeta-visual');

  await tab(p, 'Movs');
  await p.locator('.type-pill.expense').click();
  await p.fill('#txAmount', '600000');
  await p.fill('#txCategory', 'Otros');
  await p.selectOption('#txAccount', { label: 'Tarjeta Visa prueba' });
  await p.fill('#txCuotas', '6');
  await p.fill('#txComercio', 'ALKOSTO');
  await p.click('#addTxBtn');
  await p.waitForFunction(() => document.querySelector('#historyList').textContent.includes('ALKOSTO') || true);

  await tab(p, 'Tarjetas');
  await p.locator('summary', { hasText: 'Registrar pago' }).click();
  await p.getByLabel('Monto del pago').fill('100000');
  await p.getByRole('button', { name: 'Registrar pago' }).click();
  await p.waitForTimeout(300);
  await foto(p, '03-tarjetas');

  const d = await datos(p);
  assert.equal(d.comprasDiferidas.length, 1);
  assert.ok(d.transactions.some((t) => t.type === 'pago_tarjeta' && t.amount === 100000));
  assert.ok((await p.textContent('#vistaTarjetas .tarjeta-visual')).includes('$500.000'), 'deuda = compra − pago');
  await tab(p, 'Inicio');
  const panel = await p.textContent('#vistaPanel');
  assert.ok(panel.includes('$500.000'), 'la deuda aparece en pasivos');
  await foto(p, '04-panel');
});

prueba('pegado manual y registro funcionan sin conexión, y el SW sirve la app', async () => {
  const { pagina: p, contexto } = await nuevaPagina({ serviceWorkers: 'allow' });
  await p.goto(BASE);
  await p.waitForSelector('#vistaPanel .patrimonio-neto');
  await p.evaluate(() => navigator.serviceWorker.ready);
  await p.reload();
  await p.waitForFunction(() => navigator.serviceWorker.controller);
  await contexto.setOffline(true);
  await p.reload();
  await p.waitForSelector('#vistaPanel .patrimonio-neto');
  await tab(p, 'Movs');
  await p.locator('.subtab', { hasText: 'Importar' }).click();
  await p.getByLabel('Mensajes del banco').fill('Bancolombia: Transferiste $19,000 desde tu cuenta *1234 a la cuenta *00000000000 el 06/11/2026 a las 16:01.\n\nBancolombia: Recargaste 30,000.00 a Tarjeta Civica desde tu cuenta *1234 el 04/11/2026 16:52');
  await p.getByRole('button', { name: 'Importar mensajes' }).click();
  await p.waitForFunction(() => document.querySelectorAll('.subtab')[0].textContent.includes('(2)'));
  await p.fill('#txAmount', '1000');
  await p.click('#addTxBtn');
  await p.waitForTimeout(200);
  assert.equal((await datos(p)).transactions.length, 3);
  await contexto.close();
});

prueba('sin scroll horizontal en ninguna pestaña y objetivos táctiles de 48 px', async () => {
  const p = COMPARTIDO.p;
  for (const t of ['Inicio', 'Movs', 'Tarjetas', 'Ahorro', 'Más']) {
    await tab(p, t);
    const desborde = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (desborde > 0) {
      const culpables = await p.evaluate(() => [...document.querySelectorAll('main *')].filter((e) => e.offsetParent && e.getBoundingClientRect().right > window.innerWidth + 1).slice(0, 5).map((e) => `${e.tagName}#${e.id}.${e.className}`));
      assert.fail(`${t} desborda ${desborde}px: ${culpables.join(' ')}`);
    }
    const pequenos = await p.evaluate(() => [...document.querySelectorAll('button.btn-accent, button.btn-ghost, .nav-btn')].filter((b) => b.offsetParent && b.getBoundingClientRect().height < 47).map((b) => b.textContent.slice(0, 30)));
    assert.deepEqual(pequenos, [], `botones pequeños en ${t}`);
    await foto(p, `05-${t}`);
  }
});

let fallos = 0;
for (const [nombre, fn] of pruebas) {
  try {
    await fn();
    console.log(`✔ ${nombre}`);
  } catch (err) {
    fallos++;
    console.error(`✖ ${nombre}\n  ${err.message}`);
    if (COMPARTIDO.p && SALIDA) await COMPARTIDO.p.screenshot({ path: join(SALIDA, `fallo-${fallos}.png`), fullPage: true }).catch(() => {});
  }
}
if (errores.length) {
  fallos++;
  console.error('✖ Errores en el navegador:\n' + [...new Set(errores)].join('\n'));
}
await navegador.close();
servidor.close();
console.log(fallos ? `${fallos} fallo(s)` : 'Humo correcto');
process.exit(fallos ? 1 : 0);
