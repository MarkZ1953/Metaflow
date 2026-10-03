import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  FormControlLabel,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import CalendarMonthOutlined from '@mui/icons-material/CalendarMonthOutlined';
import { useWorkspaceStore } from '../../workspace/store/workspace-store';
import { useExplorerStore } from '../../explorer/store/explorer-store';
import { useWorkflowStore } from '../../inbox/store/workflow-store';
import { useMetadataStore } from '../store/metadata-store';
import { isDesktop } from '../../inbox/services/inbox-service';
import { metadataMessages as t } from '../../../shared/constants/metadata-messages';
export function MetadataView() {
  const { workspace, add, error } = useWorkspaceStore();
  const currentPath = useExplorerStore((s) => s.listing?.path);
  const { snapshot, busy } = useWorkflowStore();
  const paths = [
    ...new Set(
      [
        currentPath,
        snapshot.inbox?.path,
        ...workspace.roots.map((r) => r.path),
        ...workspace.favorites,
      ].filter((p): p is string => !!p),
    ),
  ];
  const [folder, setFolder] = useState('');
  const [recursive, setRecursive] = useState(false);
  const selected = folder || paths[0] || '';
  return (
    <Box component="main" sx={{ flex: 1, p: { xs: 2, md: 4 }, overflowY: 'auto' }}>
      <Stack spacing={3} sx={{ maxWidth: 900, mx: 'auto' }}>
        <Box>
          <CalendarMonthOutlined sx={{ fontSize: 32, color: 'primary.main', mb: 1 }} />
          <Typography variant="h2">{t.title}</Typography>
          <Typography color="text.secondary" sx={{ mt: 1 }}>
            {t.subtitle}
          </Typography>
        </Box>
        <Alert severity="info">{t.hint}</Alert>
        {error && <Alert severity="error">{error}</Alert>}
        <Stack direction="row" spacing={2} alignItems="center">
          <TextField
            select
            fullWidth
            label={t.folder}
            value={paths.includes(selected) ? selected : ''}
            disabled={busy || !paths.length}
            onChange={(e) => setFolder(e.target.value)}
          >
            {paths.map((path) => (
              <MenuItem key={path} value={path}>
                {path}
              </MenuItem>
            ))}
          </TextField>
          <Button
            sx={{ whiteSpace: 'nowrap' }}
            disabled={busy || !isDesktop}
            onClick={() => {
              void add().then(() => {
                useWorkflowStore.getState().setPage('metadata');
              });
            }}
          >
            {t.choose}
          </Button>
        </Stack>
        {!paths.length && <Typography color="text.secondary">{t.noFolder}</Typography>}
        <Typography variant="body2" color="text.secondary">
          {t.folderHint}
        </Typography>
        <FormControlLabel
          control={
            <Checkbox
              checked={recursive}
              disabled={busy}
              onChange={(_, checked) => setRecursive(checked)}
            />
          }
          label={t.recursive}
        />
        <Alert severity="warning">{t.creationHint}</Alert>
        <Button
          variant="contained"
          disabled={!selected || busy || !isDesktop}
          onClick={() => void useMetadataStore.getState().preview({ paths: [selected], recursive })}
        >
          {t.review}
        </Button>
      </Stack>
    </Box>
  );
}
