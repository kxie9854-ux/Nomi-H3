import { describe, expect, it } from "vitest";
import { forkGenerateRefusal } from "./forkGenerateContract";

describe("forkGenerateRefusal", () => {
  it("allows the contract video and image backends", () => {
    expect(forkGenerateRefusal("video", "autodl-art", "autodl-art-h3")).toBeNull();
    expect(forkGenerateRefusal("image", "codex-local", "codex-imagegen")).toBeNull();
  });

  it("does not lock text or audio", () => {
    expect(forkGenerateRefusal("text", "apimart", "anything")).toBeNull();
    expect(forkGenerateRefusal("audio", "volcengine-speech", "tts")).toBeNull();
  });

  it("refuses other video and image backends before spend", () => {
    expect(forkGenerateRefusal("video", "kie", "minimax-h3")).toMatch(/autodl-art-h3/);
    expect(forkGenerateRefusal("image", "dreamina", "seedream")).toMatch(/codex-imagegen/);
    expect(forkGenerateRefusal("video", "autodl-art", "other")).toMatch(/autodl-art-h3/);
  });
});
