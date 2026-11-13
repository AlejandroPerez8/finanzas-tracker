# Contrato del endpoint de ingesta (versión 1)

Implementado por `integraciones/apps_script/Code.gs` y `integraciones/apps_script/mock/server.js`.

Base: `https://script.google.com/macros/s/<ID>/exec`. Siempre usar `fetch(url, { redirect: 'follow' })`.

**Autenticación:** Apps Script no lee cabeceras personalizadas, así que el token viaja **en el cuerpo JSON de un POST** (mínimo 32 caracteres). Desde 5.2 la app nunca lo pone en la URL, donde quedaría en registros de servidores y proxies. Todas las acciones se envían como:

```
POST <base>   Content-Type: text/plain;charset=utf-8
{ "token": "T", "action": "ping" | "pending" | "ack", ... }
```

`text/plain` evita el preflight de CORS, que Apps Script no responde. Las mismas acciones siguen
aceptándose por `GET ?action=…&token=T` para apps anteriores a 5.2; si la app recibe `bad_request`
a un POST con acción (script viejo), pasa a GET por el resto de la sesión. Rota el token con
`rotarToken()` si sospechas que se filtró.

## Probar conexión (extensión de esta implementación)
`{ "action": "ping" }` → `{ "ok": true, "version": 1, "serverTime": "…", "pendientes": 3 }`

## Consultar nuevos
`{ "action": "pending", "cursor": "C", "limit": 50 }` (`limit` entre 1 y 100)
```json
{ "ok": true, "version": 1, "serverTime": "2026-11-07T08:00:00-05:00", "cursor": "123",
  "items": [{ "rowId": "r_000123", "source": "gmail", "messageId": "opaque-id",
    "receivedAt": "2026-11-07T07:58:12-05:00", "senderTag": "bancolombia",
    "textoRelevante": "Máximo 600 caracteres, sin enlaces" }] }
```
Solo devuelve filas sin confirmar. El cursor es opaco (en Code.gs, el número del último `rowId` revisado, así que no se corre cuando se archivan filas). Una respuesta sin elementos significa que no hay más.

## Confirmar importados
`{ "action": "ack", "ids": "r_000123,r_000124" }` (también acepta una lista) → `{ "ok": true, "acked": 2 }`. Es idempotente. La app solo lo llama **después de guardar**.

## Sin entrada de mensajes
El endpoint no recibe mensajes: la única fuente es Gmail, que el propio script lee con su disparador.
Un `POST` sin `action` responde `bad_request`.

## Archivo de filas viejas
La purga diaria (`purgarTexto`, 3 a. m.) borra el texto de lo importado con más de `DIAS_PURGA`
días (30) y **elimina** las filas importadas con más de `DIAS_ARCHIVO` días (90), para que la hoja
no crezca sin límite. Los `rowId` salen de la propiedad `ULTIMO_ROW` y nunca se repiten.

## Errores
`{ "ok": false, "error": "unauthorized" | "bad_request" | "rate_limited" | "internal" }`

Apps Script responde HTTP 200 también en errores: hay que leer `ok`. Si llega HTML (inicio de sesión de Google o despliegue incorrecto), la app lo trata como error sin reintentos y lo explica.
