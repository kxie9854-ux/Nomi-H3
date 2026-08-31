/** This fork's paid generate backends. Text/audio stay catalog-generic. */

export const FORK_VIDEO_VENDOR = "autodl-art";
export const FORK_VIDEO_MODEL = "autodl-art-h3";
export const FORK_IMAGE_VENDOR = "codex-local";
export const FORK_IMAGE_MODEL = "codex-imagegen";

export function forkGenerateRefusal(intent: unknown, vendor: unknown, modelKey: unknown): string | null {
  const kind = String(intent || "").trim();
  const vendorKey = String(vendor || "").trim();
  const model = String(modelKey || "").trim();
  if (kind === "video") {
    if (vendorKey === FORK_VIDEO_VENDOR && model === FORK_VIDEO_MODEL) return null;
    return "本 fork 视频只许 AutoDL.art MiniMax H3（vendor=autodl-art / modelKey=autodl-art-h3）。";
  }
  if (kind === "image") {
    if (vendorKey === FORK_IMAGE_VENDOR && model === FORK_IMAGE_MODEL) return null;
    return "本 fork 静帧只许 Codex imagegen（vendor=codex-local / modelKey=codex-imagegen）。";
  }
  return null;
}
