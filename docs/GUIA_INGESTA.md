# Guía: conectar los correos del banco

## 1. Qué hace esto
Cada correo de Bancolombia se convierte en un movimiento dentro de la app. Tu cuenta de Google guarda el mensaje en una hoja privada, y la app lo pide cuando la abres. Los mensajes pasan por tu Google y por tu celular, y por ningún otro servicio. La app solo lee correos: no usa mensajes de texto.

## 2. Poner la URL y el token en la app
1. En el computador donde se instaló, abre `Finanzas-Tracker/.local/ingesta.env`. Ahí están `INGESTA_URL` e `INGESTA_TOKEN`.
2. Pásalos al celular por un medio privado, como un gestor de contraseñas. El token es una clave: evita enviarlo por chats o correo. Si se filtró, cámbialo (paso 6).
3. En la app, entra a **Más > Ingesta automática**. Pega la URL y el token, sin espacios al inicio ni al final.
4. Pulsa **Probar conexión y activar**. Debe decir "Conectado".
5. En **Ahorro**, edita tu cuenta y escribe sus **últimos 4 dígitos**. Sin eso, los movimientos quedan por revisar si tienes varias cuentas.

## 3. Si los correos llegan a otro Gmail
El script solo lee el Gmail donde se instaló. Para traer los de otra cuenta, en la cuenta que los recibe:
1. Abre Gmail en un computador: **⚙ > Ver todos los ajustes > Reenvío y correo POP/IMAP**, y agrega la dirección de destino. Confírmala con el código que llega.
2. Crea un filtro con el remitente de las alertas de Bancolombia (cópialo de uno de los correos) y marca **Reenviar a** esa dirección.

El script también exige que el remitente contenga "bancolombia". Si reenviar cambia el remitente, los correos se ignorarían: revisa que lleguen a "Por revisar". Si no llegan, dímelo para ajustar `REMITENTE_VALIDO` en `Code.gs`.

## 4. Cambiar el token
1. Entra a [script.google.com](https://script.google.com) y abre *Finanzas Tracker - Ingesta*.
2. Ejecuta `rotarToken`. El registro de abajo muestra el token nuevo.
3. Actualízalo en la app. El anterior deja de funcionar de inmediato.

## 5. Actualizar el script
Desde la 5.2 el token viaja dentro de la petición y no en la URL, y las filas viejas de la hoja se
archivan solas. Desde la 6.0 el script ya no recibe mensajes enviados desde el celular: solo lee
Gmail. La app sigue funcionando con un script anterior, pero para dejarlo al día:
1. Abre el proyecto de Apps Script y reemplaza el contenido de `Code.gs` por el del repositorio.
2. **Implementar → Gestionar implementaciones → ✎ (editar) → Versión: Nueva versión → Implementar.**
   Editar la implementación existente conserva la misma URL; crear una nueva cambiaría la URL.
3. No hace falta volver a ejecutar `instalar()` ni cambiar el token.

## 6. Problemas comunes
- **"Token incorrecto":** se copió mal o se rotó.
- **"El script respondió una página":** esa no es la URL del despliegue. Debe terminar en `/exec`.
- **No llegan los correos:** el script revisa cada 10 minutos, y solo mensajes de los últimos 7 días con remitente del banco. Revisa también que estén en esa cuenta y no en Spam.
- **Mensaje en "No reconocidos":** el banco usó un formato nuevo. Elige el tipo y pulsa **Enseñar a la app**.
- **Movimiento sin cuenta:** escribe los últimos 4 dígitos de la cuenta o tarjeta.

## 7. Qué permisos pide Google
- **Gmail:** Google lo muestra como acceso completo (leer, enviar y borrar), porque su servicio no ofrece un permiso menor que permita etiquetar. El código solo busca correos del banco, los lee y les pone la etiqueta `FINANZAS_PROCESADO`. Puedes revisarlo en el editor. Si quieres limitar el riesgo, usa una cuenta dedicada con reenvío.
- **Hojas de cálculo:** guarda los mensajes en una hoja privada.
- **Ejecución automática:** permite revisar el correo sin que tengas que hacer nada.

Para retirar todo: en `myaccount.google.com/permissions`, quita el acceso y borra el proyecto en script.google.com.
