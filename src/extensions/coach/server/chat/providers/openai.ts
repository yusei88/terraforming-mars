import {CoachLLMProvider, ProviderRequest, ProviderResult, ProviderUsage} from './LLMProvider';
import {INSTRUCTIONS_VERSION, instructions, REPLY_SCHEMA} from '../instructions';

// OpenAI Responses API (POST /v1/responses) with structured outputs. Uses fetch, no SDK.
//
// `store: false`: OpenAI does not keep the request for later retrieval. The API key stays in this
// process and is never logged or returned; errors carry the HTTP status and OpenAI's error type only.

export type OpenAIOptions = {
  apiKey: string,
  model: string,
  /** Reasoning effort for reasoning models (`none`, `low`, …); omitted when undefined. */
  reasoningEffort?: string,
  maxOutputTokens: number,
  timeoutMs: number,
  endpoint?: string,
  fetchImpl?: typeof fetch,
};

type ResponsesOutput = {
  status?: string,
  incomplete_details?: {reason?: string},
  output?: Array<{type: string, content?: Array<{type: string, text?: string, refusal?: string}>}>,
  usage?: {input_tokens?: number, output_tokens?: number, input_tokens_details?: {cached_tokens?: number}, output_tokens_details?: {reasoning_tokens?: number}},
  error?: {type?: string, code?: string},
};

function usageOf(body: ResponsesOutput): ProviderUsage {
  return {
    inputTokens: body.usage?.input_tokens,
    cachedInputTokens: body.usage?.input_tokens_details?.cached_tokens,
    outputTokens: body.usage?.output_tokens,
    reasoningTokens: body.usage?.output_tokens_details?.reasoning_tokens,
  };
}

export class OpenAIProvider implements CoachLLMProvider {
  public readonly id = 'openai';
  public readonly model: string;

  constructor(private readonly options: OpenAIOptions) {
    this.model = options.model;
  }

  public requestBody(request: ProviderRequest): Record<string, unknown> {
    return {
      model: this.options.model,
      instructions: instructions(request.mode, request.language),
      input: [
        ...request.recentConversation.map((turn) => ({role: turn.role, content: turn.text})),
        {role: 'user', content: JSON.stringify({question: request.question, context: request.context})},
      ],
      text: {format: {type: 'json_schema', name: 'coach_reply', strict: true, schema: REPLY_SCHEMA}},
      max_output_tokens: this.options.maxOutputTokens,
      ...(this.options.reasoningEffort === undefined ? {} : {reasoning: {effort: this.options.reasoningEffort}}),
      store: false,
      metadata: {instructions: INSTRUCTIONS_VERSION},
    };
  }

  public async generate(request: ProviderRequest): Promise<ProviderResult> {
    const started = performance.now();
    const base = {model: this.model};
    const elapsed = () => Math.round(performance.now() - started);
    if (this.options.apiKey === '') {
      return {...base, ok: false, category: 'config', detail: 'no API key', elapsedMs: 0};
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('timeout')), this.options.timeoutMs);
    const onAbort = () => controller.abort(new Error('aborted'));
    request.abortSignal?.addEventListener('abort', onAbort);
    try {
      const response = await (this.options.fetchImpl ?? fetch)(this.options.endpoint ?? 'https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: {'Authorization': `Bearer ${this.options.apiKey}`, 'Content-Type': 'application/json'},
        body: JSON.stringify(this.requestBody(request)),
        signal: controller.signal,
      });
      const body = await response.json().catch(() => ({})) as ResponsesOutput;
      if (response.status === 429) {
        return {...base, ok: false, category: 'rate-limit', detail: `HTTP 429 ${body.error?.code ?? ''}`.trim(), elapsedMs: elapsed()};
      }
      if (!response.ok) {
        return {...base, ok: false, category: 'provider', detail: `HTTP ${response.status} ${body.error?.type ?? ''} ${body.error?.code ?? ''}`.trim(), elapsedMs: elapsed()};
      }
      const usage = usageOf(body);
      if (body.status === 'incomplete') {
        return {...base, ok: false, category: 'incomplete', detail: body.incomplete_details?.reason ?? 'incomplete', usage, elapsedMs: elapsed()};
      }
      const parts = (body.output ?? []).filter((item) => item.type === 'message').flatMap((item) => item.content ?? []);
      const refusal = parts.find((part) => part.type === 'refusal');
      if (refusal !== undefined) {
        return {...base, ok: false, category: 'refusal', detail: 'refused', usage, elapsedMs: elapsed()};
      }
      const text = parts.find((part) => part.type === 'output_text')?.text;
      if (text === undefined) {
        return {...base, ok: false, category: 'parse', detail: 'no output text', usage, elapsedMs: elapsed()};
      }
      try {
        return {...base, ok: true, structuredReply: JSON.parse(text), usage, elapsedMs: elapsed()};
      } catch {
        return {...base, ok: false, category: 'parse', detail: 'output is not JSON', usage, elapsedMs: elapsed()};
      }
    } catch (error) {
      const reason = controller.signal.reason instanceof Error ? controller.signal.reason.message : '';
      if (reason === 'timeout') {
        return {...base, ok: false, category: 'timeout', detail: `after ${this.options.timeoutMs} ms`, elapsedMs: elapsed()};
      }
      if (reason === 'aborted') {
        return {...base, ok: false, category: 'aborted', detail: 'aborted', elapsedMs: elapsed()};
      }
      return {...base, ok: false, category: 'provider', detail: error instanceof Error ? error.name : 'network error', elapsedMs: elapsed()};
    } finally {
      clearTimeout(timer);
      request.abortSignal?.removeEventListener('abort', onAbort);
    }
  }
}
