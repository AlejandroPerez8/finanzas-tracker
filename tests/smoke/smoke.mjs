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
import { datosReales } from '../fixtures/datos-reales.mjs';

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
  const contexto = await navegador.newContext({
    viewport: { width: 390, height: 844 },
    serviceWorkers: 'block',
    ...opciones,
  });
  const pagina = await contexto.newPage();
  pagina.on('pageerror', (e) => errores.push(`pageerror: ${e.message}`));
  pagina.on('console', (m) => {
    if (m.type() === 'error' && !/ERR_FAILED|net::/.test(m.text() + m.location().url))
      errores.push(`console: ${m.text()}`);
  });
  return { contexto, pagina };
}
const tab = (p, nombre) => p.locator('#navInferior button', { hasText: nombre }).click();
const foto = async (p, nombre) => {
  if (SALIDA) await p.screenshot({ path: join(SALIDA, `${nombre}.png`), fullPage: true });
};
const datos = (p) =>
  p.evaluate(
    () =>
      new Promise((res) => {
        const r = indexedDB.open('finanzas-tracker-db', 1);
        r.onsuccess = () => {
          const g = r.result.transaction('kv').objectStore('kv').get('finance-data');
          g.onsuccess = () => res(JSON.parse(g.result));
        };
      }),
  );

const pruebas = [];
const prueba = (n, f) => pruebas.push([n, f]);
const COMPARTIDO = {};

prueba('abre datos v4 sin pérdida y conserva un respaldo', async () => {
  const { pagina: p, contexto } = await nuevaPagina();
  const v4 = readFileSync(new URL('../fixtures/export-v4-sintetico.json', import.meta.url), 'utf8');
  await p.addInitScript((d) => {
    if (!localStorage.getItem('sembrado')) {
      localStorage.setItem('finance-data', d);
      localStorage.setItem('sembrado', '1');
    }
  }, v4);
  await p.goto(BASE);
  await p.waitForSelector('#vistaPanel .patrimonio-neto');
  const d = await datos(p);
  assert.equal(d.schemaVersion, 3);
  assert.equal(d.transactions.length, 6);
  assert.equal(await p.textContent('#headerTotalBalance'), '$2.919.999', 'saldo de ahorros y efectivo');
  assert.ok(
    await p.evaluate(() => localStorage.getItem('finance-data.respaldo.v1')),
    'hay instantánea previa',
  );
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

  estado.agregar(
    'gmail',
    'g1',
    '2026-11-07T07:58:12-05:00',
    'Bancolombia: Pagaste $5,500.00 a COMUNICACION CELULAR COMCEL S desde tu producto 1234 el 05/11/2026 07:02:40.',
  );
  estado.agregar(
    'gmail',
    'g2',
    '2026-11-07T07:58:12-05:00',
    'Bancolombia: Recibiste una transferencia por $116,500 de <img src=x onerror=alert(1)> EJEMPLO en tu cuenta **1234, el 01/11/2026 a las 14:23.',
  );
  estado.agregar(
    'gmail',
    'g3',
    '2026-11-07T07:58:12-05:00',
    'Bancolombia: formato <b>desconocido</b> nunca visto',
  );

  await tab(p, 'Más');
  const url = p.locator('#vistaAjustesIngesta input[type=url]');
  await url.fill(`${BASE}exec`);
  await p.locator('#vistaAjustesIngesta input[type=password]').fill(TOKEN_MOCK);
  await p.getByRole('button', { name: 'Probar conexión y activar' }).click();
  await p.waitForFunction(
    () =>
      document.querySelector('.nav-badge') &&
      !document.querySelector('[aria-label*="por revisar"] .nav-badge')?.hidden,
  );
  await tab(p, 'Movs');
  await foto(p, '02-pendientes');
  assert.equal(estado.filas.filter((f) => f.estado === 'nuevo').length, 0, 'ack tras guardar');
  const d = await datos(p);
  assert.equal(d.transactions.find((t) => t.amount === 5500).estado, 'confirmado');
  assert.equal(d.transactions.find((t) => t.amount === 116500).estado, 'pendiente_revision');
  assert.equal(await p.locator('#vistaIngesta img').count(), 0, 'sin HTML inyectado');
  assert.ok(
    !JSON.stringify(d.ingesta.find((i) => i.rowId === 'r_000001')).includes('COMCEL'),
    'sin texto crudo',
  );

  const fila = p.locator('.fila-pendiente').first();
  assert.equal(await fila.getByLabel('Cuenta de destino').isVisible(), false);
  await fila.getByLabel('Tipo').selectOption('transferencia');
  assert.equal(
    await fila.getByLabel('Cuenta de destino').isVisible(),
    true,
    'el campo aparece al cambiar el tipo',
  );
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
  await p.waitForFunction(
    () => document.querySelector('#historyList').textContent.includes('ALKOSTO') || true,
  );

  await tab(p, 'Tarjetas');
  await p.locator('summary', { hasText: 'Registrar pago' }).click();
  await p.getByLabel('Monto del pago').fill('100000');
  await p.getByRole('button', { name: 'Registrar pago' }).dblclick();
  await p.waitForTimeout(300);
  await foto(p, '03-tarjetas');

  const d = await datos(p);
  assert.equal(d.comprasDiferidas.length, 1);
  assert.ok(d.transactions.some((t) => t.type === 'pago_tarjeta' && t.amount === 100000));
  assert.ok(
    (await p.textContent('#vistaTarjetas .tarjeta-visual')).includes('$500.000'),
    'deuda = compra − pago',
  );
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
  await p
    .getByLabel('Mensajes del banco')
    .fill(
      'Bancolombia: Transferiste $19,000 desde tu cuenta *1234 a la cuenta *00000000000 el 06/11/2026 a las 16:01.\n\nBancolombia: Recargaste 30,000.00 a Tarjeta Civica desde tu cuenta *1234 el 04/11/2026 16:52',
    );
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
      const culpables = await p.evaluate(() =>
        [...document.querySelectorAll('main *')]
          .filter((e) => e.offsetParent && e.getBoundingClientRect().right > window.innerWidth + 1)
          .slice(0, 5)
          .map((e) => `${e.tagName}#${e.id}.${e.className}`),
      );
      assert.fail(`${t} desborda ${desborde}px: ${culpables.join(' ')}`);
    }
    const pequenos = await p.evaluate(() =>
      [...document.querySelectorAll('button.btn-accent, button.btn-ghost, .nav-btn')]
        .filter((b) => b.offsetParent && b.getBoundingClientRect().height < 47)
        .map((b) => b.textContent.slice(0, 30)),
    );
    assert.deepEqual(pequenos, [], `botones pequeños en ${t}`);
    await foto(p, `05-${t}`);
  }
});

