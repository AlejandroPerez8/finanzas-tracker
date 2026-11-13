/** Datos sintéticos realistas (6 meses, montos de millones, nombres largos) para estresar las pantallas. */
import { migrar } from '../../js/services/migraciones.js';

export function datosReales({ cantidadExtra = 0 } = {}) {
  const tx = [];
  let n = 0;
  const id = () => `t${++n}`;
  const meses = ['2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11'];
  const base = { estado: 'confirmado', origen: 'manual', fuentes: [], comercio: '', note: '' };
  for (const m of meses) {
    const cerrado = m !== '2026-11';
    tx.push({
      ...base,
      id: id(),
      type: 'income',
      amount: 3200000,
      date: `${m}-01`,
      accountId: 'ban',
      category: 'Salario',
      comercio: 'EMPRESA EJEMPLO S A S',
    });
    tx.push({
      ...base,
      id: id(),
      type: 'expense',
      amount: 1100000,
      date: `${m}-03`,
      accountId: 'ban',
      category: 'Vivienda',
      comercio: 'ARRENDAMIENTOS INMOBILIARIA DEL VALLE DE ABURRA',
    });
    tx.push({
      ...base,
      id: id(),
      type: 'expense',
      amount: 65900,
      date: `${m}-05`,
      accountId: 'ban',
      category: 'Servicios',
      comercio: 'COMUNICACION CELULAR COMCEL S A',
    });
    tx.push({
      ...base,
      id: id(),
      type: 'expense',
      amount: 42900,
      date: `${m}-08`,
      accountId: null,
      tarjetaId: 'visa',
      category: 'Entretenimiento',
      comercio: 'NETFLIX.COM',
    });
    if (cerrado || m === '2026-11') {
      tx.push({
        ...base,
        id: id(),
        type: 'expense',
        amount: 380000 + meses.indexOf(m) * 7300,
        date: `${m}-10`,
        accountId: 'ban',
        category: 'Alimentación',
        comercio: 'TIENDAS D1 SUCURSAL CENTRO COMERCIAL PREMIUM PLAZA',
      });
      tx.push({
        ...base,
        id: id(),
        type: 'transferencia',
        amount: 200000,
        date: `${m}-12`,
        accountId: 'ban',
        cuentaDestinoId: 'efe',
        comercio: 'METR BELLO6',
      });
      tx.push({
        ...base,
        id: id(),
        type: 'expense',
        amount: 120000,
        date: `${m}-13`,
        accountId: 'efe',
        category: 'Transporte',
        comercio: 'BUSES Y TAXIS',
      });
    }
    if (cerrado) {
      tx.push({
        ...base,
        id: id(),
        type: 'expense',
        amount: 640000,
        date: `${m}-18`,
        accountId: null,
        tarjetaId: 'visa',
        category: 'Otros',
        comercio: 'FALABELLA',
      });
      tx.push({
        ...base,
        id: id(),
        type: 'pago_tarjeta',
        amount: 600000,
        date: `${m}-28`,
        accountId: 'ban',
        tarjetaId: 'visa',
        category: '',
      });
      tx.push({
        ...base,
        id: id(),
        type: 'interes',
        amount: 31000,
        date: `${m}-25`,
        accountId: null,
        tarjetaId: 'visa',
        category: 'Deudas',
      });
    }
  }
  // Pendientes y mensajes ingeridos.
  tx.push({
    ...base,
    id: id(),
    type: 'transferencia',
    amount: 150000,
    date: '2026-11-11',
    hora: '18:14',
    accountId: null,
    cuentaDestinoId: 'efe',
    comercio: 'METR BELLO6',
    origen: 'gmail',
    estado: 'pendiente_revision',
    ultimos4: '9999',
    fuentes: [{ fuente: 'gmail', rowId: 'r_000010', patronId: 'retiro_cajero_verificado' }],
    tipoMensaje: 'retiro_cajero',
    confianza: 0.95,
  });
  tx.push({
    ...base,
    id: id(),
    type: 'expense',
    amount: 1234567,
    date: '2026-11-11',
    hora: '20:00',
    accountId: null,
    tarjetaId: null,
    category: 'Otros',
    comercio: 'ALMACENES EXITO SUCURSAL AVENIDA ORIENTAL CON CALLE CINCUENTA',
    origen: 'gmail',
    estado: 'pendiente_revision',
    ultimos4: '7788',
    fuentes: [{ fuente: 'gmail', rowId: 'r_000011', patronId: 'compra_credito' }],
    tipoMensaje: 'compra_credito',
    confianza: 0.8,
  });
  for (let k = 0; k < cantidadExtra; k++) {
    const dia = String(1 + (k % 28)).padStart(2, '0');
    tx.push({
      ...base,
      id: id(),
      type: 'expense',
      amount: 1000 + (k % 90) * 1000,
      date: `${meses[k % 6]}-${dia}`,
      accountId: 'ban',
      category: ['Alimentación', 'Transporte', 'Otros', 'Salud'][k % 4],
      comercio: `COMERCIO ${k % 300}`,
    });
  }
  const crudo = {
    accounts: [
      {
        id: 'ban',
        name: 'Bancolombia Ahorros Nómina Principal',
        type: 'Ahorros',
        startBalance: 2500000,
        ultimos4: '1234',
        ultimos4Debito: '2436',
      },
      { id: 'efe', name: 'Efectivo', type: 'Efectivo', startBalance: 50000 },
      { id: 'neq', name: 'Nequi', type: 'Digital', startBalance: 180000 },
    ],
    pockets: [
      { id: 'p1', name: 'Fondo de emergencia para imprevistos', accountId: 'ban', startBalance: 1500000 },
    ],
    goals: [
      {
        id: 'g1',
        name: 'Viaje a Punta Cana abril 2027',
        target: 6000000,
        targetDate: '2027-04-17',
        includeContributions: true,
        pocketIds: [],
        investmentIds: [],
        contributions: [{ date: '2026-10-01', amount: 900000 }],
      },
    ],
    investments: [
      {
        id: 'i1',
        entity: 'Banco de Bogotá CDT plazo largo',
        amount: 5000000,
        rate: 11.2,
        termMonths: 6,
        startDate: '2026-06-15',
      },
      {
        id: 'i2',
        entity: 'Bancolombia',
        amount: 3000000,
        rate: 10.1,
        termMonths: 12,
        startDate: '2026-09-01',
      },
    ],
    transactions: tx,
    reports: [],
    settings: { reminderOn: false, reminderHour: 20, lastNotified: null, lastReportMonth: null },
  };
  const { datos } = migrar(crudo);
  datos.tarjetas = [
    {
      id: 'visa',
      alias: 'Visa Platinum Bancolombia',
      ultimos4: '5566',
      diaCorte: 15,
      diaLimitePago: 30,
      tasaEA: 26.82,
      cupoTotal: 6000000,
      banco: 'Bancolombia',
      franquicia: 'Visa',
      saldoInicial: 1800000,
      cuotaManejo: 38900,
      estado: 'activa',
    },
    {
      id: 'mc',
      alias: 'Mastercard',
      ultimos4: '7711',
      diaCorte: 5,
      diaLimitePago: 20,
      tasaEA: 28.1,
      cupoTotal: 2500000,
      banco: 'Bancolombia',
      franquicia: 'Mastercard',
      saldoInicial: 2300000,
      cuotaManejo: 0,
      estado: 'activa',
    },
  ];
  datos.comprasDiferidas = [
    {
      id: 'cd1',
      tarjetaId: 'visa',
      movimientoId: 't9',
      montoOriginal: 2400000,
      nCuotas: 12,
      cuotasPagadas: 4,
      tasaEA: 26.82,
      mesInicio: '2026-07',
    },
  ];
  datos.deudas = [
    {
      id: 'de1',
      nombre: 'Crédito libre inversión Bancolombia',
      tipo: 'Libre inversión',
      saldo: 8500000,
      tasaEA: 22.5,
      pagoMinimo: 420000,
    },
  ];
  datos.presupuestos = [
    { categoria: 'Alimentación', limite: 450000 },
    { categoria: 'Transporte', limite: 150000 },
    { categoria: 'Entretenimiento', limite: 60000 },
    { categoria: 'Servicios', limite: 70000 },
  ];
  datos.ingesta = [
    {
      rowId: 'r_000012',
      fuente: 'gmail',
      recibidoEn: '2026-11-11T10:00:00-05:00',
      hashTexto: 'x',
      estado: 'no_reconocido',
      movimientoId: null,
      error: null,
      textoRelevante:
        'Bancolombia: Te informamos un mensaje con un formato totalmente nuevo por $12.345 en COMERCIO DESCONOCIDO MUY LARGO el 10/11/2026',
    },
  ];
  return datos;
}
