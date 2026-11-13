/** Inicio (hoy, salud, patrimonio), presupuesto, exportes, seguridad, diagnóstico y guía inicial. */

import { h, s, montar, monto, campo, entradaMonto, selector, vacio, encabezado, seguro } from './dom.js';
import { aEntero, formatear } from '../domain/money.js';
import { diaBogota, ultimoDiaMes } from '../domain/fechas.js';
import {
  patrimonio,
  avancePresupuestos,
  detectarRecurrentes,
  efectivoDelMes,
} from '../domain/presupuesto.js';
import { estadisticasMes, textoTasaAhorro } from '../domain/movimientos.js';
import { indicadoresSalud, ritmoDelMes, puntajeSalud, metaAhorro } from '../domain/salud.js';
import { proximosCompromisos, patrimonioHistorico } from '../domain/analisis.js';
import { saldoTarjeta, utilizacion, alertasTarjeta, cicloVigente } from '../domain/tarjetas.js';
import { tablasPowerBi, archivosCsv } from '../services/exportacion.js';
import { tamanoDatos } from '../db.js';
import { VERSION_ACTUAL } from '../services/migraciones.js';
import { CATEGORIAS_GASTO } from '../domain/categorias.js';

export const VERSION_APP = '6.0.0';
const ITERACIONES_PIN = 200000;
const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
// Colores de la composición del patrimonio (distintos entre sí también para daltonismo).
const COLOR_ACTIVO = { cuentas: '#199E70', bolsillos: '#3987E5', metas: '#C98500', inversiones: '#8A63D2' };

async function hashPin(pin, salBase64) {
  const sal = salBase64
    ? Uint8Array.from(atob(salBase64), (c) => c.charCodeAt(0))
    : crypto.getRandomValues(new Uint8Array(16));
  const clave = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: sal, iterations: ITERACIONES_PIN, hash: 'SHA-256' },
    clave,
    256,
  );
  const b64 = (b) => btoa(String.fromCharCode(...new Uint8Array(b)));
  return { hash: b64(bits), sal: b64(sal) };
}

/** "en 3 días", "mañana", "hoy", "hace 2 días". */
function textoDias(dias) {
  if (dias == null) return 'este mes';
  if (dias === 0) return 'hoy';
  if (dias === 1) return 'mañana';
  if (dias === -1) return 'ayer';
  return dias > 0 ? `en ${dias} días` : `hace ${-dias} días`;
}

/** Anillo de avance (0 a 100) dibujado en SVG; el número va encima como texto normal. */
function anillo(porcentaje, tamano = 76, grosor = 8) {
  const radio = (tamano - grosor) / 2;
  const largo = 2 * Math.PI * radio;
  const centro = tamano / 2;
  const comun = { cx: centro, cy: centro, r: radio, fill: 'none', 'stroke-width': grosor };
  return s(
    'svg',
    { viewBox: `0 0 ${tamano} ${tamano}`, width: tamano, height: tamano, 'aria-hidden': 'true' },
    s('circle', { ...comun, class: 'pista' }),
    s('circle', {
      ...comun,
      class: 'avance',
      'stroke-linecap': 'round',
      'stroke-dasharray': largo.toFixed(1),
      'stroke-dashoffset': (largo * (1 - Math.max(0, Math.min(100, porcentaje)) / 100)).toFixed(1),
      transform: `rotate(-90 ${centro} ${centro})`,
    }),
  );
}

/** Línea de tendencia mínima: sin ejes, solo la forma. Las cifras exactas van en el texto. */
function chispa(valores) {
  const ancho = 300;
  const alto = 56;
  const min = Math.min(...valores);
  const rango = Math.max(...valores) - min || 1;
  const x = (i) => 4 + (i / (valores.length - 1)) * (ancho - 8);
  const y = (v) => 6 + (1 - (v - min) / rango) * (alto - 14);
  const puntos = valores.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
  const ultimo = valores.length - 1;
  return s(
    'svg',
    { class: 'chispa', viewBox: `0 0 ${ancho} ${alto}`, preserveAspectRatio: 'none', 'aria-hidden': 'true' },
    s('polygon', { class: 'area', points: `4,${alto} ${puntos.join(' ')} ${ancho - 4},${alto}` }),
    s('polyline', { class: 'linea', points: puntos.join(' '), 'vector-effect': 'non-scaling-stroke' }),
    s('circle', { class: 'punto', cx: x(ultimo).toFixed(1), cy: y(valores[ultimo]).toFixed(1), r: 3.5 }),
  );
}

