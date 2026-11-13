import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  huella,
  esMismoMovimiento,
  comerciosParecidos,
  buscarDuplicado,
} from '../../js/services/deduplicacion.js';
import { categorizar, aprender } from '../../js/services/categorizacion.js';
import {
  procesarMensaje,
  confirmar,
  descartar,
  dividir,
  proponerRegla,
  elegirComercio,
  purgarTextos,
  hashTexto,
  registrarDiferida,
} from '../../js/services/ingesta.js';
import {
  paresPorConciliar,
  vincular,
  mantenerSeparados,
  buscarCandidatoManual,
} from '../../js/services/conciliacion.js';
import { migrar, VERSION_ACTUAL } from '../../js/services/migraciones.js';
import { exportable, validarCopia, cifrar, descifrar, estaCifrado } from '../../js/services/backup.js';
import { agregados, promptReporte } from '../../js/services/reportes.js';
import { celdaCsv, aCsv, tablasPowerBi, archivosCsv } from '../../js/services/exportacion.js';
import { registrar } from '../../js/services/registro.js';
import { crearRegistro } from '../../js/parsers/registry.js';
import { estadisticasMes, saldoCuenta, textoTasaAhorro } from '../../js/domain/movimientos.js';
import { saldoTarjeta } from '../../js/domain/tarjetas.js';

const leer = (r) => JSON.parse(readFileSync(new URL(r, import.meta.url), 'utf8'));
const registro = crearRegistro(leer('../../js/parsers/bancolombia/patrones.json'));
const diccionario = leer('../../data/comercios.json');
const v4 = () => leer('../fixtures/export-v4-sintetico.json');

function base(extra = {}) {
  const { datos } = migrar({
    accounts: [{ id: 'a', name: 'Ahorros', type: 'Ahorros', startBalance: 1000000, ultimos4: '1234' }],
    ...extra,
  });
  datos.accounts[0].ultimos4 = '1234';
  return datos;
}
let n = 0;
const ctx = { registro, diccionario, nuevoId: () => `m${++n}` };
const msg = (rowId, texto, fuente = 'gmail') => ({
  rowId,
  fuente,
  recibidoEn: '2026-11-07T08:00:00-05:00',
  textoRelevante: texto,
});
const PAGO =
  'Bancolombia: Pagaste $5,500.00 a COMUNICACION CELULAR COMCEL S desde tu producto 1234 el 05/11/2026 07:02:40. ¿Dudas?';

test('migración: conserva todo el formato v4', () => {
  const orig = v4();
  const { datos, desde, hasta, migro } = migrar(orig);
  assert.deepEqual([desde, hasta, migro], [1, VERSION_ACTUAL, true]);
  assert.equal(orig.schemaVersion, undefined, 'el original no se toca');
  assert.equal(datos.transactions.length, orig.transactions.length);
  assert.equal(datos.accounts[0].startBalance, 1000000);
  assert.equal(datos.accounts[0].tipo, 'ahorros');
  assert.equal(datos.accounts[1].tipo, 'efectivo');
  assert.equal(datos.transactions[1].amount, 50001);
  assert.equal(datos.transactions[1].origen, 'manual');
  assert.equal(datos.transactions[1].estado, 'confirmado');
  assert.equal(datos.pockets[0].startBalance, 100000);
  assert.ok(!('balance' in datos.pockets[0]));
  assert.equal(datos.goals[0].contributions[0].amount, 30000);
  assert.equal(datos.reports[0].monthKey, '2026-09');
  assert.equal(datos.settings.reminderHour, 21);
  assert.equal(datos.settings.ingesta.activa, false, 'la sincronización nace desactivada');
  assert.deepEqual(datos.tarjetas, []);
});

test('migración: los saldos no cambian', () => {
  const { datos } = migrar(v4());
  assert.equal(
    saldoCuenta(datos.accounts[0], datos.transactions),
    1000000 + 2000000 - 50001 - 100000 + 20000,
  );
});

test('migración: idempotente, datos vacíos y versión futura', () => {
  const una = migrar(v4()).datos;
  const dos = migrar(una);
  assert.equal(dos.migro, false);
  assert.deepEqual(dos.datos, una);
  assert.equal(migrar({}).datos.schemaVersion, VERSION_ACTUAL);
  assert.throws(() => migrar({ schemaVersion: 99 }), /más nueva/);
});

test('deduplicación: comercios parecidos', () => {
  assert.equal(comerciosParecidos('EXITO', 'Éxito Calle 80'), true);
  assert.equal(comerciosParecidos('CARULLA', 'CARULA'), true);
  assert.equal(comerciosParecidos('', 'X'), true);
  assert.equal(comerciosParecidos('NETFLIX', 'SPOTIFY'), false);
});

