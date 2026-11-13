/**
 * Iconos de línea propios (24 × 24, trazo de 1,8). Van en el código para no depender de fuentes de
 * iconos ni de emojis, que cambian de un celular a otro. Siempre son decorativos: el texto o el
 * `aria-label` del control dice qué hace.
 */

const NS = 'http://www.w3.org/2000/svg';
const p = (d) => ['path', { d }];
const c = (cx, cy, r) => ['circle', { cx, cy, r }];
const r = (x, y, width, height, rx) => ['rect', { x, y, width, height, rx }];

const ICONOS = {
  inicio: [p('M3 11.5 12 4l9 7.5'), p('M5.5 10v10h13V10'), p('M10 20v-5h4v5')],
  movimientos: [p('M7 20V4'), p('m3 8 4-4 4 4'), p('M17 4v16'), p('m13 16 4 4 4-4')],
  tarjeta: [r(3, 5, 18, 14, 3), p('M3 10h18'), p('M7 15h3')],
  ahorro: [c(12, 12, 9), c(12, 12, 5), c(12, 12, 1)],
  mas: [p('M4 7h16'), p('M4 12h16'), p('M4 17h16')],
  sumar: [p('M12 5v14'), p('M5 12h14')],
  ojo: [p('M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z'), c(12, 12, 3)],
  ojoCerrado: [
    p('m3 3 18 18'),
    p('M10.6 5.1c.5-.1.9-.1 1.4-.1 6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.1'),
    p('M6.5 6.6C3.7 8.4 2 12 2 12s3.5 7 10 7c1.6 0 3-.4 4.3-1'),
    p('M9.9 9.9a3 3 0 0 0 4.2 4.2'),
  ],
  editar: [p('M4 20h4L19 9l-4-4L4 16v4Z'), p('m13.5 6.5 4 4')],
  duplicar: [r(8, 8, 12, 12, 2.5), p('M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2')],
  eliminar: [p('M4 7h16'), p('M9 7V4h6v3'), p('m6 7 1 13h10l1-13'), p('M10 11v5'), p('M14 11v5')],
  banco: [p('m3 10 9-6 9 6'), p('M5 10v8'), p('M9.7 10v8'), p('M14.3 10v8'), p('M19 10v8'), p('M3 20h18')],
  efectivo: [r(2, 6, 20, 12, 2.5), c(12, 12, 2.5), p('M6 12h.01'), p('M18 12h.01')],
  billetera: [
    p('M3 7a2 2 0 0 1 2-2h12v4'),
    p('M3 7v10a2 2 0 0 0 2 2h15V9H5a2 2 0 0 1-2-2Z'),
    p('M16.5 14h.01'),
  ],
  bolsillo: [p('M5 8h14v7a5 5 0 0 1-5 5h-4a5 5 0 0 1-5-5V8Z'), p('M9 8V6a3 3 0 0 1 6 0v2')],
  traslado: [p('M4 8h14'), p('m14 4 4 4-4 4'), p('M20 16H6'), p('m10 12-4 4 4 4')],
};

const ATRIBUTOS = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  'stroke-width': '1.8',
  'stroke-linecap': 'round',
  'stroke-linejoin': 'round',
  'aria-hidden': 'true',
  focusable: 'false',
};

/** Icono como nodo SVG. Un nombre desconocido devuelve un SVG vacío, nunca un error. */
export function icono(nombre) {
  const svg = document.createElementNS(NS, 'svg');
  for (const [k, v] of Object.entries(ATRIBUTOS)) svg.setAttribute(k, v);
  for (const [etiqueta, attrs] of ICONOS[nombre] ?? []) {
    const el = document.createElementNS(NS, etiqueta);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    svg.append(el);
  }
  return svg;
}

/** El mismo icono como texto HTML, para las plantillas de app.js. Solo usa valores de este archivo. */
export function iconoHtml(nombre) {
  const attrs = (o) =>
    Object.entries(o)
      .map(([k, v]) => `${k}="${v}"`)
      .join(' ');
  const hijos = (ICONOS[nombre] ?? []).map(([etiqueta, a]) => `<${etiqueta} ${attrs(a)}/>`).join('');
  return `<svg ${attrs(ATRIBUTOS)}>${hijos}</svg>`;
}
