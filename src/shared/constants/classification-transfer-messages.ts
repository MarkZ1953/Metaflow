export const classificationTransferMessages = {
  title: 'Transferir selección',
  selected: 'archivos seleccionados',
  hint: 'Elige una carpeta para este lote. Puedes repetirlo con otras selecciones y carpetas.',
  destination: 'Carpeta de destino',
  chooseDestination: 'Elegir carpeta',
  mode: 'Acción',
  move: 'Mover a la carpeta',
  copy: 'Copiar a la carpeta',
  moveHint:
    'Mover retira los archivos del origen y de esta galería cuando la transferencia termina.',
  copyHint: 'Copiar guarda otra copia y conserva los archivos en el origen.',
  conflict: 'Si el nombre existe',
  skip: 'Omitir',
  keepBoth: 'Conservar ambos',
  replace: 'Reemplazar con respaldo',
  cancel: 'Cancelar',
  edit: 'Cambiar opciones',
  preview: 'Revisar transferencia',
  executeMove: 'Mover archivos',
  executeCopy: 'Copiar archivos',
  previewLabel: 'Archivos que se transferirán',
  source: 'Origen',
  target: 'Destino',
  action: 'Acción',
  backup: 'Respaldar existente',
  moveAction: 'Mover',
  copyAction: 'Copiar',
  skipAction: 'Omitir',
  integrity:
    'Se comprueba el contenido antes de transferir. La operación queda en el historial y se puede deshacer.',
  expired:
    'La selección ya no corresponde al análisis actual. Cierra esta ventana y selecciona los archivos de nuevo.',
  noTransferred:
    'No se transfirió ningún archivo. Los originales siguen en la galería; revisa las incidencias o el historial.',
  backupOnly:
    'No se transfirió ningún archivo seleccionado, pero se guardaron respaldos del destino. Puedes deshacer la operación para restaurarlos.',
  finished: (count: number, mode: 'move' | 'copy') =>
    `${count} ${count === 1 ? 'archivo' : 'archivos'} ${mode === 'move' ? 'movido' : 'copiado'}${count === 1 ? '' : 's'}. Puedes deshacer la transferencia.`,
  partial: 'Algunos archivos quedaron en el origen. Revisa los resultados en el historial.',
} as const;
