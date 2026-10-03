import { duplicateService, type ComparisonSide, type DuplicateImage } from './duplicate-service';

interface PreviewEntry {
  key: string;
  sessionId: string;
  comparisonId: string;
  side: ComparisonSide;
  state: 'queued' | 'running' | 'settled';
  consumers: Set<symbol>;
  promise: Promise<DuplicateImage>;
  resolve(image: DuplicateImage): void;
  reject(error: unknown): void;
}
const previews = new Map<string, PreviewEntry>();
const queue: PreviewEntry[] = [];
const cacheLimit = 8;
const concurrency = 2;
let running = 0;
function aborted() {
  return new DOMException('Image preview was cancelled', 'AbortError');
}
function cancelQueued(entry: PreviewEntry) {
  if (entry.state !== 'queued') return;
  const index = queue.indexOf(entry);
  if (index >= 0) queue.splice(index, 1);
  entry.state = 'settled';
  if (previews.get(entry.key) === entry) previews.delete(entry.key);
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
    void duplicateService
      .image(entry.sessionId, entry.comparisonId, entry.side)
      .then(
        (image) => entry.resolve(image),
        (error: unknown) => {
          if (previews.get(entry.key) === entry) previews.delete(entry.key);
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
export function duplicatePreview(
  sessionId: string,
  comparisonId: string,
  side: ComparisonSide,
  signal: AbortSignal,
) {
  if (signal.aborted) return Promise.reject<DuplicateImage>(aborted());
  const key = `${sessionId}:${comparisonId}:${side}`;
  let entry = previews.get(key);
  if (!entry) {
    let resolve!: (image: DuplicateImage) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<DuplicateImage>((accept, fail) => {
      resolve = accept;
      reject = fail;
    });
    entry = {
      key,
      sessionId,
      comparisonId,
      side,
      state: 'queued',
      consumers: new Set(),
      promise,
      resolve,
      reject,
    };
    queue.push(entry);
  } else {
    previews.delete(key);
  }
  previews.set(key, entry);
  while (previews.size > cacheLimit) {
    const first = previews.keys().next().value;
    if (first !== undefined) previews.delete(first);
  }
  const selected = entry;
  const token = Symbol('preview consumer');
  selected.consumers.add(token);
  const result = new Promise<DuplicateImage>((resolve, reject) => {
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
      (image) => {
        release();
        if (!signal.aborted) resolve(image);
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
export function clearDuplicatePreviews() {
  for (const entry of [...queue]) cancelQueued(entry);
  previews.clear();
}
