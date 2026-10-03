import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Box,
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
import FolderOpenRoundedIcon from '@mui/icons-material/FolderOpenRounded';
import { classificationTransferMessages as t } from '../../../shared/constants/classification-transfer-messages';
import { VirtualTable } from '../../../shared/components/virtual-table';
import { formatSize } from '../../../shared/utils/format';
import { nativeExplorerService } from '../../explorer/services/explorer-service';
import { useExplorerStore } from '../../explorer/store/explorer-store';
import type { ConflictPolicy, OrganizationPlan } from '../../inbox/schemas/inbox-schema';
import { useWorkflowStore } from '../../inbox/store/workflow-store';
import { PlanIssues } from '../../organizer/components/plan-issues';
import { PlanSummary } from '../../organizer/components/plan-summary';
import type { TransferRequest } from '../../workspace/services/workspace-service';
import { useClassificationStore } from '../store/classification-store';
import { classificationError } from '../services/classification-error';
import {
  classificationTransferService,
  completedClassifiedTransferIds,
  reconcileClassifiedTransfer,
} from '../services/classification-transfer-service';
import { clearMediaPreviews } from '../services/media-preview-cache';
import { sameMediaPath, selectedMedia } from '../services/media-query';

interface ClassificationTransferDialogProps {
  sessionId: string;
  itemIds: string[];
  onClose(): void;
}

export function ClassificationTransferDialog(props: ClassificationTransferDialogProps) {
  return <TransferContent key={`${props.sessionId}:${props.itemIds.join('|')}`} {...props} />;
}