prueba('montos de millones en 320, 360 y 390 px: sin desbordes ni cifras recortadas', async () => {
  const json = JSON.stringify(datosReales());
  for (const ancho of [320, 360, 390]) {
    const { pagina: p, contexto } = await nuevaPagina({ viewport: { width: ancho, height: 800 } });
    await p.goto(BASE);
    await p.evaluate(
      (valor) =>
        new Promise((res) => {
          const r = indexedDB.open('finanzas-tracker-db', 1);
          r.onupgradeneeded = () => r.result.createObjectStore('kv');
          r.onsuccess = () => {
            const tx = r.result.transaction('kv', 'readwrite');
            tx.objectStore('kv').put(valor, 'finance-data');
            tx.oncomplete = res;
          };
        }),
      json,
    );
    await p.reload();
    await p.waitForSelector('#vistaPanel .patrimonio-neto');
    for (const t of ['Inicio', 'Movs', 'Tarjetas', 'Ahorro', 'Más']) {
      await tab(p, t);
      await p.evaluate(() => document.querySelectorAll('details').forEach((d) => (d.open = true)));
      const r = await p.evaluate(() => ({
        desborde: document.documentElement.scrollWidth - window.innerWidth,
        // Una cifra de dinero nunca debe quedar cortada con "…".
        cifrasCortadas: [...document.querySelectorAll('.monto, .kpi-valor, .sum-card .val')]
          .filter((e) => e.offsetParent && e.scrollWidth > e.clientWidth + 1)
          .map((e) => e.textContent.trim()),
        // Ni partida en dos líneas ("$3.200.0" / "00").
        cifrasPartidas: [...document.querySelectorAll('.monto, .kpi-valor, .sum-card .val')]
          .filter((e) => e.offsetParent && /\$\s?[\d.]+/.test(e.textContent))
          .filter((e) => {
            const rango = document.createRange();
            rango.selectNodeContents(e);
            return new Set([...rango.getClientRects()].map((x) => Math.round(x.top))).size > 1;
          })
          .map((e) => e.textContent.trim()),
      }));
      assert.ok(r.desborde <= 0, `${ancho}px ${t}: desborde de ${r.desborde}px`);
      assert.deepEqual(r.cifrasCortadas, [], `${ancho}px ${t}: cifras recortadas`);
      assert.deepEqual(r.cifrasPartidas, [], `${ancho}px ${t}: cifras partidas en dos líneas`);
    }
    await contexto.close();
  }
});

