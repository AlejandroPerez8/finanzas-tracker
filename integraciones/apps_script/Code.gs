/**
 * Finanzas Tracker — Ingesta de movimientos (Google Apps Script).
 *
 * Contrato: docs/API_INGESTA.md. Mantener alineado con mock/server.js.
 *
 * Flujo: Gmail (disparador cada 10 min) y SMS (doPost) escriben en una hoja
 * privada; la app consulta con action=pending y confirma con action=ack.
 *
 * Primera vez: ejecutar instalar() una sola vez desde el editor y aceptar permisos.
 */

const VERSION_CONTRATO = 1;
const ETIQUETA_GMAIL = 'FINANZAS_PROCESADO';
const NOMBRE_HOJA = 'Ingesta';
const COLUMNAS = ['rowId', 'source', 'messageId', 'receivedAt', 'senderTag', 'textoRelevante', 'estado', 'ackEn'];
const COL = { rowId: 0, source: 1, messageId: 2, receivedAt: 3, senderTag: 4, texto: 5, estado: 6, ackEn: 7 };
const MAX_TEXTO = 600;
const MAX_LIMIT = 100;
const MAX_PETICIONES_POR_MINUTO = 60;
const ZONA = 'America/Bogota';
// Solo los correos cuyo remitente contenga esto se aceptan, aunque la búsqueda traiga otros.
const REMITENTE_VALIDO = /bancolombia/i;
// Sin "-label:": Gmail agrupa las alertas en un mismo hilo y el mensaje nuevo llegaría
// a un hilo ya etiquetado. La repetición se evita por messageId, no por etiqueta.
const DIAS_CAPTURA = 7;
const CONSULTA_GMAIL_DEFECTO =
  '(from:bancolombia OR from:notificacionesbancolombia OR from:alertasynotificaciones) ' +
  'newer_than:' + DIAS_CAPTURA + 'd';
const DIAS_PURGA_DEFECTO = 30;

/* ---------- Instalación y mantenimiento (se ejecutan desde el editor) ---------- */

/** Crea hoja, token, etiqueta y disparadores. Se puede repetir sin duplicar nada. */
function instalar() {
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('SHEET_ID')) {
    const libro = SpreadsheetApp.create('Finanzas Tracker — Ingesta (privada)');
    const hoja = libro.getSheets()[0];
    hoja.setName(NOMBRE_HOJA);
    hoja.getRange(1, 1, 1, COLUMNAS.length).setValues([COLUMNAS]);
    hoja.setFrozenRows(1);
    props.setProperty('SHEET_ID', libro.getId());
  }
  if (!props.getProperty('TOKEN')) {
    // TOKEN_INICIAL existe solo si se subió Secreto.gs (no versionado).
    const inicial = typeof TOKEN_INICIAL === 'string' ? TOKEN_INICIAL : '';
    props.setProperty('TOKEN', inicial.length >= 32 ? inicial : generarToken_());
  }
  if (!props.getProperty('CONSULTA_GMAIL')) props.setProperty('CONSULTA_GMAIL', CONSULTA_GMAIL_DEFECTO);
  if (!props.getProperty('DIAS_PURGA')) props.setProperty('DIAS_PURGA', String(DIAS_PURGA_DEFECTO));
  GmailApp.getUserLabelByName(ETIQUETA_GMAIL) || GmailApp.createLabel(ETIQUETA_GMAIL);

  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('capturarGmail').timeBased().everyMinutes(10).create();
  ScriptApp.newTrigger('purgarTexto').timeBased().everyDays(1).atHour(3).create();

  capturarGmail();
  Logger.log('Instalación lista. Si necesitas el token, ejecuta verToken().');
}

/** Muestra el token en el registro de ejecución (solo visible para el dueño). */
function verToken() {
  Logger.log(PropertiesService.getScriptProperties().getProperty('TOKEN'));
}

/** Invalida el token actual. Después hay que poner el nuevo en la app y en el celular. */
function rotarToken() {
  PropertiesService.getScriptProperties().setProperty('TOKEN', generarToken_());
  verToken();
}

function generarToken_() {
  let t = '';
  while (t.length < 48) t += Utilities.getUuid().replace(/-/g, '');
  return t.slice(0, 48);
}

/* ---------- Endpoints ---------- */

function doGet(e) {
  return responder_(function () {
    const p = (e && e.parameter) || {};
    exigirToken_(p.token);
    if (p.action === 'ping') return accionPing_();
    if (p.action === 'pending') return accionPending_(p);
    if (p.action === 'ack') return accionAck_(p);
    throw new ErrorApi_('bad_request');
  });
}

