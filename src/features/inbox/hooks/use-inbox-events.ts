import { useEffect } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { isDesktop } from '../services/inbox-service';
import { useWorkflowStore } from '../store/workflow-store';
import { progressSchema } from '../schemas/inbox-schema';
import { useWorkspaceStore } from '../../workspace/store/workspace-store';
import { useExplorerStore } from '../../explorer/store/explorer-store';

export function useInboxEvents() {
  useEffect(() => {
    if (!isDesktop) return;
    let disposed = false;
    const unlisteners: UnlistenFn[] = [];
    const state = useWorkflowStore.getState;
    void Promise.allSettled([
      listen('inbox-changed', () => {
        void state().refresh();
      }),
      listen('operation-progress', (event) => {
        const parsed = progressSchema.safeParse(event.payload);
        if (parsed.success) state().setProgress(parsed.data);
      }),
      listen('workspace-changed', () => {
        useWorkspaceStore.setState({ children: {}, expanded: {} });
        void useWorkspaceStore.getState().load();
        void useExplorerStore.getState().refresh();
      }),
    ]).then((listeners) => {
      for (const result of listeners) {
        if (result.status === 'fulfilled') {
          if (disposed) result.value();
          else unlisteners.push(result.value);
        }
      }
    });
    void state().refresh();
    // Low-frequency IPC fallback when an OS/window event is lost; never one IPC per file.
    const timer = window.setInterval(() => {
      void state().refresh();
    }, 5000);
    return () => {
      disposed = true;
      unlisteners.forEach((unlisten) => unlisten());
      window.clearInterval(timer);
    };
  }, []);
}
