/** Utilidades de interfaz. Todo texto entra como nodo de texto: aquí nunca se usa innerHTML. */

import { formatear } from '../domain/money.js';

/**
 * Crea un elemento. `on*` son eventos; `class` y `dataset` se tratan aparte; el resto, atributos.
 * @param {string} etiqueta
 * @param {object} [props]
 * @param {...(Node|string|number|null|false)} hijos
 */
export function h(etiqueta, props = {}, ...hijos) {
  const el = document.createElement(etiqueta);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'class') el.className = v;
    else if (k === 'value') el.value = v;
    else if (k === 'checked' || k === 'disabled' || k === 'selected' || k === 'hidden') el[k] = !!v;
    // Propiedades vía CSSOM, no el atributo `style`: así no depende de 'unsafe-inline' en la CSP.
    else if (k === 'style' && typeof v === 'object') for (const [p, val] of Object.entries(v)) el.style.setProperty(p, val);
    else el.setAttribute(k, v === true ? '' : v);
  }
  agregar(el, hijos);
  return el;
}

function agregar(el, hijos) {
  for (const hijo of hijos.flat(Infinity)) {
    if (hijo == null || hijo === false) continue;
    el.append(hijo instanceof Node ? hijo : document.createTextNode(String(hijo)));
  }
}

/** Reemplaza el contenido de un contenedor. */
export function montar(id, ...hijos) {
  const el = typeof id === 'string' ? document.getElementById(id) : id;
  el.replaceChildren();
  agregar(el, hijos);
  return el;
}

/** Monto formateado que "modo discreto" puede ocultar. */
export const monto = (valor) => h('span', { class: 'monto' }, formatear(valor));

/** Campo con etiqueta asociada, para lectores de pantalla. */
let contador = 0;
export function campo(etiqueta, control) {
  const id = control.id || `campo-${++contador}`;
  control.id = id;
  return h('label', { class: 'campo', for: id }, h('span', { class: 'campo-etiqueta' }, etiqueta), control);
}

export const entradaMonto = (props = {}) =>
  h('input', { type: 'number', inputmode: 'numeric', min: '0', step: '1000', ...props });

/** Selector a partir de pares `[valor, texto]`. */
export function selector(opciones, seleccionado, props = {}) {
  return h(
    'select',
    props,
    opciones.map(([v, t]) => h('option', { value: v, selected: v === seleccionado }, t)),
  );
}

/** Estado vacío útil: dice qué pasa y qué hacer. */
export const vacio = (titulo, texto) =>
  h(
    'div',
    { class: 'vacio' },
    h('div', { class: 'vacio-titulo' }, titulo),
    h('div', { class: 'vacio-texto' }, texto),
  );

export const encabezado = (titulo, etiqueta) =>
  h(
    'div',
    { class: 'section-head' },
    h('h2', {}, titulo),
    etiqueta ? h('span', { class: 'tag' }, etiqueta) : null,
  );

/** Ejecuta una acción de usuario y muestra cualquier error en lugar de perderlo. */
export function seguro(fn, avisar) {
  let enCurso = false;
  return async (...args) => {
    // Un doble toque no debe registrar dos veces un pago.
    if (enCurso) return;
    enCurso = true;
    try {
      await fn(...args);
    } catch (err) {
      avisar(err.message || 'Ocurrió un error inesperado');
    } finally {
      enCurso = false;
    }
  };
}

/** Snackbar con "Deshacer". */
let relojSnack = null;
export function snackbar(mensaje, etiquetaAccion, accion) {
  const el = montar(
    'snackbar',
    h('span', {}, mensaje),
    accion
      ? h(
          'button',
          {
            class: 'snackbar-accion',
            onclick: async () => {
              el.classList.remove('show');
              await accion();
            },
          },
          etiquetaAccion,
        )
      : null,
  );
  el.classList.add('show');
  clearTimeout(relojSnack);
  relojSnack = setTimeout(() => el.classList.remove('show'), 6000);
}

/** Gráfico de líneas accesible con leyenda; el resumen numérico queda en una tabla aparte. */
export function graficoLineas(series, etiquetaEje) {
  const NS = 'http://www.w3.org/2000/svg';
  const svgEl = (t, a = {}, ...hijos) => {
    const e = document.createElementNS(NS, t);
    for (const [k, v] of Object.entries(a)) e.setAttribute(k, v);
    e.append(...hijos);
    return e;
  };
  const ancho = 320;
  const alto = 150;
  const margen = { izq: 4, der: 4, arr: 8, aba: 20 };
  const maxX = Math.max(1, ...series.map((s) => s.valores.length - 1));
  const maxY = Math.max(1, ...series.flatMap((s) => s.valores));
  const x = (i) => margen.izq + (i / maxX) * (ancho - margen.izq - margen.der);
  const y = (v) => margen.arr + (1 - v / maxY) * (alto - margen.arr - margen.aba);
  const svg = svgEl('svg', {
    viewBox: `0 0 ${ancho} ${alto}`,
    class: 'grafico',
    role: 'img',
    'aria-label': series.map((s) => `${s.nombre}: ${s.valores.length - 1} meses`).join('; '),
  });
  svg.append(
    svgEl('line', {
      x1: margen.izq,
      x2: ancho - margen.der,
      y1: y(0),
      y2: y(0),
      stroke: 'var(--border)',
      'stroke-width': 1,
    }),
  );
  const nota = svgEl('text', {
    x: ancho - margen.der,
    y: alto - 5,
    'text-anchor': 'end',
    fill: 'var(--muted)',
    'font-size': 10,
  });
  nota.textContent = etiquetaEje;
  svg.append(nota);
  for (const s of series) {
    const puntos = s.valores.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
    const linea = svgEl('polyline', {
      points: puntos,
      fill: 'none',
      stroke: s.color,
      'stroke-width': 2,
      'stroke-linejoin': 'round',
      'stroke-dasharray': s.punteada ? '5 4' : 'none',
    });
    svg.append(linea);
  }
  const leyenda = h(
    'div',
    { class: 'leyenda' },
    series.map((s) =>
      h(
        'span',
        { class: 'leyenda-item' },
        h('span', { class: `leyenda-marca${s.punteada ? ' punteada' : ''}`, style: { '--color': s.color } }),
        s.nombre,
      ),
    ),
  );
  return h('figure', { class: 'figura' }, svg, leyenda);
}
