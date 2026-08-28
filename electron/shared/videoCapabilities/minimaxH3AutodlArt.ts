import type { ModelArchetype, ModelParameterControl } from "./types";

// Shared AutoDL.art MiniMax H3 ComfyUI API capability profile. 契约对账自
// POST https://www.autodl.art/api/v1/comfyui/workflows 与各 workflow 的 input_rules（2026-08-22）。
//
// 目录缺口（必须写进产品）：没有独立 I2VA；没有参考视频槽。本档案只有文生 / 首尾帧 / 多图±音频。

const opt = (values: string[]): ModelParameterControl["options"] => values.map((value) => ({ value, label: value }));

const RESOLUTION: ModelParameterControl = {
  key: "resolution",
  label: "清晰度",
  type: "select",
  options: opt(["480p竖", "768p竖", "480p横", "768p横"]),
  defaultValue: "768p竖",
};

const DURATION: ModelParameterControl = {
  key: "duration",
  label: "时长(秒)",
  type: "number",
  options: [],
  min: 5,
  max: 15,
  defaultValue: 5,
};

export const MINIMAX_H3_AUTODL_ART_ARCHETYPE: ModelArchetype = {
  id: "minimax-h3-autodl-art",
  family: "minimax",
  label: "MiniMax H3（AutoDL.art）",
  kind: "video",
  sources: [
    {
      url: "https://autodl.art/docs/comfyui_api/",
      checkedAt: "2026-08-22",
      vendorKey: "autodl-art",
      covers: "ComfyUI API 提交/轮询、Authorization Token、results URL 过期",
    },
    {
      url: "https://www.autodl.art/large-model/comfyui",
      checkedAt: "2026-08-22",
      vendorKey: "autodl-art",
      covers: "H3 工作流 uuid、input_rules 字段名、分辨率中文枚举、时长上下限",
    },
  ],
  defaultModeId: "t2v",
  transportTaskKind: "text_to_video",
  identifierPatterns: ["autodl-art-h3"],
  modes: [
    {
      id: "t2v",
      intent: "text",
      vendorTerm: "文生视频",
      hint: "纯文字生成；AutoDL.art minimax_h3_lightx2v_no_pic",
      promptRequired: true,
      transportTaskKind: "text_to_video",
      slots: [],
      params: [RESOLUTION, DURATION],
      fixedParams: { workflow_id: "minimax_h3_lightx2v_no_pic" },
    },
    {
      id: "firstlast",
      intent: "firstlast",
      vendorTerm: "首尾帧",
      hint: "首帧 + 尾帧都必填；没有单独首帧工作流",
      promptRequired: true,
      transportTaskKind: "image_to_video",
      slots: [
        { kind: "first_frame", label: "首帧", min: 1, max: 1, inputKey: "first_frame", asArray: false },
        { kind: "last_frame", label: "尾帧", min: 1, max: 1, inputKey: "last_frame", asArray: false },
      ],
      params: [RESOLUTION, DURATION],
      fixedParams: { workflow_id: "minimax_h3_lightx2v" },
    },
    {
      id: "ref",
      intent: "character",
      vendorTerm: "多图参考",
      hint: "1–9 张参考图，可选最多 3 段参考音频；没有参考视频槽",
      promptRequired: true,
      transportTaskKind: "image_to_video",
      slots: [
        { kind: "image_ref", label: "参考图", min: 1, max: 9, characterIndexed: true, inputKey: "reference_image_urls" },
        { kind: "audio_ref", label: "参考音频", min: 0, max: 3, inputKey: "reference_audio_urls" },
      ],
      params: [RESOLUTION, DURATION],
      fixedParams: { workflow_id: "minimax_h3_image_audio_to_video_v2_15s" },
    },
  ],
};
