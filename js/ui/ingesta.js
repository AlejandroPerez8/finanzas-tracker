/** Pantallas de ingesta: pendientes, conciliación, no reconocidos, pegado manual y ajustes. */

import { h, montar, monto, campo, entradaMonto, selector, vacio, encabezado, seguro } from './dom.js';
import { aEntero, formatear } from '../domain/money.js';
import { diaBogota, isoBogota } from '../domain/fechas.js';
import { CATEGORIAS_GASTO, CATEGORIAS_INGRESO } from '../domain/categorias.js';
import { procesarMensaje, confirmar, descartar, dividir, proponerRegla, purgarTextos, hashTexto } from '../services/ingesta.js';
import { paresPorConciliar, vincular, mantenerSeparados } from '../services/conciliacion.js';
import { crearCliente, sincronizar, urlValida } from '../services/sync.js';
import { registrar } from '../services/registro.js';
import { crearRegistro } from '../parsers/registry.js';

const TIPOS_PARSER = [
  ['compra_debito', 'Compra con débito'], ['compra_credito', 'Compra con tarjeta de crédito'], ['pago_servicio', 'Pago de servicio'],
  ['transferencia_enviada', 'Transferencia enviada'], ['transferencia_recibida', 'Transferencia recibida'], ['nomina', 'Nómina'],
  ['consignacion', 'Consignación'], ['retiro_cajero', 'Retiro en cajero'], ['pago_tarjeta', 'Pago de tarjeta'], ['cuota_manejo', 'Cuota de manejo'],
  ['intereses', 'Intereses'], ['comision', 'Comisión'], ['rechazo', 'Transacción rechazada'],
];

/** Separa un pegado en mensajes: por líneas en blanco o por cada "Bancolombia:". */
export function separarMensajes(texto) {
  return String(texto)
    .split(/\n\s*\n|(?=Bancolombia\s*:)/i)
    .map((t) => t.trim())
    .filter((t) => t.length > 5);
}

