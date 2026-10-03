import { createTheme, alpha } from '@mui/material/styles';
import type { PaletteMode } from '@mui/material';

export function createAppTheme(mode: PaletteMode) {
  const dark = mode === 'dark';
  const primary = '#6366F1';
  return createTheme({
    palette: {
      mode,
      primary: {
        main: primary,
        light: dark ? '#A5A6FF' : '#4F46E5',
        dark: '#4F46E5',
        contrastText: '#FFFFFF',
      },
      secondary: { main: dark ? '#B59BEF' : '#815AC0' },
      background: { default: dark ? '#0E1015' : '#F7F8FA', paper: dark ? '#151821' : '#FFFFFF' },
      text: {
        primary: dark ? '#F4F4F5' : '#18181B',
        secondary: dark ? '#A1A1AA' : '#666B79',
        disabled: dark ? '#666B7A' : '#8A8F9B',
      },
      divider: dark ? '#272B35' : '#E7E9EF',
      action: { hover: dark ? '#1C202B' : '#F0F2F7', selected: alpha(primary, dark ? 0.16 : 0.08) },
      info: { main: dark ? '#82ACEC' : '#3A72B8' },
      success: { main: dark ? '#8DC5AF' : '#397C62' },
      warning: { main: dark ? '#D6B882' : '#94703B' },
      error: { main: dark ? '#EC939A' : '#B94753' },
    },
    typography: {
      fontFamily: '"Segoe UI Variable", "Segoe UI", Inter, system-ui, sans-serif',
      fontSize: 13,
      h1: { fontSize: '2.8rem', fontWeight: 650, letterSpacing: '-0.055em', lineHeight: 1.12 },
      h2: { fontSize: '1.55rem', fontWeight: 650, letterSpacing: '-0.035em' },
      h3: { fontSize: '1.1rem', fontWeight: 600, letterSpacing: '-0.025em' },
      h6: { fontSize: '1rem', fontWeight: 600 },
      body1: { fontSize: '0.875rem', lineHeight: 1.6 },
      body2: { fontSize: '0.8rem', lineHeight: 1.55 },
      caption: { fontSize: '0.7rem', lineHeight: 1.5 },
      button: { fontSize: '0.8rem', fontWeight: 600, textTransform: 'none', letterSpacing: 0 },
      overline: { fontSize: '0.63rem', fontWeight: 650, lineHeight: 1.7, letterSpacing: '0.12em' },
    },
    shape: { borderRadius: 10 },
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          ':root': { colorScheme: mode },
          'html, body, #root': { height: '100%', margin: 0, overflow: 'hidden' },
          '*': {
            boxSizing: 'border-box',
            scrollbarWidth: 'thin',
            scrollbarColor: dark ? '#353B49 transparent' : '#C9CDDA transparent',
          },
          '::selection': { backgroundColor: alpha(primary, 0.3) },
        },
      },
      MuiButton: {
        defaultProps: { disableElevation: true },
        styleOverrides: {
          root: { borderRadius: 8, minHeight: 34 },
          outlined: {
            borderColor: dark ? '#353B49' : '#D8DCE5',
            color: dark ? '#F4F4F5' : '#18181B',
          },
        },
      },
      MuiIconButton: {
        styleOverrides: {
          root: {
            borderRadius: 7,
            padding: 7,
            '&:focus-visible': { outline: `2px solid ${primary}`, outlineOffset: 2 },
          },
        },
      },
      MuiTooltip: {
        defaultProps: { arrow: true },
        styleOverrides: { tooltip: { fontSize: '0.72rem', borderRadius: 6 } },
      },
      MuiTextField: { defaultProps: { size: 'small' } },
      MuiOutlinedInput: {
        styleOverrides: {
          root: { borderRadius: 8, fontSize: '0.82rem' },
          notchedOutline: { borderColor: dark ? '#353B49' : '#D8DCE5' },
        },
      },
      MuiListItemButton: {
        styleOverrides: {
          root: {
            borderRadius: 7,
            minHeight: 37,
            '&.Mui-selected': { color: dark ? '#A5A6FF' : '#4F46E5' },
          },
        },
      },
      MuiChip: { styleOverrides: { root: { fontSize: '0.68rem', height: 24, borderRadius: 5 } } },
      MuiDialog: { styleOverrides: { paper: { backgroundImage: 'none' } } },
      MuiDrawer: { styleOverrides: { paper: { backgroundImage: 'none' } } },
      MuiPopover: { styleOverrides: { paper: { backgroundImage: 'none' } } },
      MuiToggleButton: { styleOverrides: { root: { textTransform: 'none', fontSize: '0.8rem' } } },
    },
  });
}