function doPost(e) {
  return responder_(function () {
    let cuerpo;
    try {
      cuerpo = JSON.parse(e.postData.contents);
    } catch (err) {
      throw new ErrorApi_('bad_request');
    }
    exigirToken_(cuerpo.token);
    if (cuerpo.source !== 'sms' || typeof cuerpo.text !== 'string' || !cuerpo.text.trim()) {
      throw new ErrorApi_('bad_request');
    }
    const fecha = new Date(cuerpo.receivedAt);
    const recibido = isNaN(fecha.getTime()) ? new Date() : fecha;
    const texto = recortarTexto_(cuerpo.text);
    // El id del SMS se deriva del contenido: un reintento del celular no crea otra fila.
    const messageId = 'sms_' + hash_(texto + '|' + recibido.getTime());
    return { ok: true, rowId: agregarFila_('sms', messageId, recibido, 'bancolombia', texto) };
  });
}

function accionPing_() {
  const filas = leerFilas_();
  const pendientes = filas.filter(function (f) { return f[COL.estado] === 'nuevo'; }).length;
  return { ok: true, version: VERSION_CONTRATO, serverTime: ahoraIso_(), pendientes: pendientes };
}

function accionPending_(p) {
  const limite = Math.min(Math.max(parseInt(p.limit, 10) || 50, 1), MAX_LIMIT);
  const desde = parseInt(p.cursor, 10) || 0;
  const filas = leerFilas_();
  const items = [];
  let cursor = desde;
  for (let i = desde; i < filas.length && items.length < limite; i++) {
    cursor = i + 1;
    const f = filas[i];
    if (f[COL.estado] !== 'nuevo') continue;
    items.push({
      rowId: String(f[COL.rowId]),
      source: String(f[COL.source]),
      messageId: String(f[COL.messageId]),
      receivedAt: aIso_(f[COL.receivedAt]),
      senderTag: String(f[COL.senderTag]),
      textoRelevante: String(f[COL.texto]),
    });
  }
  return { ok: true, version: VERSION_CONTRATO, serverTime: ahoraIso_(), cursor: String(cursor), items: items };
}

function accionAck_(p) {
  const ids = String(p.ids || '').split(',').map(function (s) { return s.trim(); }).filter(String);
  if (!ids.length || ids.length > MAX_LIMIT) throw new ErrorApi_('bad_request');
  const buscados = {};
  ids.forEach(function (id) { buscados[id] = true; });
  return conBloqueo_(function () {
    const hoja = hoja_();
    const filas = leerFilas_();
    let acked = 0;
    filas.forEach(function (f, i) {
      if (!buscados[f[COL.rowId]]) return;
      // Repetir un ack es válido: cuenta como confirmado, pero no reescribe.
      acked++;
      if (f[COL.estado] === 'nuevo') {
        hoja.getRange(i + 2, COL.estado + 1, 1, 2).setValues([['importado', ahoraIso_()]]);
      }
    });
    return { ok: true, acked: acked };
  });
}

/* ---------- Captura de Gmail ---------- */

/** Disparador: copia a la hoja los correos nuevos del banco y los etiqueta. */
function capturarGmail() {
  const props = PropertiesService.getScriptProperties();
  const etiqueta = GmailApp.getUserLabelByName(ETIQUETA_GMAIL) || GmailApp.createLabel(ETIQUETA_GMAIL);
  const consulta = props.getProperty('CONSULTA_GMAIL') || CONSULTA_GMAIL_DEFECTO;
  const limite = Date.now() - DIAS_CAPTURA * 86400000;
  const conocidos = {};
  leerFilas_().forEach(function (f) { conocidos[f[COL.messageId]] = true; });
  GmailApp.search(consulta, 0, 50).forEach(function (hilo) {
    hilo.getMessages().forEach(function (m) {
      if (conocidos[m.getId()] || m.getDate().getTime() < limite) return;
      if (!REMITENTE_VALIDO.test(m.getFrom())) return;
      const texto = extraerTexto_(m);
      if (texto) agregarFila_('gmail', m.getId(), m.getDate(), 'bancolombia', texto);
    });
    hilo.addLabel(etiqueta);
  });
}

