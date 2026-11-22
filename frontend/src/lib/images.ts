// Egg icons and banners. Kept free of React and panel imports so it can be tested with `node --test`.
import type { EggAppearance, EggRule } from '../api/client.ts';

/** Same cap as the backend, in bytes after normalisation. */
export const MAX_IMAGE_URL_LENGTH = 1024;

/** Banners are shown at this width-to-height ratio everywhere, cropped to fit. */
export const BANNER_RATIO = 3;

/** File types offered for upload: raster images only, no SVG. */
export const UPLOAD_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif'] as const;

export const UPLOAD_ACCEPT = 'image/png,image/jpeg,image/gif,image/webp,image/avif';

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

/** The URL to store: trimmed, or null when blank (no image). */
export function imageUrlOrNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * Why the backend would reject `value` as an icon or banner URL, or null when it is fine. Blank is
 * fine: it removes the image. Mirrors `parse_image_url` in `backend/src/settings.rs`.
 */
export function imageUrlProblem(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed === '') return null;

  const tooLong = `Must be at most ${MAX_IMAGE_URL_LENGTH} characters long.`;
  if (new TextEncoder().encode(trimmed).length > MAX_IMAGE_URL_LENGTH) return tooLong;
  if (/[\s\p{Cc}]/u.test(trimmed)) return 'Must not contain spaces or control characters.';

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return 'Must be a full URL starting with https://.';
  }
  if (url.protocol !== 'https:') return 'Must start with https://.';
  if (url.hostname === '') return 'Must name a host.';
  if (url.username !== '' || url.password !== '') return 'Must not contain a user name or password.';
  if (new TextEncoder().encode(url.href).length > MAX_IMAGE_URL_LENGTH) return tooLong;
  return null;
}

/**
 * Asset name for an uploaded icon or banner, unique per upload so it never replaces another
 * asset, or null when the file type isn't offered for upload.
 */
export function uploadFileName(eggUuid: string, kind: 'icon' | 'banner', fileName: string, now: number): string | null {
  const extension = fileName.split('.').pop()?.toLowerCase() ?? '';
  if (!fileName.includes('.') || !(UPLOAD_EXTENSIONS as readonly string[]).includes(extension)) return null;
  return `${eggUuid}-${kind}-${now.toString(36)}.${extension}`;
}

/**
 * Eggs the admin can give an icon or banner: every rule's target eggs in rule order, then eggs
 * that still have pictures but are no longer a target, so those can be cleared.
 */
export function appearanceEggs(
  rules: Pick<EggRule, 'allowed_eggs'>[],
  appearance: Record<string, EggAppearance>,
): string[] {
  const eggs = new Set<string>();
  for (const rule of rules) {
    for (const egg of rule.allowed_eggs) eggs.add(egg);
  }
  for (const [egg, pictures] of Object.entries(appearance)) {
    if (pictures.icon || pictures.banner) eggs.add(egg);
  }
  return [...eggs];
}
