import './config.ts';

export interface Message { role: 'system' | 'user' | 'assistant'; content: string }
export interface CompletionRequest {
  messages: Message[];
  jsonSchema: Record<string, unknown>;
  maxTokens?: number;
}
export interface Completion {
  text: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  stopReason: string;
  latencyMs: number;
}
export interface Model {
  readonly id: string;
  complete(req: CompletionRequest): Promise<Completion>;
}

/** No SDK/tool has browser access: this returns a typed proposal for the coordinator. */
export class ClaudeModel implements Model {
  readonly id: string;
  constructor(private readonly model: string, private readonly apiKey = process.env.ANTHROPIC_API_KEY) {
    this.id = `anthropic/${model}`;
  }
  async complete(req: CompletionRequest): Promise<Completion> {
    if (!this.apiKey || this.apiKey.includes('your_')) throw new Error('MODEL_KEY_MISSING');
    const start = Date.now();
    let response: Response;
    try {
      response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': this.apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model: this.model,
          max_tokens: req.maxTokens ?? 3500,
          system: req.messages.filter(m => m.role === 'system').map(m => m.content).join('\n'),
          messages: req.messages.filter(m => m.role !== 'system'),
          output_config: { format: { type: 'json_schema', schema: req.jsonSchema } },
        }),
        signal: AbortSignal.timeout(90_000),
      });
    } catch { throw new Error('MODEL_CONNECTION_FAILED'); }
    // Provider bodies can echo inputs. Do not propagate them into chat or logs.
    if (!response.ok) throw new Error(`MODEL_HTTP_${response.status}`);
    const data = await response.json() as {
      stop_reason: string; content: { type: string; text?: string }[];
      usage: { input_tokens: number; output_tokens: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number };
    };
    const text = data.content.filter(b => b.type === 'text').map(b => b.text || '').join('');
    return { text, inputTokens: data.usage.input_tokens, outputTokens: data.usage.output_tokens,
      cacheCreationInputTokens: data.usage.cache_creation_input_tokens || 0, cacheReadInputTokens: data.usage.cache_read_input_tokens || 0,
      stopReason: data.stop_reason, latencyMs: Date.now() - start };
  }
}

/** Minimal independent validator for the JSON-schema subset used by our proposals. */
export function validates(value: unknown, schema: Record<string, any>): boolean {
  if (schema.anyOf) return schema.anyOf.some((s: Record<string, any>) => validates(value, s));
  if (schema.enum && !schema.enum.includes(value)) return false;
  if (schema.type === 'null') return value === null;
  if (schema.type === 'string') return typeof value === 'string';
  if (schema.type === 'boolean') return typeof value === 'boolean';
  if (schema.type === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (schema.type === 'integer') return typeof value === 'number' && Number.isSafeInteger(value);
  if (schema.type === 'array') return Array.isArray(value) && value.every(v => validates(v, schema.items));
  if (schema.type === 'object') {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
    const o = value as Record<string, unknown>;
    return schema.required.every((key: string) => key in o) &&
      Object.entries(o).every(([key, val]) => key in schema.properties && validates(val, schema.properties[key]));
  }
  return false;
}
