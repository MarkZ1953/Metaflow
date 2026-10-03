import { invoke } from '@tauri-apps/api/core';
import { z } from 'zod';
import { operationSchema, planSchema } from '../../inbox/schemas/inbox-schema';
import type { TransferRequest } from '../../workspace/services/workspace-service';
import { mediaEntrySchema, type MediaEntry } from './classification-service';
import {
  nextMediaId,
  sameMediaPath,
  visibleMedia,
  type MediaFilters,
  type MediaVisibility,
} from './media-query';

export const classifiedTransferResultSchema = z.object({
  operation: operationSchema,
  entries: z.array(mediaEntrySchema),
});
export type ClassifiedTransferResult = z.infer<typeof classifiedTransferResultSchema>;
export const classificationTransferService = {
  preview: async (sessionId: string, itemIds: string[], request: TransferRequest) =>
    planSchema.parse(await invoke('preview_classified_transfer', { sessionId, itemIds, request })),
  execute: async (sessionId: string, planId: string) =>
    classifiedTransferResultSchema.parse(
      await invoke('execute_classified_transfer', { sessionId, planId }),
    ),
};

interface TransferGalleryState extends MediaVisibility {
  entries: MediaEntry[];
  selected: string[];
  activeId: string | null;
  filters: MediaFilters;
  lastOperationId: string | null;
}

export function completedClassifiedTransferIds(
  entries: MediaEntry[],
  result: ClassifiedTransferResult,
): Set<string> {
  return new Set(
    entries
      .filter((entry) =>
        result.operation.items.some(
          (item) =>
            !item.backup &&
            item.status === 'completed' &&
            (item.kind === 'move' || item.kind === 'copy') &&
            sameMediaPath(item.sourcePath, entry.path) &&
            !sameMediaPath(item.sourcePath, item.destinationPath),
        ),
      )
      .map((entry) => entry.id),
  );
}

export function reconcileClassifiedTransfer(
  state: TransferGalleryState,
  result: ClassifiedTransferResult,
) {
  const updated = new Map(result.entries.map((entry) => [entry.id, entry]));
  const entries = state.entries.flatMap((entry) => {
    const replacement = updated.get(entry.id);
    return replacement && sameMediaPath(replacement.path, entry.path) ? [replacement] : [];
  });
  const ids = new Set(entries.map((entry) => entry.id));
  const removed = new Set(
    state.entries.filter((entry) => !ids.has(entry.id)).map((entry) => entry.id),
  );
  const completed = result.operation.items.some(
    (item) =>
      item.status === 'completed' &&
      (item.kind === 'move' || item.kind === 'copy') &&
      !sameMediaPath(item.sourcePath, item.destinationPath),
  );
  return {
    entries,
    selected: state.selected.filter((id) => ids.has(id)),
    excluded: state.excluded.filter((id) => ids.has(id)),
    activeId: nextMediaId(
      visibleMedia(state.entries, state.filters, state),
      state.activeId,
      removed,
    ),
    lastOperationId: completed ? result.operation.id : state.lastOperationId,
  };
}
