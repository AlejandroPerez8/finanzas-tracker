import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { crearRegistro } from '../../js/parsers/registry.js';
import { normalizarComercio } from '../../js/domain/categorias.js';

const leer = (r) => JSON.parse(readFileSync(new URL(r, import.meta.url), 'utf8'));
const registro = crearRegistro(leer('../../js/parsers/bancolombia/patrones.json'));
const RECIBIDO = '2026-11-07T08:00:00-05:00';

function comprobar(caso) {
  const r = registro.analizar(caso.texto, { fuente: 'manual', recibidoEn: RECIBIDO });
  assert.ok(r, `sin coincidencia: ${caso.texto}`);
  assert.equal(r.tipo, caso.tipo);
  if (caso.esperado.monto != null) assert.equal(r.monto, caso.esperado.monto);
  if (caso.esperado.fecha) assert.equal(r.fecha, caso.esperado.fecha);
  if (caso.esperado.hora) assert.equal(r.hora, caso.esperado.hora);
  if (caso.esperado.ultimos4) assert.equal(r.ultimos4, caso.esperado.ultimos4);
  if (caso.esperado.cuotas) assert.equal(r.cuotas, caso.esperado.cuotas);
  // El comercio define la categoría: un comercio mal recortado categoriza mal sin que nada falle.
  if (caso.esperado.comercio) assert.equal(r.comercio, normalizarComercio(caso.esperado.comercio));
}

test('formatos verificados en correos reales (anonimizados)', async (t) => {
  const casos = [
    [
      'nomina',
      'Bancolombia: Recibiste un pago de Nomina de EMPRESA EJEMPLO por $1,550,555.00 en tu cuenta de Ahorros el 29/10/2026 a las 13:44. Si tienes dudas, llamanos al 018000931987. A tu lado siempre.',
      1550555,
      '2026-10-29',
      '13:44',
      null,
    ],
    [
      'pago_qr',
      'Bancolombia: PERSONA EJEMPLO pagaste $29,000.00 por codigo QR desde tu cuenta *1234 a la llave 0000000000 el 05/11/2026 a las 19:48. Con codigo QR es facil y de una. Dudas al 018000912345.',
      29000,
      '2026-11-05',
      '19:48',
      '1234',
    ],
    [
      'transferencia_recibida',
      'Bancolombia: Recibiste una transferencia por $116,500 de PERSONA EJEMPLO en tu cuenta **1234, el 01/11/2026 a las 14:23. Si tienes dudas, hablemos: 018000931987. Siempre a tu lado.',
      116500,
      '2026-11-01',
      '14:23',
      '1234',
    ],
    [
      'recarga',
      'Bancolombia: Recargaste 30,000.00 a Tarjeta Civica desde tu cuenta *1234 el 04/11/2026 16:52 ¿Dudas? Llama al 018000945555 y las resolvemos.',
      30000,
      '2026-11-04',
      '16:52',
      '1234',
    ],
    [
      'pago_servicio',
      'Bancolombia: Pagaste $5,500.00 a COMUNICACION CELULAR COMCEL S desde tu producto 1234 el 05/11/2026 07:02:40. ¿Dudas? Llamanos al 6045109095. Estamos cerca',
      5500,
      '2026-11-05',
      '07:02',
      '1234',
    ],
    [
      'compra_debito',
      'Bancolombia: Compraste $45.300,50 en TIENDAS D1 EJEMPLO con tu T.Deb *1234, el 03/11/2026 a las 18:42. Si tienes dudas, encuentranos aqui: 6045109095 o 018000931987. Estamos cerca.',
      45301,
      '2026-11-03',
      '18:42',
      '1234',
    ],
    [
      'compra_debito',
      'Bancolombia: Compraste $9.900,00 en DLO*Didi con tu T.Deb *1234, el 03/11/2026 a las 18:42. Si tienes dudas, encuentranos aqui: 6045109095.',
      9900,
      '2026-11-03',
      '18:42',
      '1234',
    ],
    [
      'transferencia_enviada',
      'Bancolombia: PERSONA EJEMPLO, transferiste $80,000.00 a la llave @llave0000 desde tu cuenta *1234 a OTRA PERSONA el 02/11/26 a las 09:15. Con Bre-b es de una y gratis. Dudas al 6045109095.',
      80000,
      '2026-11-02',
      '09:15',
      '1234',
    ],
    [
      'transferencia_enviada',
      'Bancolombia: Transferiste $40,000.00 por Boton Bancolombia a TIENDA EJEMPLO desde producto *1234. 02/11/2026 09:15:30 ¿Dudas? 6045109095.Este es una notificación automática',
      40000,
      '2026-11-02',
      '09:15',
      '1234',
    ],
    [
      'transferencia_enviada',
      'Bancolombia: Transferiste $19,000 desde tu cuenta *1234 a la cuenta *00000000000 el 06/11/2026 a las 16:01. ¿Dudas? Llamanos al 018000931987. Estamos cerca.',
      19000,
      '2026-11-06',
      '16:01',
      '1234',
    ],
    [
      'retiro_cajero',
      'Bancolombia: Retiraste $150.000,00 en METR_BELLO6 de tu T.Deb **1234 el 28/10/2026 a las 18:14. ¿Dudas?, llamanos al 6045109095. Estamos cerca',
      150000,
      '2026-10-28',
      '18:14',
      '1234',
    ],
  ];
  for (const [tipo, texto, monto, fecha, hora, ultimos4] of casos) {
    await t.test(tipo, () => {
      const r = registro.analizar(texto, { fuente: 'gmail', recibidoEn: RECIBIDO });
      assert.equal(r.tipo, tipo);
      assert.equal(r.monto, monto);
      assert.equal(r.fecha, fecha);
      assert.equal(r.hora, hora);
      assert.equal(r.ultimos4, ultimos4);
      assert.ok(r.confianza >= 0.9, `confianza ${r.confianza}`);
    });
  }
});

