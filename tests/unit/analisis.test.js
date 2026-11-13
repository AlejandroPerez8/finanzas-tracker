import test from 'node:test';
import assert from 'node:assert/strict';
import {
  proyeccionCierre,
  comparativoCategorias,
  proximosCompromisos,
  patrimonioHistorico,
  vencimientoCdt,
} from '../../js/domain/analisis.js';
import { indicadoresSalud, puntajeSalud, ritmoDelMes, metaAhorro } from '../../js/domain/salud.js';
import { saldoDeuda, saldoCuenta, estadisticasMes, tipoCanonico } from '../../js/domain/movimientos.js';
import { patrimonio, detectarRecurrentes } from '../../js/domain/presupuesto.js';
import { migrar, VERSION_ACTUAL } from '../../js/services/migraciones.js';

/**
 * Salario de $3.000.000 el día 1, arriendo de $1.000.000 el día 5 (recurrente) y mercado de
 * $600.000 el día 20, de agosto a octubre de 2026.
 */
function persona(extra = {}) {
  const transactions = [];
  let n = 0;
  const mov = (t) => transactions.push({ id: `t${++n}`, accountId: 'b', estado: 'confirmado', ...t });
  for (const mes of ['2026-08', '2026-09', '2026-10']) {
    mov({ type: 'income', amount: 3000000, date: `${mes}-01`, category: 'Salario' });
    mov({ type: 'expense', amount: 1000000, date: `${mes}-05`, category: 'Vivienda', comercio: 'ARRIENDO' });
    mov({ type: 'expense', amount: 600000, date: `${mes}-20`, category: 'Alimentación' });
  }
  return {
    accounts: [{ id: 'b', tipo: 'ahorros', startBalance: 1000000 }],
    pockets: [],
    goals: [],
    investments: [],
    tarjetas: [],
    ciclos: [],
    deudas: [],
    presupuestos: [],
    settings: {},
    transactions,
    mov,
    ...extra,
  };
}

test('recurrentes: informan el día habitual del cobro', () => {
  const r = detectarRecurrentes(persona().transactions, '2026-11');
  assert.deepEqual(r, [{ comercio: 'ARRIENDO', monto: 1000000, meses: 3, costoAnual: 12000000, dia: 5 }]);
});

test('proyección: suma el fijo que aún no llega y proyecta lo variable con el ritmo', () => {
  const d = persona();
  // Día 10 de noviembre (30 días): $200.000 variables gastados, el arriendo no ha llegado.
  d.mov({ type: 'expense', amount: 200000, date: '2026-11-08', category: 'Alimentación' });
  const p = proyeccionCierre(d, '2026-11-10');
  assert.equal(p.gastado, 200000);
  assert.equal(p.fijosPendientes, 1000000);
  // 200.000 + (200.000 / 10) × 20 días + 1.000.000 de arriendo
  assert.equal(p.proyectado, 1600000);
  assert.equal(p.promedio, 1600000);
  // Sin ingreso aún este mes se usa el promedio.
  assert.equal(p.ingresoEsperado, 3000000);
  assert.equal(p.ahorroProyectado, 1400000);
  assert.equal(p.tasaProyectada, 47);
  assert.equal(p.hayBase, true);
});

test('proyección: al inicio del mes pesa más el promedio histórico que un gasto aislado', () => {
  const d = persona();
  d.mov({ type: 'expense', amount: 300000, date: '2026-11-01', category: 'Otros' });
  const p = proyeccionCierre(d, '2026-11-01');
  // Ritmo puro: 300.000 × 30 = 9.000.000. Mezclado al 10 %: 30.000 + 0,9 × 20.000 = 48.000 al día.
  assert.equal(p.proyectado, 300000 + 48000 * 29 + 1000000);
});

test('proyección: un recurrente ya cobrado no se cuenta dos veces', () => {
  const d = persona();
  d.mov({ type: 'expense', amount: 1000000, date: '2026-11-05', category: 'Vivienda', comercio: 'Arriendo' });
  const p = proyeccionCierre(d, '2026-11-15');
  assert.equal(p.fijosPendientes, 0);
  assert.equal(p.proyectado, 1000000, 'sin gasto variable, cierra en lo ya cobrado');
});

