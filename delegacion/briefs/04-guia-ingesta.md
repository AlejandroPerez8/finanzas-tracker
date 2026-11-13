# Brief 04: borrador de guía para persona no técnica
Objetivo: redactar en español de Colombia `docs/GUIA_INGESTA.md`. Solo imprime el Markdown; no crees archivos ni ejecutes comandos. No inventes menús: si no conoces una pantalla exacta, descríbela de forma general y márcala [VERIFICAR].
Contexto ya resuelto: el script de Google Apps Script ya está creado y desplegado; revisa Gmail cada 10 minutos. La app es una PWA en el celular. Tiene Ajustes > Ingesta, con campos "URL del script" y "Token", y botón "Probar conexión". La URL y el token están en el archivo `.local/ingesta.env` del computador donde se instaló.
Secciones:
1. Qué hace esto, en 3 frases (los correos del banco se vuelven movimientos; la app los pide; nada se envía a terceros).
2. Poner URL y token en la app, paso a paso.
3. Reenviar correos de Bancolombia si llegan a otro Gmail (filtro de reenvío).
4. Rotar el token: en el editor ejecutar rotarToken(), ver el nuevo con verToken(), actualizar en la app.
5. Problemas comunes: "Token incorrecto", "El script respondió una página", no llegan correos, mensajes en "No reconocidos".
6. Qué permisos pide Google y por qué: Gmail (Google lo describe como acceso completo; el script solo lee y etiqueta), Hojas, ejecución automática.
Máximo 150 líneas. Criterio: una persona sin conocimientos técnicos puede seguirla.
