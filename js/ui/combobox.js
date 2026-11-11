/**
 * Safari en iOS no muestra el desplegable de sugerencias de <datalist> en inputs de texto.
 * Esto dibuja una lista propia sobre cualquier <input list="..."> existente, leyendo las
 * mismas <option> que ya puebla app.js/ingesta.js/panel.js, sin tocar esos archivos.
 */

const esIOS = () =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

function opcionesDe(input) {
  const datalist = document.getElementById(input.getAttribute('list'));
  if (!datalist) return [];
  const texto = input.value.trim().toLowerCase();
  const vistos = new Set();
  const resultado = [];
  for (const opcion of datalist.options) {
    const valor = opcion.value;
    if (!valor || vistos.has(valor)) continue;
    if (texto && !valor.toLowerCase().includes(texto)) continue;
    vistos.add(valor);
    resultado.push(valor);
    if (resultado.length >= 8) break;
  }
  return resultado;
}

function activarUno(input) {
  if (input.dataset.comboboxListo) return;
  input.dataset.comboboxListo = '1';
  input.setAttribute('autocomplete', 'off');

  const caja = document.createElement('div');
  caja.className = 'combobox-sugerencias';
  caja.hidden = true;
  document.body.appendChild(caja);

  const posicionar = () => {
    const r = input.getBoundingClientRect();
    caja.style.setProperty('left', `${r.left}px`);
    caja.style.setProperty('top', `${r.bottom + 2}px`);
    caja.style.setProperty('width', `${r.width}px`);
  };
  const cerrar = () => {
    caja.hidden = true;
    caja.replaceChildren();
  };
  const render = () => {
    const opciones = opcionesDe(input);
    if (!opciones.length) return cerrar();
    posicionar();
    caja.replaceChildren(
      ...opciones.map((valor) => {
        const item = document.createElement('div');
        item.className = 'combobox-item';
        item.textContent = valor;
        item.addEventListener('mousedown', (e) => {
          e.preventDefault();
          input.value = valor;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          cerrar();
        });
        return item;
      }),
    );
    caja.hidden = false;
  };
  input.addEventListener('input', render);
  input.addEventListener('focus', render);
  input.addEventListener('blur', () => setTimeout(cerrar, 100));
  window.addEventListener('scroll', () => { if (!caja.hidden) posicionar(); }, true);
  window.addEventListener('resize', () => { if (!caja.hidden) posicionar(); });
}

/** Activa (o reactiva sobre nodos nuevos) el combobox en todos los input[list] del documento. */
export function activarCombobox() {
  if (!esIOS()) return;
  document.querySelectorAll('input[list]').forEach(activarUno);
  new MutationObserver((mutaciones) => {
    for (const m of mutaciones) {
      for (const nodo of m.addedNodes) {
        if (nodo.nodeType !== 1) continue;
        if (nodo.matches?.('input[list]')) activarUno(nodo);
        nodo.querySelectorAll?.('input[list]').forEach(activarUno);
      }
    }
  }).observe(document.body, { childList: true, subtree: true });
}
