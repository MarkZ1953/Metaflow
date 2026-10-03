import { useEffect, useRef } from 'react';
import { Box, Chip, InputBase, Stack, Typography } from '@mui/material';
import SearchRounded from '@mui/icons-material/SearchRounded';
import SettingsOutlined from '@mui/icons-material/SettingsOutlined';
import MenuRounded from '@mui/icons-material/MenuRounded';
import CloseRounded from '@mui/icons-material/CloseRounded';
import CircleRounded from '@mui/icons-material/CircleRounded';
import { Brand } from '../../shared/components/brand';
import { ActionButton } from '../../shared/components/action-button';
import { usePreferencesStore } from '../store/preferences-store';
import { useWorkflowStore } from '../../features/inbox/store/workflow-store';
import { messages as t } from '../../shared/constants/messages';
import { useExplorerStore } from '../../features/explorer/store/explorer-store';

export function TopBar({ onSettings }: { onSettings(): void }) {
  const toggleSidebar = usePreferencesStore((s) => s.toggleSidebar);
  const { query: inboxQuery, setQuery: setInboxQuery, snapshot, page, demo } = useWorkflowStore();
  const explorerQuery = useExplorerStore((s) => s.query);
  const setExplorerQuery = useExplorerStore((s) => s.setQuery);
  const listing = useExplorerStore((s) => s.listing);
  const query = page === 'workspace' ? explorerQuery : inboxQuery;
  const setQuery = page === 'workspace' ? setExplorerQuery : setInboxQuery;
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      if (
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === 'f' &&
        (page === 'inbox' || page === 'review' || page === 'workspace')
      ) {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handle);
    return () => window.removeEventListener('keydown', handle);
  }, [page]);
  return (
    <Box
      component="header"
      sx={{
        height: 66,
        borderBottom: 1,
        borderColor: 'divider',
        bgcolor: 'background.paper',
        display: 'flex',
        alignItems: 'center',
        gap: 2,
        px: 2,
        flexShrink: 0,
      }}
    >
      <Stack direction="row" alignItems="center" spacing={1.3} sx={{ width: 190, flexShrink: 0 }}>
        <ActionButton
          label="Mostrar u ocultar navegación"
          icon={MenuRounded}
          onClick={toggleSidebar}
        />
        <Brand />
      </Stack>
      <Box
        sx={{
          flex: 1,
          maxWidth: 660,
          mx: 'auto',
          height: 36,
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          px: 1.4,
          bgcolor: 'action.hover',
          border: 1,
          borderColor: 'divider',
          borderRadius: 1,
          '&:focus-within': { borderColor: 'primary.main' },
        }}
      >
        <SearchRounded sx={{ fontSize: 19, color: 'text.secondary' }} />
        <InputBase
          inputRef={searchRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          disabled={
            page === 'workspace'
              ? !listing
              : !snapshot.inbox || (page !== 'inbox' && page !== 'review')
          }
          placeholder={page === 'workspace' ? t.searchWorkspace : t.search}
          inputProps={{
            'aria-label': page === 'workspace' ? t.searchWorkspaceLabel : t.searchLabel,
          }}
          sx={{ flex: 1, fontSize: 13 }}
        />
        {query ? (
          <ActionButton label="Limpiar búsqueda" icon={CloseRounded} onClick={() => setQuery('')} />
        ) : (
          <Typography
            variant="caption"
            color="text.disabled"
            sx={{
              border: 1,
              borderColor: 'divider',
              borderRadius: 0.5,
              px: 0.6,
              whiteSpace: 'nowrap',
              display: { xs: 'none', md: 'block' },
            }}
          >
            Ctrl F
          </Typography>
        )}
      </Box>
      <Chip
        icon={<CircleRounded sx={{ fontSize: '7px !important' }} />}
        label={demo ? 'Demo' : 'Local'}
        size="small"
        variant="outlined"
        sx={{
          color: demo ? 'warning.main' : 'success.main',
          borderColor: 'divider',
          display: { xs: 'none', md: 'inline-flex' },
        }}
      />
      <ActionButton label={t.settings} icon={SettingsOutlined} onClick={onSettings} />
    </Box>
  );
}
