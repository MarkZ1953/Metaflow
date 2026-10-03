import { z } from 'zod';

const backendErrorSchema = z.object({ code: z.string() });
const errorMessages: Record<string, string> = {
  MEDIA_PROTECTED:
    'Este archivo está marcado para conservar. Desmarca Conservar en Depuración inteligente antes de retirarlo.',
  CLASSIFICATION_REVIEW_EXPIRED:
    'La revisión ya no está disponible. Vuelve a analizar los archivos.',
  INVALID_MEDIA_SELECTION: 'Selecciona entre 1 y 1.000 archivos de la revisión actual.',
  MEDIA_MODEL_UNAVAILABLE:
    'No se pudo cargar el modelo local. Ejecuta Metaflow con su carpeta classification o utiliza el instalador completo.',
  MEDIA_MODEL_INVALID: 'El modelo local no es válido. Reinstala la versión completa de Metaflow.',
  MEDIA_INFERENCE_FAILED: 'No se pudo analizar este archivo con el modelo local.',
  VIDEO_PREVIEW_UNAVAILABLE:
    'Faltan los componentes locales para revisar videos. Reinstala Metaflow.',
  VIDEO_PREVIEW_FAILED:
    'No se pudo leer este video. Revisa que esté disponible localmente y su formato.',
  DUPLICATE_REVIEW_EXPIRED: 'La comparación ya no está disponible. Vuelve a buscar duplicados.',
  UNSUPPORTED_IMAGE: 'Este tipo de archivo no dispone de vista previa de imagen.',
  IMAGE_TOO_LARGE:
    'La imagen supera el tamaño permitido para una vista previa. Comprueba el archivo antes de decidir.',
  TIMESTAMP_PRECISION:
    'El disco no conservó la fecha con la precisión solicitada. Revisa el registro de recuperación antes de continuar.',
  INVALID_NAME:
    'El nombre no es válido para Windows. Revisa caracteres, longitud y nombres reservados.',
  INVALID_PRESET: 'Revisa el preset: nombre, tokens del formato y transformaciones.',
  INVALID_TRANSFER: 'Selecciona archivos y una carpeta de destino válida del Workspace.',
  SAME_DESTINATION: 'El archivo ya está en esa carpeta. Elige otra carpeta o un preset de nombres.',
  TARGET_RESERVED:
    'Varios archivos usarían el mismo destino. Usa Conservar ambos o resuelve los conflictos por archivo.',
  DUPLICATE_ACTION_UNAVAILABLE:
    'Este duplicado pertenece al mismo lote. Usa Conservar ambos u Omitir para resolverlo.',
  OPERATION_CANCELLED:
    'El análisis se canceló. Los archivos permanecen en sus ubicaciones originales.',
  DIRECTORY_NOT_EMPTY:
    'La carpeta contiene archivos. Se conservaron; revisa el resultado parcial del lote.',
  FOLDER_INTO_ITSELF: 'No se puede mover una carpeta dentro de sí misma. Elige otro destino.',
  FOLDER_CONFLICT:
    'La carpeta de destino ya existe. Usa Conservar ambos u Omitir; no se reemplazan árboles completos.',
  FOLDER_USED_BY_CONFIGURATION:
    'Esta carpeta contiene el Inbox o un destino de reglas. Cambia esa configuración antes de moverla.',
  RECOVERY_FOLDER_PRESENT:
    'La carpeta contiene respaldos de Metaflow. Conserva esa ubicación y transfiere sus otras carpetas por separado.',
  FILE_CHANGED:
    'El archivo cambió después del análisis. Vuelve a revisar; no se ha sobrescrito nada.',
  FILE_IN_USE:
    'El archivo está siendo utilizado por otra aplicación. Termina la copia y vuelve a intentarlo.',
  DESTINATION_EXISTS:
    'La ruta de destino ya está ocupada. No se ha sobrescrito el archivo existente.',
  DESTINATION_IS_INBOX: 'El destino debe ser una carpeta diferente del Inbox.',
  INVALID_DESTINATION: 'Selecciona una carpeta de destino existente y accesible.',
  INBOX_REQUIRED: 'Elige primero una carpeta Inbox.',
  INVALID_DATE: 'La fecha o el rango de fechas no es válido.',
  INVALID_RULE: 'Revisa el nombre, fechas y destino de la regla.',
  RULE_CONFLICT: 'Los rangos habilitados se solapan. Ajusta las fechas antes de guardar.',
  MULTIPLE_RULE_MATCHES:
    'El archivo coincide con varias reglas al usar fechas diferentes. Ajusta las fuentes de fecha antes de organizarlo.',
  PLAN_EXPIRED: 'La revisión caducó o cambió la configuración. Genera una nueva vista previa.',
  NO_MATCHED_FILES: 'No hay archivos estables con una regla coincidente para organizar.',
  DATABASE_ERROR:
    'No se pudo guardar el registro local. Comprueba el espacio disponible y reinicia Metaflow.',
  DATABASE_VERSION: 'La base de datos pertenece a una versión más reciente de Metaflow.',
  DISK_FULL: 'No hay espacio suficiente en el destino. El archivo de origen se conserva.',
  INTEGRITY_ERROR:
    'La copia no superó la verificación de contenido. El origen se conserva; revisa el historial.',
  UNSUPPORTED_FILE:
    'Esta ubicación contiene un enlace o un archivo especial que no se puede organizar.',
  UNSUPPORTED_CROSS_VOLUME:
    'Este archivo tiene propiedades especiales. Solo puede moverse dentro del mismo volumen; copiarlo o trasladarlo a otro disco no preservaría todas sus propiedades.',
  UNSUPPORTED_PLATFORM: 'Los movimientos seguros de esta versión están disponibles en Windows.',
  FOLDER_CHANGED: 'La carpeta o el archivo cambió de ubicación. Selecciona la carpeta de nuevo.',
  SOME_FILES_UNREADABLE: 'Algunos archivos no se pueden inspeccionar. Comprueba sus permisos.',
  INTERRUPTED_OPERATION:
    'La operación se interrumpió. Comprueba las rutas del historial antes de continuar.',
  OPERATION_NOT_FOUND: 'No se encontró esta operación en el historial.',
  FILE_NOT_FOUND: 'El archivo o la carpeta ya no existe o ha cambiado de ubicación.',
  PERMISSION_DENIED:
    'Metaflow no tiene permiso para completar esta operación. Comprueba el acceso a las carpetas.',
  FOLDER_NOT_AUTHORIZED: 'Esta carpeta no está autorizada. Añádela desde el selector de carpetas.',
  NOT_A_DIRECTORY: 'La ubicación seleccionada no es una carpeta.',
  UNSUPPORTED_PATH: 'No se puede representar esta ruta. Prueba con otra ubicación.',
  INVALID_RESPONSE:
    'La respuesta del explorador no tiene el formato esperado. Vuelve a intentarlo.',
  DESKTOP_REQUIRED: 'Abre la aplicación de escritorio para elegir y explorar tus carpetas locales.',
  IO_ERROR:
    'No se pudo leer la carpeta. Comprueba que el disco esté conectado y vuelve a intentarlo.',
  INTERNAL_ERROR: 'No se pudo completar la operación. Vuelve a intentarlo.',
};

export function friendlyError(error: unknown): string {
  if (error instanceof z.ZodError) return errorMessages.INVALID_RESPONSE!;
  const result = backendErrorSchema.safeParse(error);
  if (result.success) return errorMessages[result.data.code] ?? errorMessages.INTERNAL_ERROR!;
  return errorMessages.INTERNAL_ERROR!;
}