test('nómina: el tipo de cuenta se captura cuando no hay últimos 4', () => {
  const r = registro.analizar(
    'Bancolombia: Recibiste un pago de Nomina de EMPRESA EJEMPLO por $1,550,555.00 en tu cuenta de Ahorros el 29/10/2026 a las 13:44.',
    { fuente: 'gmail', recibidoEn: RECIBIDO },
  );
  assert.equal(r.ultimos4, null);
  assert.equal(r.tipoCuenta, 'Ahorros');
});

test('retiro en cajero (formato real): llega igual por SMS y correo y conserva el cajero', () => {
  const texto =
    'Bancolombia: Retiraste $150.000,00 en METR_BELLO6 de tu T.Deb **1234 el 28/10/2026 a las 18:14. ¿Dudas?, llamanos al 6045109095. Estamos cerca';
  for (const fuente of ['sms', 'gmail']) {
    const r = registro.analizar(texto, { fuente, recibidoEn: RECIBIDO });
    assert.equal(r.tipo, 'retiro_cajero', fuente);
    assert.equal(r.patronId, 'retiro_cajero_verificado', fuente);
    assert.equal(r.monto, 150000, fuente);
    assert.equal(r.comercio, 'METR BELLO6', fuente);
    assert.equal(r.ultimos4, '1234', fuente);
    assert.ok(r.confianza >= 0.9, `${fuente}: confianza ${r.confianza}`);
  }
});

test('la publicidad del banco se identifica', () => {
  assert.equal(
    registro.esPublicidad(
      'Bancolombia: 5 de $100.000.000 cada una. Todos los premios son libres de impuestos. Fechas de los sorteos: x',
    ),
    true,
  );
  assert.equal(registro.esPublicidad('Bancolombia: Pagaste $5,500.00 a CLARO'), false);
});

test('texto ajeno al banco no se reconoce', () => {
  assert.equal(registro.analizar('Hola, ¿nos vemos mañana?', { fuente: 'sms' }), null);
  assert.equal(registro.analizar('Tu seguridad es nuestra prioridad.', { fuente: 'gmail' }), null);
  assert.equal(registro.analizar('', { fuente: 'gmail' }), null);
});

test('un patrón de usuario inválido se reporta y no rompe el registro', () => {
  const errores = [];
  const r = crearRegistro({ patrones: [{ id: 'malo', tipo: 'x', confianza: 1, regex: '(' }] }, [], (e) =>
    errores.push(e),
  );
  assert.equal(r.analizar('$1 algo', { fuente: 'sms' }), null);
  assert.equal(errores.length, 1);
});

test('fixtures sintéticos', async (t) => {
  for (const caso of leer('../fixtures/bancolombia/fixtures.json')) {
    await t.test(`${caso.tipo}: ${caso.texto.slice(0, 50)}`, () => comprobar(caso));
  }
});

const carpetaReales = new URL('../fixtures/bancolombia/reales/', import.meta.url);
if (existsSync(carpetaReales)) {
  for (const archivo of readdirSync(carpetaReales).filter((n) => n.endsWith('.json'))) {
    test(`muestras reales: ${archivo}`, () => {
      JSON.parse(readFileSync(new URL(archivo, carpetaReales), 'utf8')).forEach(comprobar);
    });
  }
}

test('pagar la tarjeta de crédito nunca se confirma solo como gasto de un servicio', () => {
  const casos = [
    'Bancolombia: Pagaste $80.000,00 a tu T.Cred *7711 desde tu cuenta *1234 el 12/11/2026 a las 09:00.',
    'Bancolombia: Pagaste $80.000,00 a TARJETA DE CREDITO VISA desde tu producto *1234 el 12/11/2026 a las 09:00.',
    'Bancolombia: Pagaste $80.000,00 a VISA BANCOLOMBIA 7711 desde tu producto *1234 el 12/11/2026 09:00:00.',
    'Bancolombia: Pagaste $80.000,00 a MASTERCARD *7711 desde tu producto *1234 el 12/11/2026 09:00:00.',
  ];
  for (const texto of casos) {
    const r = registro.analizar(texto, { fuente: 'sms', recibidoEn: RECIBIDO });
    assert.equal(r.tipo, 'pago_tarjeta', texto);
    assert.ok(r.confianza < 0.9, `${texto}: debe pasar por revisión`);
    assert.equal(r.monto, 80000);
  }
  // Los servicios con nombres parecidos siguen siendo servicios.
  const visajes = registro.analizar(
    'Bancolombia: Pagaste $45.000,00 a VISAJES Y ESTETICA LA 70 desde tu producto *1234 el 05/11/2026 07:02:40.',
    { fuente: 'sms', recibidoEn: RECIBIDO },
  );
  assert.equal(visajes.tipo, 'pago_servicio');
});
