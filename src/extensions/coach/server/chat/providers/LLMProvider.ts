import {CoachChatMode, CoachLLMContext} from '../../../common/CoachChat';

// The one thing the coach needs from a language model: a structured answer to a question about a
// context. Kept small on purpose, so another provider (or a local model) can replace the first one.

export type ProviderRequest = {
  mode: CoachChatMode,
  /** UI language code of the player (`jp`, `en`, …). */
  language: string,
  question: string,
  context: CoachLLMContext,
  /** Earlier turns of the same chat, newest last (short). */
  recentConversation: ReadonlyArray<{role: 'user' | 'assistant', text: string}>,
  abortSignal?: AbortSignal,
};

export type ProviderUsage = {inputTokens?: number, cachedInputTokens?: number, outputTokens?: number, reasoningTokens?: number};

export type ProviderResult =
  {ok: true, structuredReply: unknown, usage: ProviderUsage, elapsedMs: number, model: string} |
  {ok: false, category: 'timeout' | 'aborted' | 'provider' | 'rate-limit' | 'refusal' | 'incomplete' | 'parse' | 'config', detail: string, usage?: ProviderUsage, elapsedMs: number, model: string};

export interface CoachLLMProvider {
  readonly id: string;
  readonly model: string;
  generate(request: ProviderRequest): Promise<ProviderResult>;
}
