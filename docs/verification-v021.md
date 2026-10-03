# Verificación de Metaflow 0.2.1

Verificado en Windows el 2 de octubre de 2026 con archivos generados. No se aplicaron cambios de fechas a archivos del usuario.

## Corrección masiva de modificación = creación

- 7 pruebas nuevas en Rust: lote de 120 archivos de extensiones JPG/MP4/PDF/TXT; modificación igual a creación; conservación de creación, último acceso, identidad, tamaño y contenido; historial persistente y Undo exacto, incluidos ticks de 100 ns.
- Selección directa, raíces y subcarpetas; rutas superpuestas sin repetir archivos; exclusión de recuperación y omisión de fechas ya iguales.
- Cancelación tras 20 de 60 archivos, conservando los restantes y deshaciendo solo los completados.
- Cambios de 100 ns tras revisar/aplicar impiden sobrescribir una fecha ajena durante ejecución o Undo.
- Archivo ocupado omitido con motivo visible; el resto del lote continúa.
- Denegación de rutas sin autorización e invalidación de planes al retirar una raíz.
- Recuperación de operaciones pending/undo-pending con comparación de fechas exactas; resultados ambiguos conservados para revisión manual.

## Comprobación de escritorio

Se compiló una instancia de prueba con identificador independiente y SQLite/logs aislados en `.verification/metadata-ui-v021`. La pantalla se controló con Computer Use sobre cinco archivos generados y una subcarpeta.

1. Sin subcarpetas, la revisión mostró tres cambios y un archivo con fechas iguales. Cancelar conservó las fechas de todos los archivos.
2. Con subcarpetas, la revisión mostró cuatro cambios y una omisión. Creación: 6 de febrero de 2026, 19:13:48 local; modificación anterior: 21 de septiembre de 2026, 14:06:55 local.
3. Aplicar dejó modificación igual a creación en los cuatro archivos. Historial mostró FECHAS y cuatro elementos completados.
4. Deshacer operación restauró las modificaciones anteriores. Se comprobaron los timestamps del filesystem y SQLite: cuatro elementos `undone` y uno `skipped`.

## Comprobaciones y distribución

- ESLint: correcto, sin advertencias.
- Vitest: 32 pruebas correctas, incluidas dos de contratos IPC que conservan los ticks como texto y rechazan números con posible pérdida de precisión.
- Rust: 51 pruebas correctas (7 nuevas y 44 regresiones); se excluyó en esta ejecución la prueba de transferencia de 5.000 archivos ya verificada en 0.2.0, ajena al cambio de fechas.
- Clippy con `-D warnings` y rustfmt: correctos.
- TypeScript y Vite: compilación correcta.
- Tauri release: ejecutable y NSIS x64 generados; ProductVersion y FileVersion del ejecutable: 0.2.1.

Artefactos: `src-tauri/target/release/metaflow.exe` y `src-tauri/target/release/bundle/nsis/Metaflow_0.2.1_x64-setup.exe`.

La operación usa la creación actual que entrega Windows. No reconstruye fechas perdidas en Drive ni modifica EXIF/QuickTime. No se verificaron sistemas de archivos con precisión temporal inferior a NTFS; se comprueba el timestamp después de escribir y se informa una discrepancia. El instalador fue generado, sin ejecutar una instalación sobre el equipo del usuario.
