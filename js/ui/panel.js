/** Panel de inicio, presupuesto, exportes, seguridad, diagnóstico y guía inicial. */

import { h, montar, monto, campo, entradaMonto, selector, vacio, encabezado, seguro } from './dom.js';
import { aEntero, formatear } from '../domain/money.js';
import { diaBogota } from '../domain/fechas.js';
import {
  patrimonio,
  avancePresupuestos,
  detectarRecurrentes,
  efectivoDelMes,
} from '../domain/presupuesto.js';
import { estadisticasMes, textoTasaAhorro } from '../domain/movimientos.js';
import { indicadoresSalud, ritmoDelMes } from '../domain/salud.js';
import {
  saldoTarjeta,
  utilizacion,
  proximasFechas,
  alertasTarjeta,
  cicloVigente,
} from '../domain/tarjetas.js';
import { tablasPowerBi, archivosCsv } from '../services/exportacion.js';
import { tamanoDatos } from '../db.js';
import { VERSION_ACTUAL } from '../services/migraciones.js';
import { CATEGORIAS_GASTO } from '../domain/categorias.js';

export const VERSION_APP = '5.3.6';
const ITERACIONES_PIN = 200000;

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

export function crearPanelUI(ctx, ingesta) {
  const accion = (fn) => seguro(fn, ctx.toast);
  const hoy = () => diaBogota();

  function renderPanel() {
    const datos = ctx.datos();
    const p = patrimonio(datos);
    const mes = hoy().slice(0, 7);
    const s = estadisticasMes(datos.transactions, mes);
    const efectivo = efectivoDelMes(datos, mes);
    const tarjetas = datos.tarjetas.filter((t) => t.estado !== 'cerrada');
    const cupo = tarjetas.reduce((a, t) => a + aEntero(t.cupoTotal), 0);
    const usado = tarjetas.reduce((a, t) => a + Math.max(0, saldoTarjeta(t, datos.transactions)), 0);
    const uso = utilizacion({ cupoTotal: cupo }, usado);
    const vencimientos = tarjetas
      .map((t) => ({ alias: t.alias, fecha: proximasFechas(t, hoy()).limitePago }))
      .sort((a, b) => a.fecha.localeCompare(b.fecha));
    const alertas = tarjetas.flatMap((t) =>
      alertasTarjeta(t, saldoTarjeta(t, datos.transactions), {
        hoy: hoy(),
        cicloActual: cicloVigente(datos.ciclos, t.id, hoy()),
      }),
    );
    const urgentes = alertas.filter((a) => a.nivel !== 'info');
    const kpi = (valor, etiqueta) =>
      h(
        'div',
        { class: 'kpi' },
        h('div', { class: 'kpi-valor monto' }, valor),
        h('div', { class: 'kpi-etiqueta' }, etiqueta),
      );
    const porRevisar = ingesta.contarPendientes();
    const ritmo = ritmoDelMes(datos, hoy());
    const salud = indicadoresSalud(datos, mes);
    // Los indicadores sin historia se resumen en una línea en vez de repetir el mismo aviso.
    const faltan = salud.filter((i) => i.estado === 'sin_datos').map((i) => i.titulo.toLowerCase());
    const etiquetaEstado = { ok: 'Bien', alerta: 'Atención', mal: 'Actúa', sin_datos: 'Sin datos' };
    montar(
      'vistaPanel',
      ritmo.base
        ? h(
            'div',
            { class: 'card ritmo' },
            h('small', {}, 'Puedes gastar hoy'),
            h('b', { class: `monto ${ritmo.porDia > 0 ? '' : 'negativo'}` }, formatear(ritmo.porDia)),
            h(
              'p',
              { class: 'nota' },
              ritmo.disponible > 0
                ? `Te quedan ${formatear(ritmo.disponible)} ${ritmo.base === 'presupuesto' ? 'de tus presupuestos' : 'para cerrar el mes ahorrando el 20 %'} y ${ritmo.dias} día(s).`
                : ritmo.base === 'presupuesto'
                  ? `Ya usaste todos tus presupuestos (${formatear(-ritmo.disponible)} de más). Lo que gastes ahora sale del ahorro.`
                  : `Ya gastaste ${formatear(-ritmo.disponible)} más de lo que permite ahorrar el 20 % este mes.`,
            ),
          )
        : null,
      encabezado('Salud financiera', 'qué hacer'),
      h(
        'div',
        { class: 'card' },
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
      encabezado('Patrimonio', 'hoy'),
      h(
        'div',
        { class: 'card' },
        h(
          'div',
          { class: 'patrimonio-neto' },
          h('small', {}, 'Patrimonio neto'),
          h('b', { class: 'monto' }, formatear(p.neto)),
        ),
        h(
          'div',
          { class: 'panel-kpis' },
          kpi(formatear(p.activos), 'Activos'),
          kpi(formatear(p.pasivos), 'Pasivos'),
          kpi(formatear(s.balance), 'Flujo del mes'),
          h(
            'div',
            { class: 'kpi' },
            h('div', { class: 'kpi-valor' }, textoTasaAhorro(s)),
            h('div', { class: 'kpi-etiqueta' }, 'Ahorro del mes'),
          ),
          kpi(formatear(p.desglose.tarjetas + p.desglose.otrasDeudas), 'Deuda total'),
          h(
            'div',
            { class: 'kpi' },
            h('div', { class: 'kpi-valor' }, cupo ? `${uso.porcentaje} %` : 'n/a'),
            h('div', { class: 'kpi-etiqueta' }, 'Uso de tarjetas'),
          ),
        ),
        vencimientos.length
          ? h('p', { class: 'nota' }, `Próximo pago: ${vencimientos[0].alias}, ${vencimientos[0].fecha}.`)
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
                class: 'btn-ghost ancho',
                onclick: () => document.dispatchEvent(new CustomEvent('ir-a', { detail: 'movimientos' })),
              },
              `${porRevisar} movimiento(s) por revisar`,
            )
          : null,
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
                      class: 'btn-ghost',
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
                  h('div', { class: 'nota' }, `${formatear(r.costoAnual)} al año`),
                ),
                monto(r.monto),
              ),
            )
          : vacio('Aún sin detectar', 'Aparecen cuando un comercio cobra algo parecido 3 meses seguidos.'),
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
    montar(
      'vistaAjustes',
      encabezado('Ingesta automática', 'Bancolombia'),
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
      [datos.settings.ingesta.activa, 'Conecta la ingesta de Bancolombia', 'mas'],
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
              class: 'btn-ghost ancho',
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

  return { renderPanel, renderPresupuesto, renderAjustes, renderOnboarding, exigirPin };
}
