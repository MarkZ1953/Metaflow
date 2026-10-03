import {
  Box,
  Divider,
  Drawer,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import CloseRounded from '@mui/icons-material/CloseRounded';
import DarkModeOutlined from '@mui/icons-material/DarkModeOutlined';
import LightModeOutlined from '@mui/icons-material/LightModeOutlined';
import SettingsBrightnessOutlined from '@mui/icons-material/SettingsBrightnessOutlined';
import ShieldOutlined from '@mui/icons-material/ShieldOutlined';
import { usePreferencesStore } from '../../../app/store/preferences-store';
import { ActionButton } from '../../../shared/components/action-button';
import { messages as t } from '../../../shared/constants/messages';

export function SettingsPanel({ open, onClose }: { open: boolean; onClose(): void }) {
  const { themeMode, setThemeMode } = usePreferencesStore();
  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      slotProps={{ paper: { sx: { width: 420, maxWidth: '100%' } } }}
    >
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ p: 3 }}>
        <Typography variant="h2">{t.settings}</Typography>
        <ActionButton label={t.close} icon={CloseRounded} onClick={onClose} />
      </Stack>
      <Divider />
      <Stack spacing={3} sx={{ p: 3, overflowY: 'auto' }}>
        <Box>
          <Typography variant="h3" sx={{ mb: 2 }}>
            {t.appearance}
          </Typography>
          <ToggleButtonGroup
            value={themeMode}
            exclusive
            fullWidth
            size="small"
            onChange={(_, value: unknown) => {
              if (value === 'light' || value === 'dark' || value === 'system') setThemeMode(value);
            }}
            aria-label="Tema de la aplicación"
          >
            <ToggleButton value="light">
              <LightModeOutlined sx={{ fontSize: 17, mr: 0.7 }} />
              {t.light}
            </ToggleButton>
            <ToggleButton value="dark">
              <DarkModeOutlined sx={{ fontSize: 17, mr: 0.7 }} />
              {t.dark}
            </ToggleButton>
            <ToggleButton value="system">
              <SettingsBrightnessOutlined sx={{ fontSize: 17, mr: 0.7 }} />
              {t.system}
            </ToggleButton>
          </ToggleButtonGroup>
        </Box>
        <Divider />
        <Box>
          <Typography variant="h3">{t.configuration}</Typography>
          <Typography color="text.secondary" sx={{ mt: 1 }}>
            {t.configurationHint}
          </Typography>
        </Box>
        <Divider />
        <Box>
          <Typography variant="h3">{t.safetyTitle}</Typography>
          <Typography color="text.secondary" sx={{ mt: 1 }}>
            {t.safetyHint}
          </Typography>
        </Box>
        <Box sx={{ bgcolor: 'action.hover', p: 2, borderRadius: 1.5 }}>
          <ShieldOutlined sx={{ color: 'success.main', mb: 1 }} />
          <Typography variant="h3">{t.privacy}</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            {t.manualHint}
          </Typography>
        </Box>
        <Typography variant="caption" color="text.disabled">
          {t.versionDescription}
        </Typography>
      </Stack>
    </Drawer>
  );
}
