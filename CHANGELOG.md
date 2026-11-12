# Cambios

## 5.3.1
### Corregido
- El aviso de "efectivo sin rastrear" no partía líneas y desbordaba la pantalla de Inicio 688 px
  hacia la derecha. Encontrado al verificar la 5.3.0 publicada.

### Nuevo
- `npm run test:vivo`: verificación de punta a punta contra la app publicada (o `VIVO_URL`), con
  los mensajes reales de Bancolombia, en un perfil temporal de Chrome.

## 5.3.0
### Nuevo
- **Salud financiera** en Inicio (`js/domain/salud.js`): fondo de emergencia (meses de gastos
  cubiertos por cuentas, efectivo y bolsillos), tasa de ahorro promedio, uso de tarjetas y carga
  de deuda (pagos mínimos frente al ingreso). Cada indicador trae su meta, un estado
  (Bien / Atención / Actúa) y qué hacer con cifras concretas. Usa promedios de los últimos 3
  meses cerrados para que un mes a medias no distorsione.
- **"Puedes gastar hoy"**: lo que queda de tus presupuestos (o, sin presupuestos, del 80 % de tu
  ingreso promedio) dividido entre los días que faltan del mes.

## 5.2.0
### Nuevo
- Retiros en cajero con el formato real de Bancolombia ("Retiraste $X en CAJERO de tu T.Deb **1234 el …"),
  que antes llegaba a "No reconocidos". Patrón `retiro_cajero_verificado`, confianza 0.95.
- Cada cuenta acepta los últimos 4 de la **tarjeta débito** además de los de la cuenta: compras y
  retiros traen los de la T.Deb, y transferencias y pagos los de la cuenta. Al confirmar a mano un
  mensaje con dígitos desconocidos, la cuenta los aprende.
- Aviso de **efectivo sin rastrear** en el panel: lo retirado en el mes frente a lo registrado como
  gasto en efectivo. Un retiro no es gasto, así que sin este aviso la tasa de ahorro se veía inflada.
- El CDT muestra rendimiento bruto, retención en la fuente (4 %) y el **neto** que llega a la cuenta.

### Corregido
- Compras con el formato "Compraste $X con tu tarjeta … en COMERCIO" guardaban "CON" como comercio,
  lo que dañaba la categorización. Las pruebas de fixtures ahora verifican el comercio.
- En revisión ya no se puede confirmar una transferencia sin cuenta de destino (el dinero salía de la
  cuenta sin llegar a ninguna parte) ni con origen igual al destino.
- La rueda de inicio decía "0 %" de ahorro mientras el panel decía "-420 %": ambas usan ahora el
  mismo texto, y un déficit mayor al 100 % se muestra como "Déficit".
- `db.js`: si IndexedDB fallaba y localStorage no, la siguiente carga leía la versión vieja.
- Subpestañas de revisión en cuadrícula 2×2 ("Importar" quedaba oculta en 390 px) y textos de
  formulario que se cortaban.
- `VERSION_APP` decía 5.0.1 con la app en 5.1.0.

### Cambiado
- Los parsers (`js/parsers/**`) entran en el umbral de cobertura de `npm run check`.
- **Token fuera de la URL:** `ping`, `pending` y `ack` viajan por POST con el token en el cuerpo
  (`text/plain`, sin preflight). Con un `Code.gs` anterior, la app detecta el `bad_request` y usa
  GET, así que sigue funcionando hasta que se actualice el script (ver `docs/GUIA_INGESTA.md`, 6b).
- **La hoja de ingesta ya no crece sin límite:** la purga diaria elimina las filas importadas con
  más de 90 días (`DIAS_ARCHIVO`). El cursor pasa a ser el número del último `rowId`, que coincide
  con el valor anterior y no se corre al archivar; los `rowId` salen de la propiedad `ULTIMO_ROW`.
- Pruebas de `Code.gs` con dobles de las APIs de Apps Script (`tests/integration/apps_script.test.js`).

## 5.1.0
### Nuevo
- Combobox táctil (`js/ui/combobox.js`) para categoría y comercio en iOS Safari, que no muestra
  sugerencias de `<datalist>`. Solo se activa en iOS; en el resto de navegadores sigue igual.
- Licencia MIT (`LICENSE`).

### Cambiado
- `style-src` de la CSP ya no incluye `'unsafe-inline'`: todos los estilos dinámicos pasan por
  CSSOM (`el.style.setProperty`) y los estilos fijos que antes iban como atributo `style=""` ahora
  son clases en `css/componentes.css`.
- README reordenado: la propuesta de valor y el espacio para capturas quedan antes de las
  instrucciones de instalación; las notas de la migración v4 → v5 se movieron al final.

### Corregido
- Se quitó del repositorio (público) el correo de una cuenta de prueba que había quedado
  documentado en `docs/RESUMEN_FINAL.md`.

## 5.0.1
### Cambiado
- Nueva paleta de color: violeta como acento de marca (antes verde lima), verde reservado para ingresos/estados positivos, rojo para gastos/peligro, ámbar para precaución. Los mensajes puramente informativos (antes azules) pasan al acento violeta en vez de compartir color con los ingresos.
- Los colores por categoría de gasto y el gráfico avalancha/bola de nieve ahora usan un conjunto fijo de tonos validados por contraste y daltonismo, en vez de un tono aleatorio por texto.
- Ícono de la app (`icons/icon-192.png`, `icons/icon-512.png`) regenerado en violeta para combinar con la nueva paleta; mismo motivo de barras ascendentes y resplandor neón.

## 5.0.0
### Nuevo
- Ingesta de Bancolombia por Gmail y SMS, con script de Apps Script, deduplicación, revisión, conciliación y pegado manual.
- Tarjetas de crédito, compras a cuotas, deudas, simulador avalancha y bola de nieve, flujo de caja y comparador con CDT.
- Panel de patrimonio, presupuesto por categoría, detección de recurrentes y exportación para Power BI.
- PIN, modo discreto, copias cifradas, diagnóstico y navegación inferior.

### Cambiado
- Montos en enteros (migración automática con respaldo previo).
- Código separado en módulos, con CSP y sin scripts en línea.
- El prompt de reportes solo incluye agregados.
- Actualización controlada de la app.

### Corregido
- Nombres sin escapar en varias pantallas.
- La importación de copias ahora valida el archivo y migra su formato.
- Errores de guardado que antes se perdían sin aviso.
