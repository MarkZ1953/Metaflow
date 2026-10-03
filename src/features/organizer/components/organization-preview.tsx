import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import ArrowForwardRounded from '@mui/icons-material/ArrowForwardRounded';
import { useWorkflowStore } from '../../inbox/store/workflow-store';
import type { PlanItem } from '../../inbox/schemas/inbox-schema';
import { VirtualTable, type VirtualColumn } from '../../../shared/components/virtual-table';
import { messages as t } from '../../../shared/constants/messages';
import { formatDate, formatSize, folderName } from '../../../shared/utils/format';
import { PlanIssues } from './plan-issues';
import { PlanSummary } from './plan-summary';
import { workspaceMessages as w } from '../../../shared/constants/workspace-messages';

const columns: VirtualColumn<PlanItem>[] = [
  {
    label: t.from,
    width: 'minmax(240px,1fr)',
    render: (r) => (
      <Box>
        <Typography noWrap fontWeight={550} title={r.sourcePath}>
          {folderName(r.sourcePath)}
        </Typography>
        <Typography
          variant="caption"
          noWrap
          display="block"
          color="text.secondary"
          title={r.sourcePath}
        >
          {r.sourcePath}
        </Typography>
      </Box>
    ),
  },
  {
    label: t.to,
    width: 'minmax(240px,1fr)',
    render: (r) => (
      <Box>
        <Typography
          noWrap
          fontWeight={550}
          color={r.action === 'skip' ? 'text.secondary' : 'primary.light'}
          title={r.destinationPath}
        >
          {folderName(r.destinationPath)}
        </Typography>
        <Typography
          variant="caption"
          noWrap
          display="block"
          color="text.secondary"
          title={r.destinationPath}
        >
          {r.destinationPath}
        </Typography>
      </Box>
    ),
  },
  {
    label: t.rule,
    width: '135px',
    render: (r) => (
      <Box>
        <Typography variant="body2">{r.ruleName}</Typography>
        <Typography variant="caption" color="text.secondary">
          {t.sourceLabels[r.dateSource]}
        </Typography>
      </Box>
    ),
  },
  {
    label: t.date,
    width: '148px',
    render: (r) => <Typography variant="caption">{formatDate(r.dateUsed)}</Typography>,
  },
  {
    label: t.action,
    width: '100px',
    render: (r) => (
      <Chip
        variant="outlined"
        size="small"
        color={r.action === 'move' ? 'success' : 'warning'}
        label={r.backup ? w.respaldar : r.action === 'move' ? t.move : t.skip}
      />
    ),
  },
];
export function OrganizationPreview() {
  const { plan, busy, closePlan, execute, policy, preview, demo, duplicateAction, resolutions } =
    useWorkflowStore();
  if (!plan) return null;
  const moveItems = plan.items.filter((i) => i.action === 'move');
  const conflicts = plan.items.filter((i) => i.conflict).length;
  return (
    <Dialog
      open
      fullWidth
      maxWidth="lg"
      onClose={busy ? undefined : closePlan}
      slotProps={{ paper: { sx: { height: '82vh', maxHeight: 850 } } }}
    >
      <DialogTitle>
        <Typography component="span" variant="h2">
          {t.previewTitle}
        </Typography>
        <Typography color="text.secondary" sx={{ mt: 0.5 }}>
          {t.previewBody}
        </Typography>
      </DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, minHeight: 0 }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={2}>
          <Box>
            <Typography fontWeight={600}>
              {moveItems.length} {t.moveCount} ·{' '}
              {formatSize(moveItems.reduce((sum, i) => sum + i.stamp.size, 0))}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {plan.unmatchedCount + plan.items.length - moveItems.length} {t.keepInbox} ·{' '}
              {conflicts} {t.conflicts}
            </Typography>
          </Box>
          <TextField
            select
            label={t.conflictPolicy}
            value={policy}
            disabled={busy}
            sx={{ minWidth: 210 }}
            onChange={(e) => {
              if (
                e.target.value === 'skip' ||
                e.target.value === 'keep-both' ||
                e.target.value === 'replace'
              )
                void preview(e.target.value);
            }}
          >
            <MenuItem value="skip">{t.skip}</MenuItem>
            <MenuItem value="keep-both">{t.keepBoth}</MenuItem>
            <MenuItem value="replace">Reemplazar con respaldo</MenuItem>
          </TextField>
        </Stack>
        <PlanSummary plan={plan} />
        <PlanIssues
          plan={plan}
          busy={busy}
          policy={policy}
          duplicateAction={duplicateAction}
          resolutions={resolutions}
          onRebuild={preview}
        />
        <VirtualTable
          rows={plan.items}
          columns={columns}
          rowKey={(i) => i.sourcePath}
          label="Vista previa de movimientos"
        />
        <Alert severity="info">{t.previewSafe}</Alert>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button disabled={busy} onClick={closePlan}>
          {t.cancel}
        </Button>
        <Button
          variant="contained"
          endIcon={<ArrowForwardRounded />}
          disabled={busy || !moveItems.length || demo}
          onClick={() => void execute()}
        >
          {t.apply} ({moveItems.length})
        </Button>
      </DialogActions>
    </Dialog>
  );
}
