# Exportación para Power BI

En **Más > Exportar**: 6 archivos CSV (UTF-8 con BOM) o un JSON con las mismas tablas. Solo incluye movimientos vigentes; excluye pendientes y descartados, textos de mensajes, tokens y últimos 4.

| Tabla | Tipo | Columnas |
|---|---|---|
| `movimientos` | Hechos | id, fecha, hora, monto, tipo, cuenta_id, cuenta_destino_id, tarjeta_id, categoria, comercio, origen, es_cuota |
| `cuentas` | Dimensión | id, nombre, tipo, saldo |
| `categorias` | Dimensión | categoria |
| `tarjetas` | Dimensión | id, alias, banco, cupo_total, saldo, tasa_ea |
| `deudas` | Dimensión | id, nombre, tipo, saldo, tasa_ea |
| `calendario` | Dimensión | fecha, anio, mes, anio_mes, dia, dia_semana |

**Relaciones:** `movimientos.fecha` → `calendario.fecha`; `cuenta_id` → `cuentas.id` (activa); `cuenta_destino_id` → `cuentas.id` (inactiva, úsala con `USERELATIONSHIP`); `tarjeta_id` → `tarjetas.id`; `categoria` → `categorias.categoria`.

**Tipos en `movimientos.tipo`:** ingreso, gasto, abono, abono_salida, retiro, retiro_entrada, transferencia, pago_tarjeta, avance, interes, cuota_manejo. Para gasto real, filtra `gasto`, `interes` y `cuota_manejo`.

Las celdas que empiezan por `=`, `+`, `-` o `@` llevan un apóstrofo, para que Excel no las ejecute como fórmula.

**Saldo por cuenta desde el exporte:** `monto` siempre es positivo; el tipo da el signo. Sobre
`cuenta_id` suman `ingreso`, `retiro_entrada` y `avance`, y restan `gasto`, `interes`, `cuota_manejo`
(solo si `tarjeta_id` está vacío), `pago_tarjeta`, `abono_salida` y `transferencia`. Una
`transferencia` (por ejemplo un retiro en cajero) además **suma** a `cuenta_destino_id`. Así cuadra
el saldo del efectivo con el de la app.
