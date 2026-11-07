# Brief 03: revisión cruzada de lógica crítica
Objetivo: encontrar BUGS REALES en estos módulos de una app de finanzas personal (COP en enteros, zona Bogotá). No reescribas código. No crees ni edites archivos ni ejecutes comandos.
Salida: lista de hallazgos, máximo 12, ordenada por severidad. Cada uno: archivo y función, entrada concreta que falla, resultado obtenido vs esperado. Si no estás seguro, márcalo [DUDOSO]. No incluyas estilo ni sugerencias generales.
Contexto clave: mismo movimiento por SMS y correo se fusiona; dos mensajes de la misma fuente son compras distintas. El ack al servidor solo se envía tras guardar. Compra con tarjeta = gasto + deuda; pago de tarjeta no es gasto.

## js/domain/money.js
```js
/**
 * Dinero en COP como enteros (pesos sin decimales). Nunca usar float para acumular:
 * todo redondeo ocurre aquí, una vez por operación.
 */

/** Convierte un número o texto numérico a entero de pesos (mitad hacia arriba). No numérico → 0. */
export function aEntero(valor) {
  const n = typeof valor === 'number' ? valor : Number(valor);
  if (!Number.isFinite(n)) return 0;
  // El signo se trata aparte: Math.round(-2.5) daría -2 y rompería la simetría.
  return n < 0 ? -Math.round(-n) || 0 : Math.round(n);
}

/** Suma una lista de montos y devuelve un entero. */
export function sumar(montos) {
  return montos.reduce((total, m) => total + aEntero(m), 0);
}

/**
 * Formato colombiano: `$1.234.567`, negativos `-$1.234`.
 * Manual para no depender de los datos de locale del navegador.
 */
export function formatear(valor) {
  const n = aEntero(valor);
  const digitos = String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${n < 0 ? '-' : ''}$${digitos}`;
}

/**
 * Reparte un total en partes enteras proporcionales a `pesos`; la suma da exactamente el total.
 * Método del mayor residuo.
 * @param {number} total
 * @param {number[]} pesos
 * @returns {number[]}
 */
export function prorratear(total, pesos) {
  const entero = aEntero(total);
  const sumaPesos = pesos.reduce((s, p) => s + p, 0);
  if (!pesos.length) return [];
  if (sumaPesos <= 0) throw new RangeError('Los pesos del prorrateo deben sumar más de cero');
  const exactos = pesos.map((p) => (entero * p) / sumaPesos);
  const partes = exactos.map((x) => Math.floor(x));
  let faltante = entero - partes.reduce((s, x) => s + x, 0);
  const orden = exactos.map((x, i) => ({ i, r: x - Math.floor(x) })).sort((a, b) => b.r - a.r || a.i - b.i);
  for (let k = 0; faltante > 0; k = (k + 1) % orden.length, faltante--) partes[orden[k].i] += 1;
  return partes;
}

/**
 * Interpreta un monto escrito por un banco. Acepta `$1,550,555.00`, `$1.234.567`, `1.234.567,89`,
 * `COP 19000`, `$116,500`. Regla: con dos separadores distintos, el último es el decimal; con uno
 * solo, es decimal únicamente si lo siguen 1 o 2 dígitos una sola vez.
 * @param {string} texto
 * @returns {number|null} entero de pesos, o null si no es un monto
 */
