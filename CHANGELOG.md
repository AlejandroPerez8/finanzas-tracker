# Cambios

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
