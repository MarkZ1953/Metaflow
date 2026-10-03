import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Typography,
} from '@mui/material';
import { useMetadataStore } from '../store/metadata-store';
import { useWorkflowStore } from '../../inbox/store/workflow-store';
import { VirtualTable } from '../../../shared/components/virtual-table';
import { formatDateTime, folderName } from '../../../shared/utils/format';
import { friendlyError } from '../../../shared/services/app-error';
import { metadataMessages as t } from '../../../shared/constants/metadata-messages';
export function MetadataPreview() {
  const { open, plan, error, request, preview, execute, close } = useMetadataStore();
  const busy = useWorkflowStore((s) => s.busy);
  const count = plan?.items.filter((i) => i.action === 'dates').length ?? 0;
  return (
    <Dialog
      open={open}
      fullWidth
      maxWidth="lg"
      onClose={busy ? undefined : close}
      slotProps={{ paper: { sx: { height: '82vh' } } }}
    >
      <DialogTitle>{t.preview}</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', minHeight: 0, gap: 2 }}>
        <Alert severity="info">{t.hint}</Alert>
        {error && <Alert severity="error">{error}</Alert>}
        {plan ? (
          <>
            <Stack direction="row" spacing={1}>
              <Chip label={`${count} ${t.changes}`} />
              <Chip label={`${plan.items.length - count} ${t.skipped}`} variant="outlined" />
            </Stack>
            {!!plan.unreadableCount && (
              <Alert severity="warning">
                {plan.unreadableCount} {t.unreadable}
              </Alert>
            )}
            {!plan.items.length ? (
              <Alert severity="info">{t.empty}</Alert>
            ) : (
              <Box sx={{ flex: 1, display: 'flex', minHeight: 0 }}>
                <VirtualTable
                  rows={plan.items}
                  rowKey={(i) => i.sourcePath}
                  label={t.preview}
                  columns={[
                    {
                      label: t.path,
                      width: 'minmax(300px,1fr)',
                      render: (i) => (
                        <Box>
                          <Typography noWrap title={i.sourcePath} fontWeight={550}>
                            {folderName(i.sourcePath)}
                          </Typography>
                          <Typography variant="caption" title={i.sourcePath} noWrap display="block">
                            {i.sourcePath}
                          </Typography>
                        </Box>
                      ),
                    },
                    {
                      label: t.old,
                      width: '190px',
                      render: (i) => formatDateTime(i.stamp.modifiedAt),
                    },
                    {
                      label: t.created,
                      width: '190px',
                      render: (i) => formatDateTime(i.stamp.createdAt),
                    },
                    {
                      label: t.next,
                      width: '190px',
                      render: (i) =>
                        i.action === 'dates'
                          ? formatDateTime(i.stamp.createdAt)
                          : formatDateTime(i.stamp.modifiedAt),
                    },
                    {
                      label: t.status,
                      width: '200px',
                      render: (i) =>
                        i.error ? (
                          <Typography
                            variant="caption"
                            color="warning.main"
                            title={friendlyError({ code: i.error })}
                          >
                            {friendlyError({ code: i.error })}
                          </Typography>
                        ) : i.action === 'dates' ? (
                          t.change
                        ) : (
                          t.unchanged
                        ),
                    },
                  ]}
                />
              </Box>
            )}
            <Typography variant="caption" color="text.secondary">
              {t.undoHint}
            </Typography>
          </>
        ) : (
          <Typography sx={{ my: 'auto', textAlign: 'center' }} color="text.secondary">
            {busy ? t.analyzing : t.creationHint}
          </Typography>
        )}
      </DialogContent>
      <DialogActions>
        <Button disabled={busy} onClick={close}>
          {t.close}
        </Button>
        {!plan && request && (
          <Button disabled={busy} onClick={() => void preview(request)}>
            {t.retry}
          </Button>
        )}
        <Button variant="contained" disabled={busy || !count} onClick={() => void execute()}>
          {t.apply} ({count})
        </Button>
      </DialogActions>
    </Dialog>
  );
}