test('deduplicación: reglas de igualdad', () => {
  const m = {
    type: 'expense',
    amount: 10,
    date: '2026-11-05',
    hora: '10:00',
    comercio: 'EXITO',
    ultimos4: '1',
  };
  assert.equal(esMismoMovimiento(m, { ...m, hora: '10:10' }), true);
  assert.equal(esMismoMovimiento(m, { ...m, hora: '10:11' }), false);
  assert.equal(esMismoMovimiento(m, { ...m, amount: 11 }), false);
  assert.equal(esMismoMovimiento(m, { ...m, ultimos4: '2' }), false);
  assert.equal(esMismoMovimiento(m, { ...m, hora: null }), true);
  assert.equal(esMismoMovimiento(m, { ...m, hora: null, date: '2026-11-06' }), false);
  assert.equal(esMismoMovimiento({ ...m, referenciaBanco: 'A' }, { ...m, referenciaBanco: 'B' }), false);
  assert.match(huella(m), /expense\|10/);
  assert.equal(huella({ ...m, referenciaBanco: 'A' }), 'ref|A');
  assert.ok(
    buscarDuplicado(m, 'gmail', [{ ...m, origen: 'manual', fuentes: [{ fuente: 'manual' }] }]),
    'un manual ya vinculado recibe la segunda fuente',
  );
  assert.equal(buscarDuplicado(m, 'gmail', [{ ...m, origen: 'manual', fuentes: [] }]), null);
  assert.equal(
    buscarDuplicado(m, 'gmail', [{ ...m, estado: 'descartado', fuentes: [{ fuente: 'manual' }] }]),
    null,
  );
});

test('ingesta: mismo rowId no duplica', () => {
  const d = base();
  assert.equal(procesarMensaje(d, msg('r1', PAGO), ctx).resultado, 'confirmado');
  assert.equal(procesarMensaje(d, msg('r1', PAGO), ctx).resultado, 'repetido');
  assert.equal(d.transactions.length, 1);
  assert.equal(d.ingesta.length, 1);
});

test('ingesta: un mensaje pegado y su correo se fusionan', () => {
  const d = base();
  procesarMensaje(d, msg('r1', PAGO, 'manual'), ctx);
  const r = procesarMensaje(d, msg('r2', PAGO, 'gmail'), ctx);
  assert.equal(r.resultado, 'duplicado');
  assert.equal(d.transactions.length, 1);
  assert.deepEqual(
    d.transactions[0].fuentes.map((f) => f.fuente),
    ['manual', 'gmail'],
  );
});

test('ingesta: dos compras legítimas iguales de una misma fuente son dos movimientos', () => {
  const d = base();
  procesarMensaje(d, msg('r1', PAGO), ctx);
  const r = procesarMensaje(d, msg('r2', PAGO), ctx);
  assert.notEqual(r.resultado, 'duplicado');
  assert.equal(d.transactions.length, 2);
  // Y si después se pegan a mano los dos mensajes, cada uno se empareja con uno distinto.
  procesarMensaje(d, msg('r3', PAGO, 'manual'), ctx);
  procesarMensaje(d, msg('r4', PAGO, 'manual'), ctx);
  assert.equal(d.transactions.length, 2);
  assert.ok(d.transactions.every((t) => t.fuentes.length === 2));
});

test('ingesta: no guarda el texto completo de lo importado', () => {
  const d = base();
  procesarMensaje(d, msg('r1', PAGO), ctx);
  assert.equal(d.ingesta[0].textoRelevante, undefined);
  assert.equal(d.ingesta[0].hashTexto, hashTexto(PAGO));
  const c = base();
  c.settings.ingesta.conservarTexto = true;
  procesarMensaje(c, msg('r1', PAGO), ctx);
  assert.equal(c.ingesta[0].textoRelevante, PAGO);
});

test('ingesta: confianza y estados', () => {
  const d = base();
  procesarMensaje(d, msg('r1', PAGO), ctx);
  assert.equal(d.transactions[0].estado, 'confirmado');
  assert.equal(d.transactions[0].category, 'Servicios');
  const t = procesarMensaje(
    d,
    msg(
      'r2',
      'Bancolombia: Transferiste $19,000 desde tu cuenta *1234 a la cuenta *00000000000 el 06/11/2026 a las 16:01.',
    ),
    ctx,
  );
  assert.equal(t.resultado, 'pendiente', 'una transferencia puede ser a cuenta propia: siempre se revisa');
  const manual = base();
  manual.settings.ingesta.autoConfirmar = false;
  assert.equal(procesarMensaje(manual, msg('r1', PAGO), ctx).resultado, 'pendiente');
  const sinCuenta = base();
  sinCuenta.accounts.push({ id: 'b', name: 'Otra' });
  sinCuenta.accounts[0].ultimos4 = '9999';
  assert.equal(procesarMensaje(sinCuenta, msg('r1', PAGO), ctx).resultado, 'pendiente');
});

