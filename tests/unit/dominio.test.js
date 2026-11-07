import test from 'node:test';
import assert from 'node:assert/strict';
import { aEntero, sumar, formatear, prorratear, interpretarMonto } from '../../js/domain/money.js';
import {
  diaBogota,
  horaBogota,
  instanteBogota,
  isoBogota,
  esDiaValido,
  diasEntre,
  sumarDias,
  sumarMeses,
  ultimoDiaMes,
  diaDelMes,
  interpretarFecha,
  interpretarHora,
} from '../../js/domain/fechas.js';
import { normalizarComercio } from '../../js/domain/categorias.js';
import {
  saldoCuenta,
  efectoEnCuenta,
  efectoEnTarjeta,
  estadisticasMes,
  tipoCanonico,
} from '../../js/domain/movimientos.js';
import {
  tasaMensual,
  saldoTarjeta,
  cupoDisponible,
  utilizacion,
  proximasFechas,
  amortizacion,
  estadoDiferida,
  pagoMinimoEstimado,
  costoPagoMinimo,
  alertasTarjeta,
  cicloVigente,
  actualizarCiclos,
} from '../../js/domain/tarjetas.js';
import { simular, compararEstrategias, flujoCaja, pagarVsCdt } from '../../js/domain/deudas.js';
import { avancePresupuestos, detectarRecurrentes, patrimonio } from '../../js/domain/presupuesto.js';

test('money: redondeo y formato', () => {
  assert.equal(aEntero(10.5), 11);
  assert.equal(aEntero(-10.5), -11);
  assert.equal(aEntero('abc'), 0);
  assert.equal(aEntero('1500'), 1500);
  assert.equal(aEntero(-0.2), 0);
  assert.equal(sumar([0.1, 0.2, 1]), 1);
  assert.equal(formatear(1234567), '$1.234.567');
  assert.equal(formatear(-1234), '-$1.234');
  assert.equal(formatear(0), '$0');
  assert.equal(formatear(999), '$999');
});

test('money: el prorrateo suma exactamente el total', () => {
  assert.deepEqual(prorratear(100, [1, 1, 1]), [34, 33, 33]);
  assert.deepEqual(prorratear(10, [3, 7]), [3, 7]);
  assert.deepEqual(prorratear(0, [1, 2]), [0, 0]);
  assert.deepEqual(prorratear(5, []), []);
  assert.throws(() => prorratear(5, [0, 0]), RangeError);
  for (const total of [1, 7, 1000001]) {
    assert.equal(
      prorratear(total, [0.3, 0.3, 0.4]).reduce((a, b) => a + b),
      total,
    );
  }
});

test('money: montos de banco en ambos estilos', () => {
  const casos = {
    '$1,550,555.00': 1550555,
    '$29,000.00': 29000,
    '$116,500': 116500,
    '30,000.00': 30000,
    '$1.234.567': 1234567,
    '1.234.567,89': 1234568,
    '$5,500': 5500,
    'COP 19000': 19000,
    '1500,50': 1501,
    1500.5: 1501,
    '1.500': 1500,
    '1,500': 1500,
    '$ 75.500': 75500,
  };
  for (const [texto, esperado] of Object.entries(casos))
    assert.equal(interpretarMonto(texto), esperado, texto);
  assert.equal(interpretarMonto('$1.234.567,89.'), 1234568, 'punto final de oración');
  assert.equal(interpretarMonto('$1,234.567'), 1234567, 'tres dígitos finales son miles');
  assert.equal(interpretarMonto(null), null);
  assert.equal(interpretarMonto('sin monto'), null);
});

test('fechas: zona Bogotá', () => {
  const i = '2026-11-07T03:30:00Z'; // 22:30 del 6 en Bogotá
  assert.equal(diaBogota(i), '2026-11-06');
  assert.equal(horaBogota(i), '22:30');
  assert.equal(isoBogota(i), '2026-11-06T22:30:00-05:00');
  assert.equal(instanteBogota('2026-11-06', '22:30'), Date.parse(i));
  assert.equal(instanteBogota('2026-11-06'), Date.parse('2026-11-06T12:00:00-05:00'));
});

