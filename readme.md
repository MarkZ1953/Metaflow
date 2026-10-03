# Metaflow 0.5.1

Aplicación de escritorio para organizar un Inbox por fechas, administrar carpetas de distintos discos y depurar imágenes y videos. Las transferencias, la revisión de duplicados y la depuración comparten historial persistente, respaldos y Undo. Windows es la plataforma compatible con operaciones de archivos.

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

En **Duplicados**, pulsa **Buscar duplicados** para revisar las carpetas administradas. Activa **Incluir imágenes parecidas** para encontrar también fotos con distinta resolución o compresión. Los duplicados exactos se comprueban por contenido; las imágenes parecidas son sugerencias para revisar visualmente.

La revisión muestra dos archivos lado a lado, con imagen, ruta, tamaño, fechas y resolución. Usa **Acercar imagen**, **Alejar imagen** y **Ajustar** para comparar los detalles. **Eliminar esta copia** retira únicamente el archivo elegido a recuperación y avanza a la siguiente comparación. **Conservar ambas** o **Siguiente** permiten continuar; **No son iguales · Descartar** guarda el descarte para que no vuelva a aparecer mientras ambos archivos conserven su contenido e identidad. Puedes volver a la comparación anterior o restablecer los descartes para analizarlos otra vez. **Deshacer última eliminación** restaura la última copia retirada.

Las vistas previas admiten JPEG, PNG, GIF, WebP, BMP, TIFF e ICO, con límites de tamaño y resolución. GIF y TIFF se revisan por su primer fotograma o página. Los videos y otros archivos pueden aparecer como duplicados exactos con sus datos, sin vista previa visual. Se informa de archivos inaccesibles y análisis limitados; ninguna coincidencia elimina archivos automáticamente.

Los respaldos permanecen en `.metaflow-recovery`, con rutas registradas en el historial. No se incluyen en análisis de duplicados ni se purgan automáticamente. Undo de copia conserva el original y mueve la copia a recuperación; Undo de movimiento la devuelve al origen. Contenido editado, identidad distinta o rutas ocupadas impiden restaurar ese elemento y conservan los archivos.

## Depuración inteligente de imágenes y videos

1. Abre **Depuración inteligente**. En **Dónde analizar → Carpetas que elijo**, pulsa **Elegir carpetas** para seleccionar una o varias carpetas con el selector de Windows. Puedes añadir más carpetas en otro disco volviendo a abrir el selector, quitar las que no quieras analizar y elegir si incluir subcarpetas y videos. Estas carpetas no se añaden al Workspace. La opción **Todas las carpetas del Workspace y el Inbox** conserva el análisis de todas las carpetas administradas.
2. Pulsa **Analizar imágenes y videos**. La IA CLIP trabaja localmente con la CPU: tus fotos y videos no se envían a un servicio externo. El primer análisis puede tardar más; los resultados se guardan para reutilizarlos cuando el contenido no cambia.
3. Filtra la galería por **Personas**, **Animales**, **Capturas de pantalla**, **Memes**, **Documentos y texto**, **Paisajes**, **Objetos** u **Otros**, además de tipo, estado y nombre/ruta. Las categorías pueden coincidir: un meme con una cara puede aparecer en Personas y en Memes. **No concluyente** indica que debes revisar el contenido; los archivos que no se pudieron analizar también se identifican.
4. Pulsa **Revisar archivo** o **Ampliar** para ver la imagen, acercarla y pasar al archivo anterior o siguiente. Los videos muestran hasta tres fotogramas con su posición temporal; son una muestra y pueden omitir otras escenas.
5. Marca **Conservar**, **Conservar y siguiente** o **Conservar selección** para proteger lo que quieres guardar y ocultarlo de la depuración. Usa **Mostrar conservados** para verlos y seleccionarlos de nuevo, y **Ocultar conservados** para continuar depurando. La decisión se guarda por contenido y también protege sus copias idénticas, incluso en **Duplicados**. **Quitar protección y exclusión** devuelve la selección a archivos normales que puedes eliminar. No impide que otras aplicaciones modifiquen o eliminen esos archivos.
6. Selecciona manualmente lo que quieres retirar y pulsa **Eliminar selección**, o elimina un archivo desde su revisión. La confirmación muestra las rutas y excluye los archivos marcados Conservar y los excluidos de esta depuración. Cada eliminación guarda un respaldo y una operación en **Historial**; puedes usar **Deshacer última operación** o deshacer desde el historial.
7. Para separar las fotos y videos que quieres guardar, selecciónalos y pulsa **Mover / Copiar selección**. Elige una carpeta con el selector de Windows, revisa las rutas y los conflictos y confirma el lote. **Mover** los retira de la carpeta analizada y de la galería; **Copiar** conserva los originales. Los archivos conservados y excluidos también se pueden transferir. Puedes elegir otra carpeta en el siguiente lote. El destino no se añade automáticamente a las carpetas del Workspace, y cada transferencia queda en Historial con Undo.

