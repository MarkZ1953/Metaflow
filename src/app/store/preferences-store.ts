import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { z } from 'zod';

const preferencesSchema = z.object({
  themeMode: z.enum(['light', 'dark', 'system']),
  sidebarOpen: z.boolean(),
  detailsOpen: z.boolean(),
  showHidden: z.boolean(),
});
type Preferences = z.infer<typeof preferencesSchema>;
interface PreferencesState extends Preferences {
  setThemeMode: (mode: Preferences['themeMode']) => void;
  toggleSidebar: () => void;
  toggleDetails: () => void;
  setShowHidden: (show: boolean) => void;
}

export const usePreferencesStore = create<PreferencesState>()(
  persist(
    (set) => ({
      themeMode: 'system',
      sidebarOpen: true,
      detailsOpen: true,
      showHidden: false,
      setThemeMode: (themeMode) => set({ themeMode }),
      toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
      toggleDetails: () => set((state) => ({ detailsOpen: !state.detailsOpen })),
      setShowHidden: (showHidden) => set({ showHidden }),
    }),
    {
      name: 'metaflow-preferences',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: ({ themeMode, sidebarOpen, detailsOpen, showHidden }) => ({
        themeMode,
        sidebarOpen,
        detailsOpen,
        showHidden,
      }),
      merge: (persistedState, currentState) => {
        const result = preferencesSchema.safeParse(persistedState);
        return { ...currentState, ...(result.success ? result.data : {}) };
      },
    },
  ),
);
