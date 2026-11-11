import type { LanguageModel } from "ai";

export interface Models {
  /** architect, engineer, producer: quality matters most */
  strong: LanguageModel;
  /** writers, reviewer, cast: many calls, cheaper and faster */
  fast: LanguageModel;
}

const DEFAULTS: Record<string, { strong: string; fast: string }> = {
  anthropic: { strong: "claude-sonnet-5-5", fast: "claude-haiku-5-5" },
  openai: { strong: "gpt-5", fast: "gpt-5-mini" },
  google: { strong: "gemini-2.5-pro", fast: "gemini-2.5-flash" },
};

/** Build models from env: LLM_PROVIDER, LLM_MODEL_STRONG, LLM_MODEL_FAST + the provider's API key. */
export async function modelsFromEnv(env: NodeJS.ProcessEnv = process.env): Promise<Models> {
  const provider = (env.LLM_PROVIDER ?? "anthropic").toLowerCase();
  if (provider === "fake") {
    // local smoke tests only: deterministic mock team that rebuilds the sample story
    const { createFakeModels } = await import("@/test/fakeModels");
    return createFakeModels();
  }
  const d = DEFAULTS[provider];
  if (!d) throw new Error(`Unknown LLM_PROVIDER ${provider}`);
  const strongId = env.LLM_MODEL_STRONG ?? d.strong;
  const fastId = env.LLM_MODEL_FAST ?? d.fast;

  if (provider === "anthropic") {
    const { anthropic } = await import("@ai-sdk/anthropic");
    return { strong: anthropic(strongId), fast: anthropic(fastId) };
  }
  if (provider === "openai") {
    const { openai } = await import("@ai-sdk/openai");
    return { strong: openai(strongId), fast: openai(fastId) };
  }
  const { google } = await import("@ai-sdk/google");
  return { strong: google(strongId), fast: google(fastId) };
}
