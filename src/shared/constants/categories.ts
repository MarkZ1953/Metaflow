import type { Category, CategoryFilter } from '../../features/explorer/types/explorer-types';

export const categoryLabels: Record<CategoryFilter, string> = {
  all: 'Todos los archivos',
  folder: 'Carpetas',
  image: 'Imágenes',
  video: 'Videos',
  audio: 'Audio',
  document: 'Documentos',
  spreadsheet: 'Hojas de cálculo',
  presentation: 'Presentaciones',
  archive: 'Comprimidos',
  code: 'Código',
  executable: 'Aplicaciones',
  other: 'Otros',
};

export const categoryNames: Record<Category, string> = {
  folder: 'Carpeta',
  image: 'Imagen',
  video: 'Video',
  audio: 'Audio',
  document: 'Documento',
  spreadsheet: 'Hoja de cálculo',
  presentation: 'Presentación',
  archive: 'Comprimido',
  code: 'Código',
  executable: 'Aplicación',
  other: 'Otro',
};
