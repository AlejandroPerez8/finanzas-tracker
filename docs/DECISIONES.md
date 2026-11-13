# Decisiones

## Datos
- **`type` conserva sus valores en inglés** (`income`, `expense`, `transfer_*`, `withdraw_*`) y suma `pago_tarjeta`, `interes`, `cuota_manejo`, `transferencia`, `avance`. Renombrarlos a `ingreso`/`gasto`, como pedía la especificación, obligaba a reescribir toda la app original sin ganancia para el usuario. `tipoCanonico()` da el nombre en español para los exportes.
- **Montos enteros.** La migración redondea a pesos; un valor con decimales puede variar hasta $1.
- **`estado` ausente = confirmado.** Pendientes y descartados no afectan saldos ni reportes.
- **Retiro en cajero** = `transferencia`, no gasto. Si hay cuenta de tipo efectivo, sube su saldo.
- **Transferencias recibidas y enviadas siempre pasan por revisión**, porque pueden ser a cuenta propia y contarían como ingreso o gasto.

## Deduplicación
Dos mensajes de **fuentes distintas** a ±10 min, con igual monto y tipo y comercio parecido (≥ 80 %), son un solo movimiento. Dos de la **misma fuente** son siempre movimientos distintos: así, dos compras iguales seguidas no se pierden.

## Tarjetas: supuestos de cálculo
- Tasa mensual: `(1 + EA)^(1/12) − 1`.
- Amortización de cuota fija (sistema francés). Redondeo por período; la última cuota liquida el residuo.
- **Pago mínimo estimado** = 5 % del saldo + intereses del mes, con piso de $30.000. Es una aproximación: el valor real está en el extracto.
- Una compra diferida suma **todo su valor** a la deuda desde el primer día. Los intereses se registran con el extracto; la app no los causa sola, para no inventar cifras distintas a las del banco. "+1 cuota" es manual.
- Días de corte y pago inexistentes en un mes pasan al último día.
- **Comparador CDT:** interés compuesto sobre el plazo y retención del 4 % sobre rendimientos. Sin veredicto.
- **Recurrentes:** mismo comercio, 3 meses consecutivos terminados y montos a ±15 % de la mediana.

## Delegación
- Los agentes **solo imprimen** en la salida estándar, sin acceso de escritura al repositorio. Es un aislamiento más estricto que los `git worktree` que pedía la especificación, y cumple el mismo fin.

## Dependencias
Sin dependencias en ejecución. Solo de desarrollo, con versión fija:
- `eslint` y `prettier`: calidad.
- `playwright-core`: pruebas de humo en un navegador real.

## Reportes con IA
No hay llamada directa a la API de Anthropic. La app es solo cliente, así que una clave quedaría expuesta en el navegador. Se conserva el flujo original de copiar un prompt, que ahora solo incluye agregados.

## Gráfico del simulador
Usa los colores de la marca (`#C6F135`, `#38BDF8`). El validador de paletas los marca fuera de su banda de luminosidad, aunque pasan contraste y separación por daltonismo. Se conservan por ser paleta obligatoria, con línea punteada, leyenda y tabla para que la identidad no dependa solo del color.

## Versión 6.0: rediseño y análisis

- **Verde = marca e ingresos; el gasto no va en rojo.** Pintar de rojo cada gasto hace que todo
  parezca una alarma. El rojo se reserva para lo que pide actuar.
- **Fuente servida por la app** (Manrope, licencia OFL) en vez de Google Fonts: funciona sin
  conexión, la app no hace ninguna petición a terceros al abrir y la CSP no necesita excepciones.
- **Filas con `<details>`**: las acciones de cuentas, bolsillos y movimientos viven dentro de la
  fila. Es nativo, accesible con teclado y deja espacio para el nombre en pantallas de 320 px.
- **Cierre estimado del mes**: lo fijo (recurrentes detectados que aún no llegan) se suma completo y
  lo variable se proyecta con el ritmo diario. Antes del día 10 ese ritmo se mezcla con el promedio
  histórico, porque un solo gasto grande el día 1 daría una proyección absurda.
- **Abono a deudas en dos movimientos**: `pago_deuda` (capital; no es gasto) e `interes` (gasto).
  El interés sugerido es el de un mes sobre el saldo; el usuario lo ajusta con su extracto.
- **Puntaje de salud**: promedio simple de los indicadores con datos (bien 100, atención 55,
  actúa 15). Sin datos no hay puntaje: no se inventa una nota.
- **Patrimonio histórico**: se reconstruye con los movimientos hasta cada cierre. Tarjetas y deudas
  usan su saldo inicial registrado aunque se hayan creado después; es una aproximación declarada.
- **Sin SMS**: la única fuente automática es Gmail. El pegado manual se conserva como respaldo.
