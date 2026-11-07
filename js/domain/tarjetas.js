/**
 * Tarjetas de crédito: cupos, tasas, ciclos, amortización y alertas.
 * Supuestos documentados en docs/DECISIONES.md.
 */

import { aEntero } from './money.js';
import { diasEntre, diaBogota, diaDelMes, sumarMeses } from './fechas.js';
import { efectoEnTarjeta } from './movimientos.js';

/** Tasa mensual vencida equivalente a una efectiva anual en porcentaje: (1+EA)^(1/12) − 1. */
export function tasaMensual(tasaEAPorcentaje) {
  const ea = Number(tasaEAPorcentaje) / 100;
  if (!Number.isFinite(ea) || ea <= -1) throw new RangeError('Tasa EA inválida');
  return Math.pow(1 + ea, 1 / 12) - 1;
}

/** Deuda actual: saldo inicial + compras, cobros y avances − pagos. */
export function saldoTarjeta(tarjeta, transacciones) {
  return transacciones.reduce((s, t) => s + efectoEnTarjeta(t, tarjeta.id), aEntero(tarjeta.saldoInicial));
}

/** Cupo disponible; nunca negativo aunque la deuda supere el cupo. */
export function cupoDisponible(tarjeta, saldo) {
  return Math.max(0, aEntero(tarjeta.cupoTotal) - saldo);
}

/** Utilización en porcentaje entero y semáforo: ≤30 verde, ≤60 ámbar, >60 rojo. */
export function utilizacion(tarjeta, saldo) {
  const cupo = aEntero(tarjeta.cupoTotal);
  const porcentaje = cupo > 0 ? Math.round((Math.max(0, saldo) / cupo) * 100) : 0;
  const color = porcentaje <= 30 ? 'verde' : porcentaje <= 60 ? 'ambar' : 'rojo';
  return { porcentaje, color };
}

/**
 * Próximas fechas de corte y de pago desde `hoy` (inclusive). Días inexistentes se ajustan al
 * último del mes. El límite cae en el mes del corte si su día es posterior; si no, en el siguiente.
 */
export function proximasFechas(tarjeta, hoy = diaBogota()) {
  const mes = hoy.slice(0, 7);
  let corte = diaDelMes(mes, tarjeta.diaCorte);
  if (corte < hoy) corte = diaDelMes(sumarMeses(mes, 1), tarjeta.diaCorte);
  const limiteDe = (corteDia) => {
    const m = corteDia.slice(0, 7);
    return tarjeta.diaLimitePago > tarjeta.diaCorte
      ? diaDelMes(m, tarjeta.diaLimitePago)
      : diaDelMes(sumarMeses(m, 1), tarjeta.diaLimitePago);
  };
  // El siguiente límite puede pertenecer al corte anterior, que aún no se ha pagado.
  const corteAnterior = diaDelMes(sumarMeses(corte.slice(0, 7), -1), tarjeta.diaCorte);
  const limiteAnterior = limiteDe(corteAnterior);
  const limitePago = limiteAnterior >= hoy ? limiteAnterior : limiteDe(corte);
  return { corte, limitePago };
}

/**
 * Tabla de amortización de cuota fija (sistema francés). La última cuota liquida el residuo
 * del redondeo; cada cuota = capital + interés, en enteros.
 * @returns {{valorCuota:number, tabla:Array<{n:number,cuota:number,interes:number,capital:number,saldo:number}>, totalIntereses:number}}
 */
export function amortizacion(monto, nCuotas, tasaEA) {
  const capitalInicial = aEntero(monto);
  if (capitalInicial <= 0 || !Number.isInteger(nCuotas) || nCuotas < 1) {
    throw new RangeError('La amortización requiere monto positivo y cuotas enteras ≥ 1');
  }
  const i = tasaMensual(tasaEA);
  const valorCuota =
    i === 0 ? Math.ceil(capitalInicial / nCuotas) : Math.round((capitalInicial * i) / (1 - Math.pow(1 + i, -nCuotas)));
  const tabla = [];
  let saldo = capitalInicial;
  let totalIntereses = 0;
  for (let n = 1; n <= nCuotas; n++) {
    const interes = Math.round(saldo * i);
    const capital = n === nCuotas ? saldo : Math.min(saldo, valorCuota - interes);
    saldo -= capital;
    totalIntereses += interes;
    tabla.push({ n, cuota: capital + interes, interes, capital, saldo });
  }
  return { valorCuota, tabla, totalIntereses };
}

