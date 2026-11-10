# Cambios

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
