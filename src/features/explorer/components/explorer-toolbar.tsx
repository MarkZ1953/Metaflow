import { useState } from 'react';
import {
  Box,
  Breadcrumbs,
  Button,
  Chip,
  Divider,
  Menu,
  MenuItem,
  Stack,
  Typography,
} from '@mui/material';
import ArrowBackRounded from '@mui/icons-material/ArrowBackRounded';
import ArrowForwardRounded from '@mui/icons-material/ArrowForwardRounded';
import ArrowUpwardRounded from '@mui/icons-material/ArrowUpwardRounded';
import RefreshRounded from '@mui/icons-material/RefreshRounded';
import FolderOutlined from '@mui/icons-material/FolderOutlined';
import AddRounded from '@mui/icons-material/AddRounded';
import ChevronRightRounded from '@mui/icons-material/ChevronRightRounded';
import FilterListRounded from '@mui/icons-material/FilterListRounded';
import SwapVertRounded from '@mui/icons-material/SwapVertRounded';
import ViewSidebarOutlined from '@mui/icons-material/ViewSidebarOutlined';
import CheckRounded from '@mui/icons-material/CheckRounded';
import KeyboardArrowDownRounded from '@mui/icons-material/KeyboardArrowDownRounded';
import { ActionButton } from '../../../shared/components/action-button';
import { useExplorerStore } from '../store/explorer-store';
import {
  breadcrumbs,
  folderName,
  formatCount,
  formatSize,
  formatQuantity,
} from '../../../shared/utils/format';
import { usePreferencesStore } from '../../../app/store/preferences-store';
import { categoryLabels } from '../../../shared/constants/categories';
import type { SortField } from '../types/explorer-types';
import { FilterDialog } from './filter-dialog';
import { useWorkspaceStore } from '../../workspace/store/workspace-store';

const sortOptions: { value: SortField; label: string }[] = [
  { value: 'name', label: 'Nombre' },
  { value: 'size', label: 'Tamaño' },
  { value: 'category', label: 'Tipo' },
  { value: 'modifiedAt', label: 'Fecha de modificación' },
];