prueba(
  'celular en otra zona horaria (Punta Cana, UTC): todas las pantallas usan el día de Bogotá',
  async () => {
    // 23:30 del 30 de noviembre en Bogotá ya es 1 de diciembre en Punta Cana y en UTC.
    const instante = Date.parse('2026-11-30T23:30:00-05:00');
    for (const zona of ['America/Santo_Domingo', 'UTC']) {
      const { pagina: p, contexto } = await nuevaPagina({ timezoneId: zona });
      await contexto.addInitScript((ms) => {
        const D = Date;
        Date = class extends D {
          constructor(...a) {
            super(...(a.length ? a : [ms]));
          }
          static now() {
            return ms;
          }
        };
      }, instante);
      await p.goto(BASE);
      await p.waitForSelector('#vistaPanel .patrimonio-neto');
      const r = await p.evaluate(() => ({
        titular: document.getElementById('monthHeadline').textContent,
        historial: document.getElementById('historyMonth').value,
        registro: document.getElementById('txDate').value,
      }));
      assert.match(r.titular, /noviembre/, `${zona}: ${r.titular}`);
      assert.equal(r.historial, '2026-11', zona);
      assert.equal(r.registro, '2026-11-30', zona);
      await contexto.close();
    }
  },
);

prueba('duplicar un movimiento del banco crea una copia manual que sí se concilia', async () => {
  const { pagina: p, contexto } = await nuevaPagina();
  await p.goto(BASE);
  await p.waitForSelector('#vistaPanel .patrimonio-neto');
  await tab(p, 'Ahorro');
  await p.click('#accFormToggle');
  await p.fill('#accName', 'Ahorros');
  await p.fill('#accBalance', '500000');
  await p.fill('#accUltimos4', '1234');
  await p.fill('#accUltimos4Debito', '2436');
  await p.click('#addAccBtn');
  await tab(p, 'Movs');
  const hoy = await p.inputValue('#txDate');
  const [a, m, d] = hoy.split('-');
  const alerta = (comercio) =>
    `Bancolombia: Compraste $18.000,00 en ${comercio} con tu T.Deb **2436, el ${d}/${m}/${a} a las 12:30.`;
  await p.locator('.subtab', { hasText: 'Importar' }).click();
  await p.getByLabel('Mensajes del banco').fill(alerta('ALMUERZO EJEMPLO'));
  await p.getByRole('button', { name: 'Importar mensajes' }).click();
  await p.waitForTimeout(300);
  const original = (await datos(p)).transactions.find((t) => t.amount === 18000);
  const duplicar = p.locator(`button[data-act="dup"][data-id="${original.id}"]`);
  await p.locator('#historyList details.fila', { has: duplicar }).locator('summary').click();
  await duplicar.click();
  await p.waitForTimeout(300);
  const copia = (await datos(p)).transactions.find((t) => t.amount === 18000 && t.id !== original.id);
  assert.equal(copia.origen, 'manual');
  assert.deepEqual(copia.fuentes, []);
  // Más tarde llega el mensaje real de ese segundo almuerzo: se propone conciliar, no se duplica.
  await p.locator('.subtab', { hasText: 'Importar' }).click();
  await p.getByLabel('Mensajes del banco').fill(alerta('OTRO ALMUERZO'));
  await p.getByRole('button', { name: 'Importar mensajes' }).click();
  await p.waitForTimeout(300);
  const nuevo = (await datos(p)).transactions.find(
    (t) => t.amount === 18000 && t.id !== original.id && t.id !== copia.id,
  );
  assert.equal(nuevo.conciliarCon, copia.id);
  await contexto.close();
});

