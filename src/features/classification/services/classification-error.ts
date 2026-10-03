import { z } from 'zod';
import { friendlyError } from '../../../shared/services/app-error';
import { classificationMessages as t } from '../../../shared/constants/classification-messages';
const errorSchema = z.object({ code: z.string() });
const descriptions: Record<string, string> = {
  MEDIA_MODEL_UNAVAILABLE: t.modelUnavailable,
  CLASSIFICATION_REVIEW_EXPIRED: t.reviewExpired,
  MEDIA_PROTECTED: t.mediaProtected,
  VIDEO_PREVIEW_FAILED: t.videoPreviewFailed,
  INVALID_MEDIA_SELECTION: t.selectionLimit,
  INVALID_MEDIA_CATEGORIES: t.correctionInvalid,
  INVALID_CLASSIFICATION_FOLDERS: t.folderLimit,
};
export function classificationError(error: unknown): string {
  const parsed = errorSchema.safeParse(error);
  return parsed.success && descriptions[parsed.data.code]
    ? descriptions[parsed.data.code]!
    : friendlyError(error);
}
