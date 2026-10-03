# Verificación de Metaflow 0.5.1

## Selección de carpetas

Depuración inteligente ofrece **Dónde analizar → Carpetas que elijo** y conserva **Todas las carpetas del Workspace y el Inbox**. El modo específico es el inicial: Elegir carpetas abre un selector nativo múltiple, admite hasta 32 ubicaciones y permite añadir otros lotes, quitar carpetas y activar o desactivar subcarpetas y videos.

Las ubicaciones elegidas se autorizan temporalmente sin incorporarlas al Workspace. La lista permanece en memoria al alternar modos. Las raíces temporales no se incluyen en el modo general. Una lista vacía no ejecuta ningún análisis y nunca se sustituye por todo el Workspace.

El backend conserva en la sesión el ámbito realmente analizado. Vista previa, categorías, protección, transferencia y eliminación siguen funcionando fuera del Workspace y vuelven a comprobar permisos, revisión y datos del archivo. El selector no cambia la revisión de configuración. Una selección inválida se rechaza antes de reemplazar el análisis anterior.

Las rutas repetidas o solapadas no duplican archivos. En modo recursivo, un padre ya cubre sus hijos seleccionados; sin recursión, ambas carpetas se conservan para analizar sus archivos directos. Se mantienen los límites de recorrido, decodificación, cancelación, recuperación y protección.

## Validación

- Frontend: **128 pruebas en 20 archivos**, todas correctas. Contratos IPC de selección/alcance, respuesta del selector, cancelación, errores, permisos de ejecución, respuestas tardías, deduplicación de rutas de Windows, límite de 32, conservación de la lista al cambiar de modo y bloqueo de selección vacía.
- ESLint y compilación TypeScript/Vite: correctos.
- Suite nativa `media_classification_tests`: **32 pruebas correctas**, con una prueba anterior de video con recursos externos ignorada en la ejecución habitual. No cambió la detección visual ni el muestreo de video de 0.5.0.
- Cuatro regresiones nativas nuevas cubren carpetas fuera del Workspace, selección múltiple y ausencia de archivos no seleccionados, padres/hijos, recursión, selección inválida sin pérdida de revisión, permisos revocados, revisión de configuración, vista previa, categorías, Conservar, copiar/mover, eliminación con respaldo y Undo después de reiniciar sin permisos temporales restaurados.
- `clippy --all-targets --locked -- -D warnings` y `cargo fmt --check`: correctos.

Se comprobó visualmente la galería real en `.verification/ui-v051.html` con servicios simulados y datos ficticios: selección inicial vacía, agregar carpetas en distintos discos, deduplicar una selección repetida, quitar carpetas, desactivar subcarpetas, análisis específico, cambio a Workspace y regreso conservando la lista, y deshabilitar un nuevo análisis tras retirar la última carpeta. La captura está en `.verification/ui-v051-folders.png`. No se analizaron ni modificaron fotos personales del usuario durante la verificación.

## Distribución

El empaquetado usa `npm run tauri -- build --target x86_64-pc-windows-msvc`. El instalador incluye la interfaz, el ejecutable, CLIP, ONNX Runtime y herramientas de video. No se instala automáticamente.

Compilación final completada el 3 de octubre de 2026. Ejecutable e instalador verificados como versión **0.5.1**. Se copiaron el ejecutable a `src-tauri/target/release/metaflow.exe` y el instalador a `src-tauri/target/release/bundle/nsis/Metaflow_0.5.1_x64-setup.exe`. El ejecutable anterior estaba cerrado y los recursos de clasificación y video permanecen junto al ejecutable.

Instalador: **153.254.360 bytes (146,15 MiB)**. SHA-256: `C3827B9E2FB44C531065F0CF0769B857A40B0D9ADA96C18EED535264C2C55CE4`.
