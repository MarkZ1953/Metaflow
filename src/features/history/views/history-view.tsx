import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Stack,
  Typography,
} from '@mui/material';
import HistoryRounded from '@mui/icons-material/HistoryRounded';
import UndoRounded from '@mui/icons-material/UndoRounded';
import { useWorkflowStore } from '../../inbox/store/workflow-store';
import { StatusChip } from '../../inbox/components/status-chip';
import { VirtualTable, type VirtualColumn } from '../../../shared/components/virtual-table';
import type { HistoryItem } from '../../inbox/schemas/inbox-schema';
import { messages as t } from '../../../shared/constants/messages';
import { formatDateTime, folderName } from '../../../shared/utils/format';
import { friendlyError } from '../../../shared/services/app-error';
import { workspaceMessages as w } from '../../../shared/constants/workspace-messages';
import { metadataMessages as m } from '../../../shared/constants/metadata-messages';

const columns: VirtualColumn<HistoryItem>[] = [
  {
    label: w.accion,
    width: '90px',
    render: (i) => (
      <Typography variant="caption">
        {i.kind === 'mkdir'
          ? w.crearCarpeta
          : i.kind === 'rmdir'
            ? w.retirarVacA
            : i.kind === 'dates'
              ? m.history
              : i.kind === 'skip'
                ? m.omitted
                : i.kind === 'copy'
                  ? 'COPY'
                  : 'MOVE'}
      </Typography>
    ),
  },
  {
    label: t.file,
    width: '180px',
    render: (i) => (
      <Typography noWrap title={i.sourcePath} fontWeight={550}>
        {folderName(i.sourcePath)}
      </Typography>
    ),
  },
  {
    label: t.from,
    width: 'minmax(220px,1fr)',
    render: (i) => (
      <Typography variant="caption" sx={{ overflowWrap: 'anywhere' }} title={i.sourcePath}>
        {i.sourcePath}
      </Typography>
    ),
  },
  {
    label: t.to,
    width: 'minmax(220px,1fr)',
    render: (i) => (
      <Typography variant="caption" sx={{ overflowWrap: 'anywhere' }} title={i.destinationPath}>
        {i.dateChange
          ? `${formatDateTime(i.stamp.modifiedAt)} → ${formatDateTime(i.dateUsed)}`
          : i.destinationPath}
      </Typography>
    ),
  },
  {
    label: t.rule,
    width: '140px',
    render: (i) => (
      <Box>
        <Typography variant="body2">{i.ruleName}</Typography>
        <Typography variant="caption" color="text.secondary">
          {t.sourceLabels[i.dateSource]} · {formatDateTime(i.dateUsed)}
        </Typography>
      </Box>
    ),
  },
  {
    label: t.status,
    width: '220px',
    render: (i) => (
      <Box>
        <StatusChip status={i.status} />
        {i.error && (
          <Typography
            variant="caption"
            color="error.main"
            display="block"
            noWrap
            title={friendlyError({ code: i.error })}
          >
            {friendlyError({ code: i.error })}
          </Typography>
        )}
      </Box>
    ),
  },
];
export function HistoryView() {
  const { history, busy, undo, demo } = useWorkflowStore();
  const [selected, setSelected] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const operation = history.find((o) => o.id === selected) ?? history[0];
  const completed = operation?.items.filter((i) => i.status === 'completed').length ?? 0;
  const dates = operation?.items.some((i) => i.dateChange || i.kind === 'dates') ?? false;
  const undoHint = dates ? m.undoHint : t.undoHint;
  const operationColumns = dates
    ? columns.map((column, index) => (index === 3 ? { ...column, label: m.historyChange } : column))
    : columns;
  return (
    <Box
      component="main"
      sx={{
        flex: 1,
        minWidth: 0,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        p: { xs: 2, md: 3 },
        gap: 2,
      }}
    >
      <Box>
        <Typography variant="h2">{t.history}</Typography>
        <Typography color="text.secondary" sx={{ mt: 0.5 }}>
          {t.historySubtitle}
        </Typography>
      </Box>
      {!operation ? (
        <Box sx={{ flex: 1, display: 'grid', placeItems: 'center', textAlign: 'center' }}>
          <Box>
            <HistoryRounded sx={{ fontSize: 45, color: 'text.disabled', mb: 1 }} />
            <Typography variant="h3">{t.emptyHistory}</Typography>
            <Typography color="text.secondary" sx={{ mt: 1 }}>
              {t.emptyHistoryBody}
            </Typography>
          </Box>
        </Box>
      ) : (
        <>
          <Stack direction="row" spacing={1} sx={{ overflowX: 'auto', flexShrink: 0, pb: 0.5 }}>
            {history.map((o) => (
              <Button
                key={o.id}
                variant={o.id === operation.id ? 'contained' : 'outlined'}
                sx={{ whiteSpace: 'nowrap', flexShrink: 0 }}
                onClick={() => setSelected(o.id)}
              >
                {formatDateTime(o.createdAt)} · {o.items.length}
              </Button>
            ))}
          </Stack>
          <Stack direction="row" justifyContent="space-between" alignItems="center">
            <Stack direction="row" spacing={1.5} alignItems="center">
              <Typography variant="h3">
                {dates
                  ? m.history
                  : operation.items.some((i) => i.kind === 'move')
                    ? 'MOVE'
                    : 'COPY'}
                {' · '}
                {operation.items.length} {t.file.toLowerCase()}s
              </Typography>
              <StatusChip status={operation.status} />
            </Stack>
            <Button
              variant="outlined"
              startIcon={<UndoRounded />}
              disabled={busy || !completed || demo}
              onClick={() => setConfirming(true)}
            >
              {t.undo} ({completed})
            </Button>
          </Stack>
          {operation.status === 'recovery-required' && (
            <Alert severity="warning">{t.recoveryHint}</Alert>
          )}
          <VirtualTable
            rows={operation.items}
            columns={operationColumns}
            rowKey={(i) => i.id}
            label="Resultados de la operación"
          />
          <Typography variant="caption" color="text.secondary">
            {undoHint}
          </Typography>
        </>
      )}
      <Dialog open={confirming} onClose={() => setConfirming(false)} maxWidth="sm" fullWidth>
        <DialogTitle>
          {t.undoTitle} · {completed}
        </DialogTitle>
        <DialogContent>
          <DialogContentText>{undoHint}</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirming(false)}>{t.cancel}</Button>
          <Button
            variant="contained"
            startIcon={<UndoRounded />}
            onClick={() => {
              setConfirming(false);
              if (operation) void undo(operation.id);
            }}
          >
            {t.undo}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
