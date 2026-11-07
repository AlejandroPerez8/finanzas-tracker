# Brief 05: CSS de componentes nuevos
Objetivo: CSS plano para una PWA móvil oscura. Solo imprime CSS, sin Markdown; no crees archivos ni ejecutes comandos. Variables ya definidas: --bg --surface --surface-2 --accent --accent-dim --bonus --warn --warn-dim --amber --text --muted --border --radius --font-mono. Objetivos táctiles ≥ 48 px; foco visible con outline 2px de --accent; respeta prefers-reduced-motion. Sin frameworks, sin !important, sin @import.
Clases exactas a definir:
.nav-inferior (fija abajo, 5 botones iguales, safe-area-inset-bottom, fondo --surface, borde superior), .nav-btn, .nav-btn[aria-current="page"], .nav-badge (contador rojo pequeño),
.esqueleto (shimmer de carga), .vacio (estado vacío centrado con .vacio-titulo y .vacio-texto),
.snackbar (abajo sobre la navegación, con botón .snackbar-accion), .tarjeta-visual (tarjeta de crédito con degradado oscuro y borde, .tv-alias .tv-numero .tv-cifras), .barra-uso con .barra-uso-relleno y modificadores .verde .ambar .rojo,
.panel-kpis (rejilla 2 columnas) con .kpi .kpi-valor .kpi-etiqueta, .fila-pendiente (tarjeta de movimiento con .fp-monto .fp-detalle .fp-acciones), .chip y .chip-aviso .chip-urgente, .fab (botón flotante redondo de 56 px a la derecha, encima de la navegación), .overlay-pin (pantalla completa) con .pin-caja,
body.discreto .monto (difumina montos), .subtabs con .subtab y .subtab[aria-selected="true"], .formulario (columna con separación 10px).
Criterio: CSS válido, solo esas clases.