test('proyección: sin historia ni gastos no hay base', () => {
  const p = proyeccionCierre(persona({ transactions: [] }), '2026-11-10');
  assert.equal(p.hayBase, false);
  assert.equal(p.tasaProyectada, null);
  assert.equal(p.proyectado, 0);
});

test('proyección: sin meses cerrados usa solo el ritmo del mes', () => {
  const d = persona({ transactions: [] });
  d.transactions.push({ id: 'x', type: 'expense', amount: 100000, date: '2026-11-02', estado: 'confirmado' });
  assert.equal(proyeccionCierre(d, '2026-11-02').proyectado, 100000 + 50000 * 28);
});

test('comparativo: cada categoría frente a su promedio y su parte del mes', () => {
  const d = persona();
  d.mov({ type: 'expense', amount: 900000, date: '2026-11-03', category: 'Alimentación' });
  d.mov({ type: 'expense', amount: 100000, date: '2026-11-04', category: 'Salud' });
  assert.deepEqual(comparativoCategorias(d.transactions, '2026-11'), [
    { categoria: 'Alimentación', actual: 900000, promedio: 600000, delta: 300000, parte: 90 },
    { categoria: 'Salud', actual: 100000, promedio: 0, delta: 100000, parte: 10 },
  ]);
  const sinHistoria = comparativoCategorias(
    [{ type: 'expense', amount: 5, date: '2026-11-01', category: 'X' }],
    '2026-11',
  );
  assert.deepEqual(sinHistoria, [{ categoria: 'X', actual: 5, promedio: null, delta: null, parte: 100 }]);
});

test('CDT: vence el mismo día del mes de apertura, ajustado a meses cortos', () => {
  const v = vencimientoCdt({ startDate: '2026-08-31', termMonths: 6, amount: 1000000, rate: 10 });
  assert.equal(v.fecha, '2027-02-28');
  assert.ok(v.neto > 1000000 && v.retencion > 0);
  assert.equal(
    vencimientoCdt({ startDate: '2026-01-15', termMonths: 0, amount: 1, rate: 1 }).fecha,
    '2026-02-15',
  );
});

test('compromisos: tarjeta, recurrente pendiente, cuota de deuda y CDT, en orden de fecha', () => {
  const d = persona({
    tarjetas: [
      {
        id: 'c1',
        alias: 'Visa',
        cupoTotal: 2000000,
        saldoInicial: 500000,
        diaCorte: 15,
        diaLimitePago: 30,
        tasaEA: 26.82,
      },
      {
        id: 'c2',
        alias: 'Sin deuda',
        cupoTotal: 1000000,
        saldoInicial: 0,
        diaCorte: 15,
        diaLimitePago: 30,
        tasaEA: 20,
      },
      {
        id: 'c3',
        alias: 'Cerrada',
        estado: 'cerrada',
        cupoTotal: 1,
        saldoInicial: 9,
        diaCorte: 1,
        diaLimitePago: 2,
      },
    ],
    deudas: [
      { id: 'de1', nombre: 'Libranza', saldo: 4000000, tasaEA: 18, pagoMinimo: 250000 },
      { id: 'de2', nombre: 'Sin cuota', saldo: 100000, tasaEA: 0, pagoMinimo: 0 },
    ],
    investments: [
      { id: 'i1', entity: 'Banco X', amount: 2000000, rate: 10, termMonths: 3, startDate: '2026-08-20' },
      { id: 'i2', entity: 'Lejano', amount: 1, rate: 10, termMonths: 24, startDate: '2026-08-20' },
      { id: 'i3', entity: 'Ya venció', amount: 1, rate: 10, termMonths: 1, startDate: '2026-01-01' },
      { id: 'i4', entity: 'Sin fecha', amount: 1, rate: 10, termMonths: 1 },
    ],
  });
  const r = proximosCompromisos(d, '2026-11-10');
  assert.deepEqual(
    r.map((x) => [x.tipo, x.fecha, x.dias, x.entra]),
    [
      ['recurrente', '2026-11-05', -5, false],
      ['cdt', '2026-11-20', 10, true],
      ['tarjeta', '2026-11-30', 20, false],
      ['deuda', null, null, false],
    ],
  );
  assert.equal(r[0].monto, 1000000);
  assert.equal(r[2].detalle, 'pago mínimo estimado');
  assert.equal(r[3].monto, 250000);
});

