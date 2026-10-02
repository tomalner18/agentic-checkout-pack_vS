// A provider-agnostic seam for language models. Bring any provider (or several):
// implement `Model` once per provider and choose which one does which job. That
// choice, and why, is one of the questions in BRIEF.md.
//
// Keep keys out of the repo: read them from the environment (a gitignored .env is fine).

export interface Message {
  role: "system" | "user" | "assistant";
  content: string;
  /** PNG screenshots, if the model can see. */
  images?: Buffer[];
}

export interface CompletionRequest {
  messages: Message[];
  /** Ask for JSON matching this schema, if the provider supports it. */
  jsonSchema?: Record<string, unknown>;
  maxTokens?: number;
}

export interface Completion {
  text: string;
  inputTokens?: number;
  outputTokens?: number;
  latencyMs?: number;
}

export interface Model {
  /** For your run log, e.g. "provider/model-name". */
  readonly id: string;
  complete(req: CompletionRequest): Promise<Completion>;
}

/** Placeholder until you plug a provider in. */
export const notConfigured: Model = {
  id: "not-configured",
  async complete() {
    throw new Error("no model configured: implement Model in starter/model.ts for the provider(s) you choose");
  },
};