export function crearIngestaUI(ctx, recursos) {
  let registro = null;
  let sincronizando = false;
  let reloj = null;
  let subtab = 'pendientes';
  let ultimoResultado = '';

  const avisar = ctx.toast;
  const accion = (fn) => seguro(fn, avisar);

  const reconstruirRegistro = () => {
    registro = crearRegistro(recursos.patrones, ctx.datos().reglasParser, (e) => registrar(ctx.datos().log, 'error', e));
  };
  const contexto = () => ({ registro, diccionario: recursos.comercios, nuevoId: () => ctx.uid('m'), ahora: () => isoBogota() });
  const conf = () => ctx.datos().settings.ingesta;

  const pendientes = () => ctx.datos().transactions.filter((t) => t.estado === 'pendiente_revision');
  const noReconocidos = () => ctx.datos().ingesta.filter((i) => i.estado === 'no_reconocido');
  const contarPendientes = () => pendientes().length + noReconocidos().length;

  /** Sincroniza si está configurado. Nunca lanza: el fallo queda visible y en el registro. */
  async function sincronizarAhora({ manual = false } = {}) {
    const datos = ctx.datos();
    const c = conf();
    if (sincronizando || !c.activa || !c.url || !c.token) {
      if (manual && !sincronizando) avisar('Configura la conexión en Más > Ingesta');
      return;
    }
    sincronizando = true;
    try {
      const cliente = crearCliente({ url: c.url, token: c.token });
      const r = await sincronizar({ cliente, datos, guardar: ctx.guardar, contexto: contexto(), enLinea: () => navigator.onLine !== false });
      if (r.estado === 'offline') {
        ultimoResultado = 'Sin conexión; se reintentará al volver.';
        if (manual) avisar(ultimoResultado);
        return;
      }
      const dias = c.diasTexto ?? 30;
      purgarTextos(datos, dias);
      ultimoResultado = r.nuevos ? `${r.nuevos} nuevo(s): ${r.confirmados} confirmados, ${r.pendientes} por revisar, ${r.noReconocidos} sin reconocer.` : 'Sin mensajes nuevos.';
      if (r.invalidos) registrar(datos.log, 'error', `${r.invalidos} mensaje(s) inválidos rechazados`);
      registrar(datos.log, 'info', `Sincronización: ${ultimoResultado}`);
      if (r.nuevos || manual) avisar(ultimoResultado);
      await ctx.guardar();
      ctx.renderAll();
    } catch (err) {
      ultimoResultado = err.message;
      registrar(datos.log, 'error', `Sincronización: ${err.codigo ?? ''} ${err.message}`);
      if (manual) avisar(err.message);
      renderAjustes();
    } finally {
      sincronizando = false;
    }
  }

  function programar() {
    clearInterval(reloj);
    const min = Number(conf().intervaloMin) || 0;
    if (min > 0) reloj = setInterval(() => sincronizarAhora(), min * 60000);
  }

  /* ---------- Vista principal con subpestañas ---------- */
  function render() {
    const total = pendientes().length;
    const pares = paresPorConciliar(ctx.datos().transactions).length;
    const nr = noReconocidos().length;
    const pestanas = [['pendientes', `Pendientes (${total})`], ['conciliacion', `Conciliar (${pares})`], ['noreconocidos', `No reconocidos (${nr})`], ['importar', 'Importar']];
    const lista = h('div', { class: 'subtabs', role: 'tablist' }, pestanas.map(([id, t]) => h('button', { class: 'subtab', role: 'tab', 'aria-selected': String(subtab === id), onclick: () => { subtab = id; render(); } }, t)));
    const vistas = { pendientes: vistaPendientes, conciliacion: vistaConciliacion, noreconocidos: vistaNoReconocidos, importar: vistaImportar };
    montar('vistaIngesta',
      encabezado('Por revisar', conf().activa ? 'ingesta activa' : 'ingesta apagada'),
      h('div', { class: 'card' },
        h('button', { class: 'btn-ghost ancho', onclick: () => sincronizarAhora({ manual: true }), disabled: !conf().activa }, 'Sincronizar ahora'),
        lista,
        vistas[subtab]()));
  }

  function vistaPendientes() {
    const lista = pendientes().sort((a, b) => b.date.localeCompare(a.date));
    if (!lista.length) return vacio('Nada por revisar', 'Los movimientos nuevos que necesiten tu visto bueno aparecerán aquí.');
    return h('div', {}, lista.map(filaPendiente));
  }

  function filaPendiente(t) {
    const datos = ctx.datos();
    const esIngreso = t.type === 'income';
    const categorias = esIngreso ? CATEGORIAS_INGRESO : CATEGORIAS_GASTO;
    const categoria = h('input', { type: 'text', value: t.category ?? '', list: esIngreso ? 'incomeCategoryList' : 'expenseCategoryList', placeholder: categorias[0] });
    const medioValor = t.tarjetaId ? `tarjeta:${t.tarjetaId}` : (t.accountId ?? '');
    const medio = selector([['', 'Sin asociar'], ...datos.accounts.map((a) => [a.id, a.name]), ...datos.tarjetas.map((c) => [`tarjeta:${c.id}`, `Tarjeta ${c.alias}`])], medioValor);
    const clase = selector([['expense', 'Gasto'], ['income', 'Ingreso'], ['transferencia', 'Transferencia a cuenta propia'], ['pago_tarjeta', 'Pago de tarjeta'], ['cuota_manejo', 'Cuota de manejo'], ['interes', 'Intereses'], ['avance', 'Avance']], t.type);
    const destino = selector([['', 'Sin cuenta de destino'], ...datos.accounts.map((a) => [a.id, a.name])], t.cuentaDestinoId ?? '');
    const tarjetaPago = selector([['', 'Elige la tarjeta'], ...datos.tarjetas.map((c) => [c.id, c.alias])], t.tarjetaId ?? '');
    const zonaDividir = h('div', { class: 'formulario', hidden: true });

    const confirmarMov = accion(async () => {
      const cambios = { category: categoria.value.trim() || t.category, type: clase.value };
      const valorMedio = medio.value;
      if (['pago_tarjeta', 'avance'].includes(clase.value)) {
        if (!tarjetaPago.value) throw new Error('Elige la tarjeta');
        cambios.tarjetaId = tarjetaPago.value;
        cambios.accountId = valorMedio.startsWith('tarjeta:') ? null : valorMedio || null;
      } else if (valorMedio.startsWith('tarjeta:')) {
        cambios.tarjetaId = valorMedio.slice(8);
        cambios.accountId = null;
      } else {
        cambios.tarjetaId = null;
        cambios.accountId = valorMedio || null;
      }
      if (clase.value === 'transferencia') cambios.cuentaDestinoId = destino.value || null;
      confirmar(datos, t.id, cambios, contexto());
      await ctx.guardar();
      ctx.renderAll();
    });
    const descartarMov = (nota) => accion(async () => {
      if (nota) t.note = nota;
      descartar(datos, t.id);
      await ctx.guardar();
      ctx.renderAll();
    });
    const abrirDividir = () => {
      zonaDividir.hidden = !zonaDividir.hidden;
      if (zonaDividir.hidden) return;
      const parte = entradaMonto({ placeholder: 'Monto de la segunda parte' });
      const cat2 = h('input', { type: 'text', list: 'expenseCategoryList', placeholder: 'Categoría de la segunda parte' });
      montar(zonaDividir, parte, cat2, h('button', {
        class: 'btn-ghost',
        onclick: accion(async () => {
          const b = aEntero(parte.value);
          dividir(datos, t.id, [{ amount: t.amount - b, category: categoria.value.trim() || t.category }, { amount: b, category: cat2.value.trim() || 'Otros' }], () => ctx.uid('m'));
          await ctx.guardar();
          ctx.renderAll();
        }),
      }, 'Dividir'));
    };
    return h('article', { class: 'fila-pendiente' },
      h('div', { class: 'fp-monto' }, monto(t.amount), h('span', { class: 'chip' }, t.origen === 'gmail' ? 'correo' : t.origen === 'sms' ? 'SMS' : 'pegado')),
      h('div', { class: 'fp-detalle' }, `${t.comercio || 'Sin comercio'} · ${t.date}${t.hora ? ` ${t.hora}` : ''}`),
      t.conciliarCon ? h('div', { class: 'chip chip-aviso' }, 'Puede estar ya registrado a mano: revisa Conciliar.') : null,
      h('div', { class: 'formulario' },
        campo('Tipo', clase), campo('Categoría', categoria), campo('Cuenta o tarjeta', medio),
        clase.value === 'transferencia' ? campo('Cuenta de destino', destino) : null,
        ['pago_tarjeta', 'avance'].includes(clase.value) ? campo('Tarjeta', tarjetaPago) : null),
      zonaDividir,
      h('div', { class: 'fp-acciones' },
        h('button', { class: 'btn-accent', onclick: confirmarMov }, 'Confirmar'),
        h('button', { class: 'btn-ghost', onclick: abrirDividir }, 'Dividir'),
        h('button', { class: 'btn-ghost', onclick: descartarMov('No es mío') }, 'No es mío'),
        h('button', { class: 'btn-ghost', onclick: descartarMov() }, 'Descartar')));
  }

  function vistaConciliacion() {
    const pares = paresPorConciliar(ctx.datos().transactions);
    if (!pares.length) return vacio('Sin coincidencias', 'Si un mensaje coincide con algo que registraste a mano, podrás unirlos aquí.');
    return h('div', {}, pares.map(({ ingerido, manual }) => h('article', { class: 'fila-pendiente' },
      h('div', { class: 'fp-monto' }, monto(ingerido.amount)),
      h('div', { class: 'fp-detalle' }, `Mensaje: ${ingerido.comercio || 'sin comercio'}, ${ingerido.date}`),
      h('div', { class: 'fp-detalle' }, `A mano: ${manual.category || 'sin categoría'}, ${manual.date}${manual.note ? `, ${manual.note}` : ''}`),
      h('div', { class: 'fp-acciones' },
        h('button', { class: 'btn-accent', onclick: accion(async () => { vincular(ctx.datos(), ingerido.id); await ctx.guardar(); ctx.renderAll(); }) }, 'Es el mismo'),
        h('button', { class: 'btn-ghost', onclick: accion(async () => { mantenerSeparados(ctx.datos(), ingerido.id); await ctx.guardar(); ctx.renderAll(); }) }, 'Son distintos')))));
  }

  function vistaNoReconocidos() {
    const lista = noReconocidos();
    if (!lista.length) return vacio('Todo reconocido', 'Si el banco cambia el formato de un mensaje, lo verás aquí para enseñárselo a la app.');
    return h('div', {}, lista.map((item) => {
      const tipo = selector(TIPOS_PARSER, 'compra_debito');
      const ensenar = accion(async () => {
        const datos = ctx.datos();
        datos.reglasParser.push(proponerRegla(item.textoRelevante, tipo.value));
        reconstruirRegistro();
        const texto = item.textoRelevante;
        item.estado = 'error';
        const { resultado } = procesarMensaje(datos, { rowId: item.rowId, fuente: item.fuente, recibidoEn: item.recibidoEn, textoRelevante: texto }, contexto());
        avisar(resultado === 'no_reconocido' ? 'La regla no bastó para este mensaje' : 'Regla aprendida');
        await ctx.guardar();
        ctx.renderAll();
      });
      const ignorar = accion(async () => {
        item.estado = 'importado';
        delete item.textoRelevante;
        await ctx.guardar();
        ctx.renderAll();
      });
      return h('article', { class: 'fila-pendiente' },
        h('p', { class: 'fp-detalle' }, item.textoRelevante ?? '(texto ya borrado)'),
        campo('¿Qué tipo de movimiento es?', tipo),
        h('div', { class: 'fp-acciones' },
          h('button', { class: 'btn-accent', onclick: ensenar, disabled: !item.textoRelevante }, 'Enseñar a la app'),
          h('button', { class: 'btn-ghost', onclick: ignorar }, 'Ignorar')));
    }));
  }

  function vistaImportar() {
    const caja = h('textarea', { rows: 5, 'aria-label': 'Mensajes del banco', placeholder: 'Pega uno o varios SMS o correos de Bancolombia' });
    const importar = accion(async () => {
      const mensajes = separarMensajes(caja.value);
      if (!mensajes.length) throw new Error('Pega al menos un mensaje');
      const conteo = { confirmado: 0, pendiente: 0, no_reconocido: 0, duplicado: 0, repetido: 0, descartado: 0, publicidad: 0 };
      const recibidoEn = isoBogota();
      for (const texto of mensajes) {
        const { resultado } = procesarMensaje(ctx.datos(), { rowId: `manual_${hashTexto(texto)}`, fuente: 'manual', recibidoEn, textoRelevante: texto }, contexto());
        conteo[resultado]++;
      }
      await ctx.guardar();
      caja.value = '';
      avisar(`${mensajes.length} mensaje(s): ${conteo.confirmado} confirmados, ${conteo.pendiente} por revisar, ${conteo.no_reconocido} sin reconocer, ${conteo.repetido + conteo.duplicado} ya existían.`);
      ctx.renderAll();
    });
    return h('div', { class: 'formulario' }, caja, h('button', { class: 'btn-accent', onclick: importar }, 'Importar mensajes'),
      h('p', { class: 'nota' }, 'Funciona sin conexión. Es el respaldo si el banco cambia algo o la sincronización falla.'));
  }

  /* ---------- Ajustes ---------- */
  function renderAjustes() {
    const contenedor = document.getElementById('vistaAjustesIngesta');
    if (!contenedor) return;
    const c = conf();
    const url = h('input', { type: 'url', value: c.url, placeholder: 'https://script.google.com/macros/s/…/exec', autocomplete: 'off', spellcheck: 'false' });
    const token = h('input', { type: 'password', value: '', placeholder: c.token ? `Guardado (termina en ${c.token.slice(-4)})` : 'Token de al menos 32 caracteres', autocomplete: 'off' });
    const intervalo = selector([['0', 'Solo al abrir la app'], ['5', 'Cada 5 minutos'], ['15', 'Cada 15 minutos'], ['30', 'Cada 30 minutos']], String(c.intervaloMin ?? 0));
    const auto = h('input', { type: 'checkbox', checked: c.autoConfirmar !== false });
    const umbral = selector([['0.9', 'Alta (90 %)'], ['0.95', 'Muy alta (95 %)'], ['0.8', 'Media (80 %)']], String(c.umbralAutoConfirmar ?? 0.9));
    const conservar = h('input', { type: 'checkbox', checked: !!c.conservarTexto });
    const dias = h('input', { type: 'number', min: '1', max: '365', inputmode: 'numeric', value: String(c.diasTexto ?? 30) });
    const estado = h('p', { class: 'nota', role: 'status' }, resumenEstado());

    const leer = () => {
      const u = url.value.trim();
      if (u && !urlValida(u)) throw new Error('La URL debe empezar por https://script.google.com/');
      const t = token.value.trim();
      if (t && t.length < 32) throw new Error('El token debe tener al menos 32 caracteres');
      Object.assign(c, { url: u, autoConfirmar: auto.checked, umbralAutoConfirmar: Number(umbral.value), conservarTexto: conservar.checked, intervaloMin: Number(intervalo.value), diasTexto: Math.max(1, aEntero(dias.value) || 30) });
      if (t) c.token = t;
    };
    const guardarYActivar = accion(async () => {
      leer();
      if (!c.url || !c.token) throw new Error('Falta la URL o el token');
      const r = await crearCliente({ url: c.url, token: c.token, reintentos: 1 }).probar();
      c.activa = true;
      await ctx.guardar();
      programar();
      avisar(`Conectado. ${r.pendientes ?? 0} mensaje(s) en espera.`);
      await sincronizarAhora();
      ctx.renderAll();
    });
    const soloGuardar = accion(async () => { leer(); await ctx.guardar(); programar(); avisar('Ajustes guardados'); ctx.renderAll(); });
    const borrar = accion(async () => {
      if (!await ctx.preguntar('¿Borrar el token y apagar la ingesta? Tus movimientos se conservan.')) return;
      Object.assign(c, { token: '', activa: false });
      await ctx.guardar();
      programar();
      ctx.renderAll();
    });
    montar(contenedor,
      h('div', { class: 'formulario' },
        estado,
        campo('URL del script', url), campo('Token', token), campo('Frecuencia con la app abierta', intervalo),
        h('label', { class: 'campo-check' }, auto, 'Confirmar solo lo que tenga confianza alta'),
        campo('Nivel de confianza', umbral),
        h('label', { class: 'campo-check' }, conservar, 'Guardar el texto de los mensajes'),
        campo('Borrar textos después de (días)', dias),
        h('button', { class: 'btn-accent', onclick: guardarYActivar }, 'Probar conexión y activar'),
        h('div', { class: 'btn-row' },
          h('button', { class: 'btn-ghost', onclick: soloGuardar }, 'Guardar'),
          h('button', { class: 'btn-ghost', onclick: borrar }, 'Borrar token'))));
  }

  function resumenEstado() {
    const c = conf();
    const s = ctx.datos().settings.sync;
    if (!c.activa) return 'Apagada. Tus datos no salen ni entran del dispositivo.';
    const ultima = s?.ultima ? `${s.ultima.slice(0, 10)} ${s.ultima.slice(11, 16)}` : 'nunca';
    return `Activa. Última sincronización: ${ultima}. Por revisar: ${contarPendientes()}. ${ultimoResultado}`;
  }

  /* ---------- Arranque ---------- */
  function iniciar() {
    reconstruirRegistro();
    programar();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') sincronizarAhora();
    });
    window.addEventListener('online', () => sincronizarAhora());
    sincronizarAhora();
  }

  return { render, renderAjustes, iniciar, contarPendientes, resumenEstado, ultimoResultado: () => ultimoResultado, hoy: diaBogota, formatear };
}