test('fechas: aritmética de calendario', () => {
  assert.equal(esDiaValido(2026, 2, 29), false);
  assert.equal(esDiaValido(2028, 2, 29), true);
  assert.equal(diasEntre('2026-12-31', '2027-01-01'), 1);
  assert.equal(sumarDias('2026-02-28', 1), '2026-03-01');
  assert.equal(sumarMeses('2026-11', 2), '2027-01');
  assert.equal(sumarMeses('2026-01', -1), '2025-12');
  assert.equal(ultimoDiaMes('2028-02'), 29);
  assert.equal(diaDelMes('2026-02', 31), '2026-02-28');
});

test('fechas: interpretar mensajes', () => {
  const ref = new Date('2027-01-02T12:00:00-05:00');
  assert.equal(interpretarFecha('31/12', ref), '2026-12-31');
  assert.equal(interpretarFecha('01/01', ref), '2027-01-01');
  assert.equal(interpretarFecha('05/11/26', ref), '2026-11-05');
  assert.equal(interpretarFecha('05-11-2026', ref), '2026-11-05');
  assert.equal(interpretarFecha('31/02/2026', ref), null);
  assert.equal(interpretarFecha('sin fecha', ref), null);
  assert.equal(interpretarHora('07:02:40'), '07:02');
  assert.equal(interpretarHora('2:15 pm'), '14:15');
  assert.equal(interpretarHora('12:05 a.m.'), '00:05');
  assert.equal(interpretarHora('25:00'), null);
  assert.equal(interpretarHora(null), null);
});

test('comercio normalizado', () => {
  assert.equal(normalizarComercio('  Éxito  Calle-80 S.A.S '), 'EXITO CALLE 80');
  assert.equal(normalizarComercio('COMUNICACION CELULAR COMCEL S'), 'COMUNICACION CELULAR COMCEL');
  assert.equal(normalizarComercio(null), '');
});

const tx = (o) => ({ id: 'x', date: '2026-11-05', amount: 1000, estado: 'confirmado', ...o });

test('contabilidad: la compra con tarjeta es gasto y deuda; el pago no es gasto', () => {
  const lista = [
    tx({ type: 'income', amount: 5000000, accountId: 'a', category: 'Salario' }),
    tx({ type: 'expense', amount: 200000, tarjetaId: 'c', category: 'Alimentación' }),
    tx({ type: 'pago_tarjeta', amount: 150000, accountId: 'a', tarjetaId: 'c' }),
    tx({ type: 'interes', amount: 3000, tarjetaId: 'c', category: 'Deudas' }),
  ];
  const s = estadisticasMes(lista, '2026-11');
  assert.equal(s.income, 5000000);
  assert.equal(s.expense, 203000, 'el pago de tarjeta no suma al gasto');
  assert.equal(s.byCategory['Alimentación'], 200000);
  assert.equal(
    saldoCuenta({ id: 'a', startBalance: 100 }, lista),
    100 + 5000000 - 150000,
    'la compra con tarjeta no toca la cuenta',
  );
  assert.equal(saldoTarjeta({ id: 'c', saldoInicial: 10000 }, lista), 10000 + 200000 - 150000 + 3000);
});

test('contabilidad: pendientes y descartados no afectan nada', () => {
  const lista = [
    tx({ type: 'expense', accountId: 'a', tarjetaId: 'c', estado: 'pendiente_revision' }),
    tx({ type: 'income', accountId: 'a', estado: 'descartado' }),
  ];
  assert.equal(saldoCuenta({ id: 'a', startBalance: 0 }, lista), 0);
  assert.equal(saldoTarjeta({ id: 'c' }, lista), 0);
  assert.equal(estadisticasMes(lista, '2026-11').expense, 0);
  assert.equal(estadisticasMes(lista, '2026-11').count, 0);
});