test('compromisos: el extracto fija el mínimo, y lo ya pagado o cobrado desaparece', () => {
  const d = persona({
    tarjetas: [
      {
        id: 'c1',
        alias: 'Visa',
        cupoTotal: 2000000,
        saldoInicial: 500000,
        diaCorte: 15,
        diaLimitePago: 30,
        tasaEA: 26.82,
      },
    ],
    ciclos: [
      {
        id: 'k',
        tarjetaId: 'c1',
        fechaCorte: '2026-11-15',
        fechaLimitePago: '2026-11-30',
        pagoMinimo: 77000,
        pagado: false,
      },
    ],
    deudas: [{ id: 'de1', nombre: 'Libranza', saldo: 4000000, tasaEA: 18, pagoMinimo: 250000 }],
  });
  d.mov({ type: 'expense', amount: 1000000, date: '2026-11-05', comercio: 'ARRIENDO', category: 'Vivienda' });
  d.mov({ type: 'pago_deuda', amount: 200000, date: '2026-11-06', deudaId: 'de1' });
  let r = proximosCompromisos(d, '2026-11-20');
  assert.deepEqual(
    r.map((x) => [x.tipo, x.fecha, x.monto]),
    [
      ['tarjeta', '2026-11-30', 77000],
      // El arriendo de noviembre ya llegó: se anuncia el de diciembre.
      ['recurrente', '2026-12-05', 1000000],
    ],
  );
  assert.equal(r[0].detalle, 'pago mínimo del extracto');
  d.ciclos[0].pagado = true;
  r = proximosCompromisos(d, '2026-11-20');
  assert.deepEqual(
    r.map((x) => x.tipo),
    ['recurrente'],
  );
  // Con un horizonte corto, lo lejano no aparece.
  assert.deepEqual(proximosCompromisos(d, '2026-11-20', 7), []);
});

test('patrimonio histórico: reconstruye cada cierre y no inventa meses sin datos', () => {
  const d = persona({
    investments: [
      { id: 'i1', entity: 'X', amount: 500000, rate: 10, termMonths: 12, startDate: '2026-10-10' },
    ],
  });
  const h = patrimonioHistorico(d, '2026-11', 6);
  assert.deepEqual(
    h.map((x) => [x.mes, x.neto]),
    [
      ['2026-08', 2400000],
      ['2026-09', 3800000],
      // En octubre entra el CDT como activo.
      ['2026-10', 5700000],
      ['2026-11', 5700000],
    ],
  );
  assert.deepEqual(patrimonioHistorico({ ...d, transactions: [] }, '2026-11'), []);
});

test('abono a deuda: baja el saldo y la cuenta, y solo el interés es gasto', () => {
  const d = persona({
    deudas: [{ id: 'de1', nombre: 'Libranza', saldo: 1000000, tasaEA: 18, pagoMinimo: 100000 }],
  });
  const antes = saldoCuenta(d.accounts[0], d.transactions);
  d.mov({ type: 'pago_deuda', amount: 300000, date: '2026-11-02', deudaId: 'de1' });
  d.mov({ type: 'interes', amount: 14000, date: '2026-11-02', deudaId: 'de1', category: 'Deudas' });
  d.mov({ type: 'pago_deuda', amount: 50000, date: '2026-11-03', deudaId: 'de1', estado: 'descartado' });
  d.mov({ type: 'pago_deuda', amount: 50000, date: '2026-11-03', deudaId: 'otra' });
  assert.equal(saldoDeuda(d.deudas[0], d.transactions), 700000);
  assert.equal(saldoCuenta(d.accounts[0], d.transactions), antes - 300000 - 14000 - 50000);
  assert.equal(estadisticasMes(d.transactions, '2026-11').expense, 14000);
  assert.equal(patrimonio(d).desglose.otrasDeudas, 700000);
  assert.equal(tipoCanonico('pago_deuda'), 'pago_deuda');
  // Un abono mayor que la deuda no la deja negativa.
  d.mov({ type: 'pago_deuda', amount: 9000000, date: '2026-11-04', deudaId: 'de1' });
  assert.equal(saldoDeuda(d.deudas[0], d.transactions), 0);
  // Saldada, su cuota deja de contar en la carga de deuda.
  assert.equal(
    indicadoresSalud(d, '2026-12').find((i) => i.id === 'deuda'),
    undefined,
  );
});

