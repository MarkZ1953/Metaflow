import { useState, useEffect } from 'react';
import { Alert, Box, Snackbar, LinearProgress, Button } from '@mui/material';
import { usePreferencesStore } from '../store/preferences-store';
import { Sidebar } from './sidebar';
import { TopBar } from './top-bar';
import { SettingsPanel } from '../../features/settings/views/settings-panel';
import { useWorkflowStore } from '../../features/inbox/store/workflow-store';
import { useInboxEvents } from '../../features/inbox/hooks/use-inbox-events';
import { InboxView } from '../../features/inbox/views/inbox-view';
import { DateRulesView } from '../../features/date-rules/views/date-rules-view';
import { HistoryView } from '../../features/history/views/history-view';
import { OrganizationPreview } from '../../features/organizer/components/organization-preview';
import { OperationProgress } from '../../features/organizer/components/operation-progress';
import { friendlyError } from '../../shared/services/app-error';
import { messages as t } from '../../shared/constants/messages';
import { WorkspaceView } from '../../features/workspace/views/workspace-view';
import { TransferDialog } from '../../features/workspace/components/transfer-dialog';
import { useWorkspaceStore } from '../../features/workspace/store/workspace-store';
import { isDesktop } from '../../features/inbox/services/inbox-service';
import { RenamePresetsView } from '../../features/rename/views/rename-presets-view';
import { useRenameStore } from '../../features/rename/store/rename-store';
import { DuplicatesView } from '../../features/duplicates/views/duplicates-view';
import { MetadataView } from '../../features/metadata/views/metadata-view';
import { MetadataPreview } from '../../features/metadata/components/metadata-preview';
import { ClassificationView } from '../../features/classification/views/classification-view';
import { useClassificationStore } from '../../features/classification/store/classification-store';

export function AppLayout() {
  const sidebarOpen = usePreferencesStore((s) => s.sidebarOpen);
  const { page, error, dismissError, notice, dismissNotice, demo, snapshot, busy, progress } =
    useWorkflowStore();
  const [settingsOpen, setSettingsOpen] = useState(false);
  useInboxEvents();
  useEffect(() => {
    if (isDesktop) {
      void useWorkspaceStore.getState().load();
      void useRenameStore.getState().load();
    }
  }, []);
  return (
    <Box
      sx={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        bgcolor: 'background.default',
      }}
    >
      <TopBar onSettings={() => setSettingsOpen(true)} />
      {busy && !progress && <LinearProgress aria-label={t.preparing} sx={{ flexShrink: 0 }} />}
      {busy && !progress && (
        <Box sx={{ px: 3, py: 0.5 }}>
          <Button
            size="small"
            onClick={() => {
              const classification = useClassificationStore.getState();
              void (classification.scanning
                ? classification.cancel()
                : useWorkflowStore.getState().cancel());
            }}
          >
            {t.cancelAnalysis}
          </Button>
        </Box>
      )}
      {demo && (
        <Alert severity="warning" sx={{ borderRadius: 0, py: 0.5 }}>
          {t.demoBanner}
        </Alert>
      )}
      {error && (
        <Alert severity="error" onClose={dismissError} sx={{ borderRadius: 0 }}>
          {error}
        </Alert>
      )}
      {snapshot.error && (
        <Alert severity="warning" sx={{ borderRadius: 0 }}>
          {friendlyError({ code: snapshot.error })}
        </Alert>
      )}
      <Box sx={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {sidebarOpen && <Sidebar />}
        {page === 'classification' ? (
          <ClassificationView />
        ) : page === 'metadata' ? (
          <MetadataView />
        ) : page === 'duplicates' ? (
          <DuplicatesView />
        ) : page === 'workspace' ? (
          <WorkspaceView />
        ) : page === 'presets' ? (
          <RenamePresetsView />
        ) : page === 'rules' ? (
          <DateRulesView />
        ) : page === 'history' || page === 'transfers' ? (
          <HistoryView />
        ) : (
          <InboxView />
        )}
      </Box>
      <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <OrganizationPreview />
      <TransferDialog key={useWorkspaceStore((s) => s.pendingSources.join('|'))} />
      <OperationProgress />
      <MetadataPreview />
      <Snackbar open={!!notice} autoHideDuration={6500} onClose={dismissNotice}>
        <Alert severity="success" onClose={dismissNotice}>
          {notice}
        </Alert>
      </Snackbar>
    </Box>
  );
}
