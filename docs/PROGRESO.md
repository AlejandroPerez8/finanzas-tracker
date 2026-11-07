# Bitácora

## Estado: todas las fases implementadas (2026-11-07)

| Fase | Resultado |
|---|---|
| 1. Fundamentos | Código modular, dinero en enteros, migraciones con respaldo, lint, pruebas, diagnóstico |
| 2. Modelo de datos | Esquema v2 con migración probada contra un export v4 |
| 3. Ingesta | Script desplegado, sincronización, parsers, deduplicación, conciliación, pegado manual |
| 4. Tarjetas y deudas | Tarjetas, cuotas, alertas, simulador, flujo de caja, comparador CDT |
| 5. Presupuesto y reportes | Presupuestos, recurrentes, panel, prompt solo con agregados, Power BI |
| 6. UX | Navegación inferior, offline, deshacer, estados vacíos, entrada rápida, guía inicial |
| 7. Seguridad | CSP, escape, validación, PIN, modo discreto, copias cifradas |
| 8. Pruebas y docs | Unitarias, integración, humo en navegador real; documentación completa |

## Decisiones durante la noche
- La especificación dejaba el script fuera de alcance, pero el usuario pidió crearlo: se desplegó con `clasp`.
- Los montos de los correos reales usan coma de miles y a veces coma decimal. `interpretarMonto` acepta ambos.
- **Verificación con 25 correos reales:** 24 se reconocen; el otro es publicidad y se filtra. Esa prueba no confirmó nada en el servidor, no guardó textos y solo imprimió totales y plantillas enmascaradas.

## Delegaciones
| Brief | Agente | Resultado | Correcciones |
|---|---|---|---|
| 01 Fixtures | opencode, DeepSeek 4.1 Flash | 114 casos utilizables | JSON truncado en un caso, recuperado por programa. Sus formatos no verificados son plausibles, no reales |
| 02 Comercios | agy, Gemini 4 Argon | 452 comercios | Revisión de muestra; sin cambios |
| 03 Revisión cruzada | agy, Gemini 4 Argon | 12 hallazgos reales, todos corregidos con pruebas | Ninguno era falso |
| 03 Revisión cruzada | opencode, DeepSeek 4.1 Flash | Sin salida: el proceso terminó vacío | Se relanzó con alcance menor (brief 06) |
| 04 Guía | agy, Gemini 3.8 Flash | Borrador | Reescrita en buena parte: afirmaba que los datos no pasan por terceros, usaba hora local con `Z`, sugería WhatsApp para el token y citaba menús inexistentes |
| 05 CSS | opencode, DeepSeek 4.1 Flash | Base de componentes | Tarjeta con proporción fija que recortaba contenido y filas mal distribuidas; corregidas |
| 06 Revisión de pantallas | opencode, DeepSeek 4.1 Flash | Ver abajo | |

Los agentes solo imprimieron texto, sin acceso de escritura, y nunca recibieron tokens ni datos reales.

## Pendientes
Ver `docs/RESUMEN_FINAL.md` y `docs/PREGUNTAS_PENDIENTES.md`.