export function crearPanelUI(ctx, ingesta) {
  const accion = (fn) => seguro(fn, ctx.toast);
  const hoy = () => diaBogota();

  /** Lo que importa hoy: cuánto puedes gastar, avisos y qué pagos vienen. */
  function renderHoy() {
    const datos = ctx.datos();
    const dia = hoy();
    const mes = dia.slice(0, 7);
    const ritmo = ritmoDelMes(datos, dia);
    const meta = metaAhorro(datos);
    const efectivo = efectivoDelMes(datos, mes);
    const tarjetas = datos.tarjetas.filter((t) => t.estado !== 'cerrada');
    const urgentes = tarjetas
      .flatMap((t) =>
        alertasTarjeta(t, saldoTarjeta(t, datos.transactions), {
          hoy: dia,
          cicloActual: cicloVigente(datos.ciclos, t.id, dia),
        }),
      )
      .filter((a) => a.nivel !== 'info');
    const porRevisar = ingesta.contarPendientes();
    const compromisos = proximosCompromisos(datos, dia, 30).slice(0, 6);
    const avanceMes = Math.round((Number(dia.slice(8, 10)) / ultimoDiaMes(mes)) * 100);

    const tarjetaHoy =
      ritmo.base || efectivo.sinRastrear > 0 || urgentes.length || porRevisar
        ? h(
            'div',
            { class: 'card' },
            ritmo.base
              ? h(
                  'div',
                  { class: 'ritmo' },
                  h('small', {}, 'Puedes gastar hoy'),
                  h('b', { class: `monto ${ritmo.porDia > 0 ? '' : 'negativo'}` }, formatear(ritmo.porDia)),
                  h(
                    'p',
                    { class: 'nota' },
                    ritmo.disponible > 0
                      ? `Te quedan ${formatear(ritmo.disponible)} ${ritmo.base === 'presupuesto' ? 'de tus presupuestos' : `para cerrar el mes ahorrando el ${meta} %`} y ${ritmo.dias} día(s).`
                      : ritmo.base === 'presupuesto'
                        ? `Ya usaste todos tus presupuestos (${formatear(-ritmo.disponible)} de más). Lo que gastes ahora sale del ahorro.`
                        : `Ya gastaste ${formatear(-ritmo.disponible)} más de lo que permite ahorrar el ${meta} % este mes.`,
                  ),
                  h(
                    'div',
                    {
                      class: 'mes-avance',
                      role: 'progressbar',
                      'aria-valuemin': '0',
                      'aria-valuemax': '100',
                      'aria-valuenow': String(avanceMes),
                      'aria-label': `Ha pasado el ${avanceMes} % del mes`,
                    },
                    h('span', { style: { width: `${avanceMes}%` } }),
                  ),
                )
              : null,
            efectivo.sinRastrear > 0
              ? h(
                  'div',
                  { class: 'chip chip-aviso' },
                  `Retiraste ${formatear(efectivo.retirado)} en efectivo este mes y registraste ${formatear(efectivo.gastado)} en gastos con él. ` +
                    `${formatear(efectivo.sinRastrear)} sin rastrear: mientras no los anotes, tu tasa de ahorro se ve mejor de lo que es.`,
                )
              : null,
            urgentes.map((a) =>
              h('div', { class: `chip ${a.nivel === 'urgente' ? 'chip-urgente' : 'chip-aviso'}` }, a.mensaje),
            ),
            porRevisar
              ? h(
                  'button',
                  {
                    class: 'btn-ghost boton-ancho margen-arriba-chico',
                    onclick: () => document.dispatchEvent(new CustomEvent('ir-a', { detail: 'movimientos' })),
                  },
                  `${porRevisar} movimiento(s) por revisar`,
                )
              : null,
          )
        : null;

    const contenedor = montar(
      'vistaHoy',
      tarjetaHoy,
      compromisos.length ? encabezado('Próximos pagos', '30 días') : null,
      compromisos.length
        ? h(
            'div',
            { class: 'card' },
            compromisos.map((c) =>
              h(
                'div',
                { class: `compromiso${c.dias != null && c.dias < 0 ? ' vencido' : ''}` },
                h(
                  'div',
                  { class: 'compromiso-fecha', 'aria-hidden': 'true' },
                  h('b', {}, c.fecha ? String(Number(c.fecha.slice(8, 10))) : '·'),
                  c.fecha ? MESES_CORTOS[Number(c.fecha.slice(5, 7)) - 1] : 'mes',
                ),
                h(
                  'div',
                  {},
                  h('div', { class: 'compromiso-titulo' }, c.titulo),
                  h('div', { class: 'compromiso-detalle' }, `${c.detalle} · ${textoDias(c.dias)}`),
                ),
                h(
                  'span',
                  { class: `monto${c.entra ? ' entra' : ''}` },
                  `${c.entra ? '+' : ''}${formatear(c.monto)}`,
                ),
              ),
            ),
          )
        : null,
    );
    contenedor.hidden = !tarjetaHoy && !compromisos.length;
  }

  function renderPanel() {
    const datos = ctx.datos();
    const p = patrimonio(datos);
    const mes = hoy().slice(0, 7);
    const st = estadisticasMes(datos.transactions, mes);
    const tarjetas = datos.tarjetas.filter((t) => t.estado !== 'cerrada');
    const cupo = tarjetas.reduce((a, t) => a + aEntero(t.cupoTotal), 0);
    const usado = tarjetas.reduce((a, t) => a + Math.max(0, saldoTarjeta(t, datos.transactions)), 0);
    const uso = utilizacion({ cupoTotal: cupo }, usado);
    const kpi = (valor, etiqueta, esMonto = true) =>
      h(
        'div',
        { class: 'kpi' },
        h('div', { class: `kpi-valor${esMonto ? ' monto' : ''}` }, valor),
        h('div', { class: 'kpi-etiqueta' }, etiqueta),
      );
    const salud = indicadoresSalud(datos, mes);
    const nota = puntajeSalud(salud);
    // Los indicadores sin historia se resumen en una línea en vez de repetir el mismo aviso.
    const faltan = salud.filter((i) => i.estado === 'sin_datos').map((i) => i.titulo.toLowerCase());
    const etiquetaEstado = { ok: 'Bien', alerta: 'Atención', mal: 'Actúa', sin_datos: 'Sin datos' };
    const claseNota = { Sólida: 'solida', Estable: 'estable', Frágil: 'fragil' };

    const historia = patrimonioHistorico(datos, mes, 6);
    const previo = historia.length >= 2 ? historia[historia.length - 2] : null;
    const cambio = previo ? p.neto - previo.neto : null;
    const partes = [
      ['cuentas', 'Cuentas y efectivo'],
      ['bolsillos', 'Bolsillos'],
      ['metas', 'Metas'],
      ['inversiones', 'CDT'],
    ].filter(([k]) => p.desglose[k] > 0);
    const pasivo = (nombre, valor) =>
      valor > 0
        ? h(
            'div',
            { class: 'desglose-fila pasivo' },
            h('span', {}, nombre),
            h('span', { class: 'monto' }, `−${formatear(valor)}`),
          )
        : null;

    montar(
      'vistaPanel',
      encabezado('Salud financiera', 'qué hacer'),
      h(
        'div',
        { class: 'card' },
        nota
          ? h(
              'div',
              { class: 'salud-cabecera' },
              h(
                'div',
                { class: `salud-anillo ${claseNota[nota.etiqueta]}` },
                anillo(nota.puntaje),
                h('b', {}, String(nota.puntaje)),
              ),
              h(
                'div',
                { class: 'salud-resumen' },
                h('b', {}, nota.etiqueta),
                h(
                  'span',
                  { class: 'nota' },
                  `Puntaje de 0 a 100 con ${nota.evaluados} indicador(es). Abajo, qué mueve cada uno.`,
                ),
              ),
            )
          : null,
        faltan.length
          ? h(
              'p',
              { class: 'nota' },
              `Con al menos un mes completo de ingresos y gastos verás también: ${faltan.join(' y ')}.`,
            )
          : null,
        salud
          .filter((i) => i.estado !== 'sin_datos')
          .map((i) =>
            h(
              'div',
              { class: `salud-item salud-${i.estado}` },
              h(
                'div',
                { class: 'fila-simple' },
                h('b', {}, i.titulo),
                h('span', { class: 'salud-valor' }, i.valor),
                h('span', { class: `salud-estado salud-${i.estado}` }, etiquetaEstado[i.estado]),
              ),
              h('div', { class: 'nota' }, `Meta: ${i.meta}`),
              h('p', { class: 'salud-consejo' }, i.consejo),
            ),
          ),
      ),
      encabezado('Patrimonio', 'tienes − debes'),
      h(
        'div',
        { class: 'card' },
        h(
          'div',
          { class: 'patrimonio-neto' },
          h('small', {}, 'Patrimonio neto'),
          h('b', { class: 'monto' }, formatear(p.neto)),
        ),
        cambio != null
          ? h(
              'div',
              { class: `patrimonio-cambio ${cambio > 0 ? 'sube' : cambio < 0 ? 'baja' : ''}` },
              `${cambio >= 0 ? '+' : '−'}${formatear(Math.abs(cambio))} frente al cierre de ${MESES_CORTOS[Number(previo.mes.slice(5, 7)) - 1]}`,
            )
          : null,
        historia.length >= 2 ? chispa(historia.map((x) => x.neto)) : null,
        partes.length
          ? h(
              'div',
              { class: 'composicion', role: 'img', 'aria-label': 'Composición de tus activos' },
              partes.map(([k]) =>
                h('span', {
                  style: {
                    background: COLOR_ACTIVO[k],
                    'flex-grow': String(p.desglose[k]),
                    'flex-basis': '0',
                  },
                }),
              ),
            )
          : null,
        partes.map(([k, nombre]) =>
          h(
            'div',
            { class: 'desglose-fila' },
            h('span', {}, h('span', { class: 'cat-dot', style: { background: COLOR_ACTIVO[k] } }), nombre),
            monto(p.desglose[k]),
          ),
        ),
        pasivo('Tarjetas de crédito', p.desglose.tarjetas),
        pasivo('Otras deudas', p.desglose.otrasDeudas),
        h(
          'div',
          { class: 'panel-kpis' },
          kpi(formatear(p.activos), 'Activos'),
          kpi(formatear(p.pasivos), 'Pasivos'),
          kpi(formatear(st.balance), 'Flujo del mes'),
          kpi(textoTasaAhorro(st), 'Ahorro del mes', false),
          cupo ? kpi(`${uso.porcentaje} %`, 'Uso de tarjetas', false) : null,
        ),
      ),
    );
  }

  function renderPresupuesto() {
    const datos = ctx.datos();
    const mes = hoy().slice(0, 7);
    const avance = avancePresupuestos(datos.presupuestos, datos.transactions, mes);
    const recurrentes = detectarRecurrentes(datos.transactions, mes);
    const categoria = h('input', {
      type: 'text',
      list: 'expenseCategoryList',
      placeholder: CATEGORIAS_GASTO[0],
    });
    const limite = entradaMonto({ placeholder: 'Límite mensual' });
    const agregar = accion(async () => {
      const cat = categoria.value.trim();
      if (!cat || aEntero(limite.value) <= 0) throw new Error('Escribe categoría y límite');
      datos.presupuestos = [
        ...datos.presupuestos.filter((x) => x.categoria !== cat),
        { categoria: cat, limite: aEntero(limite.value) },
      ];
      await ctx.guardar();
      ctx.renderAll();
    });
    const clase = { ok: 'verde', alerta: 'ambar', excedido: 'rojo' };
    const texto = { ok: '', alerta: 'Llegaste al 80 %. ', excedido: 'Superaste el límite. ' };
    montar(
      'vistaPresupuesto',
      encabezado('Presupuesto', 'mes actual'),
      h(
        'div',
        { class: 'card' },
        avance.length
          ? avance.map((a) =>
              h(
                'div',
                { class: 'presupuesto' },
                h(
                  'div',
                  { class: 'fila-simple' },
                  h('b', {}, a.categoria),
                  h(
                    'button',
                    {
                      class: 'quitar',
                      'aria-label': `Quitar presupuesto de ${a.categoria}`,
                      onclick: accion(async () => {
                        datos.presupuestos = datos.presupuestos.filter((x) => x.categoria !== a.categoria);
                        await ctx.guardar();
                        ctx.renderAll();
                      }),
                    },
                    '✕',
                  ),
                ),
                h(
                  'div',
                  {
                    class: 'barra-uso',
                    role: 'progressbar',
                    'aria-valuenow': String(Math.min(100, a.porcentaje)),
                    'aria-valuemin': '0',
                    'aria-valuemax': '100',
                    'aria-label': `${a.categoria}: ${a.porcentaje} %`,
                  },
                  h('div', {
                    class: `barra-uso-relleno ${clase[a.nivel]}`,
                    style: { width: `${Math.min(100, a.porcentaje)}%` },
                  }),
                ),
                // Monto debajo de la barra: en 320 px nombre, montos y botón no caben en una sola fila.
                h(
                  'p',
                  { class: 'nota presupuesto-cifras' },
                  h('span', { class: 'monto' }, `${formatear(a.gastado)} de ${formatear(a.limite)}`),
                  ` · ${texto[a.nivel]}${a.porcentaje} %`,
                ),
              ),
            )
          : vacio('Sin presupuestos', 'Define un límite por categoría y la app te avisa al 80 % y al 100 %.'),
        h(
          'details',
          { class: 'detalle' },
          h('summary', {}, 'Agregar presupuesto'),
          h(
            'div',
            { class: 'formulario' },
            campo('Categoría', categoria),
            campo('Límite mensual', limite),
            h('button', { class: 'btn-accent', onclick: agregar }, 'Guardar'),
          ),
        ),
      ),
      encabezado('Recurrentes', 'suscripciones'),
      h(
        'div',
        { class: 'card' },
        recurrentes.length
          ? recurrentes.map((r) =>
              h(
                'div',
                { class: 'fila-simple' },
                h(
                  'div',
                  {},
                  h('b', {}, r.comercio),
                  h('div', { class: 'nota' }, `Hacia el día ${r.dia} · ${formatear(r.costoAnual)} al año`),
                ),
                monto(r.monto),
              ),
            )
          : vacio('Aún sin detectar', 'Aparecen cuando un comercio cobra algo parecido 3 meses seguidos.'),
        recurrentes.length
          ? h(
              'p',
              { class: 'nota con-cifras' },
              `En total, ${formatear(recurrentes.reduce((t, r) => t + r.monto, 0))} al mes en cobros fijos (${formatear(recurrentes.reduce((t, r) => t + r.costoAnual, 0))} al año).`,
            )
          : null,
      ),
    );
  }

  function renderAjustes() {
    const datos = ctx.datos();
    const discreto = h('input', {
      type: 'checkbox',
      checked: !!datos.settings.discreto,
      onchange: accion(async (e) => {
        datos.settings.discreto = e.target.checked;
        document.body.classList.toggle('discreto', e.target.checked);
        await ctx.guardar();
      }),
    });
    const pin = h('input', {
      type: 'password',
      inputmode: 'numeric',
      maxlength: '8',
      autocomplete: 'new-password',
      placeholder: '4 a 8 dígitos',
    });
    const guardarPin = accion(async () => {
      if (!/^\d{4,8}$/.test(pin.value)) throw new Error('El PIN debe tener de 4 a 8 dígitos');
      const { hash, sal } = await hashPin(pin.value);
      Object.assign(datos.settings, { pinHash: hash, pinSal: sal });
      await ctx.guardar();
      ctx.toast('PIN activado');
      ctx.renderAll();
    });
    const quitarPin = accion(async () => {
      if (!(await ctx.preguntar('¿Quitar el PIN?'))) return;
      delete datos.settings.pinHash;
      delete datos.settings.pinSal;
      await ctx.guardar();
      ctx.renderAll();
    });
    const exportarCsv = accion(async () => {
      const archivos = archivosCsv(tablasPowerBi(datos, hoy()));
      for (const [nombre, contenido] of Object.entries(archivos))
        ctx.descargar(nombre, `﻿${contenido}`, 'text/csv;charset=utf-8');
      ctx.toast(`${Object.keys(archivos).length} archivos CSV descargados`);
    });
    const exportarJson = () =>
      ctx.descargar(
        `finanzas-powerbi-${hoy()}.json`,
        JSON.stringify(tablasPowerBi(datos, hoy()), null, 2),
        'application/json',
      );
    const errores = datos.log
      .filter((l) => l.nivel === 'error')
      .slice(-5)
      .reverse();
    const uso = selector(
      [
        ['0', 'Sin guía'],
        ['1', 'Mostrar guía inicial'],
      ],
      datos.settings.onboardingOculto ? '0' : '1',
      {
        onchange: accion(async (e) => {
          datos.settings.onboardingOculto = e.target.value === '0';
          await ctx.guardar();
          ctx.renderAll();
        }),
      },
    );
    const tema = selector(
      [
        ['auto', 'Automático (como el celular)'],
        ['claro', 'Claro'],
        ['oscuro', 'Oscuro'],
      ],
      datos.settings.tema ?? 'auto',
      {
        onchange: accion(async (e) => {
          datos.settings.tema = e.target.value;
          await ctx.guardar();
          ctx.renderAll();
        }),
      },
    );
    const metaEl = h('input', {
      type: 'number',
      inputmode: 'numeric',
      min: '5',
      max: '80',
      step: '1',
      value: String(metaAhorro(datos)),
      onchange: accion(async (e) => {
        const valor = Math.round(Number(e.target.value));
        if (!(valor >= 5 && valor <= 80)) {
          e.target.value = String(metaAhorro(datos));
          throw new Error('La meta de ahorro debe estar entre 5 % y 80 %');
        }
        datos.settings.metaAhorro = valor;
        await ctx.guardar();
        ctx.toast(`Meta de ahorro: ${valor} % del ingreso`);
        ctx.renderAll();
      }),
    });
    montar(
      'vistaAjustes',
      encabezado('Preferencias', 'a tu medida'),
      h(
        'div',
        { class: 'card formulario' },
        campo('Apariencia', tema),
        campo('Meta de ahorro (% del ingreso)', metaEl),
        h(
          'p',
          { class: 'nota' },
          'La meta de ahorro define cuánto puedes gastar hoy y cómo se califica tu tasa de ahorro. 20 % es la referencia más usada; súbela si quieres llegar antes a tus metas.',
        ),
      ),
      encabezado('Ingesta automática', 'correos de Bancolombia'),
      h('div', { class: 'card', id: 'vistaAjustesIngesta' }),
      encabezado('Seguridad', 'privacidad'),
      h(
        'div',
        { class: 'card formulario' },
        h('label', { class: 'campo-check' }, discreto, 'Modo discreto: ocultar montos'),
        datos.settings.pinHash
          ? h('button', { class: 'btn-ghost', onclick: quitarPin }, 'Quitar PIN')
          : h(
              'div',
              { class: 'formulario' },
              campo('PIN de bloqueo', pin),
              h('button', { class: 'btn-ghost', onclick: guardarPin }, 'Activar PIN'),
            ),
        h(
          'p',
          { class: 'nota' },
          'El PIN evita miradas casuales; no cifra los datos. Para protegerlos, usa también el bloqueo del celular.',
        ),
        campo('Guía inicial', uso),
      ),
      encabezado('Exportar', 'Power BI'),
      h(
        'div',
        { class: 'card formulario' },
        h('button', { class: 'btn-ghost', onclick: exportarCsv }, 'Descargar CSV (6 archivos)'),
        h('button', { class: 'btn-ghost', onclick: exportarJson }, 'Descargar JSON'),
      ),
      encabezado('Diagnóstico', `v${VERSION_APP}`),
      h(
        'div',
        { class: 'card' },
        h(
          'dl',
          { class: 'diagnostico' },
          h('dt', {}, 'Versión'),
          h('dd', {}, VERSION_APP),
          h('dt', {}, 'Esquema'),
          h('dd', {}, String(datos.schemaVersion ?? VERSION_ACTUAL)),
          h('dt', {}, 'Última sincronización'),
          h('dd', {}, datos.settings.sync?.ultima ?? 'nunca'),
          h('dt', {}, 'Tamaño de la base'),
          h('dd', {}, `${Math.ceil(tamanoDatos(datos) / 1024)} KB`),
          h('dt', {}, 'Movimientos'),
          h('dd', {}, String(datos.transactions.length)),
          h('dt', {}, 'Reglas aprendidas'),
          h('dd', {}, String(datos.reglas.length + datos.reglasParser.length)),
        ),
        h('h3', {}, 'Errores recientes'),
        errores.length
          ? h(
              'ul',
              { class: 'lista-errores' },
              errores.map((e) => h('li', {}, `${e.fecha.slice(0, 16)}: ${e.mensaje}`)),
            )
          : h('p', { class: 'nota' }, 'Sin errores.'),
      ),
    );
    ingesta.renderAjustes();
  }

  function renderOnboarding() {
    const datos = ctx.datos();
    const pasos = [
      [datos.accounts.length > 0, 'Agrega tu cuenta y sus últimos 4 dígitos', 'ahorro'],
      [datos.tarjetas.length > 0, 'Agrega tus tarjetas de crédito', 'tarjetas'],
      [datos.settings.ingesta.activa, 'Conecta los correos de Bancolombia', 'mas'],
    ];
    if (datos.settings.onboardingOculto || pasos.every(([hecho]) => hecho)) {
      montar('vistaOnboarding');
      return;
    }
    montar(
      'vistaOnboarding',
      h(
        'div',
        { class: 'card onboarding' },
        h('h3', {}, 'Para empezar'),
        pasos.map(([hecho, texto, tab]) =>
          h(
            'button',
            {
              class: `btn-ghost ancho${hecho ? ' hecho' : ''}`,
              onclick: () => document.dispatchEvent(new CustomEvent('ir-a', { detail: tab })),
            },
            `${hecho ? '✓' : '○'} ${texto}`,
          ),
        ),
        h(
          'button',
          {
            class: 'btn-ghost ancho',
            onclick: accion(async () => {
              datos.settings.onboardingOculto = true;
              await ctx.guardar();
              ctx.renderAll();
            }),
          },
          'Ocultar',
        ),
      ),
    );
  }

  /** Pide el PIN antes de mostrar la app, si está activo. */
  function exigirPin() {
    const { pinHash, pinSal } = ctx.datos().settings;
    if (!pinHash) return Promise.resolve();
    return new Promise((resolve) => {
      const caja = document.getElementById('overlayPin');
      const entrada = h('input', {
        type: 'password',
        inputmode: 'numeric',
        maxlength: '8',
        'aria-label': 'PIN',
        autocomplete: 'off',
      });
      const mensaje = h('p', { role: 'alert', class: 'nota' });
      const validar = async () => {
        const { hash } = await hashPin(entrada.value, pinSal);
        if (hash === pinHash) {
          caja.hidden = true;
          resolve();
        } else {
          mensaje.textContent = 'PIN incorrecto';
          entrada.value = '';
        }
      };
      montar(
        caja,
        h(
          'div',
          { class: 'pin-caja' },
          h('h2', {}, 'Finanzas'),
          entrada,
          mensaje,
          h('button', { class: 'btn-accent', onclick: validar }, 'Entrar'),
        ),
      );
      caja.hidden = false;
      entrada.focus();
    });
  }

  return { renderHoy, renderPanel, renderPresupuesto, renderAjustes, renderOnboarding, exigirPin };
}
