import { describe, expect, it } from "vitest";
import { buildHttpRequest, buildTemplateContext } from "../ai/requestPipeline";
import { applyBuiltinSeeds } from "./seedBuiltins";
import {
  AUTODL_ART_H3_I2V_CREATE_OP,
  AUTODL_ART_H3_QUERY_OP,
  AUTODL_ART_H3_T2V_CREATE_OP,
  AUTODL_ART_VENDOR_SEED,
} from "./autodlArtH3";
import type { CatalogState } from "./types";

function emptyCatalog(): CatalogState {
  return { version: 3, vendors: [], models: [], mappings: [], apiKeysByVendor: {} };
}

function createBody(params: Record<string, unknown>, prompt = "a cat walks") {
  const ctx = buildTemplateContext({
    request: { prompt },
    params,
    model: { modelKey: "autodl-art-h3" },
    modelKey: "autodl-art-h3",
    apiKey: "SECRET",
  });
  return buildHttpRequest({
    baseUrl: AUTODL_ART_VENDOR_SEED.baseUrl,
    authType: AUTODL_ART_VENDOR_SEED.authType,
    apiKey: "SECRET",
    context: ctx,
    operation: params.first_frame || params.reference_image_urls ? AUTODL_ART_H3_I2V_CREATE_OP : AUTODL_ART_H3_T2V_CREATE_OP,
  });
}

describe("AutoDL.art H3 seeds", () => {
  it("空目录种入 vendor + 模型 + 两条 mapping", () => {
    const { state, changed } = applyBuiltinSeeds(emptyCatalog(), "2026-08-22T00:00:00.000Z");
    expect(changed).toBe(true);
    expect(state.vendors.find((v) => v.key === "autodl-art")).toMatchObject({
      name: "AutoDL.art",
      baseUrlHint: "https://www.autodl.art",
      authType: "bearer",
    });
    expect(state.models.find((m) => m.modelKey === "autodl-art-h3")).toMatchObject({
      vendorKey: "autodl-art",
      kind: "video",
      meta: { archetypeId: "minimax-h3-autodl-art" },
    });
    expect(state.mappings.filter((m) => m.vendorKey === "autodl-art")).toHaveLength(2);
  });
});

describe("AutoDL.art H3 传输形状", () => {
  it("文生视频打 no_pic 工作流，body 只有 prompt/duration/resolution", () => {
    const built = createBody({
      workflow_id: "minimax_h3_lightx2v_no_pic",
      duration: 5,
      resolution: "768p竖",
    });
    expect(built.url).toBe("https://www.autodl.art/api/v1/comfyui/comfyui_workflow/minimax_h3_lightx2v_no_pic");
    expect(built.body).toEqual({ prompt: "a cat walks", duration: 5, resolution: "768p竖" });
  });

  it("首尾帧打 lightx2v，丢弃空的参考图键", () => {
    const built = createBody({
      workflow_id: "minimax_h3_lightx2v",
      duration: 6,
      resolution: "480p横",
      first_frame: "https://example.com/a.png",
      last_frame: "https://example.com/b.png",
    });
    expect(built.url).toBe("https://www.autodl.art/api/v1/comfyui/comfyui_workflow/minimax_h3_lightx2v");
    expect(built.body).toEqual({
      prompt: "a cat walks",
      duration: 6,
      resolution: "480p横",
      first_frame: "https://example.com/a.png",
      last_frame: "https://example.com/b.png",
    });
  });

  it("多图参考展开 ref_image_N，空槽丢弃", () => {
    const built = createBody({
      workflow_id: "minimax_h3_image_audio_to_video_v2_15s",
      duration: 8,
      resolution: "768p竖",
      reference_image_urls: ["https://example.com/1.png", "https://example.com/2.png"],
    });
    expect(built.url).toContain("minimax_h3_image_audio_to_video_v2_15s");
    expect(built.body).toEqual({
      prompt: "a cat walks",
      duration: 8,
      resolution: "768p竖",
      ref_image_0: "https://example.com/1.png",
      ref_image_1: "https://example.com/2.png",
    });
  });

  it("轮询路径带 task_id，成品读 results.0.url", () => {
    const ctx = buildTemplateContext({
      request: { prompt: "x" },
      params: {},
      model: { modelKey: "autodl-art-h3" },
      modelKey: "autodl-art-h3",
      apiKey: "SECRET",
      providerMeta: { task_id: "task-1" },
    });
    const built = buildHttpRequest({
      baseUrl: AUTODL_ART_VENDOR_SEED.baseUrl,
      authType: AUTODL_ART_VENDOR_SEED.authType,
      apiKey: "SECRET",
      context: ctx,
      operation: AUTODL_ART_H3_QUERY_OP,
    });
    expect(built.url).toBe("https://www.autodl.art/api/v1/comfyui/comfyui_workflow/result/task-1");
  });
});