export function interpretarMonto(texto) {
  if (texto == null) return null;
  const limpio = String(texto)
    .replace(/cop|\$|\s/gi, '')
    .replace(/[^\d.,]/g, '');
  if (!/\d/.test(limpio)) return null;
  const ultimoPunto = limpio.lastIndexOf('.');
  const ultimaComa = limpio.lastIndexOf(',');
  let parteEntera = limpio;
  let parteDecimal = '';
  if (ultimoPunto >= 0 && ultimaComa >= 0) {
    const corte = Math.max(ultimoPunto, ultimaComa);
    parteEntera = limpio.slice(0, corte);
    parteDecimal = limpio.slice(corte + 1);
  } else if (ultimoPunto >= 0 || ultimaComa >= 0) {
    const sep = ultimoPunto >= 0 ? '.' : ',';
    const trozos = limpio.split(sep);
    const cola = trozos[trozos.length - 1];
    if (trozos.length === 2 && cola.length > 0 && cola.length <= 2) {
      parteEntera = trozos[0];
      parteDecimal = cola;
    }
  }
  const entero = Number(parteEntera.replace(/[.,]/g, '') || '0');
  const decimal = parteDecimal ? Number(`0.${parteDecimal.replace(/\D/g, '') || '0'}`) : 0;
  return Math.round(entero + decimal);
}
```

## js/domain/tarjetas.js
```js
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
```

## js/domain/deudas.js
```js
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
```

## js/services/deduplicacion.js
```js
/**
 * Deduplicación de movimientos ingeridos.
 *
 * La misma compra puede llegar por SMS y por correo, pero dos compras iguales de una misma
 * fuente son compras distintas. Por eso solo se fusionan mensajes de fuentes diferentes.
 */

import { instanteBogota } from '../domain/fechas.js';
import { normalizarComercio } from '../domain/categorias.js';

const VENTANA_MS = 10 * 60 * 1000;

/** Huella estable para consultas y exportes; la decisión real la toma `esMismoMovimiento`. */
export function huella(m) {
  if (m.referenciaBanco) return `ref|${m.referenciaBanco}`;
  return [m.type, m.amount, m.ultimos4 ?? '', normalizarComercio(m.comercio), m.date].join('|');
}

