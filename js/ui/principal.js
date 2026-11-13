/** Une las pantallas nuevas con la app: navegación, recursos, versión nueva y entrada rápida. */

import { h, montar, snackbar } from './dom.js';
import { icono } from './iconos.js';
import { crearIngestaUI } from './ingesta.js';
import { crearTarjetasUI } from './tarjetas.js';
import { crearPanelUI } from './panel.js';

const PESTANAS = [
  ['inicio', 'Inicio', 'inicio'],
  ['movimientos', 'Movs', 'movimientos'],
  ['tarjetas', 'Tarjetas', 'tarjeta'],
  ['ahorro', 'Ahorro', 'ahorro'],
  ['mas', 'Más', 'mas'],
];

/**
 * Aplica el tema ('auto' sigue al sistema) y guarda una copia que js/tema.js lee antes de pintar.
 * El color de la barra del sistema acompaña al fondo de la pantalla.
 */
export function aplicarTema(tema = 'auto') {
  const raiz = document.documentElement;
  if (tema === 'claro') raiz.setAttribute('data-theme', 'light');
  else if (tema === 'oscuro') raiz.setAttribute('data-theme', 'dark');
  else raiz.removeAttribute('data-theme');
  try {
    localStorage.setItem('finanzas-tema', tema);
  } catch {
    // Sin localStorage el tema se aplica igual al cargar los datos.
  }
  const fondo = window.getComputedStyle(raiz).getPropertyValue('--bg').trim();
  if (fondo) document.querySelector('meta[name="theme-color"]')?.setAttribute('content', fondo);
}

/** Carga patrones y diccionario; sin ellos, la app sigue funcionando sin reconocer mensajes. */
async function cargarRecursos(ctx) {
  const leer = async (ruta, respaldo) => {
    try {
      const r = await fetch(ruta);
      if (!r.ok) throw new Error(`${ruta}: ${r.status}`);
      return await r.json();
    } catch (err) {
      ctx.datos().log.push({
        nivel: 'error',
        mensaje: `No se pudo cargar ${ruta}: ${err.message}`,
        fecha: new Date().toISOString(),
      });
      return respaldo;
    }
  };
  const [patrones, comercios] = await Promise.all([
    leer('./js/parsers/bancolombia/patrones.json', { patrones: [] }),
    leer('./data/comercios.json', {}),
  ]);
  return { patrones, comercios };
}

function crearNavegacion(alCambiar) {
  let actual = 'inicio';
  const botones = new Map();
  const nav = montar(
    'navInferior',
    PESTANAS.map(([id, texto, nombreIcono]) => {
      const badge = h('span', { class: 'nav-badge', hidden: true });
      const boton = h(
        'button',
        { class: 'nav-btn', 'aria-label': texto, onclick: () => ir(id) },
        icono(nombreIcono),
        h('span', {}, texto),
        badge,
      );
      botones.set(id, { boton, badge });
      return boton;
    }),
  );
  function aplicar() {
    document.querySelectorAll('[data-tab]').forEach((el) => {
      el.classList.toggle('oculto-tab', el.dataset.tab !== actual);
    });
    for (const [id, { boton }] of botones) {
      if (id === actual) boton.setAttribute('aria-current', 'page');
      else boton.removeAttribute('aria-current');
    }
  }
  function ir(id) {
    actual = id;
    aplicar();
    window.scrollTo(0, 0);
    alCambiar?.(id);
  }
  aplicar();
  return {
    ir,
    nav,
    marcarInsignia: (id, n) => {
      const { badge, boton } = botones.get(id);
      const texto = PESTANAS.find(([p]) => p === id)[1];
      badge.hidden = !n;
      badge.textContent = n > 99 ? '99+' : String(n);
      boton.setAttribute('aria-label', n ? `${texto}: ${n} por revisar` : texto);
    },
  };
}

/** Service Worker con actualización controlada por el usuario. */
function registrarServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  const avisar = (registro) => {
    const banner = document.getElementById('bannerVersion');
    montar(
      banner,
      h('span', {}, 'Hay una versión nueva. '),
      h(
        'button',
        { class: 'btn-ghost', onclick: () => registro.waiting?.postMessage('ACTUALIZAR') },
        'Actualizar',
      ),
    );
    banner.classList.add('show');
  };
  navigator.serviceWorker
    .register('./service-worker.js', { scope: './' })
    .then((registro) => {
      if (registro.waiting) avisar(registro);
      registro.addEventListener('updatefound', () => {
        const nuevo = registro.installing;
        nuevo?.addEventListener('statechange', () => {
          if (nuevo.state === 'installed' && navigator.serviceWorker.controller) avisar(registro);
        });
      });
    })
    .catch((err) => console.warn('No se pudo registrar el Service Worker:', err));
  // La primera instalación también cambia el controlador, pero ahí no hay nada que recargar.
  const habiaControlador = !!navigator.serviceWorker.controller;
  let recargando = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (recargando || !habiaControlador) return;
    recargando = true;
    location.reload();
  });
}

/**
 * @param {{render:Function, alEliminar:Function}} interfaz ganchos que usa la app original
 * @param {object} ctx acceso a datos y utilidades de la app
 */
export async function iniciarInterfaz(interfaz, ctx) {
  const recursos = await cargarRecursos(ctx);
  const ingesta = crearIngestaUI(ctx, recursos);
  const tarjetas = crearTarjetasUI(ctx);
  const panel = crearPanelUI(ctx, ingesta);
  const nav = crearNavegacion();

  interfaz.alEliminar = (mensaje, deshacer) => snackbar(mensaje, 'Deshacer', deshacer);
  interfaz.render = () => {
    const datos = ctx.datos();
    document.body.classList.toggle('discreto', !!datos.settings.discreto);
    aplicarTema(datos.settings.tema);
    const ojo = document.getElementById('discretoBtn');
    ojo.replaceChildren(icono(datos.settings.discreto ? 'ojoCerrado' : 'ojo'));
    ojo.setAttribute('aria-pressed', String(!!datos.settings.discreto));
    ojo.setAttribute('aria-label', datos.settings.discreto ? 'Mostrar cifras' : 'Ocultar cifras');
    panel.renderHoy();
    panel.renderPanel();
    panel.renderOnboarding();
    ingesta.render();
    tarjetas.render();
    panel.renderPresupuesto();
    panel.renderAjustes();
    nav.marcarInsignia('movimientos', ingesta.contarPendientes());
    const comercios = [
      ...new Set(
        datos.transactions
          .slice(-200)
          .map((t) => t.comercio)
          .filter(Boolean),
      ),
    ];
    montar(
      'listaComercios',
      comercios.map((c) => h('option', { value: c })),
    );
  };

  document.addEventListener('ir-a', (e) => nav.ir(e.detail));
  document.getElementById('fabRegistrar').append(icono('sumar'));
  // El ojo de la portada alterna el modo discreto sin entrar a Ajustes.
  document.getElementById('discretoBtn').addEventListener('click', async () => {
    const datos = ctx.datos();
    datos.settings.discreto = !datos.settings.discreto;
    try {
      await ctx.guardar();
    } catch (err) {
      ctx.toast(err.message);
    }
    ctx.renderAll();
  });
  document.getElementById('fabRegistrar').addEventListener('click', () => {
    nav.ir('movimientos');
    document.getElementById('seccionRegistrar').scrollIntoView();
    document.getElementById('txAmount').focus();
  });

  await panel.exigirPin();
  registrarServiceWorker();
  ingesta.iniciar();
}