test('ingesta: rechazo, no reconocido y reintento tras error', () => {
  const d = base();
  const r = procesarMensaje(
    d,
    msg(
      'r1',
      'Bancolombia: Tu compra por $45.000 en NETFLIX con tu T.Cred *1234 no fue exitosa el 08/01/2026 a las 11:11.',
    ),
    ctx,
  );
  assert.equal(r.resultado, 'descartado');
  assert.equal(saldoCuenta(d.accounts[0], d.transactions), 1000000);
  const x = procesarMensaje(d, msg('r2', 'Bancolombia: formato nuevo sin nada conocido'), ctx);
  assert.equal(x.resultado, 'no_reconocido');
  assert.ok(d.ingesta.find((i) => i.rowId === 'r2').textoRelevante);
  d.ingesta.find((i) => i.rowId === 'r2').estado = 'error';
  assert.equal(procesarMensaje(d, msg('r2', PAGO), ctx).resultado, 'confirmado');
  assert.equal(d.ingesta.filter((i) => i.rowId === 'r2').length, 1);
});

test('ingesta: la publicidad no crea movimiento ni guarda su texto', () => {
  const d = base();
  const r = procesarMensaje(
    d,
    msg('r1', 'Bancolombia: Todos los premios son libres de impuestos. Sorteo de $100.000'),
    ctx,
  );
  assert.equal(r.resultado, 'publicidad');
  assert.equal(d.transactions.length, 0);
  assert.equal(d.ingesta[0].textoRelevante, undefined);
  assert.equal(procesarMensaje(d, msg('r1', 'x'), ctx).resultado, 'repetido');
});

test('ingesta: flujo de tarjeta completo por últimos 4', () => {
  const d = base();
  d.tarjetas.push({
    id: 'c',
    alias: 'Visa',
    ultimos4: '5566',
    cupoTotal: 2000000,
    tasaEA: 26.82,
    diaCorte: 15,
    diaLimitePago: 30,
  });
  procesarMensaje(
    d,
    msg(
      'r1',
      'Bancolombia: Compraste $100,000.00 con tu T.Cred *5566 en EXITO el 05/11/2026 a las 10:00. ¿Dudas?',
    ),
    ctx,
  );
  const compra = d.transactions.at(-1);
  assert.equal(compra.tarjetaId, 'c');
  assert.equal(compra.accountId, null);
  compra.estado = 'confirmado';
  procesarMensaje(
    d,
    msg(
      'r2',
      'Bancolombia: Compraste $1,200,000.00 con tu T.Cred *5566 en ALKOSTO en 12 cuotas el 05/11/2026 a las 11:00.',
    ),
    ctx,
  );
  const dif = d.transactions.at(-1);
  assert.equal(dif.esCuota, true);
  confirmar(d, dif.id, {}, ctx);
  assert.equal(d.comprasDiferidas.length, 1);
  registrarDiferida(d, dif, ctx.nuevoId);
  assert.equal(d.comprasDiferidas.length, 1, 'no repite el plan');
  const pago = confirmar(
    d,
    procesarMensaje(
      d,
      msg('r3', 'Bancolombia: Pagaste $150,000.00 a tu Tarjeta de Credito *5566 el 06/11/2026 a las 09:30.'),
      ctx,
    ).movimientoId,
  );
  assert.equal(pago.type, 'pago_tarjeta');
  assert.equal(saldoTarjeta(d.tarjetas[0], d.transactions), 100000 + 1200000 - 150000);
  assert.equal(estadisticasMes(d.transactions, '2026-11').expense, 1300000);
  assert.equal(saldoCuenta(d.accounts[0], d.transactions), 1000000 - 150000);
});

test('ingesta: retiro va a la cuenta de efectivo y no es gasto', () => {
  const d = base();
  d.accounts.push({ id: 'e', name: 'Efectivo', tipo: 'efectivo', startBalance: 0 });
  const id = procesarMensaje(
    d,
    msg(
      'r1',
      'Bancolombia: Retiraste $200,000.00 de tu cuenta *1234 en CAJERO EJEMPLO el 05/11/2026 a las 08:15.',
    ),
    ctx,
  ).movimientoId;
  confirmar(d, id);
  assert.equal(saldoCuenta(d.accounts[1], d.transactions), 200000);
  assert.equal(estadisticasMes(d.transactions, '2026-11').expense, 0);
});

const RETIRO_REAL =
  'Bancolombia: Retiraste $150.000,00 en METR_BELLO6 de tu T.Deb **2436 el 28/10/2026 a las 18:14. ¿Dudas?, llamanos al 6045109095. Estamos cerca';

test('retiro real con T.Deb: se asocia por los dígitos de la tarjeta débito y se confirma solo', () => {
  const d = base();
  d.accounts[0].ultimos4Debito = '2436';
  d.accounts.push({ id: 'e', name: 'Efectivo', tipo: 'efectivo', startBalance: 0 });
  const r = procesarMensaje(d, msg('rr1', RETIRO_REAL, 'manual'), ctx);
  assert.equal(r.resultado, 'confirmado');
  const mov = d.transactions.find((t) => t.id === r.movimientoId);
  assert.equal(mov.type, 'transferencia');
  assert.equal(mov.accountId, 'a');
  assert.equal(mov.cuentaDestinoId, 'e');
  assert.equal(mov.comercio, 'METR BELLO6');
  assert.equal(mov.date, '2026-10-28');
  assert.equal(mov.hora, '18:14');
  // Banco baja, efectivo sube, y no cuenta como gasto del mes.
  assert.equal(saldoCuenta(d.accounts[0], d.transactions), 1000000 - 150000);
  assert.equal(saldoCuenta(d.accounts[1], d.transactions), 150000);
  assert.equal(estadisticasMes(d.transactions, '2026-10').expense, 0);
  // El mismo retiro por correo se fusiona; no se duplica.
  assert.equal(procesarMensaje(d, msg('rr2', RETIRO_REAL, 'gmail'), ctx).resultado, 'duplicado');
  assert.equal(saldoCuenta(d.accounts[1], d.transactions), 150000);
});

