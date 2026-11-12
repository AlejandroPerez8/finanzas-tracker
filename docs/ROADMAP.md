# Hoja de ruta
- Backend FastAPI opcional: empuje en tiempo real y clave de IA fuera del cliente.
- Migrar las plantillas de `js/app.js` a `js/ui/dom.js` por partes, cuando cada pantalla se toque por otra razón (`'unsafe-inline'` ya se eliminó en 5.1).
- Simulador de laddering de CDT (la especificación lo daba por existente, pero no estaba).
- Sugerencia de categoría por IA, una vez exista un backend.
- WebAuthn además del PIN. El cifrado de la base local se descartó por ahora (ver docs/SEGURIDAD.md): solo tendría sentido con una frase de paso larga, no con el PIN.
- Causación automática de intereses y avance automático de cuotas con extractos.
- Reconocer más bancos con el mismo registro de parsers.