test('contabilidad: tipos heredados y nuevos sobre cuentas', () => {
  const e = (o, id = 'a') => efectoEnCuenta(tx(o), id);
  assert.equal(e({ type: 'withdraw_in', accountId: 'a' }), 1000);
  assert.equal(e({ type: 'transfer_out', accountId: 'a' }), -1000);
  assert.equal(e({ type: 'transfer_in', targetType: 'goal' }), 0);
  assert.equal(e({ type: 'avance', accountId: 'a', tarjetaId: 'c' }), 1000);
  assert.equal(e({ type: 'transferencia', accountId: 'a', cuentaDestinoId: 'b' }), -1000);
  assert.equal(e({ type: 'transferencia', accountId: 'a', cuentaDestinoId: 'b' }, 'b'), 1000);
  assert.equal(e({ type: 'cuota_manejo', accountId: 'a' }), -1000);
  assert.equal(e({ type: 'cuota_manejo', accountId: 'a', tarjetaId: 'c' }), 0);
  assert.equal(e({ type: 'otro', accountId: 'a' }), 0);
  assert.equal(efectoEnTarjeta(tx({ type: 'avance', tarjetaId: 'c' }), 'c'), 1000);
  assert.equal(efectoEnTarjeta(tx({ type: 'income', tarjetaId: 'c' }), 'c'), 0);
  assert.equal(tipoCanonico('expense'), 'gasto');
  assert.equal(tipoCanonico('raro'), 'raro');
  assert.equal(estadisticasMes([tx({ type: 'expense' })], '2026-11').byCategory.Otros, 1000);
  assert.equal(
    estadisticasMes([tx({ type: 'income', amount: 100 }), tx({ type: 'expense', amount: 25 })], '2026-11')
      .savingsRate,
    75,
  );
});

test('tarjetas: tasa, cupo y semáforo en los límites', () => {
  assert.ok(Math.abs(tasaMensual(26.82) - 0.02) < 0.00002);
  assert.equal(tasaMensual(0), 0);
  assert.throws(() => tasaMensual('x'), RangeError);
  const t = { cupoTotal: 1000 };
  assert.equal(cupoDisponible(t, 400), 600);
  assert.equal(cupoDisponible(t, 1500), 0);
  assert.deepEqual(utilizacion(t, 300), { porcentaje: 30, color: 'verde' });
  assert.deepEqual(utilizacion(t, 310), { porcentaje: 31, color: 'ambar' });
  assert.deepEqual(utilizacion(t, 600), { porcentaje: 60, color: 'ambar' });
  assert.deepEqual(utilizacion(t, 610), { porcentaje: 61, color: 'rojo' });
  assert.deepEqual(utilizacion({ cupoTotal: 0 }, 100), { porcentaje: 0, color: 'verde' });
});

test('tarjetas: próximas fechas', () => {
  const t = { diaCorte: 15, diaLimitePago: 30 };
  assert.deepEqual(proximasFechas(t, '2026-11-10'), { corte: '2026-11-15', limitePago: '2026-11-30' });
  assert.deepEqual(proximasFechas(t, '2026-11-20'), { corte: '2026-12-15', limitePago: '2026-11-30' });
  const u = { diaCorte: 25, diaLimitePago: 10 };
  assert.deepEqual(proximasFechas(u, '2026-11-05'), { corte: '2026-11-25', limitePago: '2026-11-10' });
  assert.deepEqual(proximasFechas(u, '2026-11-12'), { corte: '2026-11-25', limitePago: '2026-12-10' });
  assert.equal(proximasFechas({ diaCorte: 31, diaLimitePago: 15 }, '2026-02-10').corte, '2026-02-28');
});

test('amortización: valor de referencia y cuadre', () => {
  // 1.000.000 a 12 cuotas, 26,82 % EA ≈ 2 % m.v.: cuota francesa ≈ 94.560.
  const r = amortizacion(1000000, 12, 26.82);
  assert.ok(Math.abs(r.valorCuota - 94560) < 30, `cuota ${r.valorCuota}`);
  assert.equal(r.tabla.length, 12);
  assert.equal(r.tabla.at(-1).saldo, 0);
  assert.equal(
    r.tabla.reduce((s, f) => s + f.capital, 0),
    1000000,
  );
  assert.equal(
    r.tabla.reduce((s, f) => s + f.interes, 0),
    r.totalIntereses,
  );
  for (const f of r.tabla) assert.equal(f.cuota, f.capital + f.interes);
});

test('amortización: una cuota, sin interés y entradas inválidas', () => {
  const una = amortizacion(100000, 1, 26.82);
  assert.equal(una.tabla[0].capital, 100000);
  const sin = amortizacion(100, 3, 0);
  assert.deepEqual(
    sin.tabla.map((f) => f.capital),
    [34, 34, 32],
  );
  assert.equal(sin.totalIntereses, 0);
  assert.throws(() => amortizacion(0, 3, 10), RangeError);
  assert.throws(() => amortizacion(100, 0, 10), RangeError);
  assert.throws(() => amortizacion(100, 1.5, 10), RangeError);
});

