import { Box, Button, Stack, Typography } from '@mui/material';
import AddRounded from '@mui/icons-material/AddRounded';
import FolderRounded from '@mui/icons-material/FolderRounded';
import DescriptionOutlined from '@mui/icons-material/DescriptionOutlined';
import ImageOutlined from '@mui/icons-material/ImageOutlined';
import ShieldOutlined from '@mui/icons-material/ShieldOutlined';
import DevicesOutlined from '@mui/icons-material/DevicesOutlined';
import TuneRounded from '@mui/icons-material/TuneRounded';
import ArrowForwardRounded from '@mui/icons-material/ArrowForwardRounded';
import { useExplorerStore } from '../store/explorer-store';
import { isDesktop } from '../services/explorer-service';
import { useWorkspaceStore } from '../../workspace/store/workspace-store';

export function WelcomeState() {
  const { picking, startDemo } = useExplorerStore();
  const pickFolder = useWorkspaceStore((s) => s.add);
  return (
    <Stack
      alignItems="center"
      justifyContent="center"
      sx={{ flex: 1, minHeight: 0, overflowY: 'auto', px: 4, py: 5, textAlign: 'center' }}
    >
      <Box
        aria-hidden="true"
        sx={{ position: 'relative', width: 180, height: 108, mb: 4, flexShrink: 0 }}
      >
        <Box
          sx={{
            position: 'absolute',
            left: 12,
            top: 10,
            width: 67,
            height: 80,
            border: 1,
            borderColor: 'divider',
            bgcolor: 'background.paper',
            transform: 'rotate(-14deg)',
            borderRadius: 2,
            display: 'grid',
            placeItems: 'center',
            color: 'info.main',
          }}
        >
          <DescriptionOutlined sx={{ fontSize: 30 }} />
        </Box>
        <Box
          sx={{
            position: 'absolute',
            right: 10,
            top: 8,
            width: 67,
            height: 80,
            border: 1,
            borderColor: 'divider',
            bgcolor: 'background.paper',
            transform: 'rotate(14deg)',
            borderRadius: 2,
            display: 'grid',
            placeItems: 'center',
            color: 'secondary.main',
          }}
        >
          <ImageOutlined sx={{ fontSize: 30 }} />
        </Box>
        <Box
          sx={{
            position: 'absolute',
            left: 44,
            top: 24,
            width: 90,
            height: 80,
            bgcolor: 'action.selected',
            border: 1,
            borderColor: 'primary.main',
            borderRadius: 2,
            display: 'grid',
            placeItems: 'center',
            color: 'primary.main',
          }}
        >
          <FolderRounded sx={{ fontSize: 43 }} />
        </Box>
      </Box>
      <Typography variant="overline" color="primary.main" sx={{ mb: 1.3 }}>
        Bienvenido a Metaflow
      </Typography>
      <Typography variant="h1">
        Todo en su lugar.
        <br />
        Empieza por una carpeta.
      </Typography>
      <Typography color="text.secondary" sx={{ mt: 2, maxWidth: 430, lineHeight: 1.8 }}>
        Explora, encuentra y conoce mejor tus archivos.
        <br />
        Un espacio de trabajo local donde tú tienes el control.
      </Typography>
      <Button
        variant="contained"
        startIcon={<AddRounded />}
        onClick={() => void pickFolder()}
        disabled={picking || !isDesktop}
        sx={{ mt: 3, px: 2.7, height: 42 }}
      >
        {picking ? 'Abriendo selector…' : 'Seleccionar carpeta'}
      </Button>
      <Typography variant="caption" color="text.disabled" sx={{ mt: 1.4 }}>
        {isDesktop
          ? 'Elige qué carpetas puede leer Metaflow.'
          : 'La selección de carpetas está disponible en la aplicación de escritorio.'}
      </Typography>
      {!isDesktop && import.meta.env.DEV && (
        <Button
          variant="text"
          size="small"
          endIcon={<ArrowForwardRounded />}
          onClick={() => void startDemo()}
          sx={{ mt: 1 }}
        >
          Explorar demostración
        </Button>
      )}
      <Stack
        direction="row"
        spacing={{ xs: 2, lg: 4 }}
        sx={{
          mt: 6,
          pt: 3,
          borderTop: 1,
          borderColor: 'divider',
          maxWidth: 570,
          width: '100%',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        {[
          { icon: DevicesOutlined, title: '100% local', text: 'Sin conexión ni cuentas' },
          {
            icon: ShieldOutlined,
            title: 'Tus archivos, seguros',
            text: 'Transferencias con preview e historial',
          },
          { icon: TuneRounded, title: 'Encuentra más rápido', text: 'Filtros y orden a tu medida' },
        ].map(({ icon: Icon, title, text }) => (
          <Box key={title} sx={{ flex: 1 }}>
            <Icon sx={{ fontSize: 20, mb: 1, color: 'text.secondary' }} />
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              {title}
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
              {text}
            </Typography>
          </Box>
        ))}
      </Stack>
    </Stack>
  );
}
