# Verificación de Metaflow 0.3.0

Verificado en Windows el 3 de octubre de 2026 con archivos generados. Las pruebas no eliminaron archivos del usuario.

## Revisión de duplicados

- 13 pruebas nuevas en Rust: pares exactos, fotos con distinta resolución/compresión, eliminación reversible de cualquiera de las dos copias, contenido intacto del archivo conservado e historial/Undo.
- Tres copias exactas y una variante visual mantienen las comparaciones pendientes al retirar el primer representante, sin volver a recorrer las carpetas en cada eliminación.
- Los descartes persisten al reiniciar, afectan solo al par elegido y dejan de ocultar archivos cuyo contenido o identidad cambió. Restablecer los descartes invalida la sesión actual.
- Identificadores inventados, nuevas búsquedas y cambios de configuración impiden usar una revisión anterior. La vista previa verifica contenido aunque se restauren tamaño y modificación.
- El archivo conservado se valida por identidad y timestamps de 100 ns mientras el ejecutor mantiene su handle exclusivo; un reemplazo después de registrar el journal impide retirar la copia.
- JPEG orientado por EXIF conserva dimensiones originales. La vista previa se limita a 1280 px por eje, sin ampliar imágenes menores. Imágenes corruptas o con dimensiones enormes se rechazan antes de asignar el buffer de píxeles.
- Grupos grandes, recorridos y candidatos visuales tienen límites explícitos con aviso de análisis incompleto. Los respaldos se excluyen del análisis.

## Interfaz de escritorio

Instancia de prueba con identificador independiente y SQLite/logs en `.verification/duplicates-ui-v03`. Computer Use comprobó la interfaz sobre siete archivos generados: tres PNG idénticos, una versión de menor resolución, una imagen diferente y dos TXT idénticos.

La búsqueda mostró siete pares: cuatro exactos y tres visuales. Se comprobaron imágenes lado a lado, resoluciones 900 × 600 y 450 × 300, ampliación, ajuste sin recortar, Conservar ambas, Siguiente, descarte con avance y omisión del par al repetir la búsqueda. Las acciones principales permanecen sobre las imágenes en una ventana de 1380 × 880. Las retiradas y Undo se probaron mediante los servicios Rust con archivos generados.

16 pruebas nuevas de TypeScript comprueban contratos IPC, imágenes JPEG embebidas, navegación y filtrado de pares, doble acción, errores de búsqueda, restablecimiento de sesión, caché y cancelación de miniaturas obsoletas. Se permiten dos solicitudes de miniatura en curso; las pendientes se cancelan al cambiar de comparación. La caché de interfaz conserva como máximo ocho vistas previas.

## Comprobaciones y distribución

- ESLint sin advertencias; TypeScript y Vite correctos.
- Vitest: 48 pruebas correctas.
- Rust: las 65 pruebas correctas, incluidas las regresiones de fechas, Inbox, transferencias entre discos y el lote de 5.000 archivos con restauración completa. Duración de la suite: 92,83 segundos.
- Clippy con `-D warnings` y rustfmt correctos.
- Ejecutable release y NSIS x64 generados. ProductVersion y FileVersion: 0.3.0.

Artefactos: `src-tauri/target/release/metaflow.exe` y `src-tauri/target/release/bundle/nsis/Metaflow_0.3.0_x64-setup.exe`. Se generó el instalador sin ejecutar una instalación sobre el equipo del usuario.

Las coincidencias visuales son sugerencias, no una garantía de igualdad. HEIC, AVIF y videos no tienen miniatura en esta versión; los duplicados exactos de esos archivos siguen siendo revisables por sus datos. GIF/TIFF comparan el primer fotograma o página. El retiro conserva un respaldo recuperable en `.metaflow-recovery` y no purga archivos automáticamente.
