import { useDeferredValue, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Divider,
  LinearProgress,
  Stack,
  Typography,
} from '@mui/material';
import FolderOpenRounded from '@mui/icons-material/FolderOpenRounded';
import ArrowForwardRounded from '@mui/icons-material/ArrowForwardRounded';
import RefreshRounded from '@mui/icons-material/RefreshRounded';
import InboxRounded from '@mui/icons-material/InboxRounded';
import CalendarMonthRounded from '@mui/icons-material/CalendarMonthRounded';
import CheckCircleOutlineRounded from '@mui/icons-material/CheckCircleOutlineRounded';
import HourglassEmptyRounded from '@mui/icons-material/HourglassEmptyRounded';
import RuleFolderRounded from '@mui/icons-material/RuleFolderRounded';
import { useWorkflowStore } from '../store/workflow-store';
import { isDesktop } from '../services/inbox-service';
import { messages as t } from '../../../shared/constants/messages';
import { VirtualTable, type VirtualColumn } from '../../../shared/components/virtual-table';
import { formatDate, formatSize, folderName } from '../../../shared/utils/format';
import { StatusChip } from '../components/status-chip';
import { InboxDetails } from '../components/inbox-details';
import type { InboxFile } from '../schemas/inbox-schema';

const columns: VirtualColumn<InboxFile>[] = [
  {
    label: t.file,
    width: 'minmax(205px,1.25fr)',
    render: (f) => (
      <Stack direction="row" spacing={1.2} alignItems="center">
        <Box
          sx={{
            bgcolor: 'action.hover',
            p: 0.9,
            borderRadius: 1,
            color: 'primary.light',
            display: 'flex',
          }}
        >
          <RuleFolderRounded fontSize="small" />
        </Box>
        <Box sx={{ minWidth: 0 }}>
          <Typography noWrap title={f.name} fontWeight={550}>
            {f.name}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {f.extension.toUpperCase() || 'FILE'} · {formatSize(f.stamp.size)}
          </Typography>
        </Box>
      </Stack>
    ),
  },
  {
    label: t.date,
    width: '145px',
    render: (f) => (
      <Box>
        <Typography variant="body2">{formatDate(f.dateUsed ?? f.stamp.modifiedAt)}</Typography>
        <Typography variant="caption" color="text.secondary">
          {f.dateSource ? t.sourceLabels[f.dateSource] : t.modified}
        </Typography>
      </Box>
    ),
  },
  {
    label: t.rule,
    width: '110px',
    render: (f) => (
      <Typography variant="body2" color={f.ruleName ? 'text.primary' : 'text.secondary'}>
        {f.ruleName ?? '—'}
      </Typography>
    ),
  },
  {
    label: t.destination,
    width: 'minmax(135px,1fr)',
    render: (f) => (
      <Typography noWrap variant="body2" title={f.destinationPath ?? ''} color="text.secondary">
        {f.destinationPath
          ? folderName(f.destinationPath.replace(/[\\/][^\\/]+$/, ''))
          : t.keepInbox}
      </Typography>
    ),
  },
  { label: t.status, width: '128px', render: (f) => <StatusChip status={f.status} /> },
];

