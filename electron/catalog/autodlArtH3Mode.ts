// AutoDL.art MiniMax H3 模式 → workflow_id。headless/MCP 没有 UI 模式开关，
// 按已填槽位派生；调用方显式 workflow_id 优先。

export const AUTODL_ART_H3_WORKFLOWS = {
  t2va: "minimax_h3_lightx2v_no_pic",
  fl2va: "minimax_h3_lightx2v",
  ref2va: "minimax_h3_lightx2v_v5_15s",
  ref2va_audio: "minimax_h3_image_audio_to_video_v2_15s",
} as const;

function trimUrl(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function urlList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(trimUrl).filter(Boolean);
}

export function resolveAutodlArtH3WorkflowId(params: Record<string, unknown>): string {
  const first = trimUrl(params.first_frame) || trimUrl(params.firstFrameUrl);
  const last = trimUrl(params.last_frame) || trimUrl(params.lastFrameUrl);
  const images = urlList(params.reference_image_urls);
  const audios = urlList(params.reference_audio_urls);
  if (first && last) return AUTODL_ART_H3_WORKFLOWS.fl2va;
  if (audios.length) return AUTODL_ART_H3_WORKFLOWS.ref2va_audio;
  if (images.length) return AUTODL_ART_H3_WORKFLOWS.ref2va;
  return AUTODL_ART_H3_WORKFLOWS.t2va;
}

/** AutoDL.art 没有独立 I2VA。image_to_video / fl2va 缺尾帧（且没有参考图走 ref2va）→ 拒发。 */
export const AUTODL_ART_H3_I2VA_REFUSE =
  "AutoDL 没有只给首帧的 I2VA，请补尾帧或改文生/ref2va。";

export function autodlArtH3RejectReason(params: Record<string, unknown>, kind: string): string | null {
  if (kind !== "image_to_video") return null;
  const first = trimUrl(params.first_frame) || trimUrl(params.firstFrameUrl);
  const last = trimUrl(params.last_frame) || trimUrl(params.lastFrameUrl);
  const images = [...urlList(params.reference_image_urls), ...urlList(params.referenceImages)];
  const audios = urlList(params.reference_audio_urls);
  if (first && last) return null;
  if (images.length || audios.length) return null;
  return AUTODL_ART_H3_I2VA_REFUSE;
}

export function prepareAutodlArtH3Params(params: Record<string, unknown>): Record<string, unknown> {
  const next: Record<string, unknown> = { ...params };
  const first = trimUrl(next.first_frame) || trimUrl(next.firstFrameUrl);
  const last = trimUrl(next.last_frame) || trimUrl(next.lastFrameUrl);
  if (first) {
    next.first_frame = first;
    next.firstFrameUrl = first;
  }
  if (last) {
    next.last_frame = last;
    next.lastFrameUrl = last;
  }
  if (!trimUrl(next.workflow_id)) next.workflow_id = resolveAutodlArtH3WorkflowId(next);
  if (!next.anonymousAssetHostingConsent) next.anonymousAssetHostingConsent = "allow";
  if (!trimUrl(next.image)) {
    const images = urlList(next.reference_image_urls);
    if (first) next.image = first;
    else if (images[0]) next.image = images[0];
  }
  return next;
}
