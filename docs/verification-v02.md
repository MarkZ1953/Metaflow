# Verificación de Metaflow 0.2.0

Validación en Windows, con archivos generados y temporales. Los datos reales del usuario no se utilizaron en las pruebas de filesystem.

- TypeScript/Vite: compilación de producción correcta.
- ESLint: sin errores ni advertencias.
- Vitest: 30 pruebas correctas.
- Rust: 45 pruebas correctas. La ejecución final de los casos rápidos pasó 44; el caso independiente de 5.000 archivos pasó previamente y no se repitió tras cambios exclusivamente visuales/de versión.
- Clippy con `-D warnings` y `cargo fmt --check`: correctos.
- Tauri: ejecutable e instalador NSIS x64 generados para 0.2.0, sin firma de distribución.

## Casos de filesystem

MOVE y COPY entre C: y F:, cancelación de 100 archivos, lote de 5.000 con progreso de bytes y Undo completo, regresión de clasificación de 150 archivos, reemplazos con respaldo y Undo, duplicados con nombres distintos, muestras iguales con contenido central diferente, keeper editado después del preview, árboles anidados y vacíos, llegada de nuevos archivos durante una transferencia, raíces/favoritos tras reinicio y Undo, migración de SQLite v1 e historial JSON antiguo.

## Revisión visual nativa

Se abrió la compilación de desarrollo con `METAFLOW_TEST_DATA_DIR` apuntando a una base de datos aislada. Se verificaron Inbox, preview con el nombre `periodo-3_2026-09-21_tarea-final-programacion.pdf`, aviso de contenido idéntico con distinto nombre, tabla de tamaños/fechas/BLAKE3, navegación de Workspace, carga de hijos al expandir, selección de archivos y detalles. Se corrigieron el espacio del primer selector de comparación y el texto de búsqueda del Workspace.

La automatización de Windows no confirmó el arrastre de extremo a extremo: el gesto automatizado no abrió el diálogo de transferencia. El soporte HTML5 y el contrato del payload están implementados, pero ese gesto queda pendiente de validación manual en el equipo. Mover/Copiar desde el botón utiliza el mismo servicio y preview.

No se comprobó instalación del paquete en otra máquina. Dual Pane, selección de múltiples Workspaces y rutas recientes siguen pospuestos conforme al alcance del MVP.