test('retiro real sin dígitos de débito registrados queda en revisión, no en una cuenta equivocada', () => {
  const d = base();
  d.accounts.push({ id: 'e', name: 'Efectivo', tipo: 'efectivo', startBalance: 0 });
  const r = procesarMensaje(d, msg('rr1', RETIRO_REAL, 'manual'), ctx);
  assert.equal(r.resultado, 'pendiente');
  assert.equal(d.transactions.find((t) => t.id === r.movimientoId).accountId, null);
});

test('retiro real sin cuenta de efectivo queda en revisión', () => {
  const d = base();
  d.accounts[0].ultimos4Debito = '2436';
  const r = procesarMensaje(d, msg('rr1', RETIRO_REAL, 'manual'), ctx);
  assert.equal(r.resultado, 'pendiente');
});

test('al confirmar a mano un retiro con T.Deb desconocida, la cuenta aprende esos dígitos', () => {
  const d = base();
  d.accounts.push({ id: 'e', name: 'Efectivo', tipo: 'efectivo', startBalance: 0 });
  const r1 = procesarMensaje(d, msg('rr1', RETIRO_REAL, 'manual'), ctx);
  assert.equal(r1.resultado, 'pendiente');
  confirmar(d, r1.movimientoId, { accountId: 'a', cuentaDestinoId: 'e' });
  assert.equal(d.accounts[0].ultimos4, '1234', 'no pisa los dígitos de la cuenta');
  assert.equal(d.accounts[0].ultimos4Debito, '2436');
  assert.equal(d.accounts[1].ultimos4Debito, undefined, 'el efectivo no aprende dígitos');
  const otro = RETIRO_REAL.replace('28/10/2026', '30/10/2026');
  assert.equal(procesarMensaje(d, msg('rr2', otro, 'manual'), ctx).resultado, 'confirmado');
});

test('confirmar una compra con tarjeta de crédito no registrada no enseña esos dígitos a la cuenta', () => {
  const d = base();
  const r = procesarMensaje(
    d,
    msg(
      'cc1',
      'Bancolombia: Compraste $250,000.00 con tu T.Cred *9988 en ALKOSTO el 05/11/2026 a las 10:00.',
    ),
    ctx,
  );
  assert.equal(r.resultado, 'pendiente');
  confirmar(d, r.movimientoId, { accountId: 'a', tarjetaId: null });
  assert.equal(d.accounts[0].ultimos4Debito, undefined);
  assert.notEqual(d.accounts[0].ultimos4, '9988');
});

test('una cuenta sin dígitos sigue siendo la única candidata', () => {
  const d = base();
  d.accounts[0].ultimos4 = null;
  d.accounts.push({ id: 'e', name: 'Efectivo', tipo: 'efectivo', startBalance: 0 });
  assert.equal(procesarMensaje(d, msg('rr1', RETIRO_REAL, 'manual'), ctx).resultado, 'confirmado');
});

test('revisión: confirmar, descartar y dividir', () => {
  const d = base();
  d.settings.ingesta.autoConfirmar = false;
  const { movimientoId: id } = procesarMensaje(d, msg('r1', PAGO), ctx);
  assert.equal(confirmar(d, id, { category: 'Otros' }).category, 'Otros');
  assert.equal(descartar(d, id).estado, 'descartado');
  assert.throws(() => confirmar(d, 'nada'), /ya no existe/);
  assert.throws(() => descartar(d, 'nada'), /ya no existe/);
  assert.throws(() => dividir(d, 'nada', [], ctx.nuevoId), /ya no existe/);
  assert.throws(
    () =>
      dividir(
        d,
        id,
        [
          { amount: 1, category: 'A' },
          { amount: 2, category: 'B' },
        ],
        ctx.nuevoId,
      ),
    /sumar/,
  );
  assert.throws(() => dividir(d, id, [{ amount: 5500, category: 'A' }], ctx.nuevoId), /positivo/);
  const partes = dividir(
    d,
    id,
    [
      { amount: 5000, category: 'A' },
      { amount: 500, category: 'B' },
    ],
    ctx.nuevoId,
  );
  assert.deepEqual(
    partes.map((p) => p.amount),
    [5000, 500],
  );
  assert.equal(partes[1].divididoDe, id);
});

