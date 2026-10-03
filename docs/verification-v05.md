# Verificación de Metaflow 0.5.0

## Funcionalidad

- La detección incluye la imagen completa. El modo Detallado añade recortes acotados, con mayor peso de la vista completa para evitar que un detalle aislado cambie el resultado principal.
- Sensibilidad conservadora, equilibrada y amplia; modo rápido o detallado; lectura de texto y uso de ejemplos configurables. Los ajustes persisten y se aplican al volver a analizar.
- Corrección de una o varias categorías desde tarjeta, revisión ampliada o selección. Persiste por hash del contenido, se propaga a copias idénticas y es independiente de Conservar y Excluir.
- Hasta 256 ejemplos recientes compatibles ayudan con imágenes muy parecidas. Los resultados derivados se señalan como Sugerido por tus ejemplos y No concluyente. Las correcciones exactas se mantienen aunque se desactive la extensión a imágenes parecidas.
- Se puede restablecer la detección de una selección o borrar todas las correcciones, conservando archivos y marcas de protección/exclusión. La galería actual vuelve a su clasificación automática original.
- OCR local de Windows: señales acotadas para capturas, memes y documentos. No se guarda el texto reconocido. Un worker MTA persistente conserva la inicialización WinRT; idiomas y disponibilidad permanecen estables hasta reiniciar.
- El perfil de caché incorpora modelo, modo, sensibilidad y configuración/disponibilidad de OCR. Cambiar ajustes no reutiliza etiquetas del perfil anterior.

## Pruebas

- Frontend completo: **121 pruebas en 20 archivos**, todas correctas. Contratos IPC, errores, respuestas tardías, protección y exclusiones tras corregir/restablecer, y carga inicial de ajustes que no sobrescribe un contador de ejemplos actualizado.
- ESLint y compilación TypeScript/Vite: correctos.
- `npm run rust -- test classification --offline -- --nocapture`: **39 pruebas correctas** y dos pruebas de recursos ignoradas en la ejecución habitual.
- Las dos pruebas de recursos se ejecutaron explícitamente: inferencia CLIP real offline y video con FFmpeg, tres fotogramas, vistas previas y rechazo de listas de reproducción. Ambas correctas.
- `clippy --all-targets --locked -- -D warnings` y `cargo fmt --check`: correctos.
- Las seis regresiones nativas nuevas comprueban persistencia y copias idénticas, separación de protección, validación atómica de categorías y archivos cambiados, ejemplos cercanos/lejanos, desactivación, ejemplos contradictorios, aislamiento entre modos, borrado y perfiles de caché.
- OCR real disponible en este equipo: `en-US`, `es-ES`, `es-MX`. La captura generada produjo 11 líneas, 25 palabras y tres indicios de interfaz. También se comprobaron 20 consultas sucesivas de disponibilidad sin fallos.

## Calidad de detección

Se mantuvieron las categorías principales esperadas en cinco imágenes públicas o generadas de prueba: personas, animales, capturas, documentos y memes, usando inferencia Rust real en modos Rápido y Detallado. Dos imágenes derivadas con una persona o un animal en un extremo conservan la categoría principal correcta y permanecen marcadas para revisión.

La medición inicial en Python/Pillow mostró diferencias respecto del redimensionado nativo Rust. La calibración final utiliza las puntuaciones nativas: mínimo equilibrado de 0,225, manteniendo el umbral de duda, y combinación de afinidades 80 % imagen completa, 10 % media de recortes y 10 % máximo de recortes. Los registros locales están en `.verification/detection-v3-native.txt`; el registro Python es una comprobación auxiliar, no la medición final.

La muestra es pequeña y no representa la biblioteca del usuario: **no establece un porcentaje general de precisión**. Las correcciones sirven como etiquetas exactas y ejemplos de similitud; no entrenan de nuevo los pesos de CLIP. No se analizaron ni modificaron las fotos personales del usuario durante estas pruebas.

## Revisión visual

Se probó la galería real en `.verification/ui-v05.html` con servicios nativos simulados y rutas ficticias. Se comprobó guardar ajustes, aviso de volver a analizar, corrección individual con vista previa, bloqueo de Supr mientras el diálogo está abierto, corrección conjunta de conservados y excluidos, selección sin pérdida y restablecimiento de categorías. Las capturas se guardan en `.verification/ui-v05-settings.png` y `.verification/ui-v05-correction.png`.

## Distribución

El empaquetado utiliza `npm run tauri -- build --target x86_64-pc-windows-msvc`. La carpeta de compilación separada permite generar la actualización mientras el ejecutable anterior permanece abierto. El instalador contiene interfaz, modelo local, ONNX Runtime y herramientas de video. No se instala automáticamente durante la verificación.

Compilación final completada el 3 de octubre de 2026. Ejecutable e instalador verificados como versión 0.5.0. Instalador generado en `src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/Metaflow_0.5.0_x64-setup.exe` y copiado a `src-tauri/target/release/bundle/nsis/Metaflow_0.5.0_x64-setup.exe` para facilitar el acceso. Tamaño: **153.257.731 bytes (146,16 MiB)**. SHA-256: `94D814344C070284BF718299EF1DBA906CF2E402F48A16240176757E2F1E1400`.

El ejecutable nuevo y su carpeta de recursos están en `src-tauri/target/x86_64-pc-windows-msvc/release/`. El ejecutable anterior abierto no se reemplazó ni se cerró durante esta compilación; el instalador permite actualizar la aplicación después de cerrarla.
