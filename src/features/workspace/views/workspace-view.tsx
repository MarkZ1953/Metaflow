import { workspaceMessages as w } from '../../../shared/constants/workspace-messages';
import { useEffect } from 'react';
import { Alert, Box, Button, Stack, Typography } from '@mui/material';
import { FileExplorer } from '../../explorer/views/file-explorer';
import { FileDetailsPanel } from '../../explorer/components/file-details-panel';
import { useExplorerStore } from '../../explorer/store/explorer-store';
import { useWorkspaceStore } from '../store/workspace-store';
import { usePreferencesStore } from '../../../app/store/preferences-store';
import { useWorkflowStore } from '../../inbox/store/workflow-store';
import { isDesktop } from '../../inbox/services/inbox-service';
import { isFileDrag, readFileDrag } from '../services/workspace-drag';
import { useMetadataStore } from '../../metadata/store/metadata-store';
import { metadataMessages as m } from '../../../shared/constants/metadata-messages';
export function WorkspaceView() {
  const { workspace, load, add, error, prepare } = useWorkspaceStore();
  const { listing, selectedPaths } = useExplorerStore();
  const detailsOpen = usePreferencesStore((s) => s.detailsOpen);
  const busy = useWorkflowStore((s) => s.busy);
  useEffect(() => {
    if (isDesktop) void load();
  }, [load]);
  const sources = selectedPaths.filter((path) =>
    listing?.entries.some((e) => e.path === path && (e.kind === 'file' || e.kind === 'directory')),
  );
  return (
    <Box
      onDragOver={(event) => {
        if (listing && !busy && isFileDrag(event.dataTransfer)) {
          event.preventDefault();
          event.dataTransfer.dropEffect = 'move';
        }
      }}
      onDrop={(event) => {
        if (listing && !busy && isFileDrag(event.dataTransfer)) {
          event.preventDefault();
          prepare(readFileDrag(event.dataTransfer), listing.path);
        }
      }}
      sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}
    >
      {error && (
        <Alert severity="error" onClose={() => useWorkspaceStore.setState({ error: null })}>
          {error}
        </Alert>
      )}
      <Stack
        direction="row"
        alignItems="center"
        spacing={1}
        sx={{ px: 3, py: 1.5, borderBottom: 1, borderColor: 'divider' }}
      >
        <Typography fontWeight={600} sx={{ flex: 1 }}>
          {workspace.name}
        </Typography>
        <Typography variant="caption">
          {sources.length}
          {w.seleccionados}
        </Typography>
        <Button
          variant="outlined"
          disabled={!sources.length || busy}
          onClick={() => prepare(sources)}
        >
          {w.moverCopiar}
        </Button>
        <Button disabled={busy || !isDesktop} onClick={() => void add()}>
          {w.agregarCarpeta}
        </Button>
        <Button
          variant="outlined"
          disabled={!sources.length || busy || !isDesktop}
          onClick={() =>
            void useMetadataStore.getState().preview({ paths: sources, recursive: false })
          }
        >
          {m.fix}
        </Button>
      </Stack>
      {workspace.roots.length ? (
        <Box sx={{ flex: 1, minHeight: 0, display: 'flex' }}>
          <FileExplorer
            detailsOpen={detailsOpen}
            onToggleDetails={() => usePreferencesStore.setState({ detailsOpen: !detailsOpen })}
          />
          {detailsOpen && (
            <FileDetailsPanel
              onClose={() => usePreferencesStore.setState({ detailsOpen: false })}
            />
          )}
        </Box>
      ) : (
        <Box sx={{ m: 'auto', p: 4, maxWidth: 520, textAlign: 'center' }}>
          <Typography variant="h2">{w.tusCarpetasEnUnWorkspace}</Typography>
          <Typography color="text.secondary" sx={{ my: 2 }}>
            {w.abreCarpetasDeCualquierDiscoElArbolCarga}
          </Typography>
          <Button variant="contained" disabled={!isDesktop} onClick={() => void add()}>
            {w.agregarCarpetaAlWorkspace}
          </Button>
        </Box>
      )}
    </Box>
  );
}