test('meta de ahorro: configurable y con límites sensatos', () => {
  assert.equal(metaAhorro({}), 20);
  assert.equal(metaAhorro({ settings: { metaAhorro: 35 } }), 35);
  assert.equal(metaAhorro({ settings: { metaAhorro: 200 } }), 20);
  assert.equal(metaAhorro({ settings: { metaAhorro: 'x' } }), 20);
  // Ahorra 46,7 %: cumple una meta de 20 %, queda en atención con una de 60 %.
  const d = persona();
  assert.equal(indicadoresSalud(d, '2026-11').find((i) => i.id === 'ahorro').estado, 'ok');
  d.settings.metaAhorro = 60;
  const ahorro = indicadoresSalud(d, '2026-11').find((i) => i.id === 'ahorro');
  assert.equal(ahorro.estado, 'alerta');
  assert.match(ahorro.meta, /60 %/);
  assert.match(ahorro.consejo, /60 %/);
  // "Puedes gastar hoy" reserva esa misma meta: 40 % de 3.000.000 entre 30 días.
  assert.equal(ritmoDelMes(d, '2026-11-01').porDia, 40000);
});

test('puntaje de salud: promedio de lo evaluable, sin nota cuando no hay datos', () => {
  assert.equal(puntajeSalud([{ estado: 'sin_datos' }]), null);
  assert.deepEqual(puntajeSalud([{ estado: 'ok' }, { estado: 'ok' }, { estado: 'sin_datos' }]), {
    puntaje: 100,
    etiqueta: 'Sólida',
    evaluados: 2,
  });
  assert.equal(puntajeSalud([{ estado: 'ok' }, { estado: 'mal' }]).etiqueta, 'Estable');
  assert.equal(puntajeSalud([{ estado: 'mal' }, { estado: 'alerta' }]).etiqueta, 'Frágil');
});

test('migración a v3: lo que entró por mensaje de texto queda como importación manual', () => {
  const { datos, migro } = migrar({
    schemaVersion: 2,
    accounts: [],
    transactions: [
      {
        id: 'a',
        origen: 'sms',
        fuentes: [
          { fuente: 'sms', rowId: 'r1' },
          { fuente: 'gmail', rowId: 'r2' },
        ],
      },
      { id: 'b', origen: 'gmail', fuentes: [{ fuente: 'gmail', rowId: 'r3' }] },
      { id: 'c', origen: 'manual' },
    ],
    ingesta: [
      { rowId: 'r1', fuente: 'sms' },
      { rowId: 'r2', fuente: 'gmail' },
    ],
    settings: { reminderOn: true },
  });
  assert.equal(migro, true);
  assert.equal(datos.schemaVersion, VERSION_ACTUAL);
  assert.equal(VERSION_ACTUAL, 3);
  assert.deepEqual(
    datos.transactions.map((t) => [t.origen, t.fuentes.map((f) => f.fuente)]),
    [
      ['importacion', ['manual', 'gmail']],
      ['gmail', ['gmail']],
      ['manual', []],
    ],
  );
  assert.deepEqual(
    datos.ingesta.map((i) => i.fuente),
    ['manual', 'gmail'],
  );
  assert.equal(datos.settings.tema, 'auto');
  assert.equal(datos.settings.metaAhorro, 20);
  assert.equal(datos.settings.reminderOn, true);
  assert.ok(!JSON.stringify(datos).includes('sms'));
});
