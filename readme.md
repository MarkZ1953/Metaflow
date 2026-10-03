# Metaflow 0.2.1

Aplicación de escritorio para organizar un Inbox por fechas y administrar carpetas de distintos discos en un Workspace. Las transferencias comparten renombrado, duplicados, revisión, historial persistente y Undo. Windows es la plataforma compatible con operaciones de archivos.

## Usar el Workspace

1. Pulsa **Añadir carpeta al Workspace** para abrir raíces independientes, por ejemplo Downloads en C: y Universidad en F:. Las raíces y los favoritos se guardan en SQLite.
2. Expande el árbol para cargar sus hijos. Pulsa una carpeta para ver su contenido y detalles. Ctrl/Shift permiten seleccionar varios elementos.
3. Usa **Mover**, **Copiar** o arrastra archivos a otra carpeta del árbol o del explorador. El diálogo permite elegir operación, destino, preset y política de conflictos.
4. Genera la vista previa. Comprueba rutas, nombres, movimientos/copias, duplicados, conflictos y respaldos. **Revisar problemas** compara tamaño, fechas y BLAKE3; resuelve cada archivo o aplica una acción a todos.
5. Ejecuta el lote. El progreso muestra archivos, bytes y nombre actual. Cancelar termina el archivo activo y detiene los siguientes.
6. Consulta **Transferencias** o **Historial** para revisar resultados y deshacer.

El menú de carpetas ofrece crear, renombrar, mover, copiar, favoritos, abrir en Windows Explorer, copiar ruta, propiedades y quitar una raíz del Workspace. Quitarla elimina solo su referencia. Para renombrar una raíz, su carpeta padre también debe estar abierta en el Workspace.

## Inbox y renombrado

Elige un Inbox y crea reglas con rangos inclusivos y destinos existentes. Las plantillas Periodo 1, 2 y 3 de 2026 siguen disponibles. Los rangos habilitados no pueden solaparse. Los archivos sin regla permanecen en Inbox.

Metaflow espera al menos tres segundos de estabilidad y comprueba que el archivo no esté ocupado. Al revisar, determina fecha y destino, genera el nombre con el preset, verifica duplicados y resuelve conflictos. El renombrado se incorpora al movimiento confirmado; la ejecución continúa siendo manual.

En **Presets de nombres**, guarda formatos y transformaciones. Asigna un preset al Inbox o a cada regla; el de la regla tiene prioridad. El mismo motor Rust sirve para transferir y renombrar lotes del Workspace.

```text
Universidad: {period}_{date:yyyy-MM-dd}_{name}
Fotos:       {date:yyyyMMdd}_{counter:0001}
Documentos:  {year}-{month}_{name}
```

La extensión se conserva. Se admiten minúsculas, mayúsculas, Title Case, espacios a guiones o guiones bajos, espacios repetidos y eliminación opcional de acentos. Se limpian caracteres inválidos y se rechazan nombres reservados de Windows. Ejemplo: `Tarea Final Programación.pdf` → `periodo-3_2026-09-21_tarea-final-programacion.pdf`. Los contadores comienzan en 1 en cada revisión. Inbox utiliza la fecha elegida por la regla; las transferencias manuales utilizan modificación.

## Corregir fechas de forma masiva

1. Abre **Fechas y metadatos** y elige una carpeta. **Elegir carpeta** agrega una raíz mediante el selector de Windows. Activa **Incluir subcarpetas** si quieres recorrer todo su contenido.
2. Pulsa **Revisar cambio masivo**. Comprueba la creación actual, la modificación anterior y la nueva modificación de cada archivo.
3. Pulsa **Aplicar modificación = creación**. Cada archivo recibe su propia fecha de creación como modificación; los que ya coinciden se omiten.
4. En **Historial**, el lote aparece como **FECHAS**. **Undo** restaura las modificaciones anteriores si siguen coincidiendo la identidad, el tamaño y las fechas registradas.

