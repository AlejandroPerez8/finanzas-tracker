/**
 * Verificación de punta a punta contra la app PUBLICADA, en un perfil de Chrome temporal: no toca
 * los datos reales de nadie. Usa los formatos reales de Bancolombia.
 * Uso: CHROMIUM=/ruta/chrome npm run test:vivo   (VIVO_URL cambia el sitio; SMOKE_SALIDA guarda capturas)
 */
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';

const BASE = process.env.VIVO_URL ?? 'https://alejandroperez8.github.io/finanzas-tracker/';
const SALIDA = process.env.SMOKE_SALIDA ? `${process.env.SMOKE_SALIDA}/vivo` : null;
const VERSION = /const VERSION = '([^']+)'/.exec(
  readFileSync(new URL('../../service-worker.js', import.meta.url), 'utf8'),
)[1];
const RETIRO_REAL =
  'Bancolombia: Retiraste $150.000,00 en METR_BELLO6 de tu T.Deb **2436 el 28/10/2026 a las 18:14. ¿Dudas?, llamanos al 6045109095. Estamos cerca';
const RETIRO_HOY =
  'Bancolombia: Retiraste $50.000,00 en CAJERO CENTRO de tu T.Deb **2436 el 12/11/2026 a las 08:30. ¿Dudas?, llamanos al 6045109095. Estamos cerca';
const COMPRA_CON =
  'Bancolombia: Compraste $89,900.00 con tu Tarjeta Debito *2436 en EXITO CALLE 80 el 11/11/2026 a las 19:05.';

const resultados = [];
const ok = (nombre, cond, detalle = '') => {
  resultados.push(`${cond ? '✔' : '✖'} ${nombre}${detalle ? ` — ${detalle}` : ''}`);
};

const navegador = await chromium.launch({
  executablePath: process.env.CHROMIUM,
});
const contexto = await navegador.newContext({ viewport: { width: 390, height: 844 } });
const p = await contexto.newPage();
const errores = [];
p.on('pageerror', (e) => errores.push(e.message));
p.on('console', (m) => {
  if (m.type() === 'error' && !/fonts\.g/.test(m.location().url)) errores.push(m.text());
});
const tab = (n) => p.locator('#navInferior button', { hasText: n }).click();
const datos = () =>
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