/** Distancia de edición, para tolerar comercios escritos distinto en SMS y correo. */
function distancia(a, b) {
  let previa = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const actual = [i];
    for (let j = 1; j <= b.length; j++) {
      actual[j] = Math.min(previa[j] + 1, actual[j - 1] + 1, previa[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    previa = actual;
  }
  return previa[b.length];
}

/** Comercios equivalentes: vacío en alguno, contención, o al menos 80 % de similitud. */
export function comerciosParecidos(a, b) {
  const x = normalizarComercio(a);
  const y = normalizarComercio(b);
  if (!x || !y || x === y || x.includes(y) || y.includes(x)) return true;
  return 1 - distancia(x, y) / Math.max(x.length, y.length) >= 0.8;
}

/** ¿Son el mismo movimiento bancario? Ver reglas al inicio del archivo. */
export function esMismoMovimiento(a, b) {
  if (a.referenciaBanco && b.referenciaBanco) return a.referenciaBanco === b.referenciaBanco;
  if (a.type !== b.type || a.amount !== b.amount) return false;
  if (a.ultimos4 && b.ultimos4 && a.ultimos4 !== b.ultimos4) return false;
  const ta = instanteBogota(a.date, a.hora);
  const tb = instanteBogota(b.date, b.hora);
  // Sin hora en alguno de los dos, basta con el mismo día.
  const cerca = a.hora && b.hora ? Math.abs(ta - tb) <= VENTANA_MS : a.date === b.date;
  return cerca && comerciosParecidos(a.comercio, b.comercio);
}

/**
 * Busca el movimiento existente con el que fusionar el nuevo.
 * Se descartan los que ya tienen un mensaje de esa fuente.
 * @param {object} nuevo candidato
 * @param {string} fuente 'sms' | 'gmail'
 * @param {object[]} existentes
 * @returns {object|null}
 */
export function buscarDuplicado(nuevo, fuente, existentes) {
  for (const t of existentes) {
    if (!t.fuentes?.length || t.origen === 'manual') continue;
    if (t.fuentes.some((f) => f.fuente === fuente)) continue;
    if (esMismoMovimiento(nuevo, t)) return t;
  }
  return null;
}
```

## js/services/ingesta.js
```js
/**
 * Canal de ingesta: mensaje → parser → movimiento → deduplicación → categoría → estado.
 * Muta el objeto `datos` en memoria; el llamador guarda antes de confirmar al servidor.
 */

import { aEntero } from '../domain/money.js';
import { categorizar } from './categorizacion.js';
import { buscarDuplicado } from './deduplicacion.js';
import { buscarCandidatoManual } from './conciliacion.js';

/** tipo del parser → cómo se registra. */
const MAPA_TIPOS = {
  compra_debito: { type: 'expense' },
  compra_credito: { type: 'expense', tarjeta: true },
  compra_diferida: { type: 'expense', tarjeta: true },
  pago_qr: { type: 'expense' },
  pago_servicio: { type: 'expense' },
  recarga: { type: 'expense' },
  transferencia_enviada: { type: 'expense', siempreRevisar: true },
  retiro_cajero: { type: 'transferencia', efectivo: true },
  nomina: { type: 'income' },
  consignacion: { type: 'income' },
  transferencia_recibida: { type: 'income', siempreRevisar: true },
  pago_tarjeta: { type: 'pago_tarjeta', tarjeta: true },
  avance: { type: 'avance', tarjeta: true },
  cuota_manejo: { type: 'cuota_manejo', tarjetaOpcional: true },
  intereses: { type: 'interes', tarjetaOpcional: true },
  comision: { type: 'expense' },
  cuatro_por_mil: { type: 'expense' },
  iva: { type: 'expense' },
  rechazo: { type: 'expense', descartar: true },
};

/** Hash no criptográfico (cyrb53): identifica textos ya vistos sin conservarlos. */
export function hashTexto(texto) {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < texto.length; i++) {
    const c = texto.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/** Resuelve cuenta y tarjeta por últimos 4; con una sola cuenta y sin coincidencia, usa esa. */
function asociar(parseado, regla, datos) {
  const { ultimos4 } = parseado;
  const tarjetas = (datos.tarjetas || []).filter((t) => t.estado !== 'cerrada');
  const tarjeta = ultimos4 ? tarjetas.find((t) => t.ultimos4 === ultimos4) : null;
  const usaTarjeta = regla.tarjeta || (regla.tarjetaOpcional && tarjeta);
  let accountId = null;
  const cuentasBanco = datos.accounts;
  if (!usaTarjeta || regla.type === 'pago_tarjeta' || regla.type === 'avance') {
    const porUltimos = ultimos4 ? cuentasBanco.find((a) => a.ultimos4 === ultimos4) : null;
    accountId = porUltimos?.id ?? (cuentasBanco.length === 1 ? cuentasBanco[0].id : null);
  }
  return { tarjetaId: usaTarjeta ? (tarjeta?.id ?? null) : null, accountId };
}

/** Construye el movimiento en estado inicial a partir de la salida del parser. */
export function aMovimiento(parseado, item, datos, contexto) {
  const regla = MAPA_TIPOS[parseado.tipo] ?? { type: 'expense' };
  const { categoria } = categorizar(parseado.comercio, parseado.tipo, datos.reglas, contexto.diccionario);
  const { tarjetaId, accountId } = asociar(parseado, regla, datos);
  const efectivo = regla.efectivo ? datos.accounts.find((a) => a.tipo === 'efectivo') : null;
  const fuente = { fuente: item.fuente, rowId: item.rowId, patronId: parseado.patronId };
  return {
    id: contexto.nuevoId(),
    date: parseado.fecha,
    hora: parseado.hora,
    amount: aEntero(parseado.monto),
    type: regla.type,
    category: regla.type === 'transferencia' || regla.type === 'pago_tarjeta' ? '' : categoria,
    accountId,
    tarjetaId,
    cuentaDestinoId: efectivo?.id ?? null,
    comercio: parseado.comercio ?? '',
    note: '',
    method: tarjetaId ? 'Crédito' : '',
    origen: item.fuente === 'sms' || item.fuente === 'gmail' ? item.fuente : 'importacion',
    estado: 'pendiente_revision',
    ultimos4: parseado.ultimos4,
    referenciaBanco: parseado.referencia,
    fuentes: [fuente],
    esCuota: parseado.cuotas != null && parseado.cuotas > 1,
    cuotaInfo: parseado.cuotas ? { nCuotas: parseado.cuotas } : null,
    confianza: parseado.confianza,
  };
}

/** Decide el estado final según confianza, ajustes y datos faltantes. */
function decidirEstado(mov, parseado, ajustes, regla) {
  if (regla.descartar) return 'descartado';
  if (regla.siempreRevisar) return 'pendiente_revision';
  const asociado = regla.tarjeta ? mov.tarjetaId : mov.accountId || mov.tarjetaId;
  const umbral = ajustes?.umbralAutoConfirmar ?? 0.9;
  const auto = ajustes?.autoConfirmar !== false;
  return auto && asociado && parseado.confianza >= umbral ? 'confirmado' : 'pendiente_revision';
}

/**
 * Procesa un mensaje. Es idempotente por `rowId`: reprocesar no duplica.
 * @param {object} datos estado de la app (se muta)
 * @param {{rowId:string,fuente:string,recibidoEn:string,textoRelevante:string}} entrada
 * @param {{registro:object,diccionario:object,nuevoId:()=>string}} contexto
 * @returns {{resultado:'repetido'|'no_reconocido'|'duplicado'|'descartado'|'pendiente'|'confirmado', movimientoId?:string}}
 */
export function procesarMensaje(datos, entrada, contexto) {
  const yaVisto = datos.ingesta.find((i) => i.rowId === entrada.rowId);
  if (yaVisto && yaVisto.estado !== 'error') return { resultado: 'repetido', movimientoId: yaVisto.movimientoId };

  const conservar = !!datos.settings.ingesta?.conservarTexto;
  const item = {
    rowId: entrada.rowId,
    fuente: entrada.fuente,
    recibidoEn: entrada.recibidoEn,
    hashTexto: hashTexto(entrada.textoRelevante),
    estado: 'nuevo',
    movimientoId: null,
    error: null,
  };
  if (yaVisto) datos.ingesta.splice(datos.ingesta.indexOf(yaVisto), 1);
  datos.ingesta.push(item);

  const parseado = contexto.registro.analizar(entrada.textoRelevante, { fuente: entrada.fuente, recibidoEn: entrada.recibidoEn });
  if (!parseado) {
    item.estado = 'no_reconocido';
    // Se conserva aunque el ajuste esté apagado: sin el texto no se le puede enseñar a la app.
    item.textoRelevante = entrada.textoRelevante;
    return { resultado: 'no_reconocido' };
  }

  const mov = aMovimiento(parseado, item, datos, contexto);
  item.estado = 'importado';
  if (conservar) item.textoRelevante = entrada.textoRelevante;

  const regla = MAPA_TIPOS[parseado.tipo] ?? {};
  const existente = buscarDuplicado(mov, item.fuente, datos.transactions);
  if (existente) {
    existente.fuentes.push(mov.fuentes[0]);
    item.movimientoId = existente.id;
    return { resultado: 'duplicado', movimientoId: existente.id };
  }

  mov.estado = decidirEstado(mov, parseado, datos.settings.ingesta, regla);
  const candidato = mov.estado === 'descartado' ? null : buscarCandidatoManual(mov, datos.transactions);
  if (candidato) {
    // Un posible registro manual previo siempre pasa por revisión para no contar doble.
    mov.estado = 'pendiente_revision';
    mov.conciliarCon = candidato.id;
  }
  datos.transactions.push(mov);
  if (parseado.tipo === 'compra_diferida' && mov.tarjetaId && mov.estado === 'confirmado') {
    registrarDiferida(datos, mov, contexto.nuevoId);
  }
  item.movimientoId = mov.id;
  const resultado = mov.estado === 'descartado' ? 'descartado' : mov.estado === 'confirmado' ? 'confirmado' : 'pendiente';
  return { resultado, movimientoId: mov.id };
}

/** Crea el plan de cuotas de una compra diferida, usando la tasa de la tarjeta. */
export function registrarDiferida(datos, mov, nuevoId) {
  if (datos.comprasDiferidas.some((c) => c.movimientoId === mov.id)) return;
  const tarjeta = datos.tarjetas.find((t) => t.id === mov.tarjetaId);
  if (!tarjeta || !mov.cuotaInfo?.nCuotas) return;
  datos.comprasDiferidas.push({
    id: nuevoId(),
    tarjetaId: tarjeta.id,
    movimientoId: mov.id,
    montoOriginal: mov.amount,
    nCuotas: mov.cuotaInfo.nCuotas,
    cuotasPagadas: 0,
    tasaEA: tarjeta.tasaEA,
    mesInicio: mov.date.slice(0, 7),
  });
}

/** Pasa un movimiento pendiente a confirmado y aprende su categoría si el usuario la cambió. */
export function confirmar(datos, id, cambios = {}, contexto = {}) {
  const mov = datos.transactions.find((t) => t.id === id);
  if (!mov) throw new Error('El movimiento ya no existe');
  Object.assign(mov, cambios, { estado: 'confirmado' });
  delete mov.conciliarCon;
  if (mov.type === 'expense' && mov.esCuota && mov.tarjetaId && contexto.nuevoId) registrarDiferida(datos, mov, contexto.nuevoId);
  return mov;
}

/** Descarta: el movimiento queda registrado para que el mensaje no reaparezca, sin afectar saldos. */
export function descartar(datos, id) {
  const mov = datos.transactions.find((t) => t.id === id);
  if (!mov) throw new Error('El movimiento ya no existe');
  mov.estado = 'descartado';
  delete mov.conciliarCon;
  return mov;
}

/**
 * Divide un pendiente en partes. La suma debe coincidir con el total original.
 * @param {Array<{amount:number,category:string}>} partes
 */
export function dividir(datos, id, partes, nuevoId) {
  const mov = datos.transactions.find((t) => t.id === id);
  if (!mov) throw new Error('El movimiento ya no existe');
  const suma = partes.reduce((s, p) => s + aEntero(p.amount), 0);
  if (partes.length < 2 || partes.some((p) => aEntero(p.amount) <= 0)) throw new Error('Cada parte debe tener un monto positivo');
  if (suma !== mov.amount) throw new Error('Las partes deben sumar el total del movimiento');
  const nuevos = partes.slice(1).map((p) => ({ ...mov, id: nuevoId(), amount: aEntero(p.amount), category: p.category, divididoDe: mov.id }));
  mov.amount = aEntero(partes[0].amount);
  mov.category = partes[0].category;
  datos.transactions.push(...nuevos);
  return [mov, ...nuevos];
}

/** Regla nueva desde un texto no reconocido: escapa el texto y convierte el monto y la fecha en grupos. */
export function proponerRegla(texto, tipo) {
  const escapar = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  const base = texto.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
  const montoRe = /\$\s?[\d.,]*\d|\b\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{2})?\b/;
  const fechaRe = /\b\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\b/;
  const horaRe = /\b\d{1,2}:\d{2}(?::\d{2})?\b/;
  const ultimosRe = /\*{1,2}\d{4}\b/;
  const fin = base.search(fechaRe);
  const util = fin >= 0 ? base.slice(0, fin + base.slice(fin).match(fechaRe)[0].length + 20) : base;
  let regex = escapar(util);
  const reemplazar = (re, grupo) => {
    const m = re.exec(util);
    if (m) regex = regex.replace(escapar(m[0]), grupo);
  };
  reemplazar(montoRe, '\\$?\\s*(?<monto>[\\d.,]*\\d)');
  reemplazar(ultimosRe, '\\*{1,2}(?<ultimos4>\\d{4})');
  reemplazar(fechaRe, '(?<fecha>\\d{1,2}[/-]\\d{1,2}(?:[/-]\\d{2,4})?)');
  reemplazar(horaRe, '(?<hora>\\d{1,2}:\\d{2}(?::\\d{2})?)');
  return { id: `usuario_${hashTexto(base)}`, tipo, confianza: 0.9, verificado: false, origen: 'usuario', regex: regex.replace(/^Bancolombia: ?/i, '') };
}

/** Borra textos de mensajes no reconocidos con más de N días. */
export function purgarTextos(datos, dias, ahora = Date.now()) {
  let borrados = 0;
  for (const item of datos.ingesta) {
    if (item.textoRelevante && ahora - Date.parse(item.recibidoEn) > dias * 86400000) {
      delete item.textoRelevante;
      borrados++;
    }
  }
  return borrados;
}
```

## js/services/sync.js
```js
/**
 * Cliente del endpoint de ingesta (docs/API_INGESTA.md) y sincronización.
 * Garantía: el `ack` y el cursor solo avanzan después de guardar localmente.
 */

import { procesarMensaje } from './ingesta.js';

const FUENTES = new Set(['gmail', 'sms']);
const RE_ROWID = /^[\w-]{1,64}$/;
const MAX_TEXTO = 2000;

export class ErrorSync extends Error {
  /** @param {string} codigo @param {boolean} reintentable */
  constructor(codigo, reintentable, mensaje) {
    super(mensaje ?? codigo);
    this.name = 'ErrorSync';
    this.codigo = codigo;
    this.reintentable = reintentable;
  }
}

/** Valida la URL del script: solo HTTPS en dominios de Google, salvo localhost para desarrollo. */
export function urlValida(url) {
  try {
    const u = new URL(url);
    if (u.protocol === 'https:' && u.hostname === 'script.google.com') return true;
    return u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1');
  } catch {
    return false;
  }
}

/** Valida un elemento recibido y devuelve solo los campos conocidos; inválido → null. */
export function validarItem(item) {
  if (!item || typeof item !== 'object') return null;
  const { rowId, source, receivedAt, textoRelevante, messageId, senderTag } = item;
  if (typeof rowId !== 'string' || !RE_ROWID.test(rowId)) return null;
  if (!FUENTES.has(source)) return null;
  if (typeof textoRelevante !== 'string' || !textoRelevante.trim() || textoRelevante.length > MAX_TEXTO) return null;
  if (typeof receivedAt !== 'string' || Number.isNaN(Date.parse(receivedAt))) return null;
  return { rowId, source, receivedAt, textoRelevante, messageId: String(messageId ?? ''), senderTag: String(senderTag ?? '') };
}

/**
 * @param {{url:string, token:string, fetch?:Function, timeoutMs?:number, reintentos?:number, esperar?:(ms:number)=>Promise<void>}} opciones
 */
export function crearCliente({ url, token, fetch: hacerFetch = (...a) => fetch(...a), timeoutMs = 20000, reintentos = 3, esperar = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  if (!urlValida(url)) throw new ErrorSync('url_invalida', false, 'La URL debe ser de script.google.com con HTTPS');
  if (!token || token.length < 32) throw new ErrorSync('token_invalido', false, 'El token debe tener al menos 32 caracteres');

  async function unaVez(params) {
    const q = new URLSearchParams({ ...params, token });
    const ctl = new AbortController();
    const reloj = setTimeout(() => ctl.abort(), timeoutMs);
    let res;
    try {
      res = await hacerFetch(`${url}?${q}`, { redirect: 'follow', signal: ctl.signal });
    } catch (err) {
      throw new ErrorSync(err.name === 'AbortError' ? 'timeout' : 'red', true, 'No se pudo conectar con el script');
    } finally {
      clearTimeout(reloj);
    }
    if (res.status === 429 || res.status >= 500) throw new ErrorSync('servidor', true, `El servidor respondió ${res.status}`);
    const cuerpo = await res.text();
    let json;
    try {
      json = JSON.parse(cuerpo);
    } catch {
      // Apps Script responde HTML cuando pide iniciar sesión o el despliegue cambió.
      throw new ErrorSync('respuesta_html', false, 'El script respondió una página, no datos. Revisa que el despliegue sea "Cualquier usuario".');
    }
    if (!json || typeof json !== 'object') throw new ErrorSync('respuesta_invalida', false, 'Respuesta no válida');
    if (json.ok !== true) {
      const codigo = String(json.error ?? 'desconocido');
      throw new ErrorSync(codigo, codigo === 'internal' || codigo === 'rate_limited', mensajeError(codigo));
    }
    return json;
  }

  async function llamar(params) {
    let ultimo;
    for (let intento = 0; intento <= reintentos; intento++) {
      try {
        return await unaVez(params);
      } catch (err) {
        ultimo = err;
        if (!err.reintentable || intento === reintentos) break;
        await esperar(1000 * 2 ** intento);
      }
    }
    throw ultimo;
  }

  return {
    probar: () => llamar({ action: 'ping' }),
    async pendientes(cursor, limit = 50) {
      const json = await llamar({ action: 'pending', cursor: cursor ?? '', limit: String(limit) });
      if (!Array.isArray(json.items)) throw new ErrorSync('respuesta_invalida', false, 'La lista de mensajes no es válida');
      return { cursor: typeof json.cursor === 'string' ? json.cursor : cursor, items: json.items };
    },
    ack: (ids) => llamar({ action: 'ack', ids: ids.join(',') }),
  };
}

function mensajeError(codigo) {
  return (
    { unauthorized: 'Token incorrecto o rotado', rate_limited: 'Demasiadas consultas; se reintentará', bad_request: 'Petición rechazada', internal: 'Error interno del script' }[codigo] ?? `Error del script: ${codigo}`
  );
}

/**
 * Trae mensajes, los procesa y confirma lo guardado. Repite hasta vaciar.
 * @param {{cliente:object, datos:object, guardar:()=>Promise<void>, contexto:object, enLinea?:()=>boolean, limite?:number, maxLotes?:number}} p
 * @returns {Promise<{estado:'ok'|'offline', nuevos:number, confirmados:number, pendientes:number, noReconocidos:number, invalidos:number, duplicados:number}>}
 */
export async function sincronizar({ cliente, datos, guardar, contexto, enLinea = () => true, limite = 50, maxLotes = 20 }) {
  const resumen = { estado: 'ok', nuevos: 0, confirmados: 0, pendientes: 0, noReconocidos: 0, invalidos: 0, duplicados: 0 };
  if (!enLinea()) return { ...resumen, estado: 'offline' };

  const estado = (datos.settings.sync ??= { cursor: null, ackPendientes: [], ultima: null });
  // Confirmaciones que fallaron en una sincronización anterior; ya están guardadas.
  await vaciarAcks(cliente, estado, guardar);

  for (let lote = 0; lote < maxLotes; lote++) {
    const { items, cursor } = await cliente.pendientes(estado.cursor, limite);
    if (!items.length) {
      estado.cursor = cursor ?? estado.cursor;
      break;
    }
    const porConfirmar = [];
    for (const crudo of items) {
      const v = validarItem(crudo);
      if (!v) {
        resumen.invalidos++;
        continue;
      }
      const { resultado } = procesarMensaje(datos, { rowId: v.rowId, fuente: v.source, recibidoEn: v.receivedAt, textoRelevante: v.textoRelevante }, contexto);
      porConfirmar.push(v.rowId);
      if (resultado === 'repetido') continue;
      resumen.nuevos++;
      if (resultado === 'confirmado') resumen.confirmados++;
      else if (resultado === 'pendiente') resumen.pendientes++;
      else if (resultado === 'no_reconocido') resumen.noReconocidos++;
      else if (resultado === 'duplicado') resumen.duplicados++;
    }
    estado.cursor = cursor;
    estado.ackPendientes = [...new Set([...estado.ackPendientes, ...porConfirmar])];
    // Punto clave: si guardar falla, se lanza el error y nunca se envía el ack.
    await guardar();
    await vaciarAcks(cliente, estado, guardar);
    if (items.length < limite) break;
  }
  estado.ultima = contexto.ahora ? contexto.ahora() : new Date().toISOString();
  await guardar();
  return resumen;
}

async function vaciarAcks(cliente, estado, guardar) {
  while (estado.ackPendientes.length) {
    const lote = estado.ackPendientes.slice(0, 50);
    await cliente.ack(lote);
    estado.ackPendientes = estado.ackPendientes.slice(lote.length);
    await guardar();
  }
}
```

## js/services/migraciones.js
```js
/**
 * Migraciones versionadas del esquema. Son puras, ordenadas e idempotentes.
 * Sin `schemaVersion`, el dato viene de la v4 de la app (versión 1 del esquema).
 */

import { aEntero } from '../domain/money.js';

export const VERSION_ACTUAL = 2;

/** Mapea el tipo libre de cuenta al vocabulario nuevo sin borrar el original. */
const TIPO_CUENTA = { Ahorros: 'ahorros', Corriente: 'corriente', Efectivo: 'efectivo', Digital: 'billetera' };

const migraciones = {
  /** v1 → v2: montos enteros, campos de ingesta, tarjetas, deudas y presupuestos. */
  1(d) {
    d.accounts = (d.accounts ?? []).map((a) => ({ ...a, startBalance: aEntero(a.startBalance), tipo: a.tipo ?? TIPO_CUENTA[a.type] ?? 'ahorros', alias: a.alias ?? a.name, ultimos4: a.ultimos4 ?? null }));
    d.pockets = (d.pockets ?? []).map((p) => {
      const { balance, ...resto } = p;
      return { ...resto, startBalance: aEntero(p.startBalance ?? balance) };
    });
    d.transactions = (d.transactions ?? []).map((t) => ({
      ...t,
      amount: aEntero(t.amount),
      origen: t.origen ?? 'manual',
      estado: t.estado ?? 'confirmado',
      fuentes: t.fuentes ?? [],
      comercio: t.comercio ?? '',
      tarjetaId: t.tarjetaId ?? null,
      esCuota: t.esCuota ?? false,
    }));
    d.goals = (d.goals ?? []).map((g) => ({ ...g, target: aEntero(g.target), contributions: (g.contributions ?? []).map((c) => ({ ...c, amount: aEntero(c.amount) })) }));
    d.investments = (d.investments ?? []).map((i) => ({ ...i, amount: aEntero(i.amount) }));
    d.reports ??= [];
    d.settings ??= { reminderOn: false, reminderHour: 20, lastNotified: null, lastReportMonth: null };
    d.tarjetas ??= [];
    d.ciclos ??= [];
    d.comprasDiferidas ??= [];
    d.deudas ??= [];
    d.ingesta ??= [];
    d.reglas ??= [];
    d.reglasParser ??= [];
    d.presupuestos ??= [];
    d.log ??= [];
    d.settings.ingesta ??= { activa: false, url: '', token: '', intervaloMin: 0, autoConfirmar: true, umbralAutoConfirmar: 0.9, conservarTexto: false, diasTexto: 30 };
    d.settings.sync ??= { cursor: null, ackPendientes: [], ultima: null };
    return d;
  },
};

/**
 * Aplica las migraciones pendientes sobre una copia; el original no se toca.
 * @param {object} original
 * @returns {{datos:object, desde:number, hasta:number, migro:boolean}}
 * @throws si algún paso falla o la versión es más nueva que la app
 */
export function migrar(original) {
  const desde = original.schemaVersion ?? 1;
  if (desde > VERSION_ACTUAL) throw new Error(`Los datos son de una versión más nueva (${desde}). Actualiza la app.`);
  let datos = structuredClone(original);
  for (let v = desde; v < VERSION_ACTUAL; v++) {
    datos = migraciones[v](datos);
    datos.schemaVersion = v + 1;
  }
  datos.schemaVersion = VERSION_ACTUAL;
  return { datos, desde, hasta: VERSION_ACTUAL, migro: desde !== VERSION_ACTUAL };
}
```
