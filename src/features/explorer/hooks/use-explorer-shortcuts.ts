import { useEffect } from 'react';
import type { RefObject } from 'react';
import { useExplorerStore } from '../store/explorer-store';

export function useSearchShortcut(ref: RefObject<HTMLInputElement | null>) {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        ref.current?.focus();
        ref.current?.select();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [ref]);
}

export function useExplorerShortcuts(enabled: boolean, onToggleDetails: () => void) {
  useEffect(() => {
    if (!enabled) return;
    const handler = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        target.closest('input, textarea, select, [contenteditable="true"], [role="dialog"]')
      )
        return;
      const state = useExplorerStore.getState();
      if (event.altKey && event.key === 'ArrowLeft') {
        event.preventDefault();
        void state.back();
      } else if (event.altKey && event.key === 'ArrowRight') {
        event.preventDefault();
        void state.forward();
      } else if (event.altKey && event.key === 'ArrowUp') {
        event.preventDefault();
        void state.up();
      } else if (event.key === 'F5') {
        event.preventDefault();
        void state.refresh();
      } else if (event.key === 'Escape') {
        state.select(null);
      } else if (
        (event.ctrlKey || event.metaKey) &&
        event.shiftKey &&
        event.key.toLowerCase() === 'i'
      ) {
        event.preventDefault();
        onToggleDetails();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [enabled, onToggleDetails]);
}
