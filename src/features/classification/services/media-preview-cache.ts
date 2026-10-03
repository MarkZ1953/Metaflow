import { classificationService, type MediaPreview } from './classification-service';
interface PreviewEntry {
  key: string;
  sessionId: string;
  itemId: string;
  state: 'queued' | 'running' | 'settled';
  consumers: Set<symbol>;
  promise: Promise<MediaPreview>;
  resolve(value: MediaPreview): void;
  reject(error: unknown): void;
}
const entries = new Map<string, PreviewEntry>();
const queue: PreviewEntry[] = [];
const cacheLimit = 12;
const concurrency = 2;
let running = 0;
function aborted() {
  return new DOMException('Media preview was cancelled', 'AbortError');
}
function cancelQueued(entry: PreviewEntry) {
  if (entry.state !== 'queued') return;
  const index = queue.indexOf(entry);
  if (index >= 0) queue.splice(index, 1);
  entry.state = 'settled';
  if (entries.get(entry.key) === entry) entries.delete(entry.key);
  entry.reject(aborted());
}
function pump() {
  while (running < concurrency && queue.length) {
    const entry = queue.shift()!;
    if (!entry.consumers.size) {
      cancelQueued(entry);
      continue;
    }
    entry.state = 'running';
    running += 1;
    void classificationService
      .preview(entry.sessionId, entry.itemId)
      .then(
        (value) => entry.resolve(value),
        (error: unknown) => {
          if (entries.get(entry.key) === entry) entries.delete(entry.key);
          entry.reject(error);
        },
      )
      .finally(() => {
        entry.state = 'settled';
        running -= 1;
        pump();
      });
  }
}
export function mediaPreview(
  sessionId: string,
  itemId: string,
  signal: AbortSignal,
): Promise<MediaPreview> {
  if (signal.aborted) return Promise.reject(aborted());
  const key = `${sessionId}:${itemId}`;
  let entry = entries.get(key);
  if (!entry) {
    let resolve!: (value: MediaPreview) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<MediaPreview>((accept, fail) => {
      resolve = accept;
      reject = fail;
    });
    entry = {
      key,
      sessionId,
      itemId,
      state: 'queued',
      consumers: new Set(),
      promise,
      resolve,
      reject,
    };
    queue.push(entry);
  } else entries.delete(key);
  entries.set(key, entry);
  while (entries.size > cacheLimit) {
    const first = entries.keys().next().value;
    if (first !== undefined) entries.delete(first);
  }
  const selected = entry;
  const token = Symbol('media preview consumer');
  selected.consumers.add(token);
  const result = new Promise<MediaPreview>((resolve, reject) => {
    const release = () => {
      selected.consumers.delete(token);
      signal.removeEventListener('abort', cancel);
    };
    const cancel = () => {
      release();
      if (!selected.consumers.size) cancelQueued(selected);
      reject(aborted());
    };
    signal.addEventListener('abort', cancel, { once: true });
    selected.promise.then(
      (value) => {
        release();
        if (!signal.aborted) resolve(value);
      },
      (error: unknown) => {
        release();
        reject(error);
      },
    );
  });
  pump();
  return result;
}
export function clearMediaPreviews() {
  for (const entry of [...queue]) cancelQueued(entry);
  entries.clear();
}
export function invalidateMediaPreview(sessionId: string, itemId: string) {
  const key = `${sessionId}:${itemId}`;
  const entry = entries.get(key);
  if (entry?.state === 'settled') entries.delete(key);
}