prueba(
  'nombres e ids con HTML (de un respaldo o escritos por el usuario) se muestran como texto',
  async () => {
    const mal = '<img src=x data-inyectado=1><b data-inyectado=1>X</b>';
    const datosMal = datosReales();
    datosMal.pockets[0].name = `Bolsillo ${mal}`;
    datosMal.investments[0].entity = `CDT ${mal}`;
    datosMal.goals[0] = {
      ...datosMal.goals[0],
      id: 'g" data-inyectado="1',
      name: `Meta ${mal}`,
      pocketIds: ['p1'],
      investmentIds: ['i1'],
    };
    datosMal.accounts[0].name = `Cuenta ${mal}`;
    datosMal.tarjetas[0].alias = `Visa ${mal}`;
    const { pagina: p, contexto } = await nuevaPagina();
    await p.goto(BASE);
    await p.evaluate(
      (valor) =>
        new Promise((res) => {
          const r = indexedDB.open('finanzas-tracker-db', 1);
          r.onupgradeneeded = () => r.result.createObjectStore('kv');
          r.onsuccess = () => {
            const tx = r.result.transaction('kv', 'readwrite');
            tx.objectStore('kv').put(valor, 'finance-data');
            tx.oncomplete = res;
          };
        }),
      JSON.stringify(datosMal),
    );
    await p.reload();
    await p.waitForSelector('#vistaPanel .patrimonio-neto');
    for (const t of ['Inicio', 'Movs', 'Tarjetas', 'Ahorro', 'Más']) {
      await tab(p, t);
      await p.evaluate(() => document.querySelectorAll('details').forEach((d) => (d.open = true)));
      assert.equal(await p.locator('[data-inyectado]').count(), 0, `HTML inyectado en ${t}`);
    }
    await contexto.close();
  },
);

