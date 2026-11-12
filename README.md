# Finanzas Tracker

PWA de finanzas personales para Colombia. Los datos viven en tu dispositivo: sin backend, sin servidor, sin que tu información salga del navegador.

## Qué hace

- Cuentas, bolsillos, metas de ahorro y CDT, con saldos que se recalculan solos a partir del historial de movimientos (nada se guarda como número suelto).
- **Ingesta automática de Bancolombia** (Gmail y SMS): reconoce los mensajes del banco, los categoriza y los concilia, sin copiar nada a mano.
- **Tarjetas y deudas**: cupos, ciclos de corte y pago, amortización de cuota fija real (sistema francés), y simulador avalancha/bola de nieve para decidir cómo pagar más rápido.
- **Comparador con CDT**: qué conviene más, pagar la tarjeta o invertir, con la retención de impuestos ya incluida en la cuenta.
- Reportes mensuales con análisis local (sin IA, sin conexión) y exportación lista para Power BI.
- Seguridad pensada desde el diseño: CSP estricta, PIN, modo discreto y copias de respaldo cifradas. Ver [Seguridad](docs/SEGURIDAD.md).

## Capturas

<!-- Pendiente: corre `npm start`, abre http://localhost:8787/ y toma una captura de cada pestaña
     (Inicio, Tarjetas, Ahorro, Movimientos). Guárdalas en una carpeta `capturas/` y enlázalas aquí:
     ![Panel](capturas/panel.png) ![Tarjetas](capturas/tarjetas.png) -->

## Ejecutar
```bash
npm install
npm start        # App y mock del script en http://localhost:8787/
npm run check    # Lint, pruebas y cobertura (≥ 85 % en domain y services)
npm run test:smoke   # Navegador real (ajusta CHROMIUM si hace falta)
```
Para producción sirve la carpeta en HTTPS (GitHub Pages sirve tal cual).

**Al publicar una versión**, cambia `VERSION` en `service-worker.js` y agrega cualquier archivo nuevo a `APP_SHELL`.

## Documentación
- [Conectar la ingesta](docs/GUIA_INGESTA.md)
- [Contrato del endpoint](docs/API_INGESTA.md)
- [Arquitectura](docs/ARQUITECTURA_ACTUAL.md) y [decisiones](docs/DECISIONES.md)
- [Seguridad](docs/SEGURIDAD.md)
- [Power BI](docs/EXPORT_POWERBI.md)
- [Hoja de ruta](docs/ROADMAP.md) y [cambios](CHANGELOG.md)

Los formatos de mensajes se editan en `js/parsers/bancolombia/patrones.json`, sin tocar código.

## Estructura

```
finanzas-tracker/
├── index.html, manifest.json, service-worker.js
├── css/                    estilos base y componentes
├── js/
│   ├── app.js              pantallas originales (cuentas, ahorro, historial, reportes)
│   ├── db.js               IndexedDB con respaldo en localStorage
│   ├── domain/             reglas de dinero puras: montos, fechas, tarjetas, deudas, presupuesto
│   ├── parsers/            reconocimiento de mensajes; formatos en bancolombia/patrones.json
│   ├── services/           ingesta, sincronización, deduplicación, respaldos, exportes
│   └── ui/                 pantallas nuevas (panel, tarjetas, revisión de movimientos)
├── data/comercios.json     diccionario comercio → categoría
├── integraciones/apps_script/  script de Gmail/SMS y su mock local
├── tests/                  unitarias, integración y humo en navegador
└── docs/                   arquitectura, contrato, seguridad, decisiones
```

### Asociar mensajes a tus cuentas
En cada cuenta registra **dos** juegos de dígitos: los últimos 4 de la cuenta (aparecen en
transferencias, pagos QR y recargas) y los de la **tarjeta débito** (aparecen como `T.Deb **1234`
en compras y retiros). Para que un retiro en cajero se registre solo, crea además una cuenta de
tipo **Efectivo**: el retiro mueve el dinero del banco a efectivo y no cuenta como gasto.

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

Al publicar cambios, sube `VERSION` en `service-worker.js` (y agrega a `APP_SHELL` cualquier
archivo nuevo). Si no lo haces, el celular seguirá mostrando la versión guardada en caché.

## Sobre tus datos

Los datos se guardan **solo en tu dispositivo/navegador** (IndexedDB +
respaldo en localStorage). No se envían a ningún servidor. Si cambias de
celular, de navegador, o borras datos de navegación, perderás la información
a menos que uses el backup JSON (exportar/importar) dentro de la propia app.

---

## Notas de una migración anterior (v4 → v5)

Esta sección documenta decisiones y correcciones de cuando el proyecto pasó de un
único `index.html` monolítico a la estructura modular actual. Se conserva como
referencia histórica; el estado y las decisiones vigentes están en
[Arquitectura](docs/ARQUITECTURA_ACTUAL.md), [Decisiones](docs/DECISIONES.md) y
[Cambios](CHANGELOG.md).

### Refactor v4 — lo nuevo

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

### Qué se corrigió en esta versión

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
