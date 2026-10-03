import { workspaceMessages as w } from '../../shared/constants/workspace-messages';
import {
  Box,
  Chip,
  Divider,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Stack,
  Typography,
} from '@mui/material';
import InboxRounded from '@mui/icons-material/InboxRounded';
import PendingActionsRounded from '@mui/icons-material/PendingActionsRounded';
import CalendarMonthRounded from '@mui/icons-material/CalendarMonthRounded';
import HistoryRounded from '@mui/icons-material/HistoryRounded';
import ShieldOutlined from '@mui/icons-material/ShieldOutlined';
import AutoAwesomeMotionOutlined from '@mui/icons-material/AutoAwesomeMotionOutlined';
import FolderOutlined from '@mui/icons-material/FolderOutlined';
import DriveFileRenameOutlineRounded from '@mui/icons-material/DriveFileRenameOutlineRounded';
import FileCopyOutlined from '@mui/icons-material/FileCopyOutlined';
import PhotoLibraryOutlined from '@mui/icons-material/PhotoLibraryOutlined';
import { FolderTree } from '../../features/workspace/components/folder-tree';
import { useWorkflowStore, type Page } from '../../features/inbox/store/workflow-store';
import { messages as t } from '../../shared/constants/messages';
import { metadataMessages as m } from '../../shared/constants/metadata-messages';
import { classificationMessages as c } from '../../shared/constants/classification-messages';

export function Sidebar() {
  const { page, setPage, snapshot, preview, busy } = useWorkflowStore();
  const matched = snapshot.files.filter((f) => f.status === 'matched').length;
  const review = snapshot.files.filter(
    (f) => f.status === 'needs-review' || f.status === 'failed',
  ).length;
  const entries = [
    {
      label: t.inbox,
      icon: InboxRounded,
      page: 'inbox' as Page,
      count: snapshot.files.length,
      group: 'INBOX',
    },
    { label: t.review, icon: PendingActionsRounded, page: 'review' as Page, count: review },
    { label: w.explorador, icon: FolderOutlined, page: 'workspace' as Page },
    {
      label: t.rules,
      icon: CalendarMonthRounded,
      page: 'rules' as Page,
      count: snapshot.rules.length,
      group: 'ORGANIZACIÓN',
    },
    { label: w.presetsDeNombres, icon: DriveFileRenameOutlineRounded, page: 'presets' as Page },
    { label: m.title, icon: CalendarMonthRounded, page: 'metadata' as Page },
    { label: w.duplicados, icon: FileCopyOutlined, page: 'duplicates' as Page },
    { label: c.title, icon: PhotoLibraryOutlined, page: 'classification' as Page },
    {
      label: w.transferencias2,
      icon: FolderOutlined,
      page: 'transfers' as Page,
      group: 'ACTIVIDAD',
    },
    { label: t.history, icon: HistoryRounded, page: 'history' as Page },
  ];
  return (
    <Box
      component="nav"
      aria-label={w.navegacionPrincipal}
      sx={{
        width: 228,
        flexShrink: 0,
        borderRight: 1,
        borderColor: 'divider',
        bgcolor: 'background.paper',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
      }}
    >
      <Box sx={{ p: 2, overflowY: 'auto', flex: 1 }}>
        <List disablePadding>
          {entries.map((entry) => (
            <Box key={entry.page}>
              {entry.group && (
                <Typography
                  variant="overline"
                  color="text.disabled"
                  sx={{ display: 'block', px: 1.2, mb: 1, mt: entry.page === 'inbox' ? 0 : 3 }}
                >
                  {entry.group}
                </Typography>
              )}
              <ListItemButton
                selected={page === entry.page}
                onClick={() => setPage(entry.page)}
                sx={{ px: 1.2, mb: 0.5 }}
              >
                <ListItemIcon sx={{ minWidth: 30, color: 'inherit' }}>
                  <entry.icon sx={{ fontSize: 19 }} />
                </ListItemIcon>
                <ListItemText
                  primary={entry.label}
                  slotProps={{
                    primary: { fontSize: 12.5, fontWeight: page === entry.page ? 600 : 450 },
                  }}
                />
                {entry.count !== undefined && (
                  <Typography variant="caption" color="text.secondary" sx={{ ml: 0.5 }}>
                    {entry.count}
                  </Typography>
                )}
              </ListItemButton>
              {entry.page === 'workspace' && <FolderTree />}
            </Box>
          ))}
        </List>
        <Divider sx={{ my: 3 }} />
        <ListItemButton disabled={busy || !matched} onClick={() => void preview()} sx={{ px: 1.2 }}>
          <ListItemIcon sx={{ minWidth: 30 }}>
            <AutoAwesomeMotionOutlined sx={{ fontSize: 19 }} />
          </ListItemIcon>
          <ListItemText primary={t.organizer} slotProps={{ primary: { fontSize: 12.5 } }} />
        </ListItemButton>
        <Box
          sx={{
            mt: 3,
            p: 1.5,
            bgcolor: 'action.hover',
            border: 1,
            borderColor: 'divider',
            borderRadius: 1,
          }}
        >
          <Typography variant="caption" fontWeight={600}>
            {t.manualMode}
          </Typography>
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ display: 'block', mt: 0.7, lineHeight: 1.6 }}
          >
            {t.manualHint}
          </Typography>
        </Box>
      </Box>
      <Box sx={{ p: 2, borderTop: 1, borderColor: 'divider' }}>
        <Stack direction="row" spacing={1} alignItems="center">
          <ShieldOutlined sx={{ fontSize: 16, color: 'success.main' }} />
          <Typography variant="caption" color="text.secondary">
            {t.local}
          </Typography>
        </Stack>
        <Chip
          label={w.v}
          size="small"
          variant="outlined"
          sx={{ mt: 1.4, color: 'text.disabled' }}
        />
      </Box>
    </Box>
  );
}
