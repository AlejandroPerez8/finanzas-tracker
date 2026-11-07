# Preguntas pendientes

Cada una tiene una suposición ya implementada; cambiarla es sencillo.

1. **¿Una transferencia enviada es gasto?** Suposición: sí, categoría "Transferencias", y siempre pasa por revisión, donde puedes marcarla como transferencia a cuenta propia.
2. **¿Recargar la Tarjeta Cívica es gasto?** Suposición: sí, de transporte, según el diccionario.
3. **¿Confirmar solo los mensajes con confianza alta?** Suposición: sí, desde 90 %. Los formatos vistos en correos reales superan ese umbral. Las compras con tarjeta de crédito, cuyo formato aún no se ha visto, quedan por revisar.
4. **Formatos no vistos en mensajes reales:** tarjeta de crédito, cuotas, avances, cuota de manejo, intereses, 4x1000, IVA, rechazos y cajero son **suposiciones**. Sus patrones vienen de fixtures sintéticos. Si un mensaje real no coincide, llega a "No reconocidos".
5. **Pago mínimo:** ¿5 % + intereses con piso de $30.000 se parece a tu extracto? Es una estimación.
6. **¿La cuenta de Google del script es la definitiva?** Encontró 25 mensajes del banco en 7 días. Si cambia, hay que repetir la instalación.