test('conciliación con registro manual', () => {
  const d = base();
  d.transactions.push({
    id: 'manual',
    date: '2026-11-05',
    type: 'expense',
    amount: 5500,
    category: 'Servicios',
    accountId: 'a',
    origen: 'manual',
    estado: 'confirmado',
    fuentes: [],
  });
  const r = procesarMensaje(d, msg('r1', PAGO), ctx);
  assert.equal(r.resultado, 'pendiente');
  assert.equal(paresPorConciliar(d.transactions).length, 1);
  vincular(d, r.movimientoId);
  assert.equal(d.transactions.length, 1);
  assert.equal(d.transactions[0].id, 'manual');
  assert.equal(d.transactions[0].fuentes.length, 1);
  assert.equal(d.ingesta[0].movimientoId, 'manual');
  assert.throws(() => vincular(d, 'nada'), /No hay/);

  const s = base();
  s.transactions.push({
    id: 'manual',
    date: '2026-11-05',
    type: 'expense',
    amount: 5500,
    origen: 'manual',
    fuentes: [],
  });
  const r2 = procesarMensaje(s, msg('r1', PAGO), ctx);
  mantenerSeparados(s, r2.movimientoId);
  assert.equal(s.transactions.length, 2);
  assert.equal(paresPorConciliar(s.transactions).length, 0);
  assert.throws(() => mantenerSeparados(s, 'nada'), /ya no existe/);
  assert.equal(
    buscarCandidatoManual({ type: 'expense', amount: 5500, date: '2026-11-08' }, s.transactions),
    null,
  );
});

test('categorización y aprendizaje', () => {
  const dic = { EXITO: 'Alimentación', 'EXITO EXPRESS': 'Entretenimiento' };
  assert.equal(categorizar('Éxito', 'compra_debito', [], dic).fuente, 'diccionario');
  assert.equal(categorizar('EXITO CALLE 80', 'compra_debito', [], dic).categoria, 'Alimentación');
  assert.equal(
    categorizar('EXITO EXPRESS 3', 'compra_debito', [], dic).categoria,
    'Entretenimiento',
    'gana la coincidencia más larga',
  );
  assert.equal(categorizar('DESCONOCIDO', 'nomina', [], dic).categoria, 'Salario');
  assert.equal(categorizar(null, 'compra_debito', [], dic).fuente, 'defecto');
  const reglas = aprender(aprender([], 'Exito', 'Otros'), 'EXITO', 'Vivienda');
  assert.equal(reglas.length, 1);
  assert.equal(categorizar('EXITO', 'compra_debito', reglas, dic).fuente, 'usuario');
  assert.equal(categorizar('EXITO', 'compra_debito', reglas, dic).categoria, 'Vivienda');
  assert.equal(aprender([], '', 'X').length, 0);
});

test('enseñar: la regla propuesta reconoce el mensaje', () => {
  const texto = 'Bancolombia: Abonaste $45.000 al fondo X desde **1234 el 03/11/2026 a las 10:15.';
  const regla = proponerRegla(texto, 'compra_debito');
  const r = crearRegistro({ patrones: [] }, [regla]).analizar(texto, { fuente: 'manual' });
  assert.equal(r.monto, 45000);
  assert.equal(r.fecha, '2026-11-03');
  assert.equal(r.hora, '10:15');
  assert.equal(r.ultimos4, '1234');
});

test('purga de textos', () => {
  const d = {
    ingesta: [
      { recibidoEn: '2026-01-01T00:00:00Z', textoRelevante: 'x' },
      { recibidoEn: '2026-11-01T00:00:00Z', textoRelevante: 'y' },
      { recibidoEn: '2026-01-01T00:00:00Z' },
    ],
  };
  assert.equal(purgarTextos(d, 30, Date.parse('2026-11-07T00:00:00Z')), 1);
  assert.equal(d.ingesta[0].textoRelevante, undefined);
  assert.equal(d.ingesta[1].textoRelevante, 'y');
});

test('copias: sin secretos, validación y cifrado', async () => {
  const d = base();
  d.settings.ingesta.token = 'secreto';
  d.settings.ingesta.url = 'https://x';
  d.settings.apiKey = 'k';
  d.settings.pinHash = 'p';
  const e = exportable(d);
  assert.ok(!JSON.stringify(e).includes('secreto'));
  assert.equal(e.settings.apiKey, undefined);
  assert.equal(d.settings.ingesta.token, 'secreto', 'no toca el original');
  assert.throws(() => validarCopia(null), /formato/);
  assert.throws(() => validarCopia([]), /formato/);
  assert.throws(() => validarCopia({ accounts: 1 }), /accounts/);
  assert.throws(() => validarCopia({ schemaVersion: 'x' }), /schemaVersion/);
  assert.ok(validarCopia({ accounts: [] }));
  const paquete = await cifrar({ a: 1 }, 'clave-larga');
  assert.equal(estaCifrado(paquete), true);
  assert.equal(estaCifrado({}), false);
  assert.ok(!JSON.stringify(paquete).includes('"a"'));
  assert.deepEqual(await descifrar(paquete, 'clave-larga'), { a: 1 });
  await assert.rejects(descifrar(paquete, 'otra-clave'), /incorrecta/);
  await assert.rejects(cifrar({}, 'corta'), /8 caracteres/);
});

