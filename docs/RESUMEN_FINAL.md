# Resumen final

## Qué se logró
Versión 5.0.0, en la rama local `feat/ingesta-apps-script-y-tarjetas`. **No se ha subido a GitHub: la app publicada no ha cambiado.**

- **Script desplegado:** lee Gmail cada 10 minutos, recibe SMS y responde con token.
- **Ingesta:** sincronización, parsers, deduplicación, revisión, conciliación, "enseñar a la app" y pegado sin conexión.
- **Tarjetas y deudas:** pasivos, cuotas, alertas, simulador, flujo de caja y comparador con CDT.
- **Producción:** enteros, migración con respaldo, CSP, PIN, copias cifradas, offline, Power BI.

## Cómo correrla
```bash
npm install
npm start            # http://localhost:8787/
npm run check        # lint, pruebas y cobertura
npm run test:smoke   # navegador real
```

## Verificación
- 198 pruebas en verde. Cobertura de `domain` y `services`: 99,9 % de líneas, 94,5 % de ramas.
- 5 flujos de humo en Chromium: migración v4, mensaje → pendiente → ack, tarjeta, offline con Service Worker, móvil sin desbordes.
- Endpoint real: responde y rechaza tokens falsos.
- 25 correos reales de la última semana: 24 reconocidos con confianza ≥ 95 % y 1 de publicidad filtrado. Se probó sin confirmarlos, así que siguen esperando en la hoja.

## Sin verificar
- Un celular real. Las pruebas usan Chromium con tamaño de móvil, sin iPhone ni PWA instalada.
- La guía de SMS (MacroDroid, Tasker, Atajos). El endpoint de SMS solo se probó contra el mock, no contra el script real.
- La ejecución periódica del disparador. La primera captura sí funcionó.
- Los presupuestos de rendimiento (< 2 s, < 100 ms): no se midieron. Tampoco hubo auditoría automática de accesibilidad.
- Formatos de tarjeta de crédito y cobros: no había correos reales de esos tipos. Sus patrones son suposiciones y esos mensajes pasarán por revisión.

## Qué debes hacer
1. **Publicar:** revisa la rama y súbela al repositorio de GitHub Pages. El repositorio es de otra cuenta, así que necesitarás sus permisos.
2. **Conectar:** sigue `docs/GUIA_INGESTA.md`. La URL y el token están en `.local/ingesta.env`.
3. **Configurar:** escribe los últimos 4 dígitos de tu cuenta y crea tus tarjetas.
4. **Limpiar la cuenta equivocada** (la cuenta de Gmail de prueba que se usó antes de la definitiva; no se nombra aquí porque este repositorio es público): borra el proyecto *Finanzas Tracker - Ingesta* y su hoja, y quita sus accesos en `myaccount.google.com/permissions`. Su disparador sigue activo.
5. **Reducir permisos de `clasp`:** tiene permisos que ya no necesita. Si no vas a redesplegar, quita su acceso en la cuenta actual.

## Riesgos conocidos
- El permiso de Gmail cubre toda la bandeja de la cuenta. Conviene una cuenta dedicada con reenvío.
- El PIN no cifra los datos locales.
- El pago mínimo es una estimación, y los intereses se registran con el extracto.
- La hoja de Google conserva los textos 30 días después de importados.

## Omitido a propósito
- Simulador de laddering: la especificación lo daba por existente, pero no estaba en el código. Queda en `docs/ROADMAP.md`.
- WebAuthn y sugerencia de categoría por IA: opcionales, requieren más infraestructura.
- Llamada directa a la API de Anthropic: expondría la clave en el navegador.
- `git worktree` para los agentes: solo imprimieron texto, sin acceso de escritura.
