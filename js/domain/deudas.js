/** Simulador de pago de deudas, flujo de caja y comparador con CDT. */

import { aEntero, sumar } from './money.js';
import { sumarMeses } from './fechas.js';
import { tasaMensual, amortizacion } from './tarjetas.js';

const MAX_MESES = 600;

/** Orden de prioridad: avalancha = mayor tasa primero; bola de nieve = menor saldo primero. */
function ordenar(deudas, estrategia) {
  const copia = [...deudas];
  if (estrategia === 'avalancha') return copia.sort((a, b) => b.tasaEA - a.tasaEA || a.saldo - b.saldo);
  if (estrategia === 'bola_de_nieve') return copia.sort((a, b) => a.saldo - b.saldo || b.tasaEA - a.tasaEA);
  throw new RangeError(`Estrategia desconocida: ${estrategia}`);
}

/**
 * Simula mes a mes: causa intereses, paga mínimos y destina el resto a la deuda prioritaria.
 * Lo que libera una deuda saldada pasa a la siguiente en el mismo mes.
 * @param {Array<{id:string,saldo:number,tasaEA:number,pagoMinimo:number}>} deudas
 * @param {{estrategia:'avalancha'|'bola_de_nieve', presupuesto:number, mesInicio:string}} opciones
 * @returns {{factible:boolean, motivo?:string, meses:number, intereses:number, fechaLibertad:string|null, serie:number[]}}
 */
export function simular(deudas, { estrategia, presupuesto, mesInicio }) {
  const vivas = deudas.filter((d) => aEntero(d.saldo) > 0).map((d) => ({ ...d, saldo: aEntero(d.saldo), i: tasaMensual(d.tasaEA), pagoMinimo: aEntero(d.pagoMinimo) }));
  const serie = [sumar(vivas.map((d) => d.saldo))];
  const tope = aEntero(presupuesto);
  if (!vivas.length) return { factible: true, meses: 0, intereses: 0, fechaLibertad: mesInicio, serie };
  if (tope < sumar(vivas.map((d) => d.pagoMinimo))) {
    return { factible: false, motivo: 'El presupuesto no cubre los pagos mínimos', meses: 0, intereses: 0, fechaLibertad: null, serie };
  }
  let meses = 0;
  let intereses = 0;
  while (vivas.some((d) => d.saldo > 0)) {
    if (meses >= MAX_MESES) {
      return { factible: false, motivo: 'La deuda no se liquida: el presupuesto no alcanza a cubrir los intereses', meses, intereses, fechaLibertad: null, serie };
    }
    let disponible = tope;
    for (const d of vivas) {
      if (d.saldo <= 0) continue;
      const interes = Math.round(d.saldo * d.i);
      intereses += interes;
      d.saldo += interes;
    }
    for (const d of vivas) {
      const pago = Math.min(d.saldo, d.pagoMinimo);
      d.saldo -= pago;
      disponible -= pago;
    }
    for (const d of ordenar(vivas, estrategia)) {
      if (disponible <= 0) break;
      const extra = Math.min(d.saldo, disponible);
      d.saldo -= extra;
      disponible -= extra;
    }
    meses++;
    serie.push(sumar(vivas.map((d) => d.saldo)));
  }
  return { factible: true, meses, intereses, fechaLibertad: sumarMeses(mesInicio, meses), serie };
}

/** Compara ambas estrategias contra pagar solo los mínimos. */
export function compararEstrategias(deudas, presupuesto, mesInicio) {
  const minimos = sumar(deudas.map((d) => d.pagoMinimo));
  const base = simular(deudas, { estrategia: 'avalancha', presupuesto: minimos, mesInicio });
  const resultado = {};
  for (const estrategia of ['avalancha', 'bola_de_nieve']) {
    const r = simular(deudas, { estrategia, presupuesto, mesInicio });
    resultado[estrategia] = { ...r, interesesAhorrados: r.factible && base.factible ? base.intereses - r.intereses : null };
  }
  return { ...resultado, soloMinimos: base };
}

/**
 * Flujo de caja proyectado: cuotas diferidas y recurrentes por mes, sumadas a un ingreso esperado.
 * @returns {Array<{mes:string, ingresos:number, cuotas:number, recurrentes:number, neto:number}>}
 */
export function flujoCaja({ mesInicio, meses = 12, ingresoMensual = 0, recurrentes = [], diferidas = [] }) {
  const totalRecurrentes = sumar(recurrentes.map((r) => r.monto));
  const salida = [];
  for (let k = 0; k < meses; k++) {
    let cuotas = 0;
    for (const c of diferidas) {
      const { tabla } = amortizacion(c.montoOriginal, c.nCuotas, c.tasaEA);
      const fila = tabla[(c.cuotasPagadas || 0) + k];
      if (fila) cuotas += fila.cuota;
    }
    const ingresos = aEntero(ingresoMensual);
    salida.push({ mes: sumarMeses(mesInicio, k), ingresos, cuotas, recurrentes: totalRecurrentes, neto: ingresos - cuotas - totalRecurrentes });
  }
  return salida;
}

/**
 * Comparador pagar tarjeta vs. CDT: qué genera cada opción sobre el mismo monto y plazo.
 * Solo muestra diferencias: la decisión es del usuario. Por defecto aplica retención del 4 % a rendimientos CDT.
 */
export function pagarVsCdt({ monto, tasaTarjetaEA, tasaCdtEA, meses, retencion = 4 }) {
  const capital = aEntero(monto);
  const factor = (ea) => Math.pow(1 + ea / 100, meses / 12) - 1;
  const interesEvitado = Math.round(capital * factor(tasaTarjetaEA));
  const rendimientoBruto = Math.round(capital * factor(tasaCdtEA));
  const rendimientoCdt = rendimientoBruto - Math.round((rendimientoBruto * retencion) / 100);
  return { interesEvitado, rendimientoCdt, diferencia: interesEvitado - rendimientoCdt };
}
