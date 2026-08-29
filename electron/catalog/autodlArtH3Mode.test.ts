import { describe, expect, it } from "vitest";
import {
  AUTODL_ART_H3_I2VA_REFUSE,
  AUTODL_ART_H3_WORKFLOWS,
  autodlArtH3RejectReason,
  prepareAutodlArtH3Params,
  resolveAutodlArtH3WorkflowId,
} from "./autodlArtH3Mode";
import { imageEditGuardError } from "./taskParams";

describe("resolveAutodlArtH3WorkflowId", () => {
  it("无媒体 → 文生", () => {
    expect(resolveAutodlArtH3WorkflowId({})).toBe(AUTODL_ART_H3_WORKFLOWS.t2va);
  });

  it("首尾帧都有 → fl2va，即使同时带了参考图", () => {
    expect(resolveAutodlArtH3WorkflowId({
      first_frame: "https://a/first.jpg",
      last_frame: "https://a/last.jpg",
      reference_image_urls: ["https://a/ref.jpg"],
    })).toBe(AUTODL_ART_H3_WORKFLOWS.fl2va);
  });

  it("多图无音频 → ref2va 15s", () => {
    expect(resolveAutodlArtH3WorkflowId({
      reference_image_urls: ["https://a/1.jpg"],
    })).toBe(AUTODL_ART_H3_WORKFLOWS.ref2va);
  });

  it("有参考音频 → 图+音频工作流", () => {
    expect(resolveAutodlArtH3WorkflowId({
      reference_image_urls: ["https://a/1.jpg"],
      reference_audio_urls: ["https://a/a.wav"],
    })).toBe(AUTODL_ART_H3_WORKFLOWS.ref2va_audio);
  });
});

describe("autodlArtH3RejectReason", () => {
  it("只给首帧 → 拒 I2VA", () => {
    expect(autodlArtH3RejectReason({ first_frame: "https://a/f.jpg" }, "image_to_video"))
      .toBe(AUTODL_ART_H3_I2VA_REFUSE);
  });

  it("首尾帧都缺 → 也拒（不要打 lightx2v 空槽）", () => {
    expect(autodlArtH3RejectReason({}, "image_to_video")).toBe(AUTODL_ART_H3_I2VA_REFUSE);
  });

  it("首尾帧都有 → 放行", () => {
    expect(autodlArtH3RejectReason({
      first_frame: "https://a/f.jpg",
      last_frame: "https://a/l.jpg",
    }, "image_to_video")).toBeNull();
  });

  it("文生不拒", () => {
    expect(autodlArtH3RejectReason({}, "text_to_video")).toBeNull();
  });

  it("imageEditGuardError 缺尾帧拒发、双帧放行", () => {
    const selected = { vendorKey: "autodl-art", modelKey: "autodl-art-h3" };
    expect(imageEditGuardError(
      "image_to_video",
      { extras: { first_frame: "https://a/f.jpg" } },
      true,
      "MiniMax H3（AutoDL.art）",
      undefined,
      undefined,
      selected,
    )).toBe(AUTODL_ART_H3_I2VA_REFUSE);
    expect(imageEditGuardError(
      "image_to_video",
      { extras: { first_frame: "https://a/f.jpg", last_frame: "https://a/l.jpg" } },
      true,
      "MiniMax H3（AutoDL.art）",
      undefined,
      undefined,
      selected,
    )).toBeNull();
  });
});

describe("prepareAutodlArtH3Params", () => {
  it("补 firstFrameUrl、workflow_id、匿名上传同意", () => {
    const out = prepareAutodlArtH3Params({
      first_frame: "nomi-local://a/f.jpg",
      last_frame: "nomi-local://a/l.jpg",
      duration: 5,
    });
    expect(out.firstFrameUrl).toBe("nomi-local://a/f.jpg");
    expect(out.workflow_id).toBe(AUTODL_ART_H3_WORKFLOWS.fl2va);
    expect(out.anonymousAssetHostingConsent).toBe("allow");
    expect(out.image).toBe("nomi-local://a/f.jpg");
  });

  it("调用方 workflow_id 不被覆盖", () => {
    expect(prepareAutodlArtH3Params({
      workflow_id: "minimax_h3_lightx2v_v5_15s",
      reference_image_urls: ["https://a/1.jpg"],
    }).workflow_id).toBe("minimax_h3_lightx2v_v5_15s");
  });
});