function TransferContent({ sessionId, itemIds, onClose }: ClassificationTransferDialogProps) {
  const [captured] = useState(() =>
    selectedMedia(useClassificationStore.getState().entries, itemIds),
  );
  const [destination, setDestination] = useState('');
  const [mode, setMode] = useState<'move' | 'copy'>('move');
  const [policy, setPolicy] = useState<ConflictPolicy>('keep-both');
  const [plan, setPlan] = useState<OrganizationPlan | null>(null);
  const [request, setRequest] = useState<TransferRequest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = useWorkflowStore((state) => state.busy);
  const currentSession = useClassificationStore((state) => state.review?.sessionId);
  const alive = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  function currentSelection() {
    const state = useClassificationStore.getState();
    return (
      state.review?.sessionId === sessionId &&
      captured.length > 0 &&
      captured.length === new Set(itemIds).size &&
      captured.every((entry) =>
        state.entries.some(
          (current) => current.id === entry.id && sameMediaPath(current.path, entry.path),
        ),
      )
    );
  }

  async function chooseDestination() {
    if (useWorkflowStore.getState().busy || !currentSelection()) return;
    useWorkflowStore.setState({ busy: true });
    setError(null);
    try {
      const folder = await nativeExplorerService.pickFolder();
      if (alive.current && currentSelection() && folder) setDestination(folder.path);
    } catch (cause) {
      if (alive.current) setError(classificationError(cause));
    } finally {
      useWorkflowStore.setState({ busy: false });
    }
  }

  async function preview(nextRequest: TransferRequest) {
    if (useWorkflowStore.getState().busy) return;
    if (!currentSelection()) {
      setError(t.expired);
      return;
    }
    useWorkflowStore.setState({ busy: true, progress: null });
    setError(null);
    try {
      const nextPlan = await classificationTransferService.preview(
        sessionId,
        captured.map((entry) => entry.id),
        nextRequest,
      );
      if (alive.current && currentSelection()) {
        setRequest(nextRequest);
        setPlan(nextPlan);
      }
    } catch (cause) {
      if (alive.current) {
        setPlan(null);
        setError(classificationError(cause));
      }
    } finally {
      useWorkflowStore.setState({ busy: false, progress: null });
    }
  }

  async function execute() {
    if (useWorkflowStore.getState().busy || !plan || !request) return;
    if (!currentSelection()) {
      setError(t.expired);
      return;
    }
    const capturedPlan = plan;
    const capturedMode = request.mode;
    useWorkflowStore.setState({
      busy: true,
      progress: { operationId: '', completed: 0, total: captured.length, phase: capturedMode },
    });
    setError(null);
    let finished = false;
    try {
      const result = await classificationTransferService.execute(sessionId, capturedPlan.id);
      const completed = completedClassifiedTransferIds(captured, result);
      const current = useClassificationStore.getState();
      if (current.review?.sessionId === sessionId) {
        const patch = reconcileClassifiedTransfer(current, result);
        if (patch.entries.length !== current.entries.length) clearMediaPreviews();
        useClassificationStore.setState({
          ...patch,
          review: { ...current.review, entries: patch.entries },
          notice: completed.size
            ? t.finished(completed.size, capturedMode)
            : patch.lastOperationId === result.operation.id
              ? t.backupOnly
              : null,
          error:
            completed.size < captured.length
              ? completed.size || patch.lastOperationId === result.operation.id
                ? t.partial
                : t.noTransferred
              : null,
        });
      }
      finished = true;
    } catch (cause) {
      if (alive.current) {
        setPlan(null);
        setError(classificationError(cause));
      }
    } finally {
      await Promise.allSettled([
        useWorkflowStore.getState().loadHistory(),
        useWorkflowStore.getState().refresh(),
        useExplorerStore.getState().refresh(),
      ]);
      useWorkflowStore.setState({ busy: false, progress: null });
    }
    if (finished && alive.current) onClose();
  }

  const expired = currentSession !== sessionId || !captured.length;
  const planned = plan?.items.filter((item) => !item.backup && item.action !== 'skip') ?? [];
  return (
    <Dialog
      open
      fullWidth
      maxWidth="lg"
      onClose={busy ? undefined : onClose}
      slotProps={{ paper: { sx: { height: plan ? '82vh' : undefined } } }}
    >
      <DialogTitle>
        {t.title} · {captured.length} {t.selected}
      </DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', minHeight: 0, gap: 2 }}>
        {(error || expired) && <Alert severity="error">{error ?? t.expired}</Alert>}
        {!plan ? (
          <>
            <Typography color="text.secondary">{t.hint}</Typography>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems="stretch">
              <TextField
                label={t.destination}
                value={destination}
                fullWidth
                slotProps={{ input: { readOnly: true } }}
              />
              <Button
                startIcon={<FolderOpenRoundedIcon />}
                variant="outlined"
                sx={{ flexShrink: 0 }}
                disabled={busy || expired}
                onClick={() => void chooseDestination()}
              >
                {t.chooseDestination}
              </Button>
            </Stack>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField
                select
                label={t.mode}
                fullWidth
                value={mode}
                disabled={busy}
                onChange={(event) => setMode(event.target.value as 'move' | 'copy')}
              >
                <MenuItem value="move">{t.move}</MenuItem>
                <MenuItem value="copy">{t.copy}</MenuItem>
              </TextField>
              <TextField
                select
                label={t.conflict}
                fullWidth
                value={policy}
                disabled={busy}
                onChange={(event) => setPolicy(event.target.value as ConflictPolicy)}
              >
                <MenuItem value="keep-both">{t.keepBoth}</MenuItem>
                <MenuItem value="skip">{t.skip}</MenuItem>
                <MenuItem value="replace">{t.replace}</MenuItem>
              </TextField>
            </Stack>
            <Alert severity="info">{mode === 'move' ? t.moveHint : t.copyHint}</Alert>
            <Typography variant="caption" sx={{ overflowWrap: 'anywhere' }}>
              {t.source}:{' '}
              {captured
                .slice(0, 3)
                .map((entry) => entry.path)
                .join(' · ')}
              {captured.length > 3 ? ' …' : ''}
            </Typography>
          </>
        ) : (
          <>
            <Typography>
              {planned.length} {t.selected} ·{' '}
              {formatSize(planned.reduce((total, item) => total + item.stamp.size, 0))}
            </Typography>
            <PlanSummary plan={plan} />
            <PlanIssues
              plan={plan}
              busy={busy}
              policy={request?.policy ?? policy}
              duplicateAction={request?.duplicateAction ?? 'keep-both'}
              resolutions={request?.resolutions ?? {}}
              allowedDuplicateActions={['keep-both', 'skip', 'keep-existing']}
              onRebuild={async (nextPolicy, duplicateAction, resolutions) => {
                if (request)
                  await preview({ ...request, policy: nextPolicy, duplicateAction, resolutions });
              }}
            />
            <Box sx={{ flex: 1, minHeight: 0, display: 'flex' }}>
              <VirtualTable
                rows={plan.items}
                rowKey={(item) => `${item.sourcePath}|${item.action}|${item.destinationPath}`}
                label={t.previewLabel}
                columns={[
                  {
                    label: t.source,
                    width: 'minmax(260px,1fr)',
                    render: (item) => (
                      <Typography variant="caption" title={item.sourcePath}>
                        {item.sourcePath}
                      </Typography>
                    ),
                  },
                  {
                    label: t.target,
                    width: 'minmax(260px,1fr)',
                    render: (item) => (
                      <Typography variant="caption" title={item.destinationPath}>
                        {item.destinationPath}
                      </Typography>
                    ),
                  },
                  {
                    label: t.action,
                    width: '130px',
                    render: (item) =>
                      item.backup
                        ? t.backup
                        : item.action === 'move'
                          ? t.moveAction
                          : item.action === 'copy'
                            ? t.copyAction
                            : t.skipAction,
                  },
                ]}
              />
            </Box>
            <Alert severity="info">{t.integrity}</Alert>
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button disabled={busy} onClick={onClose}>
          {t.cancel}
        </Button>
        {plan ? (
          <>
            <Button disabled={busy} onClick={() => setPlan(null)}>
              {t.edit}
            </Button>
            <Button
              variant="contained"
              disabled={busy || expired || !planned.length}
              onClick={() => void execute()}
            >
              {request?.mode === 'copy' ? t.executeCopy : t.executeMove}
            </Button>
          </>
        ) : (
          <Button
            variant="contained"
            disabled={busy || expired || !destination}
            onClick={() =>
              void preview({
                sources: captured.map((entry) => entry.path),
                destination,
                mode,
                policy,
                duplicateAction: 'keep-both',
              })
            }
          >
            {t.preview}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
