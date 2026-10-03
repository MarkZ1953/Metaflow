import { useRef, type ReactNode } from 'react';
import { Box, Typography } from '@mui/material';
import { useVirtualizer } from '@tanstack/react-virtual';

export interface VirtualColumn<T> {
  label: string;
  width: string;
  render(row: T): ReactNode;
}
export function VirtualTable<T>({
  rows,
  columns,
  rowKey,
  label,
  onSelect,
}: {
  rows: T[];
  columns: VirtualColumn<T>[];
  rowKey(row: T): string;
  label: string;
  onSelect?(row: T): void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // The mutable virtualizer is local; React Compiler is not enabled.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtual = useVirtualizer({
    count: rows.length,
    getScrollElement: () => ref.current,
    estimateSize: () => 64,
    overscan: 6,
    getItemKey: (i) => (rows[i] ? rowKey(rows[i]) : i),
  });
  const grid = columns.map((c) => c.width).join(' ');
  return (
    <Box
      role="table"
      aria-label={label}
      aria-rowcount={rows.length + 1}
      sx={{
        border: 1,
        borderColor: 'divider',
        borderRadius: 1.2,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        minHeight: 130,
        bgcolor: 'background.paper',
      }}
    >
      <Box ref={ref} sx={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
        <Box
          role="row"
          sx={{
            display: 'grid',
            gridTemplateColumns: grid,
            minWidth: 850,
            height: 40,
            position: 'sticky',
            top: 0,
            zIndex: 1,
            bgcolor: 'background.paper',
            borderBottom: 1,
            borderColor: 'divider',
            px: 2,
            gap: 2,
            alignItems: 'center',
          }}
        >
          {columns.map((c) => (
            <Typography
              role="columnheader"
              key={c.label}
              variant="caption"
              color="text.secondary"
              fontWeight={600}
            >
              {c.label}
            </Typography>
          ))}
        </Box>
        <Box
          role="rowgroup"
          sx={{ height: virtual.getTotalSize(), position: 'relative', minWidth: 850 }}
        >
          {virtual.getVirtualItems().map((item) => {
            const row = rows[item.index];
            if (!row) return null;
            return (
              <Box
                key={item.key}
                role="row"
                aria-rowindex={item.index + 2}
                tabIndex={onSelect ? 0 : undefined}
                onClick={() => onSelect?.(row)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onSelect?.(row);
                  }
                }}
                sx={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  height: 64,
                  transform: `translateY(${item.start}px)`,
                  display: 'grid',
                  gridTemplateColumns: grid,
                  gap: 2,
                  alignItems: 'center',
                  px: 2,
                  borderBottom: 1,
                  borderColor: 'divider',
                  cursor: onSelect ? 'pointer' : 'default',
                  '&:hover': { bgcolor: 'action.hover' },
                  '&:focus-visible': {
                    outline: '2px solid',
                    outlineColor: 'primary.main',
                    outlineOffset: -2,
                  },
                }}
              >
                {columns.map((c) => (
                  <Box role="cell" key={c.label} sx={{ minWidth: 0, overflow: 'hidden' }}>
                    {c.render(row)}
                  </Box>
                ))}
              </Box>
            );
          })}
        </Box>
      </Box>
    </Box>
  );
}
