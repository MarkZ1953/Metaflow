import { useDeferredValue, useMemo } from 'react';
import { Alert, Box, Button, LinearProgress, Stack, Typography } from '@mui/material';
import FolderOpenOutlined from '@mui/icons-material/FolderOpenOutlined';
import SearchOffRounded from '@mui/icons-material/SearchOffRounded';
import { useExplorerStore } from '../store/explorer-store';
import { usePreferencesStore } from '../../../app/store/preferences-store';
import { filterAndSortFiles } from '../services/file-query';
import { ExplorerToolbar } from '../components/explorer-toolbar';
import { FileTable } from '../components/file-table';
import { WelcomeState } from '../components/welcome-state';
import { EmptyState } from '../../../shared/components/empty-state';
import { formatCount, formatSize, formatQuantity } from '../../../shared/utils/format';

export function FileExplorer({
  detailsOpen,
  onToggleDetails,
}: {
  detailsOpen: boolean;
  onToggleDetails: () => void;
}) {
  const {
    listing,
    query,
    category,
    extension,
    minimumSize,
    sortField,
    sortDirection,
    status,
    error,
    demo,
    clearFilters,
    clearError,
    refresh,
  } = useExplorerStore();
  const showHidden = usePreferencesStore((state) => state.showHidden);
  const deferredQuery = useDeferredValue(query);
  const entries = useMemo(
    () =>
      filterAndSortFiles(
        listing?.entries ?? [],
        { query: deferredQuery, category, extension, minimumSize, showHidden },
        sortField,
        sortDirection,
      ),
    [
      listing,
      deferredQuery,
      category,
      extension,
      minimumSize,
      showHidden,
      sortField,
      sortDirection,
    ],
  );
  const totalSize = useMemo(
    () => entries.reduce((size, entry) => size + (entry.size ?? 0), 0),
    [entries],
  );
  const hasFilters = !!query || category !== 'all' || !!extension || minimumSize !== null;
  return (
    <Box
      component="main"
      sx={{
        minWidth: 0,
        minHeight: 0,
        height: '100%',
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <ExplorerToolbar
        count={entries.length}
        detailsOpen={detailsOpen}
        onToggleDetails={onToggleDetails}
      />
      <Box sx={{ height: 3, flexShrink: 0 }}>
        {status === 'loading' && <LinearProgress aria-label="Leyendo carpeta" sx={{ height: 3 }} />}
      </Box>
      {error && (
        <Alert
          severity="error"
          onClose={clearError}
          action={
            status === 'error' ? (
              <Button color="inherit" size="small" onClick={() => void refresh()}>
                Reintentar
              </Button>
            ) : undefined
          }
          sx={{ mx: 3, my: 1.5 }}
        >
          {error}
        </Alert>
      )}
      {demo && (
        <Alert severity="info" sx={{ mx: 3, mb: 1.5, py: 0 }}>
          <Typography variant="caption">
            Demostración con archivos de ejemplo. No representa contenido de tu equipo.
          </Typography>
        </Alert>
      )}
      {!!listing?.unreadableCount && (
        <Alert severity="warning" sx={{ mx: 3, mb: 1.5, py: 0 }}>
          <Typography variant="caption">
            {formatCount(listing.unreadableCount)} elementos no se pudieron leer. Puedes actualizar
            para intentarlo de nuevo.
          </Typography>
        </Alert>
      )}
      {listing ? (
        entries.length > 0 ? (
          <FileTable entries={entries} />
        ) : (
          <Box sx={{ flex: 1 }}>
            <EmptyState
              icon={hasFilters ? SearchOffRounded : FolderOpenOutlined}
              title={
                hasFilters ? 'No encontramos coincidencias' : 'Una carpeta sin archivos visibles'
              }
              description={
                hasFilters
                  ? 'Prueba con otro nombre o ajusta los filtros de esta carpeta.'
                  : 'Elige otra ubicación o activa los archivos ocultos en Ajustes.'
              }
              action={
                hasFilters ? (
                  <Button variant="outlined" onClick={clearFilters}>
                    Limpiar filtros
                  </Button>
                ) : undefined
              }
            />
          </Box>
        )
      ) : (
        <WelcomeState />
      )}
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        sx={{ height: 33, minHeight: 33, px: 3, borderTop: 1, borderColor: 'divider', gap: 2 }}
      >
        <Typography variant="caption" color="text.secondary" aria-live="polite">
          {status === 'loading'
            ? 'Leyendo carpeta…'
            : listing
              ? `${formatQuantity(entries.filter((entry) => entry.kind !== 'directory').length, 'archivo', 'archivos')} · ${formatQuantity(entries.filter((entry) => entry.kind === 'directory').length, 'carpeta', 'carpetas')} · ${formatSize(totalSize)}`
              : 'Listo para explorar'}
        </Typography>
        <Typography variant="caption" color="text.disabled" sx={{ whiteSpace: 'nowrap' }}>
          {listing ? 'Doble clic para abrir una carpeta' : 'Organize. Automate. Find.'}
        </Typography>
      </Stack>
    </Box>
  );
}
