import test from 'node:test';
import assert from 'node:assert/strict';
import { indicadoresSalud, promediosMensuales, liquidez, ritmoDelMes } from '../../js/domain/salud.js';

/** Persona con salario de $3.000.000 y gastos de $2.700.000 al mes durante agosto–octubre. */
function persona(extra = {}) {
  const transactions = [];
  for (const mes of ['2026-08', '2026-09', '2026-10']) {
    transactions.push({ type: 'income', amount: 3000000, date: `${mes}-01`, accountId: 'b' });
    transactions.push({
      type: 'expense',
      amount: 2700000,
      date: `${mes}-15`,
      accountId: 'b',
      category: 'Vivienda',
    });
  }
  return {
    accounts: [{ id: 'b', tipo: 'ahorros', startBalance: 1000000 }],
    pockets: [],
    tarjetas: [],
    deudas: [],
    presupuestos: [],
    transactions,
    ...extra,
  };
}
const por = (lista, id) => lista.find((i) => i.id === id);

test('promedios: solo meses cerrados con movimientos', () => {
  const d = persona();
  d.transactions.push({ type: 'expense', amount: 9999999, date: '2026-11-02', accountId: 'b' });
  assert.deepEqual(promediosMensuales(d.transactions, '2026-11'), {
    ingreso: 3000000,
    gasto: 2700000,
    meses: 3,
  });
  assert.deepEqual(promediosMensuales([], '2026-11'), { ingreso: 0, gasto: 0, meses: 0 });
});

test('liquidez: cuentas y bolsillos, sin CDT', () => {
  const d = persona({
    pockets: [{ id: 'p', startBalance: 500000 }],
    investments: [{ id: 'i', amount: 10000000 }],
  });
  // 1.000.000 inicial + 3 × 300.000 de ahorro + 500.000 del bolsillo
  assert.equal(liquidez(d), 2400000);
});

test('salud: fondo corto y ahorro bajo dan alertas con cifras concretas', () => {
  const r = indicadoresSalud(persona(), '2026-11');
  const fondo = por(r, 'emergencia');
  assert.equal(fondo.estado, 'mal'); // 1.900.000 / 2.700.000 = 0,7 meses
  assert.match(fondo.valor, /0,7 meses/);
  assert.match(fondo.consejo, /\$6\.200\.000/); // 3 × 2.700.000 − 1.900.000
  const ahorro = por(r, 'ahorro');
  assert.equal(ahorro.valor, '10 %');
  assert.equal(ahorro.estado, 'alerta');
  assert.match(ahorro.consejo, /\$2\.400\.000/);
  assert.equal(por(r, 'tarjetas'), undefined, 'sin tarjetas no hay indicador');
});

test('salud: tarjetas y carga de deuda', () => {
  const d = persona({
    tarjetas: [{ id: 't', cupoTotal: 4000000, saldoInicial: 2800000, tasaEA: 26.8 }],
    deudas: [{ id: 'x', saldo: 5000000, pagoMinimo: 600000 }],
  });
  const r = indicadoresSalud(d, '2026-11');
  const uso = por(r, 'tarjetas');
  assert.equal(uso.valor, '70 %');
  assert.equal(uso.estado, 'mal');
  assert.match(uso.consejo, /\$1\.600\.000/);
  const deuda = por(r, 'deuda');
  assert.equal(deuda.estado, 'alerta'); // (≈188.000 + 600.000) / 3.000.000 ≈ 26 %
  assert.match(deuda.valor, /^2\d %$/);
});

test('salud: sin historia muestra "sin datos" en vez de cifras falsas', () => {
  const r = indicadoresSalud({ accounts: [], transactions: [] }, '2026-11');
  assert.equal(por(r, 'emergencia').estado, 'sin_datos');
  assert.equal(por(r, 'ahorro').estado, 'sin_datos');
});

test('salud: buena situación', () => {
  const d = persona({ accounts: [{ id: 'b', tipo: 'ahorros', startBalance: 20000000 }] });
  d.transactions = d.transactions.map((t) => (t.type === 'expense' ? { ...t, amount: 2000000 } : t));
  const r = indicadoresSalud(d, '2026-11');
  assert.equal(por(r, 'emergencia').estado, 'ok');
  assert.equal(por(r, 'ahorro').estado, 'ok');
});

test('ritmo del mes: con presupuestos reparte lo que queda entre los días restantes', () => {
  const d = persona({ presupuestos: [{ categoria: 'Alimentación', limite: 900000 }] });
  d.transactions.push({
    type: 'expense',
    amount: 300000,
    date: '2026-11-05',
    accountId: 'b',
    category: 'Alimentación',
  });
  const r = ritmoDelMes(d, '2026-11-12'); // quedan 19 días contando hoy
  assert.equal(r.base, 'presupuesto');
  assert.equal(r.dias, 19);
  assert.equal(r.disponible, 600000);
  assert.equal(r.porDia, 31578);
});

test('ritmo del mes: sin presupuestos usa el 80 % del ingreso promedio', () => {
  const d = persona();
  d.transactions.push({ type: 'expense', amount: 1400000, date: '2026-11-05', accountId: 'b' });
  const r = ritmoDelMes(d, '2026-11-30');
  assert.equal(r.base, 'ingreso');
  assert.equal(r.disponible, 1000000);
  assert.equal(r.porDia, 1000000);
  // Ya pasado del límite: no sugiere gastar nada.
  d.transactions.push({ type: 'expense', amount: 2000000, date: '2026-11-06', accountId: 'b' });
  assert.equal(ritmoDelMes(d, '2026-11-30').porDia, 0);
  assert.equal(ritmoDelMes({ accounts: [], transactions: [] }, '2026-11-30').base, null);
});