test('compra diferida: estado', () => {
  const c = { montoOriginal: 1200, nCuotas: 3, tasaEA: 0, cuotasPagadas: 1 };
  assert.deepEqual(estadoDiferida({ ...c, cuotasPagadas: 0 }).saldoPendiente, 1200);
  const e = estadoDiferida(c);
  assert.equal(e.saldoPendiente, 800);
  assert.equal(e.restantes, 2);
  assert.equal(e.proximaCuota.n, 2);
  assert.equal(estadoDiferida({ ...c, cuotasPagadas: 3 }).proximaCuota, null);
});

test('pago mínimo: estimación, costo y deuda no liquidable', () => {
  assert.equal(pagoMinimoEstimado(0, 26.82), 0);
  assert.equal(pagoMinimoEstimado(1000000, 26.82), Math.round(50000 + 1000000 * tasaMensual(26.82)));
  assert.equal(pagoMinimoEstimado(10000, 0), 10000, 'el piso no supera la deuda');
  const c = costoPagoMinimo(1000000, 26.82);
  assert.equal(c.liquidable, true);
  assert.ok(c.meses > 12 && c.intereses > 0);
  assert.equal(costoPagoMinimo(0, 26.82).meses, 0);
  const nunca = costoPagoMinimo(10000000, 300, { porcentaje: 0, piso: 1000 });
  assert.equal(nunca.liquidable, false);
});

test('ciclo vigente: por fecha, no por orden de registro', () => {
  const c = [
    { tarjetaId: 'x', fechaCorte: '2026-03-15' },
    { tarjetaId: 'x', fechaCorte: '2026-02-15' },
    { tarjetaId: 'x', fechaCorte: '2026-12-15' },
    { tarjetaId: 'y', fechaCorte: '2026-04-15' },
  ];
  assert.equal(cicloVigente(c, 'x', '2026-11-01').fechaCorte, '2026-03-15');
  assert.equal(cicloVigente(c, 'z', '2026-11-01'), null);
  const pagos = [
    { type: 'pago_tarjeta', tarjetaId: 'x', amount: 60, date: '2026-03-20', estado: 'confirmado' },
    { type: 'pago_tarjeta', tarjetaId: 'x', amount: 500, date: '2026-03-20', estado: 'pendiente_revision' },
  ];
  const [a, b] = actualizarCiclos(
    [
      { tarjetaId: 'x', fechaCorte: '2026-03-15', pagoMinimo: 50 },
      { tarjetaId: 'x', fechaCorte: '2026-03-15', pagoMinimo: 100 },
    ],
    pagos,
    'x',
  );
  assert.equal(a.pagado, true);
  assert.equal(b.pagado, undefined);
  assert.deepEqual(actualizarCiclos([{ tarjetaId: 'y', pagado: false }], pagos, 'x'), [
    { tarjetaId: 'y', pagado: false },
  ]);
});

test('alertas de tarjeta: 7, 3 y 1 día', () => {
  const t = { alias: 'Visa', diaCorte: 15, diaLimitePago: 30, cupoTotal: 1000, cuotaManejo: 20000 };
  const de = (hoy, saldo = 100, extra) => alertasTarjeta(t, saldo, { hoy, ...extra });
  assert.ok(de('2026-11-23').some((a) => a.tipo === 'limite_pago' && a.dias === 7 && a.nivel === 'aviso'));
  assert.ok(de('2026-11-27').some((a) => a.tipo === 'limite_pago' && a.dias === 3));
  assert.ok(de('2026-11-29').some((a) => a.tipo === 'limite_pago' && a.nivel === 'urgente'));
  assert.ok(de('2026-11-30').some((a) => a.mensaje.includes('hoy es el límite')));
  assert.ok(!de('2026-11-24').some((a) => a.tipo === 'limite_pago'));
  assert.ok(!de('2026-11-23', 0).some((a) => a.tipo === 'limite_pago'), 'sin deuda no se alerta el pago');
  assert.ok(de('2026-11-13').some((a) => a.tipo === 'corte' && a.dias === 2));
  assert.ok(de('2026-11-13').some((a) => a.tipo === 'cuota_manejo'));
  assert.ok(
    !de('2026-11-29', 100, { cicloActual: { pagado: true, fechaLimitePago: '2026-11-30' } }).some(
      (a) => a.tipo === 'limite_pago',
    ),
    'ciclo ya pagado',
  );
  assert.ok(de('2026-11-02', 700).some((a) => a.tipo === 'utilizacion'));
  assert.ok(
    de('2026-11-02', 100, { cicloActual: { pagado: false, fechaLimitePago: '2026-11-01' } }).some(
      (a) => a.tipo === 'minimo_no_cubierto',
    ),
  );
  assert.ok(
    alertasTarjeta({ ultimos4: '1234', diaCorte: 15, diaLimitePago: 30 }, 100, {
      hoy: '2026-11-13',
    })[0].mensaje.includes('*1234'),
  );
});

