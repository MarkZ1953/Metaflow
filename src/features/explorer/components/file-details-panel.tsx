import { Alert, Box, Chip, Divider, Stack, Typography } from '@mui/material';
import CloseRounded from '@mui/icons-material/CloseRounded';
import InfoOutlined from '@mui/icons-material/InfoOutlined';
import ShieldOutlined from '@mui/icons-material/ShieldOutlined';
import FolderOutlined from '@mui/icons-material/FolderOutlined';
import { useExplorerStore } from '../store/explorer-store';
import { ActionButton } from '../../../shared/components/action-button';
import { FileIcon } from './file-icon';
import { categoryNames } from '../../../shared/constants/categories';
import { formatDate, formatSize } from '../../../shared/utils/format';

function Property({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <Box>
      <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.5 }}>
        {label}
      </Typography>
      <Typography
        variant="body2"
        sx={{
          overflowWrap: 'anywhere',
          fontFamily: mono ? 'ui-monospace, Consolas, monospace' : undefined,
          fontSize: mono ? 11 : undefined,
          lineHeight: 1.7,
        }}
      >
        {value}
      </Typography>
    </Box>
  );
}

export function FileDetailsPanel({ onClose }: { onClose: () => void }) {
  const { selected, listing } = useExplorerStore();
  return (
    <Box
      component="aside"
      aria-label="Información del archivo"
      sx={{
        width: 292,
        height: '100%',
        maxWidth: '100%',
        bgcolor: 'background.paper',
        borderLeft: 1,
        borderColor: 'divider',
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
      }}
    >
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        sx={{ height: 50, px: 2.4, borderBottom: 1, borderColor: 'divider', flexShrink: 0 }}
      >
        <Typography variant="body2" sx={{ fontWeight: 600 }}>
          Detalles
        </Typography>
        <ActionButton label="Cerrar panel de detalles" icon={CloseRounded} onClick={onClose} />
      </Stack>
      {selected ? (
        <Box sx={{ overflowY: 'auto', p: 2.5, flex: 1 }}>
          <Stack alignItems="center" sx={{ pt: 1.5, pb: 3 }} spacing={1.8}>
            <FileIcon entry={selected} large />
            <Typography
              variant="h3"
              sx={{ textAlign: 'center', overflowWrap: 'anywhere', width: '100%', fontSize: 15 }}
            >
              {selected.name}
            </Typography>
            <Chip
              label={
                selected.kind === 'symlink' ? 'Enlace simbólico' : categoryNames[selected.category]
              }
              variant="outlined"
            />
          </Stack>
          <Divider sx={{ mb: 2.5 }} />
          <Typography variant="overline" color="text.secondary">
            Información del archivo
          </Typography>
          <Stack spacing={2.2} sx={{ mt: 1.5 }}>
            <Stack direction="row" spacing={4}>
              <Property
                label="Tamaño"
                value={selected.kind === 'directory' ? 'No calculado' : formatSize(selected.size)}
              />
              <Property
                label="Extensión"
                value={selected.extension ? `.${selected.extension}` : 'Sin extensión'}
              />
            </Stack>
            <Property label="Ruta" value={selected.path} mono />
            <Property label="Ruta relativa" value={selected.relativePath} mono />
            <Property label="Tipo MIME" value={selected.mimeType ?? 'No disponible'} mono />
            <Property
              label="Identificación del tipo"
              value={
                selected.typeSource === 'content'
                  ? 'Firma del contenido'
                  : selected.typeSource === 'extension'
                    ? 'Estimado por extensión'
                    : 'No identificado'
              }
            />
            <Property label="Última modificación" value={formatDate(selected.modifiedAt, true)} />
            <Property label="Fecha de creación" value={formatDate(selected.createdAt, true)} />
            <Property label="Último acceso" value={formatDate(selected.accessedAt, true)} />
            {selected.readonly && (
              <Chip
                label="Archivo de solo lectura"
                size="small"
                variant="outlined"
                sx={{ alignSelf: 'flex-start' }}
              />
            )}
            {selected.hidden && (
              <Chip
                label="Archivo oculto"
                size="small"
                variant="outlined"
                sx={{ alignSelf: 'flex-start' }}
              />
            )}
            {selected.kind === 'symlink' && (
              <Alert severity="info" sx={{ fontSize: 12 }}>
                Los enlaces simbólicos y puntos de redirección no se abren en esta versión.
              </Alert>
            )}
          </Stack>
        </Box>
      ) : (
        <Stack
          alignItems="center"
          justifyContent="center"
          sx={{ flex: 1, px: 3, pb: 5, textAlign: 'center' }}
          spacing={1.3}
        >
          <Box
            sx={{
              width: 60,
              height: 60,
              bgcolor: 'action.hover',
              borderRadius: 2,
              display: 'grid',
              placeItems: 'center',
              mb: 1,
            }}
          >
            <InfoOutlined sx={{ fontSize: 26, color: 'text.disabled' }} />
          </Box>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            Cada archivo tiene una historia
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Selecciona un archivo para ver su información y ubicación.
          </Typography>
          {listing && (
            <Stack
              spacing={1}
              sx={{
                mt: '32px !important',
                width: '100%',
                textAlign: 'left',
                border: 1,
                borderColor: 'divider',
                borderRadius: 1.5,
                p: 1.5,
              }}
            >
              <Stack direction="row" spacing={1} alignItems="center">
                <FolderOutlined sx={{ fontSize: 16, color: 'warning.main' }} />
                <Typography variant="caption" sx={{ fontWeight: 600 }}>
                  Carpeta actual
                </Typography>
              </Stack>
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ overflowWrap: 'anywhere' }}
              >
                {listing.path}
              </Typography>
            </Stack>
          )}
        </Stack>
      )}
      <Stack
        direction="row"
        alignItems="center"
        spacing={0.8}
        sx={{ borderTop: 1, borderColor: 'divider', px: 2.5, py: 1.5, flexShrink: 0 }}
      >
        <ShieldOutlined sx={{ fontSize: 14, color: 'success.main' }} />
        <Typography variant="caption" color="text.secondary">
          Transferencias con preview e historial
        </Typography>
      </Stack>
    </Box>
  );
}
