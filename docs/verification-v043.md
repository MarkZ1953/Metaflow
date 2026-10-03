# Verificación de Metaflow 0.4.3

## Funcionalidad

- Conservar oculta los archivos por defecto. Mostrar conservados y Mostrar excluidos permiten seleccionarlos y revisarlos otra vez.
- Los filtros de estado permiten aislar conservados o excluidos. Seleccionar todos los visibles respeta los filtros y el límite de 1.000 elementos.
- Quitar protección y exclusión conserva la selección para la siguiente acción. Primero retira la protección persistente de los archivos protegidos; limpia las exclusiones locales después de confirmar el éxito. Los errores y respuestas de otra sesión conservan las marcas.
- La selección puede moverse o copiarse a una carpeta elegida con el selector de Windows. Se conserva el nombre original, se revisan conflictos y se registra cada paso en el historial para Undo. Puede elegirse una carpeta diferente en el siguiente lote.
- El destino se autoriza sin añadirlo al Workspace. Los archivos protegidos pueden transferirse; reemplazar un destino protegido se bloquea. Solo las transferencias completadas actualizan la galería, incluida la reconciliación de respaldos de destinos visibles.

## Pruebas

- `npm test`: 108 pruebas de frontend en 19 archivos.
- `npm run lint`: sin errores ni advertencias.
- `npm run build`: TypeScript y compilación de producción correctos.
- Suite nativa `media_classification_tests`: 22 pruebas correctas; una prueba previa de decodificación de video con recursos externos permanece ignorada.
- Siete pruebas nuevas de transferencias reales en carpetas temporales: fotos y videos conservados, copia, conflictos de nombres, destinos autorizados sin persistir, contenido cambiado, sesiones distintas, errores parciales, reemplazos con respaldo, protección del existente y Undo. Se comprueba que una decisión posterior de protección no reincorpore archivos movidos a la sesión.
- `clippy --all-targets --locked -- -D warnings` y `cargo fmt --check`: correctos.

## Revisión visual

Se usó la galería real con una interfaz nativa simulada y datos ficticios, en `.verification/ui-v043.html`. No se leyeron ni trasladaron fotos del usuario. Se comprobaron:

1. Mostrar conservados y excluidos, seleccionarlos y quitar ambas marcas en lote.
2. Seleccionar todos los visibles: se seleccionan cuatro entradas, pero solo las dos sin protección ni exclusión pueden eliminarse.
3. Elegir destino, revisar rutas y ejecutar un movimiento simulado: los dos orígenes completados salen de la galería y aparece Deshacer última operación.
4. Copiar una selección que incluye conservados y excluidos: se mantienen los originales, sus marcas y la selección para otro lote.

La captura de la transferencia se guarda en `.verification/ui-v043-transfer.png`. El navegador de prueba no sustituye las pruebas nativas de archivos.

## Distribución

El instalador se genera con `npm run desktop:build` y contiene el ejecutable, la interfaz y los recursos locales de clasificación y video. No se instala ni se modifica la aplicación abierta del usuario durante la verificación.

Compilación final completada el 3 de octubre de 2026. Ejecutable verificado como versión 0.4.3. Instalador: `src-tauri/target/release/bundle/nsis/Metaflow_0.4.3_x64-setup.exe`, 153.080.300 bytes (145,99 MiB). SHA-256: `9C9E19CDBF41A3BD5EF12A36775988FD85A5391B57DDAD50D1C90D200B5001ED`. Modelo ONNX, ONNX Runtime y FFmpeg presentes junto al ejecutable.
