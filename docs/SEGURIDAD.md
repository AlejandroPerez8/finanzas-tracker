# Seguridad y privacidad

Los datos viven en el dispositivo. La ingesta nace apagada y solo habla con `script.google.com` por HTTPS. Los mensajes del banco sí pasan por la cuenta de Google del usuario: su Gmail y una hoja privada.

| Amenaza | Mitigación | Riesgo restante |
|---|---|---|
| Token filtrado | ≥ 32 caracteres; viaja en el cuerpo de un POST, nunca en la URL (desde 5.2); enmascarado, fuera de exportes y registro; `rotarToken()` | Quien lo tenga lee los textos pendientes y puede crear mensajes falsos hasta rotarlo |
| URL expuesta | Sin token solo responde `unauthorized`; límite de 60 peticiones por minuto | El límite es global: alguien podría bloquear temporalmente la sincronización |
| Mensaje malicioso | Validación de remitente y de esquema; los casos dudosos van a revisión; transferencias siempre se revisan | Un remitente falsificado con formato perfecto podría confirmarse solo. Se puede apagar la confirmación automática |
| XSS por comercio | `dom.js` usa nodos de texto; `escapeAttr` en plantillas; CSP sin scripts en línea; prueba de humo con carga HTML | Ninguno conocido: desde 5.1 `style-src` tampoco permite estilos en línea |
| Robo del dispositivo | PIN opcional con bloqueo opaco, modo discreto que oculta toda cifra de dinero, copias cifradas con AES-GCM | **El PIN no cifra la base local.** Decisión deliberada: un PIN de 4 a 6 dígitos se adivina por fuerza bruta en minutos fuera del navegador, y olvidarlo haría perder todos los datos. La protección real es el bloqueo y el cifrado del propio celular |
| Permisos de Google | El código solo busca, lee y etiqueta correos del banco | El permiso cubre toda la bandeja. Conviene una cuenta dedicada con reenvío |
| Copia de seguridad | Sin token, URL ni PIN. Cifrado opcional. HTML guardado se descarta al restaurar | Sin clave, el archivo queda legible |

**No se guarda:** número completo de tarjeta o cuenta, CVV, claves. Solo últimos 4 y alias. Tras importar se guardan el hash y los campos extraídos; el texto solo si el usuario lo activa, o si no se reconoció (para enseñarlo), con borrado a los N días.

**La hoja de Google sí conserva textos** hasta `DIAS_PURGA` (30) después de importados, y las filas importadas se eliminan a los `DIAS_ARCHIVO` (90). Ahí se enmascaran los números de 8 o más dígitos, pero siguen los nombres.

**Reportes con IA:** el prompt solo lleva totales por categoría y agregados, sin comercios, nombres de metas ni de entidades. Hay una prueba automática.

**Credenciales locales del instalador:** `.local/ingesta.env` y `~/.clasprc.json` dan acceso al script. No se versionan.