const D = [
  { id: 'a', saldo: 1000000, tasaEA: 30, pagoMinimo: 50000 },
  { id: 'b', saldo: 300000, tasaEA: 15, pagoMinimo: 20000 },
];

test('simulador: avalancha nunca paga más intereses que bola de nieve', () => {
  const r = compararEstrategias(D, 200000, '2026-11');
  assert.ok(r.avalancha.intereses <= r.bola_de_nieve.intereses);
  assert.ok(r.avalancha.meses > 0);
  assert.equal(r.avalancha.serie.at(-1), 0);
  assert.equal(r.avalancha.interesesAhorrados, r.soloMinimos.intereses - r.avalancha.intereses);
  assert.ok(r.avalancha.interesesAhorrados > 0);
});

test('simulador: caso calculable a mano', () => {
  // Sin interés: 1.000 con 100/mes → 10 meses, libre en 2027-09.
  const r = simular([{ id: 'x', saldo: 1000, tasaEA: 0, pagoMinimo: 10 }], {
    estrategia: 'avalancha',
    presupuesto: 100,
    mesInicio: '2026-11',
  });
  assert.equal(r.meses, 10);
  assert.equal(r.intereses, 0);
  assert.equal(r.fechaLibertad, '2027-09');
  assert.equal(r.serie.length, 11);
});

test('simulador: el orden de prioridad cambia a quién paga', () => {
  const dos = [
    { id: 'cara', saldo: 500, tasaEA: 0, pagoMinimo: 0 },
    { id: 'pequena', saldo: 100, tasaEA: 0, pagoMinimo: 0 },
  ];
  assert.equal(
    simular(dos, { estrategia: 'bola_de_nieve', presupuesto: 600, mesInicio: '2026-01' }).meses,
    1,
  );
  assert.throws(
    () => simular(dos, { estrategia: 'magia', presupuesto: 100, mesInicio: '2026-01' }),
    RangeError,
  );
});

test('simulador: casos no factibles y sin deudas', () => {
  const cero = simular([], { estrategia: 'avalancha', presupuesto: 1, mesInicio: '2026-11' });
  assert.deepEqual([cero.factible, cero.meses, cero.fechaLibertad], [true, 0, '2026-11']);
  const poco = simular(D, { estrategia: 'avalancha', presupuesto: 10, mesInicio: '2026-11' });
  assert.equal(poco.factible, false);
  assert.match(poco.motivo, /mínimos/);
  const eterno = simular([{ id: 'x', saldo: 1000000, tasaEA: 100, pagoMinimo: 1000 }], {
    estrategia: 'avalancha',
    presupuesto: 1000,
    mesInicio: '2026-11',
  });
  assert.equal(eterno.factible, false);
  assert.match(eterno.motivo, /intereses/);
  assert.equal(
    compararEstrategias([{ id: 'x', saldo: 1000000, tasaEA: 100, pagoMinimo: 1000 }], 500000, '2026-11')
      .avalancha.interesesAhorrados,
    null,
  );
});

test('simulador: la base de solo mínimos no reinvierte ni cuenta deudas saldadas', () => {
  const lista = [
    { id: 'z', saldo: 0, tasaEA: 25, pagoMinimo: 200000 },
    { id: 'a', saldo: 1000000, tasaEA: 30, pagoMinimo: 100000 },
    { id: 'b', saldo: 100000, tasaEA: 15, pagoMinimo: 50000 },
  ];
  const r = compararEstrategias(lista, 150000, '2026-11');
  assert.ok(r.avalancha.interesesAhorrados >= 0);
  assert.ok(r.bola_de_nieve.interesesAhorrados >= 0);
  assert.ok(r.soloMinimos.meses > r.bola_de_nieve.meses, 'sin reinvertir tarda más');
});

