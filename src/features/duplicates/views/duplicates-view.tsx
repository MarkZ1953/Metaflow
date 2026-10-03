import { useCallback, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  LinearProgress,
  Stack,
  Typography,
} from '@mui/material';
import ArrowBackRounded from '@mui/icons-material/ArrowBackRounded';
import ArrowForwardRounded from '@mui/icons-material/ArrowForwardRounded';
import CheckCircleOutlineRounded from '@mui/icons-material/CheckCircleOutlineRounded';
import UndoRounded from '@mui/icons-material/UndoRounded';
import { duplicateMessages as t } from '../../../shared/constants/duplicate-messages';
import { useWorkflowStore } from '../../inbox/store/workflow-store';
import { useDuplicateReviewStore } from '../store/duplicate-review-store';
import { DuplicateFileCard } from '../components/duplicate-file-card';
import type { ComparisonSide } from '../services/duplicate-service';
import { useReviewShortcuts } from '../../../shared/hooks/use-review-shortcuts';
import {
  allowedDuplicateShortcut,
  currentDuplicateRemoval,
  duplicateRemovalTarget,
  type DuplicateRemovalTarget,
} from '../services/duplicate-shortcuts';

export function DuplicatesView() {
  const busy = useWorkflowStore((state) => state.busy);
  const {
    review,
    comparisons,
    index,
    includeSimilar,
    scanning,
    error,
    notice,
    lastOperationId,
    setIncludeSimilar,
    scan,
    navigate,
    dismiss,
    resetDismissals,
    undoLastRemoval,
  } = useDuplicateReviewStore();
  const comparison = comparisons[index];
  const pairKey = `${review?.sessionId ?? ''}:${comparison?.id ?? ''}`;
  const [selection, setSelection] = useState<{ key: string; side: ComparisonSide }>({
    key: '',
    side: 'right',
  });
  const selectedSide = selection.key === pairKey ? selection.side : 'right';
  const [confirmation, setConfirmation] = useState<DuplicateRemovalTarget | null>(null);
  const pendingRemoval = useRef<DuplicateRemovalTarget | null>(null);
  const [previews, setPreviews] = useState({ key: '', left: false, right: false });
  const previewReady = useCallback(
    (side: ComparisonSide, ready: boolean) => {
      const current = useDuplicateReviewStore.getState();
      if (
        `${current.review?.sessionId ?? ''}:${current.comparisons[current.index]?.id ?? ''}` !==
        pairKey
      )
        return;
      setPreviews((current) => ({
        ...(current.key === pairKey ? current : { key: pairKey, left: false, right: false }),
        [side]: ready,
      }));
    },
    [pairKey],
  );
  const canRemove =
    comparison?.kind === 'exact' || (previews.key === pairKey && previews.left && previews.right);
  const confirmationCurrent = currentDuplicateRemoval(confirmation, review?.sessionId, comparison);
  const reviewLocked = busy || !!confirmation;
  const closeRemoval = () => {
    pendingRemoval.current = null;
    setConfirmation(null);
  };
  const selectSide = (side: ComparisonSide) => {
    if (useWorkflowStore.getState().busy || pendingRemoval.current) return;
    setSelection({ key: pairKey, side });
  };
  const openRemoval = (side: ComparisonSide) => {
    const workflow = useWorkflowStore.getState();
    const current = useDuplicateReviewStore.getState();
    const pair = current.comparisons[current.index];
    if (
      workflow.page !== 'duplicates' ||
      workflow.busy ||
      workflow.plan ||
      current.scanning ||
      pendingRemoval.current ||
      !current.review ||
      !pair ||
      `${current.review.sessionId}:${pair.id}` !== pairKey ||
      !canRemove
    )
      return;
    const target = duplicateRemovalTarget(current.review.sessionId, pair, side);
    pendingRemoval.current = target;
    setSelection({ key: pairKey, side });
    setConfirmation(target);
  };
  const confirmRemoval = () => {
    const current = useDuplicateReviewStore.getState();
    const workflow = useWorkflowStore.getState();
    const target = pendingRemoval.current;
    if (
      workflow.page !== 'duplicates' ||
      workflow.busy ||
      workflow.plan ||
      current.scanning ||
      !canRemove ||
      !currentDuplicateRemoval(
        target,
        current.review?.sessionId,
        current.comparisons[current.index],
      )
    )
      return;
    closeRemoval();
    if (target) void current.remove(target.side);
  };
  useReviewShortcuts({
    enabled: !busy && !scanning,
    scopeId: confirmation ? 'duplicates-removal' : 'duplicates-review',
    onAction(action) {
      if (action === 'exclude') return;
      const workflow = useWorkflowStore.getState();
      const current = useDuplicateReviewStore.getState();
      const target = pendingRemoval.current;
      const allowed = allowedDuplicateShortcut(action, {
        active: workflow.page === 'duplicates' && !workflow.plan,
        busy: workflow.busy,
        scanning: current.scanning,
        externalDialog: false,
        hasComparison: !!current.comparisons[current.index],
        canRemove,
        canGoBack: current.index > 0,
        hasUndo: !!current.lastOperationId,
        confirming: !!target,
        confirmationCurrent: currentDuplicateRemoval(
          target,
          current.review?.sessionId,
          current.comparisons[current.index],
        ),
      });
      switch (allowed) {
        case 'previous':
          current.navigate(-1);
          break;
        case 'next':
        case 'keep':
          current.navigate(1);
          break;
        case 'discard':
          void current.dismiss();
          break;
        case 'undo':
          void current.undoLastRemoval();
          break;
        case 'left':
          selectSide('left');
          break;
        case 'right':
          selectSide('right');
          break;
        case 'remove':
          openRemoval(selectedSide);
          break;
        case 'confirm':
          confirmRemoval();
          break;
      }
    },
  });
  const finished = !!review && !comparison && review.comparisons.length > 0;
  return (
    <Box
      component="main"
      data-review-shortcut-scope="duplicates-review"
      sx={{
        flex: 1,
        minWidth: 0,
        minHeight: 0,
        overflow: 'auto',
        p: { xs: 2, md: 3 },
        display: 'flex',
        flexDirection: 'column',
        gap: 1.5,
      }}
    >
      <Stack
        direction={{ xs: 'column', md: 'row' }}
        alignItems={{ xs: 'stretch', md: 'center' }}
        spacing={2}
      >
        <Box sx={{ flex: 1 }}>
          <Typography variant="h2">{t.title}</Typography>
          <Typography color="text.secondary" sx={{ mt: 0.5 }}>
            {t.subtitle}
          </Typography>
        </Box>
        <Button disabled={reviewLocked} variant="contained" onClick={() => void scan()}>
          {review ? t.rescan : t.scan}
        </Button>
      </Stack>
      <Stack
        direction={{ xs: 'column', md: 'row' }}
        alignItems={{ xs: 'start', md: 'center' }}
        justifyContent="space-between"
        spacing={1}
      >
        <FormControlLabel
          control={
            <Checkbox
              checked={includeSimilar}
              disabled={reviewLocked}
              onChange={(event) => setIncludeSimilar(event.target.checked)}
            />
          }
          label={t.similar}
          title={t.similarHint}
        />
        <Button size="small" disabled={reviewLocked} onClick={() => void resetDismissals()}>
          {t.reset}
        </Button>
      </Stack>
      {error && <Alert severity="error">{error}</Alert>}
      {notice && <Alert severity="success">{notice}</Alert>}
      {!!review?.unreadableCount && (
        <Alert severity="warning">
          {review.unreadableCount} {t.unreadable}
        </Alert>
      )}
      {!!review?.ignoredCount && (
        <Typography variant="caption" color="text.secondary">
          {review.ignoredCount} {t.ignored}
        </Typography>
      )}
      {review?.truncated && <Alert severity="warning">{t.truncated}</Alert>}
      <Alert
        severity="info"
        action={
          <Button
            color="inherit"
            size="small"
            disabled={reviewLocked}
            onClick={() => useWorkflowStore.getState().setPage('history')}
          >
            {t.history}
          </Button>
        }
      >
        {t.recovery}
      </Alert>
      {lastOperationId && (
        <Box>
          <Button
            size="small"
            startIcon={<UndoRounded />}
            disabled={reviewLocked}
            aria-keyshortcuts="Control+z"
            onClick={() => void undoLastRemoval()}
          >
            {t.undo}
          </Button>
        </Box>
      )}
      {!!review && (
        <Typography variant="caption" color="text.secondary">
          {t.shortcuts}
        </Typography>
      )}
      {scanning ? (
        <Stack
          alignItems="center"
          justifyContent="center"
          spacing={2}
          sx={{ flex: 1, minHeight: 200 }}
        >
          <CircularProgress size={32} />
          <Typography color="text.secondary">{t.scanning}</Typography>
        </Stack>
      ) : comparison && review ? (
        <>
          <Stack
            direction="row"
            alignItems="center"
            justifyContent="space-between"
            spacing={1}
            sx={{ flexWrap: 'wrap', gap: 1 }}
          >
            <Stack direction="row" alignItems="center" spacing={1}>
              <Typography variant="h3">
                {t.comparison} {index + 1} {t.of} {comparisons.length}
              </Typography>
              <Chip
                label={comparison.kind === 'exact' ? t.exact : t.visual}
                color={comparison.kind === 'exact' ? 'success' : 'warning'}
                size="small"
                variant="outlined"
              />
            </Stack>
            <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 0.5 }}>
              <Button
                disabled={reviewLocked || index === 0}
                aria-keyshortcuts="ArrowLeft"
                startIcon={<ArrowBackRounded />}
                onClick={() => navigate(-1)}
              >
                {t.previous}
              </Button>
              <Button
                disabled={reviewLocked}
                aria-keyshortcuts="ArrowRight"
                endIcon={<ArrowForwardRounded />}
                onClick={() => navigate(1)}
              >
                {t.next}
              </Button>
              <Button
                disabled={reviewLocked}
                aria-keyshortcuts="c"
                variant="outlined"
                startIcon={<CheckCircleOutlineRounded />}
                onClick={() => navigate(1)}
              >
                {t.keep}
              </Button>
              <Button
                disabled={reviewLocked}
                aria-keyshortcuts="d"
                variant="outlined"
                onClick={() => void dismiss()}
              >
                {t.discard}
              </Button>
            </Stack>
          </Stack>
          <LinearProgress
            variant="determinate"
            value={((index + 1) / comparisons.length) * 100}
            sx={{ height: 3 }}
          />
          <Typography variant="body2" color="text.secondary">
            {comparison.kind === 'exact' ? t.exactHint : t.visualHint}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {t.selectionHint}
          </Typography>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems="stretch">
            <DuplicateFileCard
              key={`${review.sessionId}:${comparison.id}:left`}
              sessionId={review.sessionId}
              comparisonId={comparison.id}
              side="left"
              file={comparison.left}
              busy={reviewLocked}
              canRemove={canRemove}
              selected={selectedSide === 'left'}
              onSelect={selectSide}
              onPreviewReady={previewReady}
              onRemove={openRemoval}
            />
            <DuplicateFileCard
              key={`${review.sessionId}:${comparison.id}:right`}
              sessionId={review.sessionId}
              comparisonId={comparison.id}
              side="right"
              file={comparison.right}
              busy={reviewLocked}
              canRemove={canRemove}
              selected={selectedSide === 'right'}
              onSelect={selectSide}
              onPreviewReady={previewReady}
              onRemove={openRemoval}
            />
          </Stack>
          <Typography variant="caption" color="text.secondary" textAlign="center">
            {t.discardHint}
          </Typography>
        </>
      ) : (
        <Stack
          alignItems="center"
          justifyContent="center"
          spacing={1.5}
          sx={{ flex: 1, minHeight: 220, textAlign: 'center' }}
        >
          {finished && <CheckCircleOutlineRounded sx={{ fontSize: 42, color: 'success.main' }} />}
          <Typography variant="h3">{finished ? t.finished : review ? t.empty : t.start}</Typography>
          <Typography color="text.secondary">
            {finished ? t.finishedHint : !review ? t.similarHint : ''}
          </Typography>
          {review && (
            <Stack direction="row" spacing={1}>
              {index > 0 && (
                <Button
                  disabled={reviewLocked}
                  aria-keyshortcuts="ArrowLeft"
                  startIcon={<ArrowBackRounded />}
                  onClick={() => navigate(-1)}
                >
                  {t.previous}
                </Button>
              )}
              <Button disabled={reviewLocked} variant="outlined" onClick={() => void scan()}>
                {t.rescan}
              </Button>
            </Stack>
          )}
        </Stack>
      )}
      <Dialog
        open={!!confirmation}
        onClose={closeRemoval}
        aria-labelledby="duplicate-removal-title"
        data-review-shortcut-scope="duplicates-removal"
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle id="duplicate-removal-title">{t.removalTitle}</DialogTitle>
        <DialogContent>
          <Stack spacing={2}>
            <Alert severity="info">{t.recovery}</Alert>
            {confirmation && !confirmationCurrent && (
              <Alert severity="warning">{t.removalStale}</Alert>
            )}
            <Box>
              <Typography variant="overline" color="error.main">
                {t.removalCopy} · {confirmation?.side === 'left' ? t.left : t.right}
              </Typography>
              <Typography sx={{ overflowWrap: 'anywhere' }}>{confirmation?.file.path}</Typography>
            </Box>
            <Box>
              <Typography variant="overline" color="text.secondary">
                {t.removalKeeper}
              </Typography>
              <Typography sx={{ overflowWrap: 'anywhere' }}>{confirmation?.keeper.path}</Typography>
            </Box>
            <Typography variant="caption" color="text.secondary">
              {t.removalShortcuts}
            </Typography>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={closeRemoval}>{t.removalCancel}</Button>
          <Button
            autoFocus
            variant="contained"
            color="error"
            disabled={busy || !canRemove || !confirmationCurrent}
            aria-keyshortcuts="Enter"
            onClick={confirmRemoval}
          >
            {t.removalConfirm}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