prueba('modo discreto oculta toda cifra de dinero y el bloqueo con PIN es opaco', async () => {
  const d = datosReales();
  d.settings.discreto = true;
  const { pagina: p, contexto } = await nuevaPagina();
  await p.goto(BASE);
  await p.evaluate(
    (valor) =>
      new Promise((res) => {
        const r = indexedDB.open('finanzas-tracker-db', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('kv');
        r.onsuccess = () => {
          const tx = r.result.transaction('kv', 'readwrite');
          tx.objectStore('kv').put(valor, 'finance-data');
          tx.oncomplete = res;
        };
      }),
    JSON.stringify(d),
  );
  await p.reload();
  await p.waitForSelector('#vistaPanel .patrimonio-neto');
  for (const t of ['Inicio', 'Movs', 'Tarjetas', 'Ahorro', 'Más']) {
    await tab(p, t);
    const fugas = await p.evaluate(() => {
      const oculto = (e) => {
        for (let n = e; n; n = n.parentElement)
          if (window.getComputedStyle(n).filter.includes('blur')) return true;
        return false;
      };
      return [...document.querySelectorAll('header *, main *')]
        .filter(
          (e) =>
            e.offsetParent &&
            [...e.childNodes].some((n) => n.nodeType === 3 && /\$\s?\d/.test(n.textContent)),
        )
        .filter((e) => !oculto(e))
        .map((e) => e.textContent.trim().slice(0, 40));
    });
    assert.deepEqual(fugas, [], `cifras visibles en modo discreto (${t})`);
  }
  await tab(p, 'Más');
  await p.getByPlaceholder('4 a 8 dígitos').fill('2580');
  await p.getByRole('button', { name: 'Activar PIN' }).click();
  await p.waitForTimeout(500);
  await p.reload();
  await p.waitForSelector('input[aria-label="PIN"]');
  const fondo = await p.evaluate(
    () => window.getComputedStyle(document.getElementById('overlayPin')).backgroundColor,
  );
  assert.ok(!/rgba\(.*,\s*0?\.\d+\)/.test(fondo), `bloqueo translúcido: ${fondo}`);
  await contexto.close();
});

prueba('traslado entre cuentas, abono a una deuda y buscador del historial', async () => {
  const { pagina: p, contexto } = await nuevaPagina();
  await p.goto(BASE);
  await p.waitForSelector('#vistaPanel .patrimonio-neto');
  await tab(p, 'Ahorro');
  for (const [nombre, tipo, saldo] of [
    ['Ahorros', 'Ahorros', '1000000'],
    ['Billetera', 'Efectivo', '0'],
  ]) {
    await p.click('#accFormToggle');
    await p.fill('#accName', nombre);
    await p.selectOption('#accType', tipo);
    await p.fill('#accBalance', saldo);
    await p.click('#addAccBtn');
    await p.waitForFunction(
      (n) => document.querySelectorAll('.acc-row').length === n,
      nombre === 'Ahorros' ? 1 : 2,
    );
  }

  // Traslado: mueve dinero entre cuentas propias y no es ingreso ni gasto.
  await tab(p, 'Movs');
  await p.locator('.type-pill.transfer').click();
  assert.equal(await p.locator('#txCategory').isVisible(), false, 'un traslado no lleva categoría');
  await p.fill('#txAmount', '200000');
  await p.selectOption('#txAccount', { label: 'Ahorros' });
  await p.selectOption('#txDestino', { label: 'Billetera' });
  await p.click('#addTxBtn');
  await p.waitForFunction(() => document.querySelectorAll('#historyList details.fila').length === 1);
  let d = await datos(p);
  const traslado = d.transactions.find((t) => t.type === 'transferencia');
  assert.equal(traslado.amount, 200000);
  assert.ok(
    traslado.accountId && traslado.cuentaDestinoId && traslado.accountId !== traslado.cuentaDestinoId,
  );
  assert.equal(await p.textContent('#headerTotalBalance'), '$1.000.000', 'el total no cambia');
  assert.equal(await p.textContent('#sumExpense'), '$0', 'no cuenta como gasto');

  // Abono a un préstamo: el capital baja la deuda y solo el interés es gasto.
  await tab(p, 'Tarjetas');
  const v = p.locator('#vistaTarjetas');
  await p.locator('summary', { hasText: 'Agregar deuda' }).click();
  await v.getByLabel('Nombre').fill('Libranza');
  await v.getByLabel('Saldo', { exact: true }).fill('4000000');
  await v.getByLabel('Tasa efectiva anual (%)').last().fill('18');
  await v.getByLabel('Pago mínimo', { exact: true }).fill('300000');
  await p.getByRole('button', { name: 'Guardar deuda' }).click();
  await p.locator('summary', { hasText: 'Registrar abono a Libranza' }).click();
  await v.getByLabel('Valor total que pagaste').fill('300000');
  await v.getByLabel('De ese valor, intereses').fill('20000');
  await p.getByRole('button', { name: 'Registrar abono' }).click();
  await p.waitForFunction(() => document.getElementById('vistaTarjetas').textContent.includes('$3.720.000'));
  d = await datos(p);
  assert.equal(d.transactions.find((t) => t.type === 'pago_deuda').amount, 280000);
  assert.equal(d.transactions.find((t) => t.type === 'interes').amount, 20000);
  await tab(p, 'Inicio');
  assert.equal(await p.textContent('#sumExpense'), '$20.000', 'solo el interés es gasto');
  assert.equal(await p.textContent('#headerTotalBalance'), '$700.000');
  assert.ok(
    (await p.textContent('#vistaHoy')).includes('Próximos pagos') === false,
    'la cuota del mes ya se abonó',
  );

  // Buscador y filtros del historial.
  await tab(p, 'Movs');
  await p.fill('#historySearch', 'libranza');
  await p.waitForFunction(() => document.querySelectorAll('#historyList details.fila').length === 2);
  await p.fill('#historySearch', '');
  await p.locator('#historyFilters .filtro', { hasText: 'Gastos' }).click();
  await p.waitForFunction(() => document.querySelectorAll('#historyList details.fila').length === 1);
  assert.ok((await p.textContent('#historySummary')).includes('salieron $20.000'));
  await contexto.close();
});

let fallos = 0;
for (const [nombre, fn] of pruebas) {
  try {
    await fn();
    console.log(`✔ ${nombre}`);
  } catch (err) {
    fallos++;
    console.error(`✖ ${nombre}\n  ${err.message}`);
    if (COMPARTIDO.p && SALIDA)
      await COMPARTIDO.p
        .screenshot({ path: join(SALIDA, `fallo-${fallos}.png`), fullPage: true })
        .catch(() => {});
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