**Seleccionar todos los visibles** incluye los resultados de los filtros actuales, hasta el límite de 1.000 archivos por lote. Para seleccionar solo conservados, elige el estado **Conservar**; para seleccionar también excluidos, activa **Mostrar excluidos**.

La selección de carpetas admite hasta 32 ubicaciones y se mantiene mientras Metaflow está abierto, incluso si alternas entre el análisis específico y el general. Después de reiniciar, vuelve a elegir las carpetas externas al Workspace para iniciar otro análisis. Cambiar las carpetas no modifica los resultados existentes: pulsa **Analizar imágenes y videos** o **Volver a analizar** para usar la nueva selección. Una selección vacía no inicia un análisis de todo el Workspace. Las carpetas solapadas no duplican archivos; sin subcarpetas, seleccionar un padre y un hijo analiza directamente ambos niveles.

### Mejorar la detección en tu colección

En **Ajustes de detección**, el análisis **Detallado** incluye la imagen completa y recortes adicionales para no perder personas, texto u objetos situados en los bordes. **Rápido** analiza la imagen completa una sola vez. La sensibilidad **Conservadora** limita las sugerencias ambiguas; **Equilibrada** es la opción inicial; **Amplia** muestra más categorías y candidatos para revisar. Los cambios se guardan; pulsa **Volver a analizar** para aplicarlos a la galería.

**Leer texto de las imágenes** usa OCR local de Windows como ayuda para capturas, memes y documentos. Solo refuerza indicios visuales; tener texto no convierte cualquier foto en una captura. El panel muestra si está disponible y los idiomas instalados. Si Windows no dispone de un reconocedor compatible, el análisis visual continúa. Reinicia Metaflow después de instalar idiomas de OCR en Windows para detectarlos. El texto reconocido se procesa temporalmente y no se guarda en SQLite ni se envía a Internet.

Usa **Corregir categorías** en una tarjeta o en la revisión ampliada, o selecciona varios archivos y pulsa **Corregir selección**. Marca una o varias categorías y guarda. La corrección se recuerda por contenido, también en copias idénticas, y aparece como **Tu corrección**. Esta acción es independiente de Conservar y Excluir: no cambia el archivo ni decide si eliminarlo.

Con **Usar mis ejemplos para sugerir categorías en imágenes parecidas** activado, el siguiente análisis compara las imágenes con hasta 256 ejemplos recientes compatibles con el modelo y modo actuales. Solo aplica categorías a imágenes muy parecidas y con ejemplos que no se contradigan; aparecen como **Sugerido por tus ejemplos** y **No concluyente** para revisarlas. No entrena de nuevo CLIP ni garantiza que todos los memes o capturas se detecten. Desactivar la opción conserva tus correcciones exactas y deja de extenderlas a imágenes parecidas.

**Restablecer detección automática** retira la corrección de los archivos elegidos y sus copias idénticas. **Borrar mis ejemplos** elimina todas las correcciones y restablece las etiquetas automáticas de la galería actual; mantiene Conservar y Excluir. No es necesario borrar ejemplos para ajustar la sensibilidad.

Las etiquetas son sugerencias, no una valoración de lo que te interesa ni una garantía de detección. Nada se selecciona ni se elimina automáticamente. No se identifica a una persona concreta: la categoría Personas solo indica contenido visual relacionado con personas.

Cada análisis admite hasta 10.000 archivos multimedia y 100.000 entradas visitadas. Cada selección admite 1.000 archivos; para colecciones mayores, analiza carpetas más pequeñas o revisa varios lotes. Puedes cancelar el análisis y revisar los resultados ya terminados. La caché se asocia al contenido, versión del modelo, modo, sensibilidad y disponibilidad/configuración de OCR. Las correcciones y la protección Conservar se guardan por separado y no desaparecen al renovar esa caché.

Las imágenes compatibles son JPEG, PNG, GIF, WebP, BMP, TIFF e ICO; GIF y TIFF se analizan por su primer fotograma o página. HEIC/HEIF y AVIF no se clasifican en esta versión. Se admiten videos MP4, MOV, MKV, AVI, WebM, M4V, MPG/MPEG, MTS/M2TS, 3GP y WMV cuando sus datos se pueden decodificar. Los archivos deben estar disponibles localmente. Se omiten formatos no compatibles y se informan errores de lectura o decodificación. Los límites de imagen son 64 MiB de archivo, 40 millones de píxeles y 16.384 píxeles por dimensión, además de un límite de memoria de decodificación.

## Revisar con el teclado

En la revisión ampliada de **Depuración inteligente**, usa **← / →** para cambiar de archivo, **C** para conservar y avanzar, y **Supr** para abrir la eliminación del archivo actual. En la galería, selecciona archivos con sus casillas: **Enter** abre la revisión, **C** conserva la selección y **Supr** prepara la eliminación de los seleccionados sin proteger.

