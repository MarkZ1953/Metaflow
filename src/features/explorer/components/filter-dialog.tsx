import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { filterSchema } from '../schemas/filter-schema';
import type { FilterValues } from '../schemas/filter-schema';
import { useExplorerStore } from '../store/explorer-store';

export function FilterDialog({ onClose }: { onClose: () => void }) {
  const { extension, minimumSize, setFilters } = useExplorerStore();
  const size = minimumSize === null ? 'all' : String(minimumSize);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FilterValues>({
    resolver: zodResolver(filterSchema),
    defaultValues: {
      extension,
      minimumSize: filterSchema.shape.minimumSize.safeParse(size).success
        ? (size as FilterValues['minimumSize'])
        : 'all',
    },
  });
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs" aria-labelledby="filter-title">
      <form
        onSubmit={(event) =>
          void handleSubmit((values) => {
            setFilters(
              values.extension,
              values.minimumSize === 'all' ? null : Number(values.minimumSize),
            );
            onClose();
          })(event)
        }
      >
        <DialogTitle id="filter-title">Filtrar archivos</DialogTitle>
        <DialogContent>
          <Stack spacing={2.5} sx={{ pt: 1 }}>
            <Typography variant="body2" color="text.secondary">
              Los filtros se aplican al contenido de esta carpeta.
            </Typography>
            <TextField
              label="Extensión"
              placeholder="pdf, jpg, mp4…"
              autoFocus
              {...register('extension')}
              error={!!errors.extension}
              helperText={
                errors.extension?.message ??
                'Una extensión por filtro. Déjala vacía para ver todas.'
              }
            />
            <TextField
              select
              label="Tamaño mínimo"
              defaultValue={size}
              {...register('minimumSize')}
            >
              <MenuItem value="all">Cualquier tamaño</MenuItem>
              <MenuItem value="1048576">1 MB</MenuItem>
              <MenuItem value="10485760">10 MB</MenuItem>
              <MenuItem value="104857600">100 MB</MenuItem>
              <MenuItem value="1073741824">1 GB</MenuItem>
            </TextField>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button onClick={onClose} color="inherit">
            Cancelar
          </Button>
          <Button type="submit" variant="contained">
            Aplicar filtros
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
