import { useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  LinearProgress,
  MenuItem,
  Pagination,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import AutoAwesomeOutlined from '@mui/icons-material/AutoAwesomeOutlined';
import BookmarkRounded from '@mui/icons-material/BookmarkRounded';
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded';
import UndoRounded from '@mui/icons-material/UndoRounded';
import FolderOpenRounded from '@mui/icons-material/FolderOpenRounded';
import CloseRounded from '@mui/icons-material/CloseRounded';
import { classificationMessages as t } from '../../../shared/constants/classification-messages';
import { useReviewShortcuts } from '../../../shared/hooks/use-review-shortcuts';
import { useWorkflowStore } from '../../inbox/store/workflow-store';
import { useWorkspaceStore } from '../../workspace/store/workspace-store';
import { isDesktop } from '../../inbox/services/inbox-service';
import { useClassificationStore } from '../store/classification-store';
import {
  emptyMediaFilters,
  visibleMedia,
  selectedMedia,
  type MediaFilters,
} from '../services/media-query';
import type { MediaCategory } from '../services/classification-service';
import { MediaCard } from '../components/media-card';
import { MediaReviewDialog } from '../components/media-review-dialog';
import { ClassificationTransferDialog } from '../components/classification-transfer-dialog';
import { CategoryCorrectionDialog } from '../components/category-correction-dialog';
import { DetectionSettingsPanel } from '../components/detection-settings-panel';
import {
  classificationShortcut,
  type MediaRemovalSelection,
} from '../services/classification-shortcuts';
const pageSize = 36;
export function ClassificationView() {
  const state = useClassificationStore();
  const { snapshot, busy } = useWorkflowStore();
  const { workspace } = useWorkspaceStore();
  const hasWorkspaceFolders =
    !!snapshot.inbox || !!workspace.roots.length || !!snapshot.rules.length;
  const selectedScope = state.options.folderPaths !== null;
  const hasScanFolders = selectedScope ? !!state.options.folderPaths?.length : hasWorkspaceFolders;
  const [removal, setRemoval] = useState<MediaRemovalSelection | null>(null);
  const [transfer, setTransfer] = useState<MediaRemovalSelection | null>(null);
  const [correction, setCorrection] = useState<MediaRemovalSelection | null>(null);
  const transferOpen = !!transfer && transfer.sessionId === state.review?.sessionId;
  const correctionOpen = !!correction && correction.sessionId === state.review?.sessionId;
  const visible = useMemo(
    () =>
      visibleMedia(state.entries, state.filters, {
        excluded: state.excluded,
        showExcluded: state.showExcluded,
        showProtected: state.showProtected,
      }),
    [state.entries, state.excluded, state.filters, state.showExcluded, state.showProtected],
  );
  const selected = useMemo(
    () => selectedMedia(state.entries, state.selected),
    [state.entries, state.selected],
  );
  const excludedIds = new Set(state.excluded);
  const excludedCount = state.excluded.length;
  const protectedCount = state.entries.filter((entry) => entry.protected).length;
  const removable = selected.filter((entry) => !entry.protected && !excludedIds.has(entry.id));
  const selectedRestricted = selected.filter(
    (entry) => entry.protected || excludedIds.has(entry.id),
  );
  const pageCount = Math.max(1, Math.ceil(visible.length / pageSize));
  const page = Math.min(state.page, pageCount);
  const pageEntries = visible.slice((page - 1) * pageSize, page * pageSize);
  const pageSelected =
    pageEntries.length > 0 && pageEntries.every((entry) => state.selected.includes(entry.id));
  const active = state.entries.find((entry) => entry.id === state.activeId);
  const activeIndex = visible.findIndex((entry) => entry.id === state.activeId);
  const removalEntries =
    removal && removal.sessionId === state.review?.sessionId
      ? selectedMedia(state.entries, removal.ids, true).filter(
          (entry) => !excludedIds.has(entry.id),
        )
      : [];
  const filtersActive =
    state.filters.category !== 'all' ||
    state.filters.kind !== 'all' ||
    state.filters.status !== 'all' ||
    !!state.filters.query;
  const openRemoval = (ids: string[]) => {
    const current = useClassificationStore.getState();
    if (
      useWorkflowStore.getState().busy ||
      !current.review ||
      !selectedMedia(current.entries, ids, true).some(
        (entry) => !current.excluded.includes(entry.id),
      )
    )
      return;
    setRemoval({ sessionId: current.review.sessionId, ids: [...ids] });
  };
  const confirmRemoval = () => {
    const current = useClassificationStore.getState();
    if (
      !removal ||
      useWorkflowStore.getState().busy ||
      current.review?.sessionId !== removal.sessionId
    )
      return;
    const ids = selectedMedia(current.entries, removal.ids, true)
      .filter((entry) => !current.excluded.includes(entry.id))
      .map((entry) => entry.id);
    if (!ids.length) return;
    setRemoval(null);
    void current.remove(ids);
  };
  const openCorrection = (ids: string[]) => {
    const current = useClassificationStore.getState();
    if (useWorkflowStore.getState().busy || !current.review) return;
    const chosen = selectedMedia(current.entries, ids).map((entry) => entry.id);
    if (!chosen.length) return;
    useClassificationStore.setState({ error: null });
    setCorrection({ sessionId: current.review.sessionId, ids: chosen });
  };
  useReviewShortcuts({
    enabled:
      !busy &&
      !state.scanning &&
      !transferOpen &&
      !correctionOpen &&
      (!!state.review || !!state.lastOperationId),
    scopeId: removal
      ? 'classification-removal'
      : active && state.review
        ? 'classification-review'
        : 'classification-gallery',
    onAction: (action) => {
      if (transferOpen || correctionOpen) return;
      const current = useClassificationStore.getState();
      const command = classificationShortcut(action, {
        busy: useWorkflowStore.getState().busy,
        sessionId: current.review?.sessionId ?? null,
        removal,
        entries: current.entries,
        visible,
        selected: current.selected,
        excluded: current.excluded,
        activeId: current.activeId,
        lastOperationId: current.lastOperationId,
      });
      if (!command) return;
      switch (command.type) {
        case 'navigate':
          current.navigate(command.direction);
          break;
        case 'open':
          current.open(command.id);
          break;
        case 'remove':
          openRemoval(command.ids);
          break;
        case 'confirm-removal':
          confirmRemoval();
          break;
        case 'keep':
          void current.protect(command.ids, true, command.advance);
          break;
        case 'exclude':
          current.exclude(command.ids);
          break;
        case 'undo':
          void current.undoLastRemoval();
          break;
      }
    },
  });
  return (
    <Box
      component="main"
      data-review-shortcut-scope="classification-gallery"
      sx={{ flex: 1, minWidth: 0, minHeight: 0, overflow: 'auto', p: { xs: 2, md: 3 } }}
    >
      <Stack spacing={2}>
        <Stack
          direction={{ xs: 'column', md: 'row' }}
          alignItems={{ xs: 'stretch', md: 'center' }}
          spacing={2}
        >
          <Box sx={{ flex: 1 }}>
            <Stack direction="row" alignItems="center" spacing={1}>
              <AutoAwesomeOutlined color="primary" />
              <Typography variant="h2">{t.title}</Typography>
            </Stack>
            <Typography color="text.secondary" sx={{ mt: 0.5 }}>
              {t.subtitle}
            </Typography>
          </Box>
          <Button
            variant="contained"
            disabled={busy || state.pickingFolders || !hasScanFolders || !isDesktop}
            onClick={() => void state.scan()}
          >
            {state.review ? t.rescan : t.scan}
          </Button>
        </Stack>
        <Typography variant="body2" color="text.secondary">
          {t.privacy}
        </Typography>
        <Stack spacing={1.5}>
          <TextField
            select
            fullWidth
            size="small"
            label={t.scanScope}
            disabled={busy || state.pickingFolders}
            value={selectedScope ? 'selected' : 'workspace'}
            onChange={(event) => state.setScanScope(event.target.value as 'selected' | 'workspace')}
          >
            <MenuItem value="selected">{t.selectedFolders}</MenuItem>
            <MenuItem value="workspace">{t.allFolders}</MenuItem>
          </TextField>
          {selectedScope ? (
            <>
              <Typography variant="body2" color="text.secondary">
                {t.selectedFoldersHint}
              </Typography>
              <Stack
                direction={{ xs: 'column', sm: 'row' }}
                spacing={1.5}
                alignItems={{ xs: 'stretch', sm: 'center' }}
              >
                <Button
                  variant="outlined"
                  startIcon={<FolderOpenRounded />}
                  disabled={
                    busy ||
                    state.pickingFolders ||
                    !isDesktop ||
                    state.selectedFolderPaths.length >= 32
                  }
                  onClick={() => void state.chooseFolders()}
                >
                  {state.pickingFolders ? t.choosingFolders : t.chooseFolders}
                </Button>
                <Typography variant="caption" color="text.secondary">
                  {t.selectedFoldersCount(state.selectedFolderPaths.length)}
                </Typography>
              </Stack>
              {state.selectedFolderPaths.length ? (
                <Stack
                  component="ul"
                  aria-label={t.selectedFolders}
                  spacing={0.5}
                  sx={{
                    m: 0,
                    p: 1,
                    listStyle: 'none',
                    border: 1,
                    borderColor: 'divider',
                    borderRadius: 1,
                    maxHeight: 220,
                    overflow: 'auto',
                  }}
                >
                  {state.selectedFolderPaths.map((folder) => (
                    <Stack
                      component="li"
                      key={folder}
                      direction="row"
                      spacing={1}
                      alignItems="center"
                    >
                      <Typography
                        variant="body2"
                        sx={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}
                      >
                        {folder}
                      </Typography>
                      <IconButton
                        size="small"
                        aria-label={t.removeFolder(folder)}
                        disabled={busy || state.pickingFolders}
                        onClick={() => state.removeFolder(folder)}
                      >
                        <CloseRounded fontSize="small" />
                      </IconButton>
                    </Stack>
                  ))}
                </Stack>
              ) : (
                <Alert severity="info">{t.selectedFoldersEmpty}</Alert>
              )}
            </>
          ) : (
            <>
              <Typography variant="body2" color="text.secondary">
                {t.workspaceScopeHint}
              </Typography>
              {!hasWorkspaceFolders && <Alert severity="info">{t.noFolders}</Alert>}
            </>
          )}
          {state.review && (
            <Typography variant="caption" color="text.secondary">
              {t.scopeChangesHint}
            </Typography>
          )}
        </Stack>
        <Stack direction="row" spacing={2} sx={{ flexWrap: 'wrap' }}>
          <FormControlLabel
            control={
              <Checkbox
                checked={state.options.recursive}
                disabled={busy}
                onChange={(_, value) => state.setOptions({ recursive: value })}
              />
            }
            label={t.recursive}
          />
          <FormControlLabel
            control={
              <Checkbox
                checked={state.options.includeVideos}
                disabled={busy}
                onChange={(_, value) => state.setOptions({ includeVideos: value })}
              />
            }
            label={t.videos}
          />
        </Stack>
        <DetectionSettingsPanel />
        {state.error && <Alert severity="error">{state.error}</Alert>}
        {state.notice && (
          <Alert severity={state.review?.cancelled ? 'info' : 'success'}>{state.notice}</Alert>
        )}
        <Alert
          severity="info"
          action={
            <Button
              color="inherit"
              size="small"
              disabled={busy}
              onClick={() => useWorkflowStore.getState().setPage('history')}
            >
              {t.history}
            </Button>
          }
        >
          {t.recovery}
        </Alert>
        {state.lastOperationId && (
          <Box>
            <Button
              size="small"
              aria-keyshortcuts="Control+z"
              disabled={busy}
              startIcon={<UndoRounded />}
              onClick={() => void state.undoLastRemoval()}
            >
              {t.undo}
            </Button>
          </Box>
        )}
        {state.scanning ? (
          <Stack spacing={1.5} sx={{ py: 3 }}>
            <Typography variant="h3">
              {state.progress?.total ? t.scanning : t.collecting}
            </Typography>
            <LinearProgress
              variant={state.progress?.total ? 'determinate' : 'indeterminate'}
              value={
                state.progress?.total
                  ? Math.min(100, (state.progress.completed / state.progress.total) * 100)
                  : 0
              }
            />
            {state.progress && (
              <Typography variant="body2" color="text.secondary" noWrap>
                {state.progress.completed} / {state.progress.total} · {state.progress.currentName}
              </Typography>
            )}
            <Box>
              <Button
                variant="outlined"
                disabled={state.cancelling}
                onClick={() => void state.cancel()}
              >
                {state.cancelling ? t.cancelling : t.cancel}
              </Button>
            </Box>
          </Stack>
        ) : state.review ? (
          <>
            <Typography variant="body2" color="text.secondary">
              {t.suggestions}
            </Typography>
            {state.review.truncated && <Alert severity="warning">{t.truncated}</Alert>}
            {!!state.review.unreadableCount && (
              <Typography variant="body2" color="warning.main">
                {state.review.unreadableCount} {t.unreadable}
              </Typography>
            )}
            {!!state.review.skippedCount && (
              <Typography variant="caption" color="text.secondary">
                {state.review.skippedCount} {t.skipped}
              </Typography>
            )}
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: {
                  xs: '1fr',
                  sm: 'repeat(2, minmax(0, 1fr))',
                  lg: 'repeat(4, minmax(0, 1fr))',
                },
                gap: 1,
              }}
            >
              <TextField
                select
                size="small"
                label={t.category}
                value={state.filters.category}
                disabled={busy}
                onChange={(event) =>
                  state.setFilters({ category: event.target.value as MediaCategory | 'all' })
                }
              >
                <MenuItem value="all">{t.allCategories}</MenuItem>
                {Object.entries(t.categories).map(([value, label]) => (
                  <MenuItem key={value} value={value}>
                    {label}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                select
                size="small"
                label={t.mediaType}
                value={state.filters.kind}
                disabled={busy}
                onChange={(event) =>
                  state.setFilters({ kind: event.target.value as MediaFilters['kind'] })
                }
              >
                <MenuItem value="all">{t.allTypes}</MenuItem>
                <MenuItem value="image">{t.image}</MenuItem>
                <MenuItem value="video">{t.video}</MenuItem>
              </TextField>
              <TextField
                select
                size="small"
                label={t.state}
                value={state.filters.status}
                disabled={busy}
                onChange={(event) =>
                  state.setFilters({ status: event.target.value as MediaFilters['status'] })
                }
              >
                <MenuItem value="all">{t.allStates}</MenuItem>
                <MenuItem value="available">{t.available}</MenuItem>
                <MenuItem value="protected">{t.protected}</MenuItem>
                <MenuItem value="excluded">{t.excludedState}</MenuItem>
                <MenuItem value="uncertain">{t.uncertain}</MenuItem>
                <MenuItem value="error">{t.errorState}</MenuItem>
              </TextField>
              <TextField
                size="small"
                label={t.query}
                value={state.filters.query}
                disabled={busy}
                onChange={(event) => state.setFilters({ query: event.target.value })}
              />
            </Box>
            <Stack
              spacing={1}
              sx={{
                p: 1.5,
                border: 1,
                borderColor: 'divider',
                borderRadius: 1,
                bgcolor: 'background.paper',
              }}
            >
              <Stack
                direction="row"
                alignItems="center"
                spacing={1}
                sx={{ flexWrap: 'wrap', gap: 0.5 }}
              >
                <Chip
                  size="small"
                  label={`${selected.length} ${t.selection}`}
                  color={selected.length ? 'primary' : 'default'}
                  variant="outlined"
                />
                <Typography variant="caption" color="text.secondary">
                  {visible.length} / {state.entries.length} {t.shown}
                </Typography>
                {!!excludedCount && (
                  <Chip
                    size="small"
                    label={`${excludedCount} ${t.excluded}`}
                    variant="outlined"
                    color="warning"
                  />
                )}
                <Box sx={{ flex: 1 }} />
                {!!protectedCount && (
                  <Button
                    size="small"
                    disabled={busy}
                    aria-expanded={state.showProtected}
                    onClick={() => state.setShowProtected(!state.showProtected)}
                  >
                    {state.showProtected
                      ? t.hideProtected
                      : `${t.showProtected} (${protectedCount})`}
                  </Button>
                )}
                {!!excludedCount && (
                  <Button
                    size="small"
                    disabled={busy}
                    aria-expanded={state.showExcluded}
                    onClick={() => state.setShowExcluded(!state.showExcluded)}
                  >
                    {state.showExcluded ? t.hideExcluded : `${t.showExcluded} (${excludedCount})`}
                  </Button>
                )}
                <Button
                  size="small"
                  disabled={busy || !pageEntries.length}
                  onClick={() =>
                    state.selectPage(
                      pageEntries.map((entry) => entry.id),
                      !pageSelected,
                    )
                  }
                >
                  {pageSelected ? t.deselectPage : t.selectPage}
                </Button>
                <Button
                  size="small"
                  disabled={busy || !visible.length}
                  onClick={() =>
                    state.selectPage(
                      visible.map((entry) => entry.id),
                      true,
                    )
                  }
                >
                  {t.selectVisible}
                </Button>
                <Button
                  size="small"
                  disabled={busy || !selected.length}
                  onClick={state.clearSelection}
                >
                  {t.clearSelection}
                </Button>
              </Stack>
              <Stack
                direction="row"
                alignItems="center"
                spacing={1}
                sx={{ flexWrap: 'wrap', gap: 0.5 }}
              >
                <Button
                  size="small"
                  variant="outlined"
                  aria-keyshortcuts="Enter"
                  disabled={busy || !selected.length}
                  onClick={() => {
                    const selectedIds = new Set(state.selected);
                    const first = visible.find((entry) => selectedIds.has(entry.id)) ?? selected[0];
                    if (first) state.open(first.id);
                  }}
                >
                  {t.reviewSelection}
                </Button>
                <Button
                  size="small"
                  variant="outlined"
                  disabled={busy || !selected.length}
                  onClick={() => openCorrection(state.selected)}
                >
                  {t.correctSelection}
                </Button>
                <Button
                  size="small"
                  variant="outlined"
                  color="success"
                  aria-keyshortcuts="c"
                  startIcon={<BookmarkRounded />}
                  disabled={busy || !selected.length}
                  onClick={() => void state.protect(state.selected, true)}
                >
                  {t.selectedKeep}
                </Button>
                <Button
                  size="small"
                  variant="outlined"
                  aria-keyshortcuts="e"
                  disabled={busy || !selected.length}
                  onClick={() => state.exclude(state.selected)}
                >
                  {t.selectedExclude} ({selected.length})
                </Button>
                <Button
                  size="small"
                  disabled={busy || !selectedRestricted.length}
                  onClick={() => void state.restoreNormal(state.selected)}
                >
                  {t.selectedRestore}
                </Button>
                <Button
                  size="small"
                  variant="outlined"
                  disabled={busy || !selected.length}
                  onClick={() => {
                    const current = useClassificationStore.getState();
                    if (
                      !useWorkflowStore.getState().busy &&
                      current.review &&
                      current.selected.length
                    )
                      setTransfer({
                        sessionId: current.review.sessionId,
                        ids: [...current.selected],
                      });
                  }}
                >
                  {t.selectedTransfer}
                </Button>
                <Box sx={{ flex: 1 }} />
                <Button
                  size="small"
                  color="error"
                  variant="outlined"
                  aria-keyshortcuts="Delete"
                  startIcon={<DeleteOutlineRounded />}
                  disabled={busy || !removable.length}
                  onClick={() => openRemoval(state.selected)}
                >
                  {t.selectedRemove}
                  {removable.length ? ` (${removable.length})` : ''}
                </Button>
              </Stack>
              <Typography variant="caption" color="text.secondary">
                {t.protectedHint}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {t.galleryShortcuts}
              </Typography>
            </Stack>
            {pageEntries.length ? (
              <>
                <Box
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: {
                      xs: 'minmax(0,1fr)',
                      sm: 'repeat(2,minmax(0,1fr))',
                      lg: 'repeat(3,minmax(0,1fr))',
                      xl: 'repeat(4,minmax(0,1fr))',
                    },
                    gap: 1.5,
                  }}
                >
                  {pageEntries.map((entry) => (
                    <MediaCard
                      key={`${state.review!.sessionId}:${entry.id}`}
                      sessionId={state.review!.sessionId}
                      entry={entry}
                      selected={state.selected.includes(entry.id)}
                      excluded={excludedIds.has(entry.id)}
                      busy={busy}
                      onSelect={(value) => state.select(entry.id, value)}
                      onOpen={() => state.open(entry.id)}
                      onProtect={(value) => void state.protect([entry.id], value)}
                      onInclude={() => state.include(entry.id)}
                      onCorrect={() => openCorrection([entry.id])}
                    />
                  ))}
                </Box>
                {pageCount > 1 && (
                  <Stack alignItems="center" sx={{ py: 1 }}>
                    <Pagination
                      count={pageCount}
                      page={page}
                      disabled={busy}
                      onChange={(_, value) => state.setPage(value)}
                      color="primary"
                    />
                  </Stack>
                )}
              </>
            ) : (
              <Stack spacing={1.5} alignItems="center" sx={{ py: 5, textAlign: 'center' }}>
                <Typography variant="h3">
                  {state.entries.length
                    ? excludedCount && !state.showExcluded
                      ? t.emptyExcluded
                      : t.emptyFilter
                    : t.empty}
                </Typography>
                {excludedCount > 0 && !state.showExcluded && (
                  <Button disabled={busy} onClick={() => state.setShowExcluded(true)}>
                    {t.emptyExcludedAction} ({excludedCount})
                  </Button>
                )}
                {protectedCount > 0 && !state.showProtected && (
                  <>
                    <Typography variant="body2" color="text.secondary">
                      {t.emptyProtected}
                    </Typography>
                    <Button disabled={busy} onClick={() => state.setShowProtected(true)}>
                      {t.showProtected} ({protectedCount})
                    </Button>
                  </>
                )}
                {filtersActive && (
                  <Button disabled={busy} onClick={() => state.setFilters(emptyMediaFilters)}>
                    {t.clearFilters}
                  </Button>
                )}
              </Stack>
            )}
          </>
        ) : (
          <Stack alignItems="center" spacing={1.5} sx={{ py: 5, textAlign: 'center' }}>
            <AutoAwesomeOutlined sx={{ fontSize: 42, color: 'text.disabled' }} />
            <Typography variant="h3">{t.start}</Typography>
            <Typography color="text.secondary">{t.startHint}</Typography>
          </Stack>
        )}
      </Stack>
      {active && state.review && (
        <MediaReviewDialog
          sessionId={state.review.sessionId}
          entry={active}
          index={activeIndex}
          count={visible.length}
          busy={busy}
          excluded={excludedIds.has(active.id)}
          onClose={() => state.open(null)}
          onNavigate={state.navigate}
          onProtect={(value, advance) => void state.protect([active.id], value, advance)}
          onRemove={() => openRemoval([active.id])}
          onCorrect={() => openCorrection([active.id])}
        />
      )}
      {transfer && transfer.sessionId === state.review?.sessionId && (
        <ClassificationTransferDialog
          sessionId={transfer.sessionId}
          itemIds={transfer.ids}
          onClose={() => setTransfer(null)}
        />
      )}
      {correction && correction.sessionId === state.review?.sessionId && (
        <CategoryCorrectionDialog
          key={`${correction.sessionId}:${correction.ids.join(',')}`}
          sessionId={correction.sessionId}
          entries={selectedMedia(state.entries, correction.ids)}
          onClose={() => setCorrection(null)}
        />
      )}
      <Dialog
        open={!!removal}
        data-review-shortcut-scope="classification-removal"
        fullWidth
        maxWidth="sm"
        onClose={() => {
          if (!busy) setRemoval(null);
        }}
      >
        <DialogTitle>
          {t.removeTitle} · {removalEntries.length}
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2}>
            <Alert severity="info">{t.removeHint}</Alert>
            <Typography variant="body2">{t.excludedProtected}</Typography>
            <Typography variant="caption" color="text.secondary">
              {t.removalShortcuts}
            </Typography>
            <Box component="ul" sx={{ m: 0, pl: 2.5, maxHeight: 250, overflow: 'auto' }}>
              {removalEntries.map((entry) => (
                <Typography
                  component="li"
                  variant="body2"
                  key={entry.id}
                  sx={{ overflowWrap: 'anywhere', py: 0.5 }}
                >
                  {entry.path}
                </Typography>
              ))}
            </Box>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button disabled={busy} onClick={() => setRemoval(null)}>
            {t.close}
          </Button>
          <Button
            autoFocus
            variant="contained"
            color="error"
            aria-keyshortcuts="Enter"
            disabled={busy || !removalEntries.length}
            onClick={confirmRemoval}
          >
            {t.removeConfirm}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
