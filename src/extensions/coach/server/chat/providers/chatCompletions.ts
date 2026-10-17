import {CoachLLMProvider, ProviderRequest, ProviderResult, ProviderUsage} from './LLMProvider';
import {instructions, REPLY_SCHEMA} from '../instructions';

// Providers with an OpenAI-style Chat Completions API (POST <baseUrl>/chat/completions) and JSON-schema
// structured output, such as SB Intuitions' Sarashina API. Uses fetch, no SDK.
//
// Only documented parameters are sent: some compatible APIs answer 400 to unknown ones (Sarashina
// refuses `max_tokens` and `logprobs`; it takes `max_completion_tokens`). Requests are spaced to stay
// under the provider's requests-per-minute limit; a 429 is reported as `rate-limit` without retrying.
// The API key stays in this process and is never logged or returned.

export type ChatCompletionsOptions = {
  id: string,
  baseUrl: string,
  apiKey: string,
  model: string,
  maxOutputTokens: number,
  timeoutMs: number,
  /** Requests per minute allowed by the provider; requests are spaced by 60 s / rpm. */
  requestsPerMinute?: number,
  temperature?: number,
  fetchImpl?: typeof fetch,
};

type ChatCompletionsOutput = {
  choices?: Array<{finish_reason?: string, message?: {content?: string | null, refusal?: string | null}}>,
  usage?: {prompt_tokens?: number, completion_tokens?: number, prompt_tokens_details?: {cached_tokens?: number}, completion_tokens_details?: {reasoning_tokens?: number}},
};

export class ChatCompletionsProvider implements CoachLLMProvider {
  public readonly id: string;
  public readonly model: string;
  private nextSlot = 0;

  constructor(private readonly options: ChatCompletionsOptions) {
    this.id = options.id;
    this.model = options.model;
  }

  public requestBody(request: ProviderRequest): Record<string, unknown> {
    return {
      model: this.options.model,
      messages: [
        {role: 'system', content: request.task?.instructions ?? instructions(request.mode, request.language)},
        ...request.recentConversation.map((turn) => ({role: turn.role, content: turn.text})),
        {role: 'user', content: JSON.stringify(request.task !== undefined ? request.task.input : {question: request.question, context: request.context})},
      ],
      response_format: {type: 'json_schema', json_schema: {name: request.task?.schemaName ?? 'coach_reply', strict: true, schema: request.task?.schema ?? REPLY_SCHEMA}},
      max_completion_tokens: this.options.maxOutputTokens,
      ...(this.options.temperature === undefined ? {} : {temperature: this.options.temperature}),
    };
  }

  /** Waits for the next free slot of the per-minute limit. */
  private async throttle(): Promise<void> {
    const rpm = this.options.requestsPerMinute;
    if (rpm === undefined || rpm <= 0) {
      return;
    }
    const now = Date.now();
    const slot = Math.max(now, this.nextSlot);
    this.nextSlot = slot + Math.ceil(60000 / rpm);
    if (slot > now) {
      await new Promise((resolve) => setTimeout(resolve, slot - now));
    }
  }

  public async generate(request: ProviderRequest): Promise<ProviderResult> {
    const base = {model: this.model};
    if (this.options.apiKey === '') {
      return {...base, ok: false, category: 'config', detail: 'no API key', elapsedMs: 0};
    }
    await this.throttle();
    const started = performance.now();
    const elapsed = () => Math.round(performance.now() - started);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('timeout')), this.options.timeoutMs);
    const onAbort = () => controller.abort(new Error('aborted'));
    request.abortSignal?.addEventListener('abort', onAbort);
    try {
      const response = await (this.options.fetchImpl ?? fetch)(`${this.options.baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: {'Authorization': `Bearer ${this.options.apiKey}`, 'Content-Type': 'application/json'},
        body: JSON.stringify(this.requestBody(request)),
        signal: controller.signal,
      });
      const body = await response.json().catch(() => ({})) as ChatCompletionsOutput;
      if (response.status === 429) {
        return {...base, ok: false, category: 'rate-limit', detail: 'HTTP 429', elapsedMs: elapsed()};
      }
      if (!response.ok) {
        return {...base, ok: false, category: 'provider', detail: `HTTP ${response.status}`, elapsedMs: elapsed()};
      }
      const usage: ProviderUsage = {
        inputTokens: body.usage?.prompt_tokens,
        cachedInputTokens: body.usage?.prompt_tokens_details?.cached_tokens,
        outputTokens: body.usage?.completion_tokens,
        reasoningTokens: body.usage?.completion_tokens_details?.reasoning_tokens,
      };
      const choice = body.choices?.[0];
      if (choice?.message?.refusal) {
        return {...base, ok: false, category: 'refusal', detail: 'refused', usage, elapsedMs: elapsed()};
      }
      if (choice?.finish_reason === 'length') {
        return {...base, ok: false, category: 'incomplete', detail: 'length', usage, elapsedMs: elapsed()};
      }
      const text = choice?.message?.content;
      if (typeof text !== 'string') {
        return {...base, ok: false, category: 'parse', detail: 'no content', usage, elapsedMs: elapsed()};
      }
      try {
        return {...base, ok: true, structuredReply: JSON.parse(text), usage, elapsedMs: elapsed()};
      } catch {
        return {...base, ok: false, category: 'parse', detail: 'content is not JSON', usage, elapsedMs: elapsed()};
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

/** Sarashina API (SB Intuitions): https://api.sarashina.ai/v1, chat models sarashina3-mini (6 rpm) and sarashina3-nano (60 rpm). */
export function sarashinaProvider(apiKey: string, model: string, options: {maxOutputTokens: number, timeoutMs: number, fetchImpl?: typeof fetch}): ChatCompletionsProvider {
  const rpm: Readonly<Record<string, number>> = {'sarashina3-mini': 6, 'sarashina3-nano': 60};
  return new ChatCompletionsProvider({id: 'sarashina', baseUrl: 'https://api.sarashina.ai/v1', apiKey, model, requestsPerMinute: rpm[model] ?? 6, ...options});
}
