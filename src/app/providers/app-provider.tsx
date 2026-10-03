import { useMemo } from 'react';
import type { PropsWithChildren } from 'react';
import { CssBaseline, ThemeProvider, useMediaQuery } from '@mui/material';
import { createAppTheme } from '../../shared/theme/app-theme';
import { usePreferencesStore } from '../store/preferences-store';

export function AppProvider({ children }: PropsWithChildren) {
  const mode = usePreferencesStore((state) => state.themeMode);
  const systemDark = useMediaQuery('(prefers-color-scheme: dark)');
  const resolvedMode = mode === 'system' ? (systemDark ? 'dark' : 'light') : mode;
  const theme = useMemo(() => createAppTheme(resolvedMode), [resolvedMode]);
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      {children}
    </ThemeProvider>
  );
}
