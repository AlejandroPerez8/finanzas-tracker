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
 * @returns {{resultado:'repetido'|'publicidad'|'no_reconocido'|'duplicado'|'descartado'|'pendiente'|'confirmado', movimientoId?:string}}
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

  if (contexto.registro.esPublicidad?.(entrada.textoRelevante)) {
    item.estado = 'publicidad';
    return { resultado: 'publicidad' };
  }

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
