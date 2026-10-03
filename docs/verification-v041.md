# Verificación de Metaflow 0.4.1

Fecha: 3 de octubre de 2026. Plataforma: Windows x64.

## Cambios

La revisión ampliada de Depuración inteligente permite cambiar de archivo con las flechas, conservar y avanzar con C y preparar la eliminación con Supr. En la galería, Enter abre la selección y Supr prepara la retirada de los seleccionados sin proteger. Duplicados permite elegir la copia izquierda o derecha con 1/2, avanzar con las flechas, conservar ambas con C y descartar con D.

Las confirmaciones capturan la sesión y los archivos concretos. Enter confirma, Esc cancela y Ctrl+Z utiliza el historial existente para deshacer la última retirada. Los atajos respetan campos de edición, archivos protegidos, operaciones en curso y otros diálogos. Las teclas mantenidas no repiten decisiones; también se evita la activación nativa repetida de Enter sobre botones.

Se normaliza la carpeta de recursos de la aplicación después de obtenerla de Tauri. En Windows, Tauri puede devolver una ruta con prefijo `\\?\`, mientras la verificación de FFmpeg/ffprobe utiliza rutas normalizadas. Esa diferencia impedía analizar vídeos. La normalización afecta únicamente a los componentes empaquetados; se conservan las verificaciones de rutas de archivos del usuario.

## Comprobaciones

- `npm run lint`: correcto, sin advertencias.
- `npm test`: 92 pruebas correctas en 18 archivos; 20 pruebas adicionales cubren los atajos compartidos y las decisiones de ambas revisiones.
- `npm run build`: TypeScript y Vite correctos, incluido durante las compilaciones de escritorio.
- `npm run check:rust`: correcto con `-D warnings`.
- `npm run rust -- fmt --check`: correcto.
- `npm run rust -- test --locked --lib media_video -- --ignored --nocapture`: correcta la regresión con un MP4 real y la ruta Windows con prefijo. Se ejecutan clasificación local ONNX, extracción de tres JPEG con tiempos crecientes y rechazo de listas disfrazadas de vídeo.
- `npx prettier --check` sobre los archivos modificados de atajos y documentación: correcto.
- `npm run desktop:build`: ejecutable 0.4.1 e instalador NSIS x64 generados correctamente (146,02 MiB). Se comprobó la versión del ejecutable y la presencia del bundle frontend final `index-DoWtCeXj.js`.

La suite de Rust de la versión 0.4.0, incluidas las 5.000 transferencias y su restauración, pasó previamente; no se repitió completa para estos cambios de interfaz y normalización de recursos. La prueba de vídeo extendida sí se ejecutó sobre el código final.

## Prueba de escritorio

Se utilizó una aplicación de prueba con identificador, SQLite y archivos separados en `.verification/classification-ui-v04`. Se observaron Enter desde una casilla de selección, navegación con ambas flechas, Supr desde la galería y desde la revisión, cancelación con Esc y Conservar con C seguido del siguiente archivo. Supr no abre eliminación para el archivo protegido.

En Duplicados se observaron tres pares, cambio de comparación con ambas flechas, elección de la izquierda con 1 y confirmación de Supr que muestra exactamente la copia elegida y la que permanece. Las flechas no cambian el par mientras se confirma ni mientras Ajustes está abierto. Las confirmaciones se cancelaron; no se eliminaron archivos mediante la interfaz. Los contratos de confirmación y las retiradas/restauraciones se verifican mediante las pruebas automatizadas.

La comprobación nativa adicional del vídeo recompilado no se completó porque hubo interacción del usuario y la ventana de prueba quedó minimizada. La corrección del vídeo está verificada mediante la regresión con componentes y modelo reales.

## Distribución

El ejecutable y el instalador NSIS se generan con `npm run desktop:build`. El ejecutable directo necesita la carpeta `classification` situada a su lado. Los modelos y componentes de vídeo se verifican por SHA-256 antes de compilar. Los archivos del usuario no se envían a servicios externos durante el análisis.
