import { describe, expect, it } from "vitest";
import { codexAppServerEnv } from "./codexEnv";

describe("codexAppServerEnv", () => {
  it("allowlists OS/login keys and extraEnv, and drops secrets", () => {
    const env = codexAppServerEnv(
      { NOMI_PROJECTS_DIR: "/projects", NOMI_SETTINGS_DIR: "/settings" },
      {
        PATH: "/bin",
        HOME: "/Users/kaijun",
        NOMI_ONBOARDING_AGENT_KEY: "secret-key",
        AUTODL_ART_TOKEN: "token",
        ELECTRON_RUN_AS_NODE: "1",
      },
    );
    expect(env).toEqual({
      PATH: "/bin",
      HOME: "/Users/kaijun",
      NOMI_PROJECTS_DIR: "/projects",
      NOMI_SETTINGS_DIR: "/settings",
    });
  });
});
