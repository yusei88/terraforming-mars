import {CoachLLMProvider} from '../chat/providers/LLMProvider';
import {OpenAIProvider} from '../chat/providers/openai';
import {sarashinaProvider} from '../chat/providers/chatCompletions';

// Server settings of the external model (docs/coach/phase3/choice-driven-design.md §6). Off unless both
// COACH_AI_ENABLED and COACH_AI_EXTERNAL_ALLOWED are "true" and the provider's key is set; the player's
// consent is checked per request on top of that. Keys stay in the environment of this process.

type Environment = Readonly<Record<string, string | undefined>>;

export type AiSettings = {
  enabled: boolean,
  provider: 'openai' | 'sarashina',
  model: string,
  timeoutMs: number,
  maxOutputTokens: number,
  reasoningEffort?: string,
  /** Model calls allowed in this process (all players together). */
  maxCalls: number,
  /** Counsel requests per player and minute. */
  perMinute: number,
};

function numberFrom(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return value !== undefined && Number.isFinite(n) && n > 0 ? n : fallback;
}

export function aiSettings(env: Environment = process.env): AiSettings {
  const provider = env.COACH_AI_PROVIDER === 'sarashina' ? 'sarashina' : 'openai';
  const key = provider === 'sarashina' ? env.SARASHINA_API_KEY : env.OPENAI_API_KEY;
  return {
    enabled: env.COACH_AI_ENABLED === 'true' && env.COACH_AI_EXTERNAL_ALLOWED === 'true' && (key ?? '') !== '',
    provider,
    model: env.COACH_AI_MODEL ?? (provider === 'sarashina' ? 'sarashina3-mini' : 'gpt-6.1-sol'),
    timeoutMs: numberFrom(env.COACH_AI_TIMEOUT_MS, 30000),
    maxOutputTokens: numberFrom(env.COACH_AI_MAX_OUTPUT_TOKENS, 2000),
    reasoningEffort: provider === 'openai' ? (env.COACH_AI_REASONING_EFFORT ?? 'low') : undefined,
    maxCalls: numberFrom(env.COACH_AI_MAX_CALLS, 200),
    perMinute: numberFrom(env.COACH_COUNSEL_PER_MINUTE, 10),
  };
}

let providerForTesting: CoachLLMProvider | undefined;
let cached: {key: string, provider: CoachLLMProvider} | undefined;

/** The provider to use, or undefined when the server does not allow an external model. */
export function aiProvider(settings: AiSettings = aiSettings(), env: Environment = process.env): CoachLLMProvider | undefined {
  if (providerForTesting !== undefined) {
    return providerForTesting;
  }
  if (!settings.enabled) {
    return undefined;
  }
  const cacheKey = `${settings.provider}|${settings.model}|${settings.timeoutMs}|${settings.maxOutputTokens}|${settings.reasoningEffort}`;
  if (cached?.key !== cacheKey) {
    const provider = settings.provider === 'sarashina' ?
      sarashinaProvider(env.SARASHINA_API_KEY ?? '', settings.model, {maxOutputTokens: settings.maxOutputTokens, timeoutMs: settings.timeoutMs}) :
      new OpenAIProvider({apiKey: env.OPENAI_API_KEY ?? '', model: settings.model, reasoningEffort: settings.reasoningEffort, maxOutputTokens: settings.maxOutputTokens, timeoutMs: settings.timeoutMs});
    cached = {key: cacheKey, provider};
  }
  return cached.provider;
}

export function setAiProviderForTesting(provider: CoachLLMProvider | undefined): void {
  providerForTesting = provider;
}