También puedes seleccionar varios archivos o carpetas en el Workspace y pulsar **Arreglar fechas**. Esa selección revisa archivos directos de las carpetas; la pantalla **Fechas y metadatos** permite incluir subcarpetas.

Se actualiza únicamente la modificación de archivos regulares mediante la API de Windows. No se reescribe el contenido, no se mueven archivos y se conservan creación, último acceso y metadatos internos EXIF/QuickTime. El registro conserva la precisión de 100 ns de Windows como cadenas decimales, incluso al deshacer. Se informa cualquier archivo ocupado o inaccesible y la cancelación detiene los siguientes archivos. La revisión no modifica fechas. Las carpetas y `.metaflow-recovery` se conservan sin cambios.

Se utiliza la creación que **Windows muestra actualmente**: Metaflow no recupera una fecha original que Drive ya haya reemplazado. Compruébala antes de aplicar. Los archivos deben estar disponibles localmente.

## Duplicados y recuperación

Se compara tamaño, una muestra inicial/final y, cuando coinciden, BLAKE3 completo calculado en Rust. Un nombre igual con contenido distinto es un conflicto; contenido igual con otro nombre es un duplicado.

La revisión permite conservar existente, conservar entrante, conservar ambos, omitir o reemplazar. Conservar existente y omitir dejan el entrante en su origen. Conservar entrante envía las copias existentes a recuperación; reemplazar conserva la ruta del existente. Ambos guardan respaldos para Undo. Los duplicados entre archivos todavía pendientes del mismo lote permiten conservar ambos u omitir.

**Duplicados** analiza explícitamente carpetas administradas, agrupa contenidos idénticos y muestra nombres, rutas, tamaño, fechas y hash. Elige qué copia conservar y revisa el traslado de las otras a recuperación. Nunca elimina duplicados automáticamente. Se informa cualquier análisis incompleto por ubicaciones inaccesibles.

Los respaldos permanecen en `.metaflow-recovery`, con rutas registradas en el historial. No se incluyen en análisis de duplicados ni se purgan automáticamente. Undo de copia conserva el original y mueve la copia a recuperación; Undo de movimiento la devuelve al origen. Contenido editado, identidad distinta o rutas ocupadas impiden restaurar ese elemento y conservan los archivos.

## Ejecutar y compilar

Stack: Tauri 2, Rust, React, TypeScript, Vite, MUI Community, Zustand, React Hook Form, Zod y SQLite. TanStack Virtual limita las filas renderizadas. Rust utiliza notify, chrono, rusqlite, BLAKE3 y unicode-normalization. Los archivos reales permanecen en el filesystem.