try {
  await p.goto(BASE);
  await p.waitForSelector('#vistaPanel .patrimonio-neto');
  await p.evaluate(() => navigator.serviceWorker.ready);
  const caches = await p.evaluate(() => caches.keys());
  ok(
    `Service worker instala la caché ${VERSION}`,
    caches.includes(`finanzas-tracker-${VERSION}`),
    caches.join(','),
  );

  // Cuentas: Bancolombia con dígitos de cuenta y de T.Deb, y Efectivo.
  await tab('Ahorro');
  await p.click('#accFormToggle');
  await p.fill('#accName', 'Bancolombia');
  await p.fill('#accBalance', '1000000');
  await p.fill('#accUltimos4', '1234');
  await p.fill('#accUltimos4Debito', '2436');
  await p.click('#addAccBtn');
  await p.waitForTimeout(300);
  await p.click('#accFormToggle');
  await p.fill('#accName', 'Efectivo');
  await p.selectOption('#accType', 'Efectivo');
  await p.fill('#accBalance', '0');
  await p.click('#addAccBtn');
  await p.waitForTimeout(300);
  let d = await datos();
  const banco = d.accounts.find((a) => a.name === 'Bancolombia');
  const efectivo = d.accounts.find((a) => a.name === 'Efectivo');
  ok(
    'Cuenta guarda dígitos de tarjeta débito',
    banco?.ultimos4Debito === '2436' && banco?.ultimos4 === '1234',
  );
  ok('Cuenta de efectivo creada', efectivo?.tipo === 'efectivo');

  // Pegado manual de los mensajes reales.
  await tab('Movs');
  await p.locator('.subtab', { hasText: 'Importar' }).click();
  await p.getByLabel('Mensajes del banco').fill([RETIRO_REAL, RETIRO_HOY, COMPRA_CON].join('\n\n'));
  await p.getByRole('button', { name: 'Importar mensajes' }).click();
  await p.waitForTimeout(800);
  d = await datos();
  const retiro = d.transactions.find((t) => t.amount === 150000);
  ok(
    'Retiro real reconocido (patrón verificado)',
    retiro?.fuentes?.[0]?.patronId === 'retiro_cajero_verificado',
  );
  ok(
    'Retiro real: banco → efectivo, confirmado solo',
    retiro?.type === 'transferencia' &&
      retiro.accountId === banco.id &&
      retiro.cuentaDestinoId === efectivo.id &&
      retiro.estado === 'confirmado',
    `${retiro?.type}/${retiro?.estado}`,
  );
  ok(
    'Retiro conserva el cajero y la fecha',
    retiro?.comercio === 'METR BELLO6' && retiro?.date === '2026-10-28' && retiro?.hora === '18:14',
  );
  const compra = d.transactions.find((t) => t.amount === 89900);
  ok(
    'Compra "con tu tarjeta… en X": comercio correcto',
    compra?.comercio === 'EXITO CALLE 80',
    compra?.comercio,
  );
  ok('Compra asociada por dígitos de T.Deb', compra?.accountId === banco.id);
  // Formato aún no visto en un mensaje real: confianza 0,8, así que espera revisión.
  ok('Formato no verificado queda en revisión', compra?.estado === 'pendiente_revision', compra?.estado);
  const noRec = d.ingesta.filter((i) => i.estado === 'no_reconocido').length;
  ok('Ningún mensaje quedó sin reconocer', noRec === 0, `${noRec}`);

  // Saldos: el retiro es un traslado propio y no cambia el total; la compra pendiente aún no cuenta.
  await tab('Inicio');
  let total = await p.textContent('#headerTotalBalance');
  ok('Retiro no cambia el saldo total', total === '$1.000.000', total);
  // Confirmar la compra desde la revisión sí descuenta.
  await tab('Movs');
  await p.locator('.subtab', { hasText: 'Pendientes' }).click();
  await p.locator('.fila-pendiente', { hasText: 'EXITO' }).getByRole('button', { name: 'Confirmar' }).click();
  await p.waitForTimeout(300);
  await tab('Inicio');
  total = await p.textContent('#headerTotalBalance');
  ok('Confirmar la compra descuenta 89.900', total === '$910.100', total);
  const panel = await p.textContent('#vistaPanel');
  ok('Aviso de efectivo sin rastrear del mes', panel.includes('Retiraste $50.000 en efectivo este mes'));
  ok('Tarjeta de salud financiera visible', panel.includes('Salud financiera'));
  if (SALIDA) await p.screenshot({ path: `${SALIDA}-inicio.png`, fullPage: true });

  // Presupuesto → "Puedes gastar hoy".
  await tab('Más');
  const pres = p.locator('#vistaPresupuesto');
  await pres.locator('summary', { hasText: 'Agregar presupuesto' }).click();
  await pres.getByLabel('Categoría').fill('Alimentación');
  await pres.getByLabel('Límite mensual').fill('600000');
  await pres.getByRole('button', { name: 'Guardar' }).click();
  await p.waitForTimeout(300);
  await tab('Inicio');
  const ritmo = await p
    .locator('#vistaPanel .ritmo')
    .textContent()
    .catch(() => '');
  ok(
    '"Puedes gastar hoy" aparece con presupuesto',
    ritmo.includes('Puedes gastar hoy'),
    ritmo.replace(/\s+/g, ' ').slice(0, 120),
  );

  // CDT con retención.
  await tab('Ahorro');
  await p.click('#invFormToggle');
  await p.fill('#invEntity', 'Banco prueba');
  await p.fill('#invAmount', '10000000');
  await p.fill('#invRate', '10');
  await p.fill('#invTerm', '12');
  await p.fill('#invStart', '2026-11-12');
  await p.click('#addInvBtn');
  await p.waitForTimeout(300);
  const cdt = await p.textContent('#investList');
  ok(
    'CDT muestra retención y neto',
    /Retención \(4 %\)/.test(cdt) && cdt.includes('Recibirás al vencimiento (neto)'),
  );
  ok('CDT neto $10.960.000 (10 % EA, 12 meses)', cdt.includes('$10.960.000'));

  // Offline: la app abre sin conexión desde la caché.
  await p.reload();
  await p.waitForFunction(() => navigator.serviceWorker.controller);
  await contexto.setOffline(true);
  await p.reload();
  await p.waitForSelector('#vistaPanel .patrimonio-neto');
  ok('Abre sin conexión', true);
  await contexto.setOffline(false);

  // Sin desbordes horizontales en ninguna pestaña.
  for (const t of ['Inicio', 'Movs', 'Tarjetas', 'Ahorro', 'Más']) {
    await tab(t);
    const desborde = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    ok(`Sin scroll horizontal en ${t}`, desborde <= 0, `${desborde}px`);
  }
  ok('Sin errores de JavaScript', errores.length === 0, errores.slice(0, 3).join(' | '));
} catch (err) {
  ok('Flujo completo sin excepciones', false, err.message.split('\n')[0]);
  if (SALIDA) await p.screenshot({ path: `${SALIDA}-error.png`, fullPage: true }).catch(() => {});
} finally {
  await navegador.close();
}
console.log(resultados.join('\n'));
process.exit(resultados.some((r) => r.startsWith('✖')) ? 1 : 0);
