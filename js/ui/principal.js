/** Une las pantallas nuevas con la app: navegación, recursos, versión nueva y entrada rápida. */

import { h, montar, snackbar } from './dom.js';
import { crearIngestaUI } from './ingesta.js';
import { crearTarjetasUI } from './tarjetas.js';
import { crearPanelUI } from './panel.js';

const PESTANAS = [
  ['inicio', 'Inicio', '⌂'],
  ['movimientos', 'Movs', '⇅'],
  ['tarjetas', 'Tarjetas', '▭'],
  ['ahorro', 'Ahorro', '◎'],
  ['mas', 'Más', '☰'],
];

/** Carga patrones y diccionario; sin ellos, la app sigue funcionando sin reconocer mensajes. */
async function cargarRecursos(ctx) {
  const leer = async (ruta, respaldo) => {
    try {
      const r = await fetch(ruta);
      if (!r.ok) throw new Error(`${ruta}: ${r.status}`);
      return await r.json();
    } catch (err) {
      ctx
        .datos()
        .log.push({
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
    PESTANAS.map(([id, texto, icono]) => {
      const badge = h('span', { class: 'nav-badge', hidden: true });
      const boton = h(
        'button',
        { class: 'nav-btn', 'aria-label': texto, onclick: () => ir(id) },
        h('span', { 'aria-hidden': 'true' }, icono),
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
      badge.hidden = !n;
      badge.textContent = n > 99 ? '99+' : String(n);
      boton.setAttribute('aria-label', n ? `${id}: ${n} por revisar` : id);
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
  document.getElementById('fabRegistrar').addEventListener('click', () => {
    nav.ir('movimientos');
    document.getElementById('seccionRegistrar').scrollIntoView();
    document.getElementById('txAmount').focus();
  });

  await panel.exigirPin();
  registrarServiceWorker();
  ingesta.iniciar();
}
