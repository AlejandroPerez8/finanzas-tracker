# Arquitectura

## Punto de partida (v4)
El repositorio era un solo `index.html` de 1.970 líneas con CSS y JS en línea, más `service-worker.js` y `manifest.json`. Los datos eran un JSON bajo la clave `finance-data`, en IndexedDB (`finanzas-tracker-db`, almacén `kv`) y localStorage.

La especificación mencionaba `js/db.js`, `js/ui.js`, `js/ladder.js` y una llamada a la API de Anthropic. **Nada de eso existía**: no había simulador de laddering, y los reportes eran locales o por copiar y pegar un prompt.

## Estructura actual (v5)
```
index.html            Marcado, sin scripts en línea (CSP)
css/                  styles.css (original), componentes.css (nuevo)
js/app.js             Pantallas originales, extraídas casi sin cambios
js/db.js              Persistencia y arranque de migraciones
js/domain/            Reglas puras: money, fechas, movimientos, tarjetas, deudas, presupuesto, salud
js/services/          ingesta, sync, deduplicacion, categorizacion, conciliacion, migraciones, backup, reportes, exportacion, registro
js/parsers/           registry.js y bancolombia/ (patrones.json editable)
js/ui/                Pantallas nuevas; dom.js nunca usa innerHTML
data/comercios.json   Diccionario inicial comercio → categoría
integraciones/apps_script/  Code.gs desplegado y mock local
tests/                unit, integration, smoke, fixtures
```
`js/app.js` conserva `innerHTML` con plantillas: todo dato variable pasa por `escapeAttr`. Migrarlo a `dom.js` queda en el ROADMAP.
