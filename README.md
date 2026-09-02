# Finanzas Tracker — PWA

Aplicación web de finanzas personales, lista para GitHub Pages.

## Refactor v4 — lo nuevo

- **Abonos/retiros con doble contabilidad**: al abonar a un bolsillo, meta o
  CDT ahora eliges obligatoriamente una cuenta de origen. Cada abono/retiro
  se guarda como dos movimientos enlazados por un `transferencia_id`, así que
  el saldo de la cuenta y el del recurso siempre cuadran. Si la cuenta de
  origen no alcanza a cubrir el abono, aparece una advertencia antes de
  confirmar.
- **Todo editable, todo recalculable**: los saldos de cuentas, bolsillos,
  metas y CDT ya no se guardan como números sueltos — se calculan sumando
  sus movimientos. Por eso cualquier movimiento del historial (ingreso,
  gasto, abono o retiro) se puede editar, duplicar o eliminar, y los saldos
  se recalculan solos.
- **Categorías libres**: los campos de categoría ahora son de texto libre
  con sugerencias (autocompletado) basadas en lo que ya has escrito antes,
  en vez de una lista cerrada.
- **Paleta y accesibilidad**: nueva paleta de bajo contraste para lecturas
  largas, botones y campos con altura mínima de 48px para el pulgar, y las
  barras de gastos por categoría ahora tienen un color distinto por
  categoría (generado automáticamente a partir del texto).
- **Alertas de CDT escalonadas**: aviso a 30, 15 y 5 días antes del
  vencimiento, con más urgencia entre más cerca esté la fecha.

## Qué se corrigió en esta versión

1. **Ícono "G" genérico** → el `manifest.json` apuntaba a `./icons/icon-192.png` y
   `./icons/icon-512.png`, pero esos archivos nunca se subieron al repositorio como
   archivos reales (solo existían como imagen incrustada dentro de `index.html`
   para el favicon). El navegador no encontraba los íconos del manifest y
   generaba uno automático con la inicial del nombre.
   → Ahora la carpeta `icons/` con los PNG reales viene incluida. Solo tienes
   que subir la estructura completa tal cual está aquí.

2. **No guardaba los datos al reabrir la app** → la app usaba `window.storage`,
   que es un mecanismo exclusivo del entorno donde se construyó (no existe en un
   sitio publicado en GitHub Pages ni en ningún navegador normal).
   → Ahora usa **IndexedDB** como almacenamiento principal (persistente en el
   dispositivo) con **localStorage** como respaldo automático si IndexedDB no
   está disponible (por ejemplo, en modo incógnito). Tus registros ahora sí
   sobreviven al cerrar y reabrir la app.

3. **Reportes con IA** → la app intenta pedir el análisis mensual a la API de
   Anthropic directamente desde el navegador. Eso funciona dentro del entorno
   de Claude, pero **no funcionará en GitHub Pages** porque no hay una clave de
   API configurada ahí. Para que la sección de reportes no quede vacía, si esa
   llamada falla la app genera automáticamente un **análisis local básico**
   (reglas simples, sin IA) con tu tasa de ahorro, categoría de mayor gasto y
   recomendaciones. Si más adelante quieres que el análisis con IA real
   funcione en la web publicada, se necesita un pequeño backend propio que
   guarde la clave de API (nunca debe ir la clave dentro del HTML público).

## Estructura

```
finanzas-tracker/
├── index.html
├── manifest.json
├── service-worker.js
└── icons/
    ├── icon-192.png
    └── icon-512.png
```

## Publicar en GitHub Pages

1. Crea un repositorio en GitHub (o usa el que ya tienes).
2. Sube **todos** los archivos de esta carpeta a la raíz del repositorio,
   **conservando la carpeta `icons/`** (no subas los PNG sueltos en la raíz).
3. Ve a **Settings → Pages**.
4. En **Build and deployment**, selecciona **Deploy from a branch**.
5. Selecciona la rama `main` y la carpeta `/ (root)`.
6. Guarda y espera el despliegue (puede tardar 1-2 minutos).
7. Abre la URL HTTPS que te entregue GitHub Pages.

Las rutas del `manifest.json` y del `service-worker.js` son relativas (`./`),
así que funcionan igual si tu sitio queda en `usuario.github.io` o en
`usuario.github.io/nombre-repo/` — no hace falta cambiar nada según el nombre
del repositorio.

## Instalación en el celular

- **Android (Chrome/Edge):** abre la URL, el navegador debería ofrecer
  "Instalar app" automáticamente, o puedes buscarlo en el menú ⋮.
- **iPhone/iPad (Safari):** botón compartir → "Añadir a pantalla de inicio".

## Actualizaciones futuras

Cuando cambies `index.html` u otro archivo estático, sube de nuevo el
`service-worker.js` incrementando `CACHE_NAME` (por ejemplo de `v2` a `v3`).
Si no lo haces, algunos usuarios pueden seguir viendo la versión antigua
cacheada por un tiempo.

## Sobre tus datos

Los datos se guardan **solo en tu dispositivo/navegador** (IndexedDB +
respaldo en localStorage). No se envían a ningún servidor. Si cambias de
celular, de navegador, o borras datos de navegación, perderás la información
a menos que uses el backup JSON (exportar/importar) dentro de la propia app.
