import { useRef } from 'react';
import { Box, ButtonBase, Stack, Typography } from '@mui/material';
import ArrowDownwardRounded from '@mui/icons-material/ArrowDownwardRounded';
import ArrowUpwardRounded from '@mui/icons-material/ArrowUpwardRounded';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useExplorerStore } from '../store/explorer-store';
import { FileIcon } from './file-icon';
import { categoryNames } from '../../../shared/constants/categories';
import { formatDate, formatSize } from '../../../shared/utils/format';
import type { FileEntry, SortField } from '../types/explorer-types';
import { useWorkspaceStore } from '../../workspace/store/workspace-store';
import { startFileDrag, isFileDrag, readFileDrag } from '../../workspace/services/workspace-drag';

const columns = 'minmax(220px, 1fr) 112px 76px 90px 146px';
const headers: { label: string; field?: SortField }[] = [
  { label: 'Nombre', field: 'name' },
  { label: 'Tipo', field: 'category' },
  { label: 'Extensión' },
  { label: 'Tamaño', field: 'size' },
  { label: 'Modificado', field: 'modifiedAt' },
];

export function FileTable({ entries }: { entries: FileEntry[] }) {
  const {
    selected,
    selectedPaths,
    selectPaths,
    select,
    navigate,
    sortField,
    sortDirection,
    setSort,
    status,
  } = useExplorerStore();
  const scrollRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  // React Compiler is not enabled. The mutable virtualizer stays local to this component.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: entries.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 52,
    overscan: 8,
    getItemKey: (index) => entries[index]?.path ?? index,
  });
  const busy = status === 'loading';

  function moveSelection(index: number) {
    const nextIndex = Math.max(0, Math.min(entries.length - 1, index));
    const entry = entries[nextIndex];
    if (!entry) return;
    select(entry);
    virtualizer.scrollToIndex(nextIndex, { align: 'auto' });
  }

  return (
    <Box
      ref={gridRef}
      role="grid"
      tabIndex={0}
      aria-label="Archivos de la carpeta"
      aria-rowcount={entries.length + 1}
      aria-colcount={5}
      aria-busy={busy}
      aria-multiselectable
      onKeyDown={(event) => {
        if (
          !busy &&
          (event.ctrlKey || event.metaKey) &&
          event.key.toLowerCase() === 'a' &&
          event.target === event.currentTarget
        ) {
          event.preventDefault();
          selectPaths(entries.filter((e) => e.kind === 'file').map((e) => e.path));
          return;
        }
        if (
          busy ||
          event.altKey ||
          event.ctrlKey ||
          event.metaKey ||
          event.target !== event.currentTarget
        )
          return;
        const index = entries.findIndex((entry) => entry.path === selected?.path);
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          moveSelection(index + 1);
        } else if (event.key === 'ArrowUp') {
          event.preventDefault();
          moveSelection(index < 0 ? 0 : index - 1);
        } else if (event.key === 'Home') {
          event.preventDefault();
          moveSelection(0);
        } else if (event.key === 'End') {
          event.preventDefault();
          moveSelection(entries.length - 1);
        } else if (event.key === 'Enter' && selected?.kind === 'directory') {
          event.preventDefault();
          void navigate(selected.path);
        }
      }}
      sx={{
        mx: 3,
        mb: 1,
        border: 1,
        borderColor: 'divider',
        borderRadius: 1.2,
        flex: 1,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        bgcolor: 'background.paper',
        '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 2 },
      }}
    >
      <Box ref={scrollRef} sx={{ overflow: 'auto', flex: 1, minHeight: 0 }}>
        <Box
          role="row"
          aria-rowindex={1}
          sx={{
            position: 'sticky',
            top: 0,
            zIndex: 1,
            display: 'grid',
            gridTemplateColumns: columns,
            minWidth: 680,
            height: 39,
            borderBottom: 1,
            borderColor: 'divider',
            bgcolor: 'background.paper',
            px: 1.5,
          }}
        >
          {headers.map((header) => (
            <Box
              role="columnheader"
              key={header.label}
              aria-sort={
                header.field && sortField === header.field
                  ? sortDirection === 'asc'
                    ? 'ascending'
                    : 'descending'
                  : undefined
              }
              sx={{ display: 'flex', alignItems: 'center' }}
            >
              {header.field ? (
                <ButtonBase
                  onClick={() => setSort(header.field!)}
                  sx={{
                    height: '100%',
                    px: 0.7,
                    gap: 0.8,
                    justifyContent: 'flex-start',
                    color: sortField === header.field ? 'text.primary' : 'text.secondary',
                  }}
                >
                  <Typography variant="caption" sx={{ fontWeight: 600 }}>
                    {header.label}
                  </Typography>
                  {sortField === header.field &&
                    (sortDirection === 'asc' ? (
                      <ArrowUpwardRounded sx={{ fontSize: 13 }} />
                    ) : (
                      <ArrowDownwardRounded sx={{ fontSize: 13 }} />
                    ))}
                </ButtonBase>
              ) : (
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ pl: 0.7, fontWeight: 600 }}
                >
                  {header.label}
                </Typography>
              )}
            </Box>
          ))}
        </Box>
        <Box
          role="rowgroup"
          sx={{ position: 'relative', height: virtualizer.getTotalSize(), minWidth: 680 }}
        >
          {virtualizer.getVirtualItems().map((row) => {
            const entry = entries[row.index];
            if (!entry) return null;
            const active = selectedPaths.includes(entry.path);
            return (
              <Box
                key={row.key}
                role="row"
                aria-rowindex={row.index + 2}
                aria-selected={active}
                draggable={!busy && entry.kind === 'file'}
                onDragStart={(event) => {
                  if (entry.kind !== 'file') return;
                  const paths = (active ? selectedPaths : [entry.path]).filter((path) =>
                    entries.some((e) => e.path === path && e.kind === 'file'),
                  );
                  startFileDrag(event.dataTransfer, paths);
                }}
                onDragOver={(event) => {
                  if (entry.kind === 'directory' && isFileDrag(event.dataTransfer)) {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = 'move';
                  }
                }}
                onDrop={(event) => {
                  if (entry.kind === 'directory' && isFileDrag(event.dataTransfer)) {
                    event.preventDefault();
                    event.stopPropagation();
                    useWorkspaceStore
                      .getState()
                      .prepare(readFileDrag(event.dataTransfer), entry.path);
                  }
                }}
                onClick={(event) => {
                  if (!busy) {
                    if (event.shiftKey && selected) {
                      const anchor = entries.findIndex((e) => e.path === selected.path);
                      selectPaths(
                        entries
                          .slice(Math.min(anchor, row.index), Math.max(anchor, row.index) + 1)
                          .map((e) => e.path),
                        entry,
                      );
                    } else if (event.ctrlKey || event.metaKey) {
                      selectPaths(
                        active
                          ? selectedPaths.filter((p) => p !== entry.path)
                          : [...selectedPaths, entry.path],
                        entry,
                      );
                    } else select(entry);
                    gridRef.current?.focus({ preventScroll: true });
                  }
                }}
                onDoubleClick={() => {
                  if (!busy && entry.kind === 'directory') void navigate(entry.path);
                }}
                title={
                  entry.kind === 'directory'
                    ? `${entry.path}\nDoble clic o Enter para abrir`
                    : entry.path
                }
                sx={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: row.size,
                  transform: `translateY(${row.start}px)`,
                  display: 'grid',
                  gridTemplateColumns: columns,
                  px: 1.5,
                  alignItems: 'center',
                  cursor: 'default',
                  userSelect: 'none',
                  borderBottom: 1,
                  borderColor: 'divider',
                  bgcolor: active ? 'action.selected' : 'transparent',
                  '&:hover': { bgcolor: active ? 'action.selected' : 'action.hover' },
                  '&::before': active
                    ? {
                        content: '""',
                        position: 'absolute',
                        left: 0,
                        top: 12,
                        bottom: 12,
                        width: 3,
                        bgcolor: 'primary.main',
                        borderRadius: 2,
                      }
                    : {},
                }}
              >
                <Stack
                  role="gridcell"
                  direction="row"
                  alignItems="center"
                  spacing={1.1}
                  sx={{ minWidth: 0, pr: 1 }}
                >
                  <FileIcon entry={entry} />
                  <Typography variant="body2" noWrap sx={{ fontWeight: active ? 600 : 450 }}>
                    {entry.name}
                  </Typography>
                </Stack>
                <Typography
                  role="gridcell"
                  variant="caption"
                  color="text.secondary"
                  noWrap
                  sx={{ px: 0.7 }}
                >
                  {entry.kind === 'symlink' ? 'Enlace' : categoryNames[entry.category]}
                </Typography>
                <Typography
                  role="gridcell"
                  variant="caption"
                  color="text.disabled"
                  sx={{ pl: 0.7, fontFamily: 'monospace', fontSize: 11 }}
                >
                  {entry.extension ? entry.extension.toUpperCase() : '—'}
                </Typography>
                <Typography
                  role="gridcell"
                  variant="caption"
                  color="text.secondary"
                  sx={{ pl: 0.7, fontVariantNumeric: 'tabular-nums' }}
                >
                  {formatSize(entry.size)}
                </Typography>
                <Typography
                  role="gridcell"
                  variant="caption"
                  color="text.secondary"
                  sx={{ pl: 0.7 }}
                >
                  {entry.modifiedAt === null ? '—' : formatDate(entry.modifiedAt)}
                </Typography>
              </Box>
            );
          })}
        </Box>
      </Box>
    </Box>
  );
}
