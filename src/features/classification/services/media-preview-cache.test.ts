import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MediaPreview } from './classification-service';
const mock = vi.hoisted(() => ({ preview: vi.fn() }));
vi.mock('./classification-service', () => ({ classificationService: { preview: mock.preview } }));
import { clearMediaPreviews, mediaPreview } from './media-preview-cache';
const preview: MediaPreview = {
  frames: [
    { dataUrl: 'data:image/jpeg;base64,/9j/AA==', width: 100, height: 100, atSeconds: null },
  ],
};
beforeEach(() => {
  clearMediaPreviews();
  vi.resetAllMocks();
});
describe('Bounded lazy media preview scheduling', () => {
  it('limits native work to two and cancels gallery requests that disappear before they begin', async () => {
    const complete: ((result: MediaPreview) => void)[] = [];
    mock.preview.mockImplementation(
      () => new Promise<MediaPreview>((resolve) => complete.push(resolve)),
    );
    const first = mediaPreview('session', 'first', new AbortController().signal);
    const second = mediaPreview('session', 'second', new AbortController().signal);
    const abandoned: Promise<unknown>[] = [];
    for (let index = 0; index < 20; index += 1) {
      const controller = new AbortController();
      abandoned.push(
        mediaPreview('session', `old-${index}`, controller.signal).catch((error: unknown) => error),
      );
      controller.abort();
    }
    const current = mediaPreview('session', 'current', new AbortController().signal);
    expect(mock.preview).toHaveBeenCalledTimes(2);
    complete[0]!(preview);
    complete[1]!(preview);
    await Promise.all([first, second, ...abandoned]);
    expect(mock.preview).toHaveBeenCalledTimes(3);
    expect(mock.preview).toHaveBeenLastCalledWith('session', 'current');
    complete[2]!(preview);
    await current;
  });
  it('shares the gallery and enlarged preview without cancelling the surviving consumer', async () => {
    let complete!: (result: MediaPreview) => void;
    mock.preview.mockReturnValue(
      new Promise<MediaPreview>((resolve) => {
        complete = resolve;
      }),
    );
    const controller = new AbortController();
    const first = mediaPreview('session', 'a', controller.signal).catch((error: unknown) => error);
    const enlarged = mediaPreview('session', 'a', new AbortController().signal);
    controller.abort();
    complete(preview);
    await first;
    expect(await enlarged).toEqual(preview);
    expect(mock.preview).toHaveBeenCalledOnce();
  });
  it('bounds the cache to twelve results and expires pending work on a new analysis', async () => {
    mock.preview.mockResolvedValue(preview);
    for (let index = 0; index < 13; index += 1)
      await mediaPreview('session', String(index), new AbortController().signal);
    await mediaPreview('session', '12', new AbortController().signal);
    expect(mock.preview).toHaveBeenCalledTimes(13);
    await mediaPreview('session', '0', new AbortController().signal);
    expect(mock.preview).toHaveBeenCalledTimes(14);
    clearMediaPreviews();
    await mediaPreview('new-session', '12', new AbortController().signal);
    expect(mock.preview).toHaveBeenCalledTimes(15);
  });
});