En Windows necesitas Node.js 22.12 o superior, Rust estable, C++ Build Tools y WebView2. Consulta los [prerrequisitos de Tauri](https://v2.tauri.app/start/prerequisites/).

```powershell
npm ci
npm run desktop:dev
npm run desktop:build
```

Los scripts utilizan Rust portátil de `.tools/cargo` si existe o la instalación del sistema, sin cambiar el PATH del sistema.

```text
src-tauri/target/release/metaflow.exe
src-tauri/target/release/bundle/nsis/Metaflow_0.2.1_x64-setup.exe
```

Producción incluye la interfaz y funciona sin Vite ni conexión. WebView2 debe estar instalado; el instalador puede descargarlo si falta. La compilación no tiene firma de distribución. `npm run dev` sirve la vista web en `http://127.0.0.1:1420`; el navegador ofrece únicamente una demostración de desarrollo. Las operaciones reales requieren Tauri.

## Garantías y límites

- El árbol carga una carpeta a la vez. El recorrido recursivo se solicita al analizar duplicados, transferir una carpeta o corregir sus fechas con subcarpetas; no se recorren discos al arrancar.
- Inbox procesa archivos regulares directamente dentro de su carpeta. El watcher mantiene estabilidad, sufijos temporales, ocho reintentos de bloqueo y reconciliación periódica.
- Las operaciones no siguen enlaces, junctions ni reparse points. Solo acceden a raíces seleccionadas o ubicaciones autorizadas del Inbox/reglas.
- Una revisión inmutable dura diez minutos; cambios de configuración la invalidan. Las transferencias verifican identidad, fechas, tamaño, hash y disponibilidad antes de ejecutar. La corrección de fechas verifica identidad, tamaño y fechas exactas bajo un handle exclusivo, sin leer el contenido. Un conflicto nuevo falla sin sobrescribir.
- Entre discos se crea un destino nuevo, se copia, sincroniza, verifica tamaño/BLAKE3 y preservan fechas antes de retirar el origen. Streams alternativos, cifrado, compresión y datos dispersos se rechazan al copiar o mover entre discos para conservar sus propiedades; pueden moverse dentro del mismo volumen.
- Los reemplazos primero trasladan el existente a un respaldo registrado. No se reemplazan árboles completos. Carpetas con Inbox, destinos de reglas o recuperación requieren gestionar esas referencias antes de moverlas.
- Los árboles se transfieren como pasos registrados, incluidas carpetas vacías. Solo se retiran directorios vacíos; archivos que llegan durante el lote se conservan. No se garantiza copiar ACL ni todos los metadatos del directorio.
- El journal precede cada mutación. Al reiniciar se reconcilian operaciones de archivos y referencias del Workspace. Interrupciones ambiguas o pasos de carpeta pendientes requieren recuperación manual sin eliminar contenido.
- Cada lote usa una llamada de ejecución IPC. No hay Pause. Se cancela el análisis entre elementos y el traslado entre archivos.
- La interfaz muestra las 100 operaciones más recientes; SQLite conserva todo el registro y recupera todas las operaciones interrumpidas.
- Windows puede diferir o deshabilitar actualizaciones de último acceso; se utiliza el valor que devuelve el sistema.

SQLite y el log están en los datos de `app.metaflow.desktop`. La migración v2 conserva Inbox, reglas e historial de v0.1. No hay telemetría ni servicios externos. Los logs contienen códigos y cantidades, no nombres. Una sola instancia evita organizadores concurrentes. Solo en desarrollo, `METAFLOW_TEST_DATA_DIR` aísla SQLite/logs para pruebas.

## Verificación y arquitectura

```powershell
npm run lint
npm test
npm run build
npm run test:rust
npm run check:rust
npm run rust -- fmt --check
```

Las pruebas usan archivos generados y cubren regresiones de Inbox/reglas, presets, migración, raíces independientes, duplicados con nombres distintos, falsos positivos del hash parcial, respaldos, cambios tras revisión, cancelación, carpetas anidadas/vacías, transferencias C: ↔ F:, recuperación y Undo. El lote de transferencia de 5.000 comprueba contenido, progreso en bytes y restauración completa; el de 150 mantiene la clasificación 42/51/57 en los tres periodos. Las pruebas de fechas incluyen 120 archivos de distintas extensiones, precisión de 100 ns, conservación de creación/acceso/contenido, cancelación, selección, subcarpetas, exclusiones, bloqueo y recuperación de journal.

El [plan técnico](docs/architecture.md) describe la integración. Comandos IPC pequeños delegan en servicios y repositorios Rust. `rename-engine`, `duplicate-service` y `file-operation-service` son compartidos por Inbox y Workspace. La corrección de fechas comparte ejecución, historial y Undo. Los textos se centralizan en diccionarios de `src/shared/constants`; el tema MUI conserva claro/oscuro.

SQLite admite más Workspaces y el explorador tiene una fábrica de stores independientes para futuros paneles. Selección de múltiples Workspaces, Dual Pane y rutas recientes quedan para otra versión. Edición de fechas internas EXIF/QuickTime, fechas manuales, ExifTool, reglas avanzadas y ejecución automática siguen fuera de esta versión.
