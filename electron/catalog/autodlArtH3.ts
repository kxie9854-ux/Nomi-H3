// AutoDL.art MiniMax H3 ComfyUI API。契约对账自 catalog/autodl-art-h3.json（2026-08-22）。
//
// 创建  POST /api/v1/comfyui/comfyui_workflow/{workflow_id}
//       → { code:"Success", data:{ task_id, status:"QUEUED" } }
// 轮询  GET  /api/v1/comfyui/comfyui_workflow/result/{task_id}
//       → data.status: QUEUED|RUNNING|SUCCESS|FAILED（示例里也出现 completed）
//       → data.results[0].url 为成品，URL 会过期，runtime 下载后落本地
//
// baseUrl 裸主机、path 带 /api/v1，避开 joinUrl 双前缀。
// 每模式 workflow_id 由档案 fixedParams 注入；一条 i2v mapping 覆盖首尾帧 / 多图参考，空键丢弃。

import type { HttpOperation } from "./types";
import { ANON_UPLOAD_CHAIN } from "./assetLocalization";

export const AUTODL_ART_VENDOR_SEED = {
  key: "autodl-art",
  name: "AutoDL.art",
  baseUrl: "https://www.autodl.art",
  authType: "bearer" as const,
  authHeader: "Authorization",
  assetIngestion: ANON_UPLOAD_CHAIN,
} as const;

export const AUTODL_ART_H3_MODEL_SEED = {
  modelKey: "autodl-art-h3",
  labelZh: "MiniMax H3（AutoDL.art）",
  kind: "video" as const,
} as const;

export const AUTODL_ART_STATUS_MAPPING: Record<string, string[]> = {
  queued: ["QUEUED", "queued", "submitted", "pending"],
  running: ["RUNNING", "running", "processing"],
  succeeded: ["SUCCESS", "completed", "succeeded", "success"],
  failed: ["FAILED", "failed", "error", "cancelled", "canceled"],
};

const AUTH_HEADERS = {
  Authorization: "Bearer {{user_api_key}}",
  "Content-Type": "application/json",
};

const CREATE_PATH = "/api/v1/comfyui/comfyui_workflow/{{request.params.workflow_id}}";

const CREATE_ID_PATH = "data.task_id";

export const AUTODL_ART_H3_QUERY_OP: HttpOperation = {
  method: "GET",
  path: "/api/v1/comfyui/comfyui_workflow/result/{{providerMeta.task_id}}",
  headers: { Authorization: "Bearer {{user_api_key}}" },
  response_mapping: {
    task_id: "data.task_id",
    status: "data.status",
    video_url: "data.results.0.url",
    error_message: "data.message",
  },
};

export const AUTODL_ART_H3_T2V_CREATE_OP: HttpOperation = {
  method: "POST",
  path: CREATE_PATH,
  headers: AUTH_HEADERS,
  body: {
    prompt: "{{request.prompt}}",
    duration: "{{request.params.duration}}",
    resolution: "{{request.params.resolution}}",
  },
  response_mapping: { task_id: CREATE_ID_PATH },
  provider_meta_mapping: { task_id: CREATE_ID_PATH },
  defaultParams: {
    workflow_id: "minimax_h3_lightx2v_no_pic",
    duration: 5,
    resolution: "768p竖",
  },
};

export const AUTODL_ART_H3_I2V_CREATE_OP: HttpOperation = {
  method: "POST",
  path: CREATE_PATH,
  headers: AUTH_HEADERS,
  body: {
    prompt: "{{request.prompt}}",
    duration: "{{request.params.duration}}",
    resolution: "{{request.params.resolution}}",
    first_frame: "{{request.params.first_frame}}",
    last_frame: "{{request.params.last_frame}}",
    ref_image_0: "{{request.params.reference_image_urls.0}}",
    ref_image_1: "{{request.params.reference_image_urls.1}}",
    ref_image_2: "{{request.params.reference_image_urls.2}}",
    ref_image_3: "{{request.params.reference_image_urls.3}}",
    ref_image_4: "{{request.params.reference_image_urls.4}}",
    ref_image_5: "{{request.params.reference_image_urls.5}}",
    ref_image_6: "{{request.params.reference_image_urls.6}}",
    ref_image_7: "{{request.params.reference_image_urls.7}}",
    ref_image_8: "{{request.params.reference_image_urls.8}}",
    ref_audio_0: "{{request.params.reference_audio_urls.0}}",
    ref_audio_1: "{{request.params.reference_audio_urls.1}}",
    ref_audio_2: "{{request.params.reference_audio_urls.2}}",
  },
  response_mapping: { task_id: CREATE_ID_PATH },
  provider_meta_mapping: { task_id: CREATE_ID_PATH },
  defaultParams: {
    workflow_id: "minimax_h3_lightx2v",
    duration: 5,
    resolution: "768p竖",
  },
};

export const AUTODL_ART_H3_T2V_MAPPING = {
  id: "seed-autodl-art-h3-text_to_video",
  vendorKey: AUTODL_ART_VENDOR_SEED.key,
  taskKind: "text_to_video" as const,
  modelKey: AUTODL_ART_H3_MODEL_SEED.modelKey,
  name: "MiniMax H3 · AutoDL.art 文生视频",
  create: AUTODL_ART_H3_T2V_CREATE_OP,
  query: AUTODL_ART_H3_QUERY_OP,
  statusMapping: AUTODL_ART_STATUS_MAPPING,
};

export const AUTODL_ART_H3_I2V_MAPPING = {
  id: "seed-autodl-art-h3-image_to_video",
  vendorKey: AUTODL_ART_VENDOR_SEED.key,
  taskKind: "image_to_video" as const,
  modelKey: AUTODL_ART_H3_MODEL_SEED.modelKey,
  name: "MiniMax H3 · AutoDL.art 首尾帧/多图",
  create: AUTODL_ART_H3_I2V_CREATE_OP,
  query: AUTODL_ART_H3_QUERY_OP,
  statusMapping: AUTODL_ART_STATUS_MAPPING,
};
