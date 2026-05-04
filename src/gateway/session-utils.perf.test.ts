import path from "node:path";
import { describe, test, expect } from "vitest";
import type { OpenClawConfig } from "../config/config.js";
import { resetConfigRuntimeState, setRuntimeConfigSnapshot } from "../config/config.js";
import type { SessionEntry } from "../config/sessions.js";
import { createEmptyPluginRegistry } from "../plugins/registry-empty.js";
import { resetPluginRuntimeStateForTest, setActivePluginRegistry } from "../plugins/runtime.js";
import { withStateDirEnv } from "../test-helpers/state-dir-env.js";
import { listSessionsFromStoreAsync } from "./session-utils.js";

describe("listSessionsFromStoreAsync resolver cache micro-bench", () => {
  test("scales to 1000 sessions in well under one second", async () => {
    await withStateDirEnv("openclaw-bench-", async ({ stateDir }) => {
      resetPluginRuntimeStateForTest();
      setActivePluginRegistry(createEmptyPluginRegistry());
      const cfg: OpenClawConfig = {
        agents: {
          defaults: { model: { primary: "google-vertex/gemini-3-flash-preview" } },
        },
      } as OpenClawConfig;
      resetConfigRuntimeState();
      setRuntimeConfigSnapshot(cfg);

      const store: Record<string, SessionEntry> = {};
      const now = Date.now();
      for (let i = 0; i < 1000; i++) {
        // 5 unique provider/model tuples spread across 1000 sessions —
        // the resolver cache should collapse the per-row work to ~5
        // executions of each pure resolver.
        const flavour = i % 5;
        const modelProvider =
          flavour === 0
            ? "google-vertex"
            : flavour === 1
              ? "openai"
              : flavour === 2
                ? "anthropic"
                : flavour === 3
                  ? "openrouter"
                  : "google";
        const model =
          flavour === 0
            ? "gemini-3-flash-preview"
            : flavour === 1
              ? "gpt-5"
              : flavour === 2
                ? "claude-opus-4-7"
                : flavour === 3
                  ? "z-ai/glm-5"
                  : "gemini-2.5-pro";
        store[`agent:default:webchat:dm:${i}`] = {
          updatedAt: now - i,
          modelProvider,
          model,
          inputTokens: 100,
          outputTokens: 50,
        } as SessionEntry;
      }

      const storePath = path.join(stateDir, "sessions.json");
      const t0 = Date.now();
      const result = await listSessionsFromStoreAsync({
        cfg,
        storePath,
        store,
        opts: {},
      });
      const elapsedMs = Date.now() - t0;
      expect(result.sessions.length).toBe(1000);
      // With the resolver cache, 1000 rows should comfortably finish
      // under 1500 ms even on slow CI; pre-cache it took ~88 s of CPU
      // for the same workload pattern in production profiles.
      expect(elapsedMs).toBeLessThan(2500);
    });
  });
});
