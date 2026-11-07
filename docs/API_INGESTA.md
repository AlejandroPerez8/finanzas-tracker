# Contrato del endpoint de ingesta (versión 1)

Implementado por `integraciones/apps_script/Code.gs` y `integraciones/apps_script/mock/server.js`.

Base: `https://script.google.com/macros/s/<ID>/exec`. Siempre usar `fetch(url, { redirect: 'follow' })`.

**Autenticación:** Apps Script no lee cabeceras personalizadas, así que el token viaja como parámetro. Mínimo 32 caracteres. **Riesgo:** una URL con token puede quedar en registros o en el historial; por eso se puede rotar con `rotarToken()` y la app lo enmascara y no lo escribe en su registro.

## Probar conexión (extensión de esta implementación)
`GET ?action=ping&token=T` → `{ "ok": true, "version": 1, "serverTime": "…", "pendientes": 3 }`

## Consultar nuevos
`GET ?action=pending&token=T&cursor=C&limit=50` (`limit` entre 1 y 100)
```json
{ "ok": true, "version": 1, "serverTime": "2026-11-07T08:00:00-05:00", "cursor": "123",
  "items": [{ "rowId": "r_000123", "source": "gmail", "messageId": "opaque-id",
    "receivedAt": "2026-11-07T07:58:12-05:00", "senderTag": "bancolombia",
    "textoRelevante": "Máximo 600 caracteres, sin enlaces" }] }
```
Solo devuelve filas sin confirmar. El cursor es opaco. Una respuesta sin elementos significa que no hay más.

## Confirmar importados
`GET ?action=ack&token=T&ids=r_000123,r_000124` → `{ "ok": true, "acked": 2 }`. Es idempotente. La app solo lo llama **después de guardar**.

## Recibir SMS
`POST` con `Content-Type: text/plain` y cuerpo JSON como texto, para evitar el preflight de CORS:
```json
{ "token": "T", "source": "sms", "receivedAt": "2026-11-07T07:58:12-05:00", "text": "…" }
```
→ `{ "ok": true, "rowId": "r_000124" }`. Un reintento con el mismo texto y fecha devuelve la misma fila.

## Errores
`{ "ok": false, "error": "unauthorized" | "bad_request" | "rate_limited" | "internal" }`

Apps Script responde HTTP 200 también en errores: hay que leer `ok`. Si llega HTML (inicio de sesión de Google o despliegue incorrecto), la app lo trata como error sin reintentos y lo explica.
