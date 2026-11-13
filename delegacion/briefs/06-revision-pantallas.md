# Brief 06: revisión de pantallas
Busca BUGS REALES en estos dos módulos de interfaz de una PWA de finanzas (JavaScript sin frameworks). No crees ni edites archivos ni ejecutes comandos. Responde solo con texto, de inmediato, sin usar herramientas.
Salida: máximo 8 hallazgos por severidad. Cada uno: función, pasos concretos que lo provocan, resultado obtenido vs esperado. Marca [DUDOSO] lo incierto. Sin estilo ni sugerencias generales.

## js/ui/ingesta.js
```js
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
      h('div', { class: 'fp-monto' }, monto(t.amount), h('span', { class: 'chip' }, t.origen === 'gmail' ? 'correo' : 'pegado')),
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
    const caja = h('textarea', { rows: 5, 'aria-label': 'Mensajes del banco', placeholder: 'Pega una o varias alertas de Bancolombia' });
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
```

## js/ui/tarjetas.js
```js
/** Pantalla de tarjetas, deudas, simulador, flujo de caja y comparador con CDT. */

import { h, montar, monto, campo, entradaMonto, selector, vacio, encabezado, seguro, graficoLineas } from './dom.js';
import { aEntero, formatear } from '../domain/money.js';
import { diaBogota } from '../domain/fechas.js';
import { saldoTarjeta, cupoDisponible, utilizacion, proximasFechas, alertasTarjeta, estadoDiferida, pagoMinimoEstimado, costoPagoMinimo, amortizacion, tasaMensual, actualizarCiclos } from '../domain/tarjetas.js';
import { compararEstrategias, flujoCaja, pagarVsCdt } from '../domain/deudas.js';
import { detectarRecurrentes } from '../domain/presupuesto.js';
import { estadisticasMes, saldoCuenta } from '../domain/movimientos.js';
import { sumarMeses } from '../domain/fechas.js';

const COLORES = { avalancha: '#C6F135', bola_de_nieve: '#38BDF8' };

export function crearTarjetasUI(ctx) {
  const accion = (fn) => seguro(fn, ctx.toast);
  let formularioAbierto = false;
  let presupuestoSim = '';

  const nuevaTarjeta = () => {
    const alias = h('input', { type: 'text', placeholder: 'Visa Bancolombia' });
    const ultimos4 = h('input', { type: 'text', inputmode: 'numeric', maxlength: '4', pattern: '\\d{4}', placeholder: '1234', autocomplete: 'off' });
    const franquicia = selector([['Visa', 'Visa'], ['Mastercard', 'Mastercard'], ['Amex', 'American Express'], ['Otra', 'Otra']], 'Visa');
    const cupo = entradaMonto({ placeholder: '5000000' });
    const saldo = entradaMonto({ placeholder: '0' });
    const corte = h('input', { type: 'number', inputmode: 'numeric', min: '1', max: '31', placeholder: '15' });
    const limite = h('input', { type: 'number', inputmode: 'numeric', min: '1', max: '31', placeholder: '30' });
    const tasa = h('input', { type: 'number', inputmode: 'decimal', min: '0', step: '0.01', placeholder: '26.82' });
    const manejo = entradaMonto({ placeholder: '0' });
    const guardar = accion(async () => {
      const d = { alias: alias.value.trim(), ultimos4: ultimos4.value.trim(), diaCorte: Number(corte.value), diaLimitePago: Number(limite.value), tasaEA: Number(tasa.value), cupoTotal: aEntero(cupo.value) };
      if (!d.alias) throw new Error('Escribe un alias');
      if (!/^\d{4}$/.test(d.ultimos4)) throw new Error('Escribe solo los últimos 4 dígitos');
      if (!(d.diaCorte >= 1 && d.diaCorte <= 31 && d.diaLimitePago >= 1 && d.diaLimitePago <= 31)) throw new Error('Los días deben estar entre 1 y 31');
      if (!(d.cupoTotal > 0)) throw new Error('Escribe el cupo total');
      if (!(tasa.value !== '' && d.tasaEA >= 0)) throw new Error('Escribe la tasa efectiva anual');
      ctx.datos().tarjetas.push({ ...d, id: ctx.uid('c'), banco: 'Bancolombia', franquicia: franquicia.value, saldoInicial: aEntero(saldo.value), cuotaManejo: aEntero(manejo.value), estado: 'activa' });
      formularioAbierto = false;
      await ctx.guardar();
      ctx.toast('Tarjeta guardada');
      ctx.renderAll();
    });
    return h('div', { class: 'formulario' },
      campo('Alias', alias), campo('Últimos 4 dígitos', ultimos4), campo('Franquicia', franquicia), campo('Cupo total', cupo), campo('Deuda actual', saldo),
      campo('Día de corte', corte), campo('Día límite de pago', limite), campo('Tasa efectiva anual (%)', tasa), campo('Cuota de manejo mensual', manejo),
      h('p', { class: 'nota' }, 'Nunca escribas el número completo, el CVV ni claves. La app no los necesita.'),
      h('button', { class: 'btn-accent', onclick: guardar }, 'Guardar tarjeta'));
  };

  function formPago(t, saldo) {
    const datos = ctx.datos();
    if (!datos.accounts.length) return h('p', { class: 'nota' }, 'Crea una cuenta en Ahorro para registrar pagos.');
    const cuenta = selector(datos.accounts.map((a) => [a.id, a.name]), datos.accounts[0].id);
    const valor = entradaMonto({ placeholder: 'Monto', 'aria-label': 'Monto del pago' });
    const minimo = pagoMinimoEstimado(saldo, t.tasaEA);
    const registrar = accion(async () => {
      const amount = aEntero(valor.value);
      if (amount <= 0) throw new Error('Escribe el monto del pago');
      const c = datos.accounts.find((a) => a.id === cuenta.value);
      const disponible = saldoCuenta(c, datos.transactions);
      if (amount > disponible && !await ctx.preguntar(`La cuenta tiene ${formatear(disponible)}, menos que el pago. ¿Continuar?`)) return;
      datos.transactions.push({ id: ctx.uid('t'), date: diaBogota(), type: 'pago_tarjeta', amount, accountId: c.id, tarjetaId: t.id, category: '', note: '', origen: 'manual', estado: 'confirmado', fuentes: [] });
      datos.ciclos = actualizarCiclos(datos.ciclos, datos.transactions, t.id);
      await ctx.guardar();
      ctx.toast('Pago registrado. No cuenta como gasto.');
      ctx.renderAll();
    });
    return h('div', { class: 'formulario' },
      campo('Desde', cuenta), valor,
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn-ghost', onclick: () => { valor.value = minimo; } }, `Mínimo ${formatear(minimo)}`),
        h('button', { class: 'btn-ghost', onclick: () => { valor.value = Math.max(0, saldo); } }, 'Total')),
      h('button', { class: 'btn-accent', onclick: registrar }, 'Registrar pago'));
  }

  function formExtracto(t) {
    const fechaCorte = h('input', { type: 'date', value: proximasFechas(t).corte });
    const limite = h('input', { type: 'date', value: proximasFechas(t).limitePago });
    const total = entradaMonto({ placeholder: 'Pago total' });
    const minimo = entradaMonto({ placeholder: 'Pago mínimo' });
    const interes = entradaMonto({ placeholder: 'Intereses cobrados' });
    const guardar = accion(async () => {
      const datos = ctx.datos();
      datos.ciclos.push({ id: ctx.uid('ci'), tarjetaId: t.id, fechaCorte: fechaCorte.value, fechaLimitePago: limite.value, saldoAlCorte: aEntero(total.value), pagoMinimo: aEntero(minimo.value), pagoTotal: aEntero(total.value), pagado: false, interesesCausados: aEntero(interes.value) });
      if (aEntero(interes.value) > 0) {
        datos.transactions.push({ id: ctx.uid('t'), date: fechaCorte.value, type: 'interes', amount: aEntero(interes.value), tarjetaId: t.id, accountId: null, category: 'Deudas', note: 'Intereses del extracto', origen: 'manual', estado: 'confirmado', fuentes: [] });
      }
      await ctx.guardar();
      ctx.toast('Extracto guardado');
      ctx.renderAll();
    });
    return h('details', { class: 'detalle' }, h('summary', {}, 'Registrar extracto'),
      h('div', { class: 'formulario' }, campo('Fecha de corte', fechaCorte), campo('Fecha límite', limite), campo('Pago total', total), campo('Pago mínimo', minimo), campo('Intereses', interes),
        h('button', { class: 'btn-ghost', onclick: guardar }, 'Guardar extracto')));
  }

  function tarjetaVisual(t) {
    const datos = ctx.datos();
    const saldo = saldoTarjeta(t, datos.transactions);
    const uso = utilizacion(t, saldo);
    const fechas = proximasFechas(t);
    const ciclo = datos.ciclos.filter((c) => c.tarjetaId === t.id).at(-1) ?? null;
    const alertas = alertasTarjeta(t, saldo, { cicloActual: ciclo });
    const costo = saldo > 0 ? costoPagoMinimo(saldo, t.tasaEA) : null;
    const diferidas = datos.comprasDiferidas.filter((c) => c.tarjetaId === t.id && estadoDiferida(c).restantes > 0);
    const etiquetaUso = { verde: 'uso sano', ambar: 'uso medio', rojo: 'uso alto' }[uso.color];
    return h('article', { class: 'tarjeta-visual' },
      h('div', { class: 'tv-alias' }, t.alias),
      h('div', { class: 'tv-numero' }, `•••• ${t.ultimos4}`),
      h('div', { class: 'tv-cifras' },
        h('div', {}, h('small', {}, 'Usado'), monto(saldo)),
        h('div', {}, h('small', {}, 'Disponible'), monto(cupoDisponible(t, saldo))),
        h('div', {}, h('small', {}, 'Cupo'), monto(t.cupoTotal))),
      h('div', { class: 'barra-uso', role: 'progressbar', 'aria-valuenow': String(Math.min(100, uso.porcentaje)), 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-label': `Utilización del cupo: ${uso.porcentaje} %, ${etiquetaUso}` },
        h('div', { class: `barra-uso-relleno ${uso.color}`, style: `width:${Math.min(100, uso.porcentaje)}%` })),
      h('p', { class: 'nota' }, `${uso.porcentaje} % de uso (${etiquetaUso}). Corte ${fechas.corte}. Pagar antes del ${fechas.limitePago}.`),
      alertas.map((a) => h('div', { class: `chip ${a.nivel === 'urgente' ? 'chip-urgente' : 'chip-aviso'}` }, a.mensaje)),
      costo ? h('p', { class: 'nota' }, costo.liquidable
        ? `Pagando solo el mínimo: ${costo.meses} meses y ${formatear(costo.intereses)} en intereses, a ${(tasaMensual(t.tasaEA) * 100).toFixed(2)} % mensual.`
        : 'Con el pago mínimo estimado, esta deuda no se terminaría de pagar.') : null,
      diferidas.length ? h('div', {}, h('h3', {}, 'Compras a cuotas'), diferidas.map(filaDiferida)) : null,
      h('details', { class: 'detalle' }, h('summary', {}, 'Registrar pago'), formPago(t, saldo)),
      formExtracto(t),
      h('button', { class: 'btn-ghost peligro', onclick: accion(async () => {
        if (!await ctx.preguntar(`¿Cerrar ${t.alias}? Deja de sumar al pasivo; su historial se conserva.`)) return;
        t.estado = 'cerrada';
        await ctx.guardar();
        ctx.renderAll();
      }) }, 'Cerrar tarjeta'));
  }

  function filaDiferida(c) {
    const e = estadoDiferida(c);
    const mov = ctx.datos().transactions.find((t) => t.id === c.movimientoId);
    const { valorCuota, totalIntereses } = amortizacion(c.montoOriginal, c.nCuotas, c.tasaEA);
    return h('div', { class: 'fila-simple' },
      h('div', {}, h('b', {}, mov?.comercio || 'Compra'), h('div', { class: 'nota' }, `Cuota ${formatear(valorCuota)}, faltan ${e.restantes} de ${c.nCuotas}. Saldo ${formatear(e.saldoPendiente)}. Intereses totales ${formatear(totalIntereses)}.`)),
      h('button', { class: 'btn-ghost', onclick: accion(async () => { c.cuotasPagadas = (c.cuotasPagadas || 0) + 1; await ctx.guardar(); ctx.renderAll(); }) }, '+1 cuota'));
  }

  /* ---------- Otras deudas ---------- */
  function vistaDeudas() {
    const datos = ctx.datos();
    const nombre = h('input', { type: 'text', placeholder: 'Préstamo de libranza' });
    const tipo = selector([['prestamo', 'Préstamo'], ['libranza', 'Libranza'], ['consumo', 'Consumo'], ['informal', 'Informal']], 'prestamo');
    const saldo = entradaMonto({ placeholder: 'Saldo' });
    const tasa = h('input', { type: 'number', inputmode: 'decimal', min: '0', step: '0.01', placeholder: 'Tasa EA %' });
    const pago = entradaMonto({ placeholder: 'Pago mensual mínimo' });
    const agregar = accion(async () => {
      if (!nombre.value.trim() || aEntero(saldo.value) <= 0 || tasa.value === '') throw new Error('Completa nombre, saldo y tasa');
      datos.deudas.push({ id: ctx.uid('de'), nombre: nombre.value.trim(), tipo: tipo.value, saldo: aEntero(saldo.value), tasaEA: Number(tasa.value), pagoMinimo: aEntero(pago.value) });
      await ctx.guardar();
      ctx.renderAll();
    });
    return h('div', {}, encabezado('Otras deudas', 'pasivo'),
      h('div', { class: 'card' },
        datos.deudas.length ? datos.deudas.map((d) => h('div', { class: 'fila-simple' },
          h('div', {}, h('b', {}, d.nombre), h('div', { class: 'nota' }, `${d.tipo}, ${d.tasaEA} % EA, mínimo ${formatear(d.pagoMinimo)}`)),
          monto(d.saldo),
          h('button', { class: 'btn-ghost', 'aria-label': `Eliminar ${d.nombre}`, onclick: accion(async () => {
            if (!await ctx.preguntar(`¿Eliminar la deuda ${d.nombre}?`)) return;
            datos.deudas = datos.deudas.filter((x) => x.id !== d.id);
            await ctx.guardar();
            ctx.renderAll();
          }) }, '✕'))) : vacio('Sin otras deudas', 'Agrega préstamos o libranzas para verlos en tu pasivo.'),
        h('details', { class: 'detalle' }, h('summary', {}, 'Agregar deuda'),
          h('div', { class: 'formulario' }, campo('Nombre', nombre), campo('Tipo', tipo), campo('Saldo', saldo), campo('Tasa efectiva anual (%)', tasa), campo('Pago mínimo', pago),
            h('button', { class: 'btn-accent', onclick: agregar }, 'Guardar deuda')))));
  }

  /** Reúne tarjetas y deudas en el formato del simulador. */
  function deudasParaSimular() {
    const datos = ctx.datos();
    const tarjetas = datos.tarjetas.filter((t) => t.estado !== 'cerrada').map((t) => {
      const saldo = saldoTarjeta(t, datos.transactions);
      return { id: t.id, nombre: t.alias, saldo: Math.max(0, saldo), tasaEA: t.tasaEA, pagoMinimo: pagoMinimoEstimado(saldo, t.tasaEA) };
    });
    return [...tarjetas, ...datos.deudas.map((d) => ({ id: d.id, nombre: d.nombre, saldo: d.saldo, tasaEA: d.tasaEA, pagoMinimo: d.pagoMinimo || 0 }))].filter((d) => d.saldo > 0);
  }

  function vistaSimulador() {
    const deudas = deudasParaSimular();
    if (!deudas.length) return null;
    const mes = diaBogota().slice(0, 7);
    const minimos = deudas.reduce((s, d) => s + d.pagoMinimo, 0);
    const entrada = entradaMonto({ placeholder: `Mínimos: ${formatear(minimos)}`, value: presupuestoSim });
    const resultado = h('div', {});
    const calcular = () => {
      presupuestoSim = entrada.value;
      const valor = aEntero(entrada.value) || minimos;
      const r = compararEstrategias(deudas, valor, mes);
      if (!r.avalancha.factible) {
        montar(resultado, h('div', { class: 'chip chip-aviso' }, r.avalancha.motivo));
        return;
      }
      const fila = (nombre, x) => h('tr', {}, h('th', { scope: 'row' }, nombre), h('td', {}, x.fechaLibertad), h('td', {}, String(x.meses)), h('td', { class: 'monto' }, formatear(x.intereses)), h('td', { class: 'monto' }, x.interesesAhorrados == null ? 'n/d' : formatear(x.interesesAhorrados)));
      montar(resultado,
        graficoLineas([
          { nombre: 'Avalancha', valores: r.avalancha.serie, color: COLORES.avalancha },
          { nombre: 'Bola de nieve', valores: r.bola_de_nieve.serie, color: COLORES.bola_de_nieve, punteada: true },
        ], `Deuda total, ${r.avalancha.meses} meses`),
        h('div', { class: 'tabla-scroll' }, h('table', { class: 'tabla' },
          h('thead', {}, h('tr', {}, ['Estrategia', 'Libre en', 'Meses', 'Intereses', 'Ahorro vs. mínimos'].map((t) => h('th', { scope: 'col' }, t)))),
          h('tbody', {}, fila('Avalancha', r.avalancha), fila('Bola de nieve', r.bola_de_nieve)))),
        r.soloMinimos.factible ? null : h('p', { class: 'nota' }, 'Pagando solo los mínimos, la deuda no se liquidaría.'));
    };
    const vista = h('div', {}, encabezado('Simulador de deuda', 'estrategias'),
      h('div', { class: 'card' }, h('div', { class: 'formulario' }, campo('Presupuesto mensual para deudas', entrada), h('button', { class: 'btn-accent', onclick: calcular }, 'Simular')), resultado));
    calcular();
    return vista;
  }

  function vistaFlujo() {
    const datos = ctx.datos();
    const hoy = diaBogota().slice(0, 7);
    const ingresos = [1, 2, 3].map((k) => estadisticasMes(datos.transactions, sumarMeses(hoy, -k)).income);
    const conDatos = ingresos.filter((x) => x > 0);
    const ingresoMensual = conDatos.length ? Math.round(conDatos.reduce((a, b) => a + b, 0) / conDatos.length) : 0;
    const recurrentes = detectarRecurrentes(datos.transactions, hoy);
    if (!ingresoMensual && !recurrentes.length && !datos.comprasDiferidas.length) return null;
    const filas = flujoCaja({ mesInicio: hoy, meses: 6, ingresoMensual, recurrentes, diferidas: datos.comprasDiferidas });
    return h('div', {}, encabezado('Flujo de caja', '6 meses'),
      h('div', { class: 'card' },
        h('p', { class: 'nota' }, 'Ingreso: promedio de los últimos 3 meses con datos. No incluye gastos variables.'),
        h('div', { class: 'tabla-scroll' }, h('table', { class: 'tabla' },
          h('thead', {}, h('tr', {}, ['Mes', 'Ingresos', 'Cuotas', 'Recurrentes', 'Neto'].map((t) => h('th', { scope: 'col' }, t)))),
          h('tbody', {}, filas.map((f) => h('tr', {}, h('th', { scope: 'row' }, f.mes), [f.ingresos, f.cuotas, f.recurrentes, f.neto].map((v) => h('td', { class: 'monto' }, formatear(v))))))))));
  }

  function vistaComparador() {
    const datos = ctx.datos();
    const cdts = datos.investments;
    const montoEl = entradaMonto({ placeholder: '1000000', value: '1000000' });
    const tasaT = h('input', { type: 'number', inputmode: 'decimal', step: '0.01', value: String(datos.tarjetas.find((t) => t.estado !== 'cerrada')?.tasaEA ?? 26.82) });
    const tasaC = h('input', { type: 'number', inputmode: 'decimal', step: '0.01', value: String(cdts[0]?.rate ?? 10) });
    const meses = h('input', { type: 'number', inputmode: 'numeric', min: '1', value: '12' });
    const salida = h('div', { role: 'status' });
    const calcular = () => {
      const r = pagarVsCdt({ monto: aEntero(montoEl.value), tasaTarjetaEA: Number(tasaT.value), tasaCdtEA: Number(tasaC.value), meses: Number(meses.value) || 12 });
      montar(salida, h('div', { class: 'panel-kpis' },
        h('div', { class: 'kpi' }, h('div', { class: 'kpi-valor monto' }, formatear(r.interesEvitado)), h('div', { class: 'kpi-etiqueta' }, 'Intereses que evitas pagando la tarjeta')),
        h('div', { class: 'kpi' }, h('div', { class: 'kpi-valor monto' }, formatear(r.rendimientoCdt)), h('div', { class: 'kpi-etiqueta' }, 'Rendimiento del CDT tras retención del 4 %'))),
        h('p', { class: 'nota' }, `Diferencia: ${formatear(r.diferencia)}. Es un cálculo aproximado, sin otros factores como liquidez o emergencias.`));
    };
    calcular();
    return h('div', {}, encabezado('Pagar tarjeta o invertir en CDT', 'comparador'),
      h('div', { class: 'card' }, h('div', { class: 'formulario' }, campo('Monto', montoEl), campo('Tasa de la tarjeta (% EA)', tasaT), campo('Tasa del CDT (% EA)', tasaC), campo('Plazo (meses)', meses),
        h('button', { class: 'btn-ghost', onclick: calcular }, 'Comparar')), salida));
  }

  function render() {
    const tarjetas = ctx.datos().tarjetas.filter((t) => t.estado !== 'cerrada');
    montar('vistaTarjetas',
      encabezado('Tarjetas de crédito', 'pasivo'),
      h('div', { class: 'card' },
        tarjetas.length ? tarjetas.map(tarjetaVisual) : vacio('Sin tarjetas', 'Agrégalas para ver tu deuda, las fechas de pago y las compras a cuotas.'),
        h('details', { class: 'detalle', open: formularioAbierto, ontoggle: (e) => { formularioAbierto = e.target.open; } }, h('summary', {}, 'Agregar tarjeta'), nuevaTarjeta())),
      vistaDeudas(), vistaSimulador(), vistaFlujo(), vistaComparador());
  }

  return { render };
}
```