export function InboxView() {
  const {
    snapshot,
    page,
    query,
    loading,
    busy,
    chooseInbox,
    preview,
    retry,
    setPage,
    startDemo,
    demo,
  } = useWorkflowStore();
  const [selected, setSelected] = useState<InboxFile | null>(null);
  const deferred = useDeferredValue(query);
  const files = useMemo(
    () =>
      snapshot.files.filter(
        (f) =>
          (page !== 'review' || ['needs-review', 'failed'].includes(f.status)) &&
          f.name.toLocaleLowerCase().includes(deferred.toLocaleLowerCase()),
      ),
    [snapshot.files, page, deferred],
  );
  const matched = snapshot.files.filter((f) => f.status === 'matched').length;
  const waiting = snapshot.files.filter((f) =>
    ['detected', 'waiting-for-stability', 'analyzing'].includes(f.status),
  ).length;
  const unmatched = snapshot.files.length - matched - waiting;
  if (!snapshot.inbox && !loading)
    return (
      <Box
        sx={{
          flex: 1,
          overflowY: 'auto',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          p: 4,
        }}
      >
        <Box sx={{ maxWidth: 630, textAlign: 'center' }}>
          <Stack
            direction="row"
            spacing={2}
            justifyContent="center"
            alignItems="center"
            sx={{ mb: 5 }}
          >
            {[InboxRounded, CalendarMonthRounded, CheckCircleOutlineRounded].map((Icon, i) => (
              <Box
                key={i}
                sx={{
                  width: i === 1 ? 84 : 64,
                  height: i === 1 ? 84 : 64,
                  border: 1,
                  borderColor: i === 1 ? 'primary.main' : 'divider',
                  bgcolor: i === 1 ? 'action.selected' : 'background.paper',
                  borderRadius: 2.5,
                  display: 'grid',
                  placeItems: 'center',
                  color: i === 1 ? 'primary.light' : 'text.secondary',
                  transform: i === 1 ? 'rotate(-6deg)' : 'none',
                }}
              >
                <Icon sx={{ fontSize: i === 1 ? 38 : 28 }} />
              </Box>
            ))}
          </Stack>
          <Typography variant="overline" color="primary.light">
            METAFLOW INBOX
          </Typography>
          <Typography variant="h1" sx={{ mt: 1, mb: 2 }}>
            {t.welcome}
          </Typography>
          <Typography
            color="text.secondary"
            sx={{ maxWidth: 480, mx: 'auto', fontSize: 15, mb: 4 }}
          >
            {t.welcomeBody}
          </Typography>
          <Button
            size="large"
            variant="contained"
            startIcon={<FolderOpenRounded />}
            disabled={!isDesktop || busy}
            onClick={() => void chooseInbox()}
          >
            {t.chooseInbox}
          </Button>
          <Typography sx={{ mt: 2 }} color="text.secondary" variant="body2">
            {t.manualMode}
          </Typography>
          {!isDesktop && (
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 2 }}>
              {t.desktopRequired}
            </Typography>
          )}
          {!isDesktop && import.meta.env.DEV && (
            <Button sx={{ mt: 1 }} onClick={() => void startDemo()}>
              {t.demo}
            </Button>
          )}
          <Divider sx={{ my: 4 }} />
          <Typography variant="caption" color="text.secondary">
            {t.privacy}
          </Typography>
        </Box>
      </Box>
    );
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
      <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={2}>
        <Box>
          <Typography variant="h2">{page === 'review' ? t.review : t.inboxTitle}</Typography>
          <Typography color="text.secondary" sx={{ mt: 0.4 }}>
            {t.inboxSubtitle}
          </Typography>
        </Box>
        <Stack direction="row" spacing={1}>
          <Button
            variant="outlined"
            startIcon={<RefreshRounded />}
            disabled={busy}
            onClick={() => void retry()}
            sx={{ display: { xs: 'none', md: 'inline-flex' } }}
          >
            {t.refresh}
          </Button>
          <Button
            variant="contained"
            endIcon={<ArrowForwardRounded />}
            disabled={matched === 0 || busy}
            onClick={() => void preview()}
          >
            {t.preview}
          </Button>
        </Stack>
      </Stack>
      <Stack
        direction="row"
        alignItems="center"
        spacing={1.2}
        sx={{
          border: 1,
          borderColor: 'divider',
          borderRadius: 1,
          p: 1.3,
          bgcolor: 'background.paper',
        }}
      >
        <FolderOpenRounded color="primary" fontSize="small" />
        <Typography noWrap title={snapshot.inbox?.path} sx={{ flex: 1, fontSize: 12 }}>
          {snapshot.inbox?.path}
        </Typography>
        <Chip
          size="small"
          label={t.manualMode}
          variant="outlined"
          sx={{ display: { xs: 'none', lg: 'inline-flex' } }}
        />
        <Button size="small" disabled={busy || demo} onClick={() => void chooseInbox()}>
          {t.changeInbox}
        </Button>
      </Stack>
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(4,minmax(0,1fr))', gap: 1.5 }}>
        {[
          {
            label: t.detected,
            value: snapshot.files.length,
            Icon: InboxRounded,
            color: 'text.secondary',
          },
          {
            label: t.matched,
            value: matched,
            Icon: CheckCircleOutlineRounded,
            color: 'success.main',
          },
          {
            label: t.unmatched,
            value: unmatched,
            Icon: CalendarMonthRounded,
            color: 'warning.main',
          },
          { label: t.waiting, value: waiting, Icon: HourglassEmptyRounded, color: 'info.main' },
        ].map(({ label, value, Icon, color }) => (
          <Box
            key={label}
            sx={{
              p: { xs: 1.3, md: 2 },
              border: 1,
              borderColor: 'divider',
              borderRadius: 1.2,
              bgcolor: 'background.paper',
            }}
          >
            <Stack direction="row" justifyContent="space-between" alignItems="center">
              <Typography variant="h2" sx={{ fontSize: 28 }}>
                {value}
              </Typography>
              <Icon sx={{ fontSize: 20, color }} />
            </Stack>
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
              {label}
            </Typography>
          </Box>
        ))}
      </Box>
      {loading && <LinearProgress />}
      {!snapshot.rules.length && (
        <Alert
          severity="info"
          action={
            <Button color="inherit" size="small" onClick={() => setPage('rules')}>
              {t.addRule}
            </Button>
          }
        >
          {t.noMatches}
        </Alert>
      )}
      <Stack direction="row" alignItems="center" justifyContent="space-between">
        <Typography variant="h3">
          {t.file}
          <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>
            {files.length}
          </Typography>
        </Typography>
        <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {snapshot.rules
            .filter((r) => r.enabled)
            .map((r) => (
              <Chip
                key={r.id}
                size="small"
                variant="outlined"
                label={`${r.name} · ${snapshot.files.filter((f) => f.ruleId === r.id).length}`}
              />
            ))}
        </Stack>
      </Stack>
      {files.length ? (
        <VirtualTable
          rows={files}
          columns={columns}
          rowKey={(f) => f.path}
          label="Archivos en Inbox"
          onSelect={(file) => setSelected(file)}
        />
      ) : (
        <Box
          sx={{
            flex: 1,
            border: 1,
            borderColor: 'divider',
            borderRadius: 1.2,
            display: 'grid',
            placeItems: 'center',
            p: 3,
            textAlign: 'center',
          }}
        >
          <Box>
            <InboxRounded sx={{ fontSize: 40, color: 'text.disabled', mb: 1 }} />
            <Typography variant="h3">{snapshot.files.length ? t.noResults : t.noFiles}</Typography>
            <Typography color="text.secondary" sx={{ mt: 1 }}>
              {snapshot.files.length ? '' : t.noFilesBody}
            </Typography>
          </Box>
        </Box>
      )}
      <Stack direction="row" justifyContent="space-between">
        <Typography variant="caption" color="text.secondary">
          {t.watcherLabels[snapshot.watcherStatus] ?? snapshot.watcherStatus} · {t.manualMode}
        </Typography>
        <Typography variant="caption" color="text.disabled">
          {t.roadmap}
        </Typography>
      </Stack>
      <InboxDetails file={selected} onClose={() => setSelected(null)} />
    </Box>
  );
}