function extraerTexto_(mensaje) {
  const plano = mensaje.getPlainBody() || htmlATexto_(mensaje.getBody());
  const inicio = plano.search(/Bancolombia\s*(:|le informa)/i);
  // Sin el prefijo del banco es publicidad o seguridad, no un movimiento.
  return inicio < 0 ? '' : recortarTexto_(plano.slice(inicio));
}

function htmlATexto_(html) {
  return String(html || '')
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

/** Quita enlaces, compacta espacios, enmascara números largos y limita el largo. */
function recortarTexto_(texto) {
  return String(texto)
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_TEXTO)
    .replace(/(?<![\d$.,]|COP\s|\$\s)\d{4,}(\d{4})(?!\d)/gi, '*$1');
}

/** Purga diaria: borra el texto de filas ya importadas con más de N días. */
function purgarTexto() {
  const dias = parseInt(PropertiesService.getScriptProperties().getProperty('DIAS_PURGA'), 10) || DIAS_PURGA_DEFECTO;
  const limite = Date.now() - dias * 86400000;
  conBloqueo_(function () {
    const hoja = hoja_();
    leerFilas_().forEach(function (f, i) {
      const antigua = new Date(f[COL.receivedAt]).getTime() < limite;
      if (antigua && f[COL.estado] === 'importado' && f[COL.texto]) {
        hoja.getRange(i + 2, COL.texto + 1).setValue('');
      }
    });
  });
}

/* ---------- Hoja ---------- */

function hoja_() {
  const id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  if (!id) throw new ErrorApi_('internal');
  return SpreadsheetApp.openById(id).getSheetByName(NOMBRE_HOJA);
}

function leerFilas_() {
  const hoja = hoja_();
  const n = hoja.getLastRow() - 1;
  return n > 0 ? hoja.getRange(2, 1, n, COLUMNAS.length).getValues() : [];
}

/** Agrega la fila si su messageId no existe; devuelve el rowId (nuevo o existente). */
function agregarFila_(fuente, messageId, fecha, senderTag, texto) {
  return conBloqueo_(function () {
    const hoja = hoja_();
    const filas = leerFilas_();
    for (let i = filas.length - 1; i >= 0; i--) {
      if (filas[i][COL.messageId] === messageId) return String(filas[i][COL.rowId]);
    }
    const rowId = 'r_' + ('000000' + (filas.length + 1)).slice(-6);
    // El apóstrofo inicial evita que la hoja interprete el texto como fórmula.
    hoja.appendRow([rowId, fuente, messageId, aIso_(fecha), senderTag, "'" + texto, 'nuevo', '']);
    return rowId;
  });
}

/* ---------- Utilidades ---------- */

function ErrorApi_(codigo) {
  this.codigo = codigo;
}

function responder_(accion) {
  let salida;
  try {
    limitarPeticiones_();
    salida = accion();
  } catch (err) {
    const conocido = err instanceof ErrorApi_;
    if (!conocido) console.error(err && err.stack ? err.stack : String(err));
    salida = { ok: false, error: conocido ? err.codigo : 'internal' };
  }
  return ContentService.createTextOutput(JSON.stringify(salida)).setMimeType(ContentService.MimeType.JSON);
}

function exigirToken_(token) {
  const real = PropertiesService.getScriptProperties().getProperty('TOKEN') || '';
  const dado = String(token || '');
  let dif = real.length === dado.length && real.length >= 32 ? 0 : 1;
  for (let i = 0; i < Math.min(real.length, dado.length); i++) dif |= real.charCodeAt(i) ^ dado.charCodeAt(i);
  if (dif !== 0) throw new ErrorApi_('unauthorized');
}

function limitarPeticiones_() {
  const cache = CacheService.getScriptCache();
  const clave = 'rl_' + Math.floor(Date.now() / 60000);
  const n = (parseInt(cache.get(clave), 10) || 0) + 1;
  cache.put(clave, String(n), 120);
  if (n > MAX_PETICIONES_POR_MINUTO) throw new ErrorApi_('rate_limited');
}

function conBloqueo_(fn) {
  const bloqueo = LockService.getScriptLock();
  bloqueo.waitLock(20000);
  try {
    return fn();
  } finally {
    bloqueo.releaseLock();
  }
}

function hash_(texto) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, texto)
    .slice(0, 12)
    .map(function (b) { return ('0' + (b & 255).toString(16)).slice(-2); })
    .join('');
}

function aIso_(fecha) {
  return Utilities.formatDate(new Date(fecha), ZONA, "yyyy-MM-dd'T'HH:mm:ssXXX");
}

function ahoraIso_() {
  return aIso_(new Date());
}
