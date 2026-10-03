# Verificación de Metaflow 0.4.0

Fecha: 3 de octubre de 2026. Plataforma: Windows x64.

## Resultado

- `npm run lint`: correcto, sin advertencias.
- `npm test`: 72 pruebas correctas, incluidas 24 nuevas del flujo de clasificación.
- `npm run build`: compilación TypeScript y Vite correcta.
- `npm run test:rust`: 85 pruebas correctas; las dos pruebas con componentes descargados se ejecutaron por separado.
- `npm run rust -- test --locked --lib -- --ignored --nocapture`: ambas pruebas correctas. Total: 87 pruebas de Rust.
- `npm run check:rust`: correcto con `-D warnings`. El compilador de recursos de Windows requirió ejecución fuera del entorno restringido.
- `npm run rust -- fmt --check`: correcto.
- `npm run desktop:build`: ejecutable 0.4.0 e instalador NSIS x64 generados correctamente (145,96 MiB). Se comprobó que el ejecutable incluye el bundle frontend final.
- Preparación de recursos: modelo, DLL y ejecutables verificados por SHA-256; URLs y archivos fijados en `src-tauri/resources/classification-assets.json`.

## Cobertura nueva

La clasificación distingue categorías sugeridas y afinidades relativas. Un resultado débil o con varias categorías cercanas queda como no concluyente. Los vectores de texto se generan con el encoder FP16 y sin optimización de grafo; el encoder de texto cuantizado producía clasificaciones incorrectas del retrato de referencia. El generador verifica los assets de desarrollo y reproduce exactamente el JSON incluido.

El smoke nativo carga ONNX Runtime CPU y el modelo real. Reconoce dos copias de un retrato público como personas, una foto pública de un mapache como animales, una interfaz generada como captura, una factura generada como documento y una imagen humorística generada como meme. El meme también obtiene etiquetas cercanas y queda no concluyente. Estas muestras comprueban la integración; no constituyen una medición general de precisión.

La prueba de video genera un MP4 local y clasifica sus fotogramas mediante el modelo real, sin predicciones precargadas. La vista previa devuelve tres JPEG con tiempos crecientes y dimensiones originales. Un playlist disfrazado de MP4 se rechaza sin seguir sus referencias.

Las pruebas del flujo cubren raíces autorizadas, selección de carpeta y subcarpetas, identificadores falsos o anteriores, límites de decodificación, hash completo después de editar preservando tamaño y fechas, cancelación antes de adquirir el bloqueo y durante el análisis, caché persistente y protección de directorios durante la extracción de video. La protección por contenido persiste y alcanza copias idénticas, incluidos hardlinks. Duplicados y el ejecutor común rechazan retirar contenido protegido. La retirada genera journal y respaldo; Deshacer restaura los archivos. El lote existente de 5.000 archivos y su restauración completa sigue pasando.

Las pruebas frontend verifican contratos IPC, filtros no excluyentes, selección explícita limitada a 1.000 elementos, propagación de protección, errores parciales, respuestas tardías, cancelación mientras se registra el listener y caché limitada de vistas previas. Conservar y siguiente salta las copias idénticas recién protegidas que desaparecen del filtro Sin proteger y cierra la revisión cuando no quedan candidatos posteriores.

## Observación de escritorio

Se compiló y abrió una aplicación de prueba con identificador y SQLite independientes. La galería de nueve archivos se observó con imágenes, categorías, estado no concluyente y un archivo dañado. Las rutas correspondían exclusivamente a fixtures públicos o generados en `.verification`.

La segunda comprobación visual fue detenida por el usuario con Escape. No se completó la navegación nativa del diálogo ampliado ni se retiraron archivos mediante la interfaz. La revisión, protección, cancelación y recuperación se comprobaron mediante pruebas del store y del backend.

## Distribución y límites

El instalador NSIS incluye el modelo, ONNX Runtime, FFmpeg/ffprobe, los vectores y sus licencias. El ejecutable directo requiere la carpeta `classification` que la compilación coloca a su lado. La aplicación no descarga modelos ni transmite fotografías durante el análisis.

Las categorías no determinan qué archivos tienen valor personal. La selección y la retirada son manuales. El análisis está limitado a 10.000 archivos por sesión y los videos se muestrean en tres posiciones; una escena breve puede no aparecer. HEIC y AVIF requieren conversión previa. Los archivos retirados permanecen en `.metaflow-recovery` hasta que el usuario gestione esos respaldos.