test('reportes: solo agregados', () => {
  const d = base();
  d.goals.push({ id: 'g', name: 'Meta secreta', contributions: [] });
  d.investments.push({ id: 'i', entity: 'Banco Secreto', amount: 100 });
  d.transactions.push(
    {
      id: 't',
      date: '2026-11-05',
      type: 'expense',
      amount: 1000,
      category: 'Salud',
      comercio: 'CLINICA PRIVADA',
      note: 'nota privada',
      accountId: 'a',
    },
    { id: 'u', date: '2026-10-05', type: 'expense', amount: 400, category: 'Salud', accountId: 'a' },
  );
  const a = agregados(d, '2026-11');
  assert.equal(a.variacionPorCategoria.Salud, 600);
  const p = promptReporte(a);
  for (const privado of ['CLINICA', 'nota privada', 'Meta secreta', 'Banco Secreto', 'Ahorros', '1234'])
    assert.ok(!p.includes(privado), privado);
  assert.match(p, /Salud: \$1\.000 \(\+\$600/);
  assert.match(promptReporte(agregados(base(), '2026-11')), /sin gastos/);
});

test('revisión cruzada: una compra aprobada no se funde con su rechazo', () => {
  const d = base();
  procesarMensaje(
    d,
    msg(
      'r1',
      'Bancolombia: Tu compra por $50,000 en EXITO con tu T.Deb *1234 fue rechazada el 06/11/2026 a las 14:00.',
      'manual',
    ),
    ctx,
  );
  const r = procesarMensaje(
    d,
    msg(
      'r2',
      'Bancolombia: Compraste $50,000 en EXITO con tu T.Deb *1234, el 06/11/2026 a las 14:01.',
      'gmail',
    ),
    ctx,
  );
  assert.equal(r.resultado, 'confirmado');
  assert.equal(saldoCuenta(d.accounts[0], d.transactions), 950000);
  const inverso = base();
  procesarMensaje(
    inverso,
    msg(
      'r1',
      'Bancolombia: Compraste $50,000 en EXITO con tu T.Deb *1234, el 06/11/2026 a las 14:01.',
      'manual',
    ),
    ctx,
  );
  procesarMensaje(
    inverso,
    msg(
      'r2',
      'Bancolombia: Tu compra por $50,000 en EXITO con tu T.Deb *1234 fue rechazada el 06/11/2026 a las 14:00.',
      'gmail',
    ),
    ctx,
  );
  assert.equal(inverso.transactions.find((t) => t.estado === 'confirmado').fuentes.length, 1);
});

test('revisión cruzada: movimientos de dos lados exigen ambos', () => {
  const d = base();
  d.accounts.push({ id: 'b', name: 'Otra', tipo: 'ahorros', ultimos4: '1111' });
  d.tarjetas.push({ id: 'c', alias: 'V', ultimos4: '5566', tasaEA: 20 });
  d.settings.ingesta.umbralAutoConfirmar = 0.5;
  assert.equal(
    procesarMensaje(
      d,
      msg('r1', 'Bancolombia: Pagaste $1,000 a tu Tarjeta de Credito *5566 el 06/11/2026 a las 09:30.'),
      ctx,
    ).resultado,
    'pendiente',
  );
  const sinEfectivo = base();
  sinEfectivo.settings.ingesta.umbralAutoConfirmar = 0.5;
  assert.equal(
    procesarMensaje(
      sinEfectivo,
      msg('r1', 'Bancolombia: Retiraste $1,000 de tu cuenta *1234 en CAJERO el 05/11/2026 a las 08:15.'),
      ctx,
    ).resultado,
    'pendiente',
  );
});

test('revisión cruzada: la cuenta única no absorbe otra cuenta', () => {
  const d = base();
  assert.equal(
    procesarMensaje(d, msg('r1', PAGO.replace('producto 1234', 'producto 9999')), ctx).resultado,
    'pendiente',
  );
  assert.equal(d.transactions[0].accountId, null);
  const sinDigitos = base();
  sinDigitos.accounts[0].ultimos4 = null;
  sinDigitos.accounts.push({ id: 'e', name: 'Efectivo', tipo: 'efectivo' });
  procesarMensaje(sinDigitos, msg('r1', PAGO), ctx);
  assert.equal(sinDigitos.transactions[0].accountId, 'a', 'el efectivo no cuenta como cuenta bancaria');
});

test('ingesta: nómina sin últimos 4 usa el tipo de cuenta cuando es único', () => {
  const NOMINA_SIN_DIGITOS =
    'Bancolombia: Recibiste un pago de Nomina de EMPRESA EJEMPLO por $1,550,555.00 en tu cuenta de Ahorros el 29/10/2026 a las 13:44.';
  const d = base();
  d.accounts.push({ id: 'b', name: 'Corriente', tipo: 'corriente', ultimos4: '9999' });
  procesarMensaje(d, msg('r1', NOMINA_SIN_DIGITOS), ctx);
  assert.equal(d.transactions[0].accountId, 'a', 'la única cuenta de Ahorros resuelve la nómina sin dígitos');

  const dosAhorros = base();
  dosAhorros.accounts.push({ id: 'b', name: 'Otra Ahorros', tipo: 'ahorros', ultimos4: '9999' });
  procesarMensaje(dosAhorros, msg('r1', NOMINA_SIN_DIGITOS), ctx);
  assert.equal(
    dosAhorros.transactions[0].accountId,
    null,
    'con dos cuentas del mismo tipo no hay forma de adivinar cuál es',
  );
});

test('revisión cruzada: manual vinculado recibe la segunda fuente', () => {
  const d = base();
  d.transactions.push({
    id: 'manual',
    date: '2026-11-05',
    type: 'expense',
    amount: 5500,
    origen: 'manual',
    estado: 'confirmado',
    fuentes: [],
  });
  vincular(d, procesarMensaje(d, msg('r1', PAGO, 'manual'), ctx).movimientoId);
  assert.equal(procesarMensaje(d, msg('r2', PAGO, 'gmail'), ctx).resultado, 'duplicado');
  assert.equal(d.transactions.length, 1);
});

test('revisión cruzada: confirmar aprende y las cuotas siguen al movimiento', () => {
  const d = base();
  d.tarjetas.push({ id: 'c', alias: 'V', ultimos4: '5566', tasaEA: 20 });
  d.settings.ingesta.autoConfirmar = false;
  const { movimientoId: id } = procesarMensaje(d, msg('r1', PAGO), ctx);
  confirmar(d, id, { category: 'Salud' });
  assert.equal(d.reglas[0].categoria, 'Salud');
  d.settings.ingesta.autoConfirmar = true;
  d.settings.ingesta.umbralAutoConfirmar = 0.5;
  const dif = procesarMensaje(
    d,
    msg(
      'r2',
      'Bancolombia: Compraste $600,000.00 con tu T.Cred *5566 en ALKOSTO en 6 cuotas el 05/11/2026 a las 11:00.',
    ),
    ctx,
  );
  assert.equal(d.comprasDiferidas.length, 1);
  descartar(d, dif.movimientoId);
  assert.equal(d.comprasDiferidas.length, 0, 'sin cuotas fantasma');
  d.settings.ingesta.autoConfirmar = false;
  const otra = procesarMensaje(
    d,
    msg(
      'r3',
      'Bancolombia: Compraste $700,000.00 con tu T.Cred *5566 en ALKOSTO en 6 cuotas el 05/11/2026 a las 11:00.',
    ),
    ctx,
  );
  assert.throws(() => confirmar(d, otra.movimientoId), /identificadores/);
});

test('revisión cruzada: dividir no duplica cuando llega la segunda fuente', () => {
  const d = base();
  d.settings.ingesta.autoConfirmar = false;
  const { movimientoId: id } = procesarMensaje(d, msg('r1', PAGO, 'manual'), ctx);
  const [a, b] = dividir(
    d,
    id,
    [
      { amount: 5000, category: 'A' },
      { amount: 500, category: 'B' },
    ],
    ctx.nuevoId,
  );
  assert.notEqual(a.fuentes, b.fuentes);
  assert.deepEqual(b.fuentes, []);
  assert.equal(procesarMensaje(d, msg('r2', PAGO, 'gmail'), ctx).resultado, 'duplicado');
  assert.equal(d.transactions.length, 2);
});

test('enseñar: dato al inicio, comercio variable y sin monto', () => {
  const texto =
    'Bancolombia: El 06/11/2026 a las 14:30 abonaste en EXITO NORTE por $120.000 con tu tarjeta *1234. Publicidad larga';
  const regla = proponerRegla(texto, 'compra_debito');
  const r = crearRegistro({ patrones: [] }, [regla]);
  const uno = r.analizar(texto, { fuente: 'manual' });
  assert.equal(uno.monto, 120000);
  assert.equal(uno.ultimos4, '1234');
  assert.equal(uno.comercio, 'EXITO NORTE');
  assert.equal(
    r.analizar(texto.replace('EXITO NORTE', 'CARULLA').replace('120.000', '5.000'), { fuente: 'manual' })
      .monto,
    5000,
  );
  assert.throws(() => proponerRegla('Bancolombia: aviso sin cifras', 'iva'), /monto/);
});

test('Power BI: tablas y CSV seguro', () => {
  assert.equal(celdaCsv('a,b'), '"a,b"');
  assert.equal(celdaCsv('a"b'), '"a""b"');
  assert.equal(celdaCsv('=1+1'), "'=1+1");
  assert.equal(celdaCsv(-5), '-5');
  assert.equal(celdaCsv(null), '');
  assert.equal(aCsv(['a'], [{ a: 1 }]), 'a\r\n1');
  const d = base();
  d.tarjetas.push({ id: 'c', alias: 'Visa', cupoTotal: 10, tasaEA: 1 });
  d.deudas.push({ id: 'd', tipo: 'consumo', saldo: 5, tasaEA: 2 });
  d.transactions.push(
    { id: 't', date: '2026-10-30', type: 'expense', amount: 10, category: 'X', accountId: 'a' },
    { id: 'p', date: '2026-10-30', type: 'expense', amount: 10, estado: 'pendiente_revision' },
  );
  const t = tablasPowerBi(d, '2026-11-02');
  assert.equal(t.movimientos.length, 1, 'excluye pendientes');
  assert.equal(t.movimientos[0].tipo, 'gasto');
  assert.equal(t.calendario[0].fecha, '2026-10-01');
  assert.equal(t.calendario.at(-1).fecha, '2026-11-02');
  assert.equal(t.tarjetas[0].cupo_total, 10);
  assert.equal(t.deudas[0].saldo, 5);
  const csv = archivosCsv(t);
  assert.ok(csv['movimientos.csv'].startsWith('id,fecha'));
  assert.equal(archivosCsv({ vacia: [] })['vacia.csv'], '');
  assert.deepEqual(tablasPowerBi(base(), '2026-11-02').calendario, []);
});

test('registro local: acotado y sin tokens', () => {
  const log = [];
  registrar(log, 'error', 'fallo https://x/exec?action=ack&token=abc123&ids=1');
  registrar(log, 'info', 'clave 0123456789abcdef0123456789abcdef0123');
  assert.ok(!log[0].mensaje.includes('abc123'));
  assert.ok(!log[1].mensaje.includes('0123456789abcdef'));
  for (let i = 0; i < 250; i++) registrar(log, 'info', 'x');
  assert.equal(log.length, 200);
});

test('tasa de ahorro: mismo texto en todas las pantallas, sin porcentajes absurdos', () => {
  assert.equal(textoTasaAhorro({ income: 1000, expense: 800, savingsRate: 20 }), '20 %');
  assert.equal(textoTasaAhorro({ income: 1000, expense: 1500, savingsRate: -50 }), '-50 %');
  assert.equal(textoTasaAhorro({ income: 116500, expense: 605500, savingsRate: -420 }), 'Déficit');
  assert.equal(textoTasaAhorro({ income: 0, expense: 10, savingsRate: 0 }), 'Sin ingresos');
  assert.equal(textoTasaAhorro({ income: 0, expense: 0, savingsRate: 0 }), '0 %');
});

test('enseñar: el comercio es el que sigue a "a/en/para", no una sigla como PSE', () => {
  const primero =
    'Bancolombia: Hiciste un pago PSE por $230.000,00 a ETB COLOMBIA desde tu cuenta *1234 el 10/11/2026 a las 11:20.';
  const regla = proponerRegla(primero, 'pago_servicio');
  const r = crearRegistro({ patrones: [] }, [regla]);
  assert.equal(r.analizar(primero, { fuente: 'manual' }).comercio, 'ETB COLOMBIA');
  const segundo = r.analizar(
    'Bancolombia: Hiciste un pago PSE por $54.900,00 a CLARO COLOMBIA desde tu cuenta *1234 el 11/11/2026 a las 08:05.',
    { fuente: 'manual' },
  );
  assert.equal(segundo.monto, 54900);
  assert.equal(segundo.comercio, 'CLARO COLOMBIA');
  assert.equal(segundo.fecha, '2026-11-11');
  assert.equal(elegirComercio('Compraste $9.900 en DLO*Didi con tu T.Deb *1234'), 'DLO*Didi');
  assert.equal(
    elegirComercio('Pago QR exitoso por $12.000 en PANADERIA LA 80 desde tu cuenta'),
    'PANADERIA LA 80',
  );
  assert.equal(elegirComercio('Abonaste $45.000 al fondo X desde **1234'), null);
});

test('Power BI: un retiro exporta su cuenta destino y el saldo del efectivo se puede reconstruir', () => {
  const d = base();
  d.accounts.push({ id: 'e', name: 'Efectivo', tipo: 'efectivo', startBalance: 20000 });
  d.transactions.push(
    {
      id: 'r',
      date: '2026-11-10',
      type: 'transferencia',
      amount: 150000,
      accountId: 'a',
      cuentaDestinoId: 'e',
      estado: 'confirmado',
    },
    {
      id: 'g',
      date: '2026-11-11',
      type: 'expense',
      amount: 40000,
      accountId: 'e',
      category: 'Transporte',
      estado: 'confirmado',
    },
  );
  const { movimientos } = tablasPowerBi(d, '2026-11-12');
  const retiro = movimientos.find((m) => m.id === 'r');
  assert.equal(retiro.cuenta_id, 'a');
  assert.equal(retiro.cuenta_destino_id, 'e');
  assert.equal(movimientos.find((m) => m.id === 'g').cuenta_destino_id, '');
  const efectivo = movimientos.reduce((s, m) => {
    if (m.cuenta_destino_id === 'e') s += m.monto;
    if (m.cuenta_id === 'e' && m.tipo === 'gasto') s -= m.monto;
    return s;
  }, 20000);
  assert.equal(efectivo, saldoCuenta(d.accounts[1], d.transactions));
});