test('flujo de caja: cuotas y recurrentes', () => {
  const f = flujoCaja({
    mesInicio: '2026-11',
    meses: 3,
    ingresoMensual: 1000,
    recurrentes: [{ monto: 100 }],
    diferidas: [{ montoOriginal: 200, nCuotas: 2, tasaEA: 0, cuotasPagadas: 0 }],
  });
  assert.deepEqual(
    f.map((x) => x.cuotas),
    [100, 100, 0],
  );
  assert.deepEqual(
    f.map((x) => x.neto),
    [800, 800, 900],
  );
  assert.equal(f[2].mes, '2027-01');
  assert.equal(flujoCaja({ mesInicio: '2026-11' }).length, 12);
});

test('comparador tarjeta vs CDT', () => {
  const r = pagarVsCdt({ monto: 1000000, tasaTarjetaEA: 25, tasaCdtEA: 10, meses: 12 });
  assert.equal(r.interesEvitado, 250000);
  assert.equal(r.rendimientoCdt, 96000);
  assert.equal(r.diferencia, 154000);
});

test('presupuesto: alertas 80 % y 100 %', () => {
  const lista = [
    tx({ type: 'expense', category: 'A', amount: 79 }),
    tx({ type: 'expense', category: 'B', amount: 80 }),
    tx({ type: 'expense', category: 'C', amount: 100 }),
  ];
  const a = avancePresupuestos(
    [
      { categoria: 'A', limite: 100 },
      { categoria: 'B', limite: 100 },
      { categoria: 'C', limite: 100 },
      { categoria: 'D', limite: 0 },
    ],
    lista,
    '2026-11',
  );
  assert.deepEqual(
    a.map((x) => x.nivel),
    ['ok', 'alerta', 'excedido', 'ok'],
  );
});

test('recurrentes: detección', () => {
  const gen = (comercio, montos) =>
    montos.map((amount, i) => tx({ type: 'expense', comercio, amount, date: `2026-0${i + 1}-10` }));
  const lista = [
    ...gen('NETFLIX', [30000, 30000, 31000]),
    ...gen('EXITO', [20000, 200000, 50000]),
    ...gen('UBER', [10000, 10000]),
  ];
  lista.push(
    tx({ type: 'expense', comercio: 'SPOTIFY', amount: 1, date: '2026-01-01' }),
    tx({ type: 'expense', comercio: 'SPOTIFY', amount: 1, date: '2026-03-01' }),
    tx({ type: 'expense', comercio: 'SPOTIFY', amount: 1, date: '2026-05-01' }),
  );
  lista.push(
    tx({ type: 'expense', amount: 5, date: '2026-01-01' }),
    tx({ type: 'expense', comercio: 'NETFLIX', amount: 99999, date: '2026-11-01' }),
  );
  const r = detectarRecurrentes(lista, '2026-11');
  assert.deepEqual(
    r.map((x) => x.comercio),
    ['NETFLIX'],
  );
  assert.equal(r[0].costoAnual, 30000 * 12);
});

test('patrimonio: la tarjeta suma al pasivo', () => {
  const datos = {
    accounts: [{ id: 'a', startBalance: 1000 }],
    pockets: [{ id: 'p', startBalance: 50 }],
    goals: [{ id: 'g', contributions: [{ amount: 10 }] }],
    investments: [{ id: 'i', amount: 500 }],
    tarjetas: [
      { id: 'c', saldoInicial: 300 },
      { id: 'z', saldoInicial: 999, estado: 'cerrada' },
    ],
    deudas: [{ saldo: 100 }],
    transactions: [
      tx({ type: 'transfer_in', targetType: 'pocket', targetId: 'p', amount: 5 }),
      tx({ type: 'withdraw_out', targetType: 'goal', targetId: 'g', amount: 2 }),
    ],
  };
  const p = patrimonio(datos);
  assert.equal(p.activos, 1000 + 55 + 8 + 500);
  assert.equal(p.pasivos, 400);
  assert.equal(p.neto, 1563 - 400);
  assert.equal(
    patrimonio({ accounts: [], pockets: [], goals: [], investments: [], transactions: [] }).pasivos,
    0,
  );
});