/** Saldo y próxima cuota de una compra diferida según las cuotas ya pagadas. */
export function estadoDiferida(compra) {
  const { tabla } = amortizacion(compra.montoOriginal, compra.nCuotas, compra.tasaEA);
  const pagadas = Math.min(compra.cuotasPagadas || 0, compra.nCuotas);
  const saldoPendiente = pagadas === 0 ? aEntero(compra.montoOriginal) : tabla[pagadas - 1].saldo;
  return { saldoPendiente, proximaCuota: tabla[pagadas] ?? null, restantes: compra.nCuotas - pagadas };
}

/** Pago mínimo estimado: porcentaje del saldo más intereses, con piso. */
export function pagoMinimoEstimado(saldo, tasaEA, { porcentaje = 5, piso = 30000 } = {}) {
  const deuda = aEntero(saldo);
  if (deuda <= 0) return 0;
  const calculado = Math.round((deuda * porcentaje) / 100 + deuda * tasaMensual(tasaEA));
  return Math.min(Math.max(calculado, piso), Math.round(deuda * (1 + tasaMensual(tasaEA))));
}

/**
 * Costo de pagar solo el mínimo frente a pagar el total hoy.
 * El tope de 600 meses evita ciclos infinitos si el mínimo no cubre intereses.
 */
export function costoPagoMinimo(saldo, tasaEA, opciones = {}) {
  const i = tasaMensual(tasaEA);
  let deuda = aEntero(saldo);
  let meses = 0;
  let intereses = 0;
  while (deuda > 0 && meses < 600) {
    const pago = pagoMinimoEstimado(deuda, tasaEA, opciones);
    const interes = Math.round(deuda * i);
    if (pago <= interes) return { meses: null, intereses: null, liquidable: false };
    intereses += interes;
    deuda = Math.max(0, deuda + interes - pago);
    meses++;
  }
  return { meses, intereses, liquidable: deuda === 0 };
}

/**
 * Alertas de una tarjeta para hoy.
 * @returns {Array<{tipo:string,nivel:'info'|'aviso'|'urgente',mensaje:string,dias?:number}>}
 */
export function alertasTarjeta(tarjeta, saldo, opciones = {}) {
  const { hoy = diaBogota(), cicloActual = null } = opciones;
  const alertas = [];
  const { corte, limitePago } = proximasFechas(tarjeta, hoy);
  const diasCorte = diasEntre(hoy, corte);
  const diasPago = diasEntre(hoy, limitePago);
  const nombre = tarjeta.alias || `*${tarjeta.ultimos4 ?? ''}`;
  if (diasCorte >= 0 && diasCorte <= 3) {
    alertas.push({ tipo: 'corte', nivel: 'info', dias: diasCorte, mensaje: `${nombre}: corte en ${diasCorte} día(s).` });
  }
  if (saldo > 0 && [7, 3, 1, 0].includes(diasPago)) {
    alertas.push({
      tipo: 'limite_pago',
      nivel: diasPago <= 1 ? 'urgente' : 'aviso',
      dias: diasPago,
      mensaje: diasPago === 0 ? `${nombre}: hoy es el límite de pago.` : `${nombre}: límite de pago en ${diasPago} día(s).`,
    });
  }
  if (cicloActual && !cicloActual.pagado && cicloActual.fechaLimitePago < hoy) {
    alertas.push({ tipo: 'minimo_no_cubierto', nivel: 'urgente', mensaje: `${nombre}: venció el pago sin cubrir el mínimo.` });
  }
  const uso = utilizacion(tarjeta, saldo);
  if (uso.color === 'rojo') {
    alertas.push({ tipo: 'utilizacion', nivel: 'aviso', mensaje: `${nombre}: utilización del ${uso.porcentaje} % del cupo.` });
  }
  const cuota = aEntero(tarjeta.cuotaManejo);
  if (cuota > 0 && diasCorte >= 0 && diasCorte <= 3) {
    alertas.push({ tipo: 'cuota_manejo', nivel: 'info', mensaje: `${nombre}: cuota de manejo próxima por $${cuota.toLocaleString('es-CO')}.` });
  }
  return alertas;
}
