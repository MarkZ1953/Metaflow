import { describe, expect, it } from 'vitest';
import { duplicateImageSchema, duplicateReviewSchema } from './duplicate-service';

const file = {
  path: 'F:\\Fotos\\foto.jpg',
  stamp: { size: 200, createdAt: 1, modifiedAt: 2 },
  hash: null,
  planned: false,
};
describe('Duplicate review IPC boundaries', () => {
  it('keeps visual candidates distinct from verified identical content', () => {
    const review = duplicateReviewSchema.parse({
      sessionId: 'session',
      comparisons: [{ id: 'pair', left: file, right: file, kind: 'similar' }],
      unreadableCount: 0,
      ignoredCount: 1,
      truncated: false,
    });
    expect(review.comparisons[0]?.kind).toBe('similar');
    expect(
      duplicateReviewSchema.safeParse({
        ...review,
        comparisons: [{ ...review.comparisons[0], kind: 'confirmed' }],
      }).success,
    ).toBe(false);
  });
  it('accepts bounded embedded JPEG data and rejects external URLs, HTML, SVG and invalid dimensions', () => {
    const preview = { dataUrl: 'data:image/jpeg;base64,/9j/AA==', width: 1200, height: 800 };
    expect(duplicateImageSchema.safeParse(preview).success).toBe(true);
    for (const dataUrl of [
      'https://example.com/foto.jpg',
      'file:///F:/foto.jpg',
      'data:text/html;base64,AAAA',
      'data:image/svg+xml;base64,AAAA',
      'data:image/jpeg;base64,A',
      'data:image/jpeg;base64,<script>',
    ]) {
      expect(duplicateImageSchema.safeParse({ ...preview, dataUrl }).success).toBe(false);
    }
    expect(duplicateImageSchema.safeParse({ ...preview, width: 0 }).success).toBe(false);
    expect(
      duplicateImageSchema.safeParse({
        ...preview,
        dataUrl: `data:image/jpeg;base64,${'A'.repeat(8_000_000)}`,
      }).success,
    ).toBe(false);
  });
});
