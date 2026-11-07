# Brief 01: fixtures sintéticos de mensajes Bancolombia

**Objetivo:** generar `fixtures.json` con mensajes sintéticos para probar parsers.
**Puede tocar:** solo imprimir en la salida estándar. **Prohibido:** crear o editar archivos, ejecutar comandos, usar datos reales.

## Formatos verificados (ya anonimizados, la app ve exactamente esto)
Los montos usan coma de miles y punto decimal (estilo US), a veces sin decimales.
- nomina: `Bancolombia: Recibiste un pago de Nomina de EMPRESA EJEMPLO por $1,550,555.00 en tu cuenta de Ahorros el 29/10/2026 a las 13:44. Si tienes dudas, llamanos al 018000931987. A tu lado siempre.`
- pago_qr: `Bancolombia: PERSONA EJEMPLO pagaste $29,000.00 por codigo QR desde tu cuenta *1234 a la llave 0000000000 el 05/11/2026 a las 19:48. Con codigo QR es facil y de una. Dudas al 018000912345.`
- transferencia_recibida: `Bancolombia: Recibiste una transferencia por $116,500 de PERSONA EJEMPLO en tu cuenta **1234, el 01/11/2026 a las 14:23. Si tienes dudas, hablemos: 018000931987. Siempre a tu lado.`
- recarga: `Bancolombia: Recargaste 30,000.00 a Tarjeta Civica desde tu cuenta *1234 el 04/11/2026 16:52 ¿Dudas? Llama al 018000945555 y las resolvemos.`
- pago_servicio: `Bancolombia: Pagaste $5,500.00 a COMUNICACION CELULAR COMCEL S desde tu producto 1234 el 05/11/2026 07:02:40. ¿Dudas? Llamanos al 6045109095. Estamos cerca`
- transferencia_enviada: `Bancolombia: Transferiste $19,000 desde tu cuenta *1234 a la cuenta *00000000000 el 06/11/2026 a las 16:01. ¿Dudas? Llamanos al 018000931987. Estamos cerca.`

## Formatos NO verificados (plausibles; invéntalos siguiendo ese estilo)
compra_debito, compra_credito (`T.Cred *1234`), compra_diferida (N cuotas), retiro_cajero, consignacion, pago_tarjeta, avance, cuota_manejo, intereses, comision, cuatro_por_mil, iva, rechazo (compra rechazada/no exitosa).

## Formato exacto de salida
Solo un arreglo JSON, sin Markdown ni comentarios. Mínimo 6 elementos por cada uno de los 19 tipos, con variantes: `$1.234.567` y `$1,234,567.00`, `COP`, MAYÚSCULAS/minúsculas, con y sin tildes, espacios dobles, saltos de línea. Cada elemento:
`{"tipo":"<uno de los 19>","texto":"...","esperado":{"monto":<entero COP, decimales descartados si son .00>,"fecha":"AAAA-MM-DD","hora":"HH:MM" o null,"ultimos4":"NNNN" o null,"comercio":"..." o null,"cuotas":<entero> o null},"verificado":<true solo si sigue uno de los 6 formatos verificados>}`
Fechas entre 2026-01-01 y 2026-11-06. Nombres, llaves y cuentas 100 % inventados.

**Criterio de aceptación:** JSON válido, cada `esperado` coincide exactamente con su `texto`.
