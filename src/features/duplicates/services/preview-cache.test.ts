import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DuplicateImage } from './duplicate-service';
const mock = vi.hoisted(() => ({ image: vi.fn() }));
vi.mock('./duplicate-service', () => ({ duplicateService: { image: mock.image } }));
import { clearDuplicatePreviews, duplicatePreview } from './preview-cache';

const image: DuplicateImage = {
  dataUrl: 'data:image/jpeg;base64,/9j/AA==',
  width: 100,
  height: 100,
};
beforeEach(() => {
  clearDuplicatePreviews();
  vi.resetAllMocks();
});
describe('Bounded duplicate image preview scheduling', () => {
  it('limits live IPC to two and cancels obsolete queued comparisons during fast navigation', async () => {
    const complete: ((image: DuplicateImage) => void)[] = [];
    mock.image.mockImplementation(
      () => new Promise<DuplicateImage>((resolve) => complete.push(resolve)),
    );
    const first = duplicatePreview('session', 'first', 'left', new AbortController().signal);
    const second = duplicatePreview('session', 'first', 'right', new AbortController().signal);
    const abortedRequests: Promise<unknown>[] = [];
    for (let index = 0; index < 20; index += 1) {
      const controller = new AbortController();
      const request = duplicatePreview('session', `old-${index}`, 'left', controller.signal);
      abortedRequests.push(request.catch((error: unknown) => error));
      controller.abort();
    }
    expect(mock.image).toHaveBeenCalledTimes(2);
    const current = duplicatePreview('session', 'current', 'left', new AbortController().signal);
    complete[0]!(image);
    complete[1]!(image);
    await Promise.all([first, second, ...abortedRequests]);
    expect(mock.image).toHaveBeenCalledTimes(3);
    expect(mock.image).toHaveBeenLastCalledWith('session', 'current', 'left');
    complete[2]!(image);
    await current;
  });
  it('keeps shared requests live for a new card after the first consumer unmounts', async () => {
    let complete!: (image: DuplicateImage) => void;
    mock.image.mockReturnValue(
      new Promise<DuplicateImage>((resolve) => {
        complete = resolve;
      }),
    );
    const controller = new AbortController();
    const old = duplicatePreview('session', 'pair', 'left', controller.signal).catch(
      (error: unknown) => error,
    );
    const current = duplicatePreview('session', 'pair', 'left', new AbortController().signal);
    controller.abort();
    complete(image);
    await old;
    expect(await current).toEqual(image);
    expect(mock.image).toHaveBeenCalledOnce();
  });
  it('keeps only eight cached results and clears them when the session changes', async () => {
    mock.image.mockResolvedValue(image);
    for (let index = 0; index < 9; index += 1) {
      await duplicatePreview('session', String(index), 'left', new AbortController().signal);
    }
    await duplicatePreview('session', '8', 'left', new AbortController().signal);
    expect(mock.image).toHaveBeenCalledTimes(9);
    await duplicatePreview('session', '0', 'left', new AbortController().signal);
    expect(mock.image).toHaveBeenCalledTimes(10);
    clearDuplicatePreviews();
    await duplicatePreview('new-session', '8', 'left', new AbortController().signal);
    expect(mock.image).toHaveBeenCalledTimes(11);
  });
  it('cancels previews waiting behind live requests when a new session begins', async () => {
    const complete: ((image: DuplicateImage) => void)[] = [];
    mock.image.mockImplementation(
      () => new Promise<DuplicateImage>((resolve) => complete.push(resolve)),
    );
    const first = duplicatePreview('old-session', 'pair', 'left', new AbortController().signal);
    const second = duplicatePreview('old-session', 'pair', 'right', new AbortController().signal);
    const queued = duplicatePreview(
      'old-session',
      'obsolete',
      'left',
      new AbortController().signal,
    ).catch((error: unknown) => error);
    clearDuplicatePreviews();
    complete[0]!(image);
    complete[1]!(image);
    await Promise.all([first, second]);
    const error = await queued;
    expect(error).toBeInstanceOf(DOMException);
    expect((error as DOMException).name).toBe('AbortError');
    expect(mock.image).toHaveBeenCalledTimes(2);
  });
});