Selecciona archivos y pulsa **Excluir selección** o **E** para ocultarlos durante el análisis actual. **Mostrar excluidos** permite revisarlos y seleccionarlos de nuevo, incluidos los conservados. Puedes reincorporarlos uno por uno con **Incluir de nuevo**, o seleccionar un lote y pulsar **Quitar protección y exclusión**. Mientras están excluidos no se eliminan. Son exclusiones temporales: un análisis nuevo vuelve a incluirlos.

En **Duplicados**, **← / →** cambian de comparación. **1 / 2** eligen la copia izquierda o derecha; un borde y una etiqueta muestran cuál usaría Supr. Cada nueva comparación empieza con la derecha elegida. **C** conserva ambas y avanza; **D** descarta el par. También puedes elegir una copia haciendo clic en su tarjeta.

**Supr** abre una confirmación con las rutas concretas. **Enter** confirma con respaldo y **Esc** cancela. **Ctrl+Z** deshace la última retirada de la revisión cuando esté disponible. Los atajos se suspenden durante operaciones y otros diálogos, y respetan campos de búsqueda, menús y controles de edición. Mantener pulsada una tecla no repite decisiones ni confirmaciones.

## Ejecutar y compilar

Stack: Tauri 2, Rust, React, TypeScript, Vite, MUI Community, Zustand, React Hook Form, Zod y SQLite. TanStack Virtual limita las filas del explorador; la galería usa paginación y miniaturas con carga diferida. Rust utiliza notify, chrono, rusqlite, BLAKE3, unicode-normalization e image. CLIP se ejecuta con ONNX Runtime en CPU; FFmpeg/FFprobe extraen fotogramas de los videos. Los archivos reales permanecen en el filesystem.

En Windows necesitas Node.js 22.12 o superior, Rust estable, C++ Build Tools y WebView2. Consulta los [prerrequisitos de Tauri](https://v2.tauri.app/start/prerequisites/).

```powershell
npm ci
npm run assets:prepare
npm run desktop:dev
npm run desktop:build
```

Ejecuta `npm run assets:prepare` antes de desarrollar o compilar para preparar el modelo local, el runtime y las herramientas de video. Esa preparación necesita Internet para descargar los recursos que falten; analizar tus archivos después no necesita conexión. Los recursos se empaquetan con la aplicación. Los scripts utilizan Rust portátil de `.tools/cargo` si existe o la instalación del sistema, sin cambiar el PATH del sistema.

```text
src-tauri/target/release/metaflow.exe
src-tauri/target/release/classification/
src-tauri/target/release/bundle/nsis/Metaflow_0.5.1_x64-setup.exe
```

Producción incluye la interfaz y funciona sin Vite ni conexión. Usa el instalador para distribuirla con sus recursos; si copias el ejecutable, conserva la carpeta `classification` junto a `metaflow.exe`. Copiar únicamente el `.exe` deja la clasificación sin modelo ni herramientas. WebView2 debe estar instalado; el instalador puede descargarlo si falta. La compilación no tiene firma de distribución. `npm run dev` sirve la vista web en `http://127.0.0.1:1420`; el navegador ofrece únicamente una demostración de desarrollo. Las operaciones reales requieren Tauri.

## Garantías y límites

- El árbol carga una carpeta a la vez. El recorrido recursivo se solicita al analizar duplicados, depurar imágenes/videos, transferir una carpeta o corregir sus fechas con subcarpetas; no se recorren discos al arrancar.
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

El [plan técnico](docs/architecture.md) describe la integración; la [verificación de 0.4.3](docs/verification-v043.md) cubre conservados, excluidos y transferencias, la [verificación de 0.5.0](docs/verification-v05.md) registra ajustes, OCR y correcciones de detección, y la [verificación de 0.5.1](docs/verification-v051.md) cubre la selección de carpetas para analizar. Comandos IPC pequeños delegan en servicios y repositorios Rust. `rename-engine`, `duplicate-service` y `file-operation-service` son compartidos por Inbox y Workspace. La corrección de fechas, la revisión visual de duplicados y la depuración inteligente comparten historial y Undo. Las pruebas de clasificación incluyen contratos IPC, etiquetas superpuestas, protección persistente de copias idénticas, selección explícita, límites, cancelación, vistas previas, errores parciales y respuestas tardías. Los textos se centralizan en diccionarios de `src/shared/constants`; el tema MUI conserva claro/oscuro.

SQLite admite más Workspaces y el explorador tiene una fábrica de stores independientes para futuros paneles. Selección de múltiples Workspaces, Dual Pane y rutas recientes quedan para otra versión. Edición de fechas internas EXIF/QuickTime, fechas manuales, ExifTool, reglas avanzadas y ejecución automática siguen fuera de esta versión.