export function ExplorerToolbar({
  count,
  detailsOpen,
  onToggleDetails,
}: {
  count: number;
  detailsOpen: boolean;
  onToggleDetails: () => void;
}) {
  const {
    listing,
    folders,
    status,
    category,
    query,
    extension,
    minimumSize,
    history,
    historyIndex,
    back,
    forward,
    up,
    refresh,
    navigate,
    picking,
    sortField,
    sortDirection,
    setSort,
    setDirection,
    clearFilters,
  } = useExplorerStore();
  const pickFolder = useWorkspaceStore((s) => s.add);
  const [filterOpen, setFilterOpen] = useState(false);
  const showHidden = usePreferencesStore((state) => state.showHidden);
  const visibleTotal = listing?.entries.filter((entry) => showHidden || !entry.hidden).length ?? 0;
  const [sortAnchor, setSortAnchor] = useState<HTMLElement | null>(null);
  const loading = status === 'loading';
  const hasFilters = category !== 'all' || !!query || !!extension || minimumSize !== null;
  const title = listing ? folderName(listing.path) : 'Explorador';
  return (
    <Box sx={{ flexShrink: 0 }}>
      <Stack
        direction="row"
        spacing={0.5}
        alignItems="center"
        sx={{ height: 50, px: 2.4, borderBottom: 1, borderColor: 'divider' }}
      >
        <ActionButton
          label="Atrás (Alt + ←)"
          icon={ArrowBackRounded}
          disabled={historyIndex <= 0 || loading}
          onClick={() => void back()}
        />
        <ActionButton
          label="Adelante (Alt + →)"
          icon={ArrowForwardRounded}
          disabled={historyIndex >= history.length - 1 || loading}
          onClick={() => void forward()}
        />
        <ActionButton
          label="Carpeta superior (Alt + ↑)"
          icon={ArrowUpwardRounded}
          disabled={!listing?.parentPath || loading}
          onClick={() => void up()}
        />
        <Divider orientation="vertical" flexItem sx={{ mx: '8px !important', my: 1.5 }} />
        <FolderOutlined sx={{ color: 'text.disabled', fontSize: 18 }} />
        <Breadcrumbs
          aria-label="Ruta actual"
          separator={<ChevronRightRounded sx={{ fontSize: 14 }} />}
          sx={{
            minWidth: 0,
            flex: 1,
            overflow: 'hidden',
            '& .MuiBreadcrumbs-ol': { flexWrap: 'nowrap' },
            '& .MuiBreadcrumbs-li': { minWidth: 0 },
          }}
          maxItems={4}
        >
          {listing ? (
            breadcrumbs(listing.path, listing.rootPath).map((crumb, index, crumbs) => (
              <Button
                key={crumb.path}
                color="inherit"
                size="small"
                disabled={loading}
                onClick={() => void navigate(crumb.path)}
                title={crumb.path}
                sx={{
                  minWidth: 0,
                  maxWidth: 180,
                  px: 0.5,
                  color: index === crumbs.length - 1 ? 'text.primary' : 'text.secondary',
                  fontWeight: index === crumbs.length - 1 ? 600 : 400,
                  display: 'block',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {crumb.name}
              </Button>
            ))
          ) : (
            <Typography variant="body2" color="text.secondary">
              Tu espacio de trabajo
            </Typography>
          )}
        </Breadcrumbs>
        <ActionButton
          label="Actualizar carpeta (F5)"
          icon={RefreshRounded}
          disabled={!listing || loading}
          onClick={() => void refresh()}
        />
        <ActionButton
          label={detailsOpen ? 'Ocultar detalles' : 'Mostrar detalles'}
          icon={ViewSidebarOutlined}
          color={detailsOpen ? 'primary' : 'default'}
          onClick={onToggleDetails}
        />
      </Stack>
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        spacing={2}
        sx={{ px: 3, pt: 2.8, pb: 2 }}
      >
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="h2" noWrap title={title}>
            {title}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.4 }}>
            {listing
              ? `${formatQuantity(count, 'elemento', 'elementos')}${hasFilters ? ` de ${formatCount(visibleTotal)}` : ''} · ${category === 'all' ? 'Contenido de la carpeta' : categoryLabels[category]}`
              : `${folders.length ? 'Elige una ubicación para continuar' : 'Una nueva perspectiva de tus archivos'}`}
          </Typography>
        </Box>
        <Button
          variant={listing ? 'outlined' : 'contained'}
          size="small"
          startIcon={<AddRounded />}
          disabled={picking}
          onClick={() => void pickFolder()}
          sx={{ flexShrink: 0 }}
        >
          {listing ? 'Añadir carpeta' : 'Abrir carpeta'}
        </Button>
      </Stack>
      {listing && (
        <Stack direction="row" alignItems="center" spacing={1} sx={{ px: 3, pb: 1.7 }}>
          <Button
            size="small"
            variant="outlined"
            startIcon={<FilterListRounded />}
            onClick={() => setFilterOpen(true)}
            sx={{ color: hasFilters ? 'primary.main' : 'text.secondary' }}
          >
            Filtrar{hasFilters ? ' · activo' : ''}
          </Button>
          <Button
            size="small"
            color="inherit"
            startIcon={<SwapVertRounded />}
            endIcon={<KeyboardArrowDownRounded />}
            onClick={(event) => setSortAnchor(event.currentTarget)}
            sx={{ color: 'text.secondary' }}
          >
            Ordenar
          </Button>
          {extension && (
            <Chip
              label={`.${extension}`}
              onDelete={() => useExplorerStore.getState().setFilters('', minimumSize)}
            />
          )}
          {minimumSize !== null && (
            <Chip
              label={`≥ ${formatSize(minimumSize)}`}
              onDelete={() => useExplorerStore.getState().setFilters(extension, null)}
            />
          )}
          {hasFilters && (
            <Button size="small" onClick={clearFilters} sx={{ ml: 'auto !important' }}>
              Limpiar
            </Button>
          )}
          <Menu anchorEl={sortAnchor} open={!!sortAnchor} onClose={() => setSortAnchor(null)}>
            {sortOptions.map((option) => (
              <MenuItem
                key={option.value}
                selected={sortField === option.value}
                onClick={() => {
                  if (sortField !== option.value) setSort(option.value);
                  setSortAnchor(null);
                }}
                sx={{ gap: 2, minWidth: 210 }}
              >
                <Typography variant="body2" sx={{ flex: 1 }}>
                  {option.label}
                </Typography>
                {sortField === option.value && <CheckRounded fontSize="small" />}
              </MenuItem>
            ))}
            <Divider />
            <MenuItem
              selected={sortDirection === 'asc'}
              onClick={() => {
                setDirection('asc');
                setSortAnchor(null);
              }}
            >
              Ascendente
            </MenuItem>
            <MenuItem
              selected={sortDirection === 'desc'}
              onClick={() => {
                setDirection('desc');
                setSortAnchor(null);
              }}
            >
              Descendente
            </MenuItem>
          </Menu>
          {filterOpen && <FilterDialog onClose={() => setFilterOpen(false)} />}
        </Stack>
      )}
    </Box>
  );
}
