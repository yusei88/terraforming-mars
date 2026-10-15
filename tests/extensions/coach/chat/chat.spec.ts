import {expect} from 'chai';
import * as fs from 'fs';
import * as path from 'path';
import {buildContext, contextCardNames} from '../../../../src/extensions/coach/server/chat/contextBuilder';
import {validateReply} from '../../../../src/extensions/coach/server/chat/replyValidator';
import {OpenAIProvider} from '../../../../src/extensions/coach/server/chat/providers/openai';
import {ChatCompletionsProvider, sarashinaProvider} from '../../../../src/extensions/coach/server/chat/providers/chatCompletions';
import {REPLY_SCHEMA} from '../../../../src/extensions/coach/server/chat/instructions';
import {CoachStateV1} from '../../../../src/extensions/coach/common/CoachState';
import {CoachAnalysisV1} from '../../../../src/extensions/coach/common/CoachAnalysis';
import {CoachLLMContext} from '../../../../src/extensions/coach/common/CoachChat';

type Fixture = {id: string, state: CoachStateV1, analysis: CoachAnalysisV1};
type FetchInit = NonNullable<Parameters<typeof fetch>[1]>;
const FIXTURES = path.join(__dirname, 'fixtures');

function load(id: string): Fixture {
  return JSON.parse(fs.readFileSync(path.join(FIXTURES, `${id}.json`), 'utf8'));
}

function contextOf(id: string): CoachLLMContext {
  const f = load(id);
  return buildContext(f.state, f.analysis).context;
}

describe('coach chat context', () => {
  it('keeps every fixture free of ids and builds a context for each', () => {
    const files = fs.readdirSync(FIXTURES).filter((f) => f.endsWith('.json'));
    expect(files.length).greaterThanOrEqual(20);
    for (const file of files) {
      const f: Fixture = JSON.parse(fs.readFileSync(path.join(FIXTURES, file), 'utf8'));
      const {context, planIds} = buildContext(f.state, f.analysis);
      expect(context.analysis.plans.map((p) => p.id)).deep.eq(f.analysis.candidates.map((_, i) => `P${i + 1}`));
      expect([...planIds.values()]).deep.eq(f.analysis.candidates.map((p) => p.id));
    }
  });

  it('sends no names of people, no plan ids of the server and no hidden cards of others', () => {
    const f = load('2p-g7-action');
    const {context} = buildContext(f.state, f.analysis);
    const json = JSON.stringify(context);
    expect(json).does.not.contain(f.state.me.name);
    for (const opponent of f.state.opponents) {
      expect(json).does.not.contain(`"${opponent.name}"`);
    }
    for (const plan of f.analysis.candidates.filter((p) => p.cards.length > 1)) {
      expect(json).does.not.contain(plan.id);
    }
    expect(Object.keys(context.opponents[0]).sort()).deep.eq(['cardsInHand', 'color', 'played', 'production', 'tags', 'terraformRating']);
    expect(json).does.not.contain('stateKey');
    expect(json).does.not.contain('fingerprint');
  });

  it('lists hand, offered and played cards with the costs the game computed', () => {
    const f = load('solo-a-g8-research');
    const {context} = buildContext(f.state, f.analysis);
    expect(context.me.hand.map((c) => c.name)).deep.eq(f.state.me.hand.map((c) => c.name));
    expect(context.me.offered.length).greaterThan(0);
    expect(context.game.lastGeneration).eq(14);
    expect(context.now.status).eq('awaiting-input');
  });
});

describe('coach reply validator', () => {
  const context = contextOf('solo-a-g9-action');
  const plan = context.analysis.plans[0];
  const card = plan.cards[0].name;
  const reply = (message: string, extra: Partial<{planIds: Array<string>, cards: Array<string>}> = {}) =>
    ({message, planIds: extra.planIds ?? [plan.id], cards: extra.cards ?? [card], followUpQuestions: []});

  it('accepts an answer that only uses the context', () => {
    const cost = plan.cards[0].cost;
    const result = validateReply(reply(`${plan.id} は ${card} から始まります。費用は ${cost} M€ です。どの目的を優先しますか？`), context);
    expect(result.ok, JSON.stringify(result)).is.true;
  });

  it('refuses plans, cards and numbers that are not in the context', () => {
    const result = validateReply(reply('P42 を使えば 12345 M€ 得します。Big Asteroid と Giant Space Mirror も強いです。', {planIds: ['P42'], cards: ['Not A Card']}), context);
    expect(result.ok).is.false;
    const codes = result.ok ? [] : result.problems.map((p) => p.code);
    expect(codes).includes.members(['unknown-plan', 'unknown-card', 'number-not-in-context']);
    if (!contextCardNames(context).has('Giant Space Mirror')) {
      expect(codes).includes('card-not-in-context');
    }
  });

  it('does not read a standard project of the context as another card', () => {
    const withProjects = contextOf('2p-g1-action');
    const projects = withProjects.me.offered.map((c) => c.name).filter((n) => n.endsWith(':SP'));
    expect(projects).includes('Power Plant:SP');
    const result = validateReply({message: 'Power Plant:SP と Asteroid:SP を比べますか？', planIds: [], cards: ['Power Plant:SP'], followUpQuestions: []}, withProjects);
    expect(result.ok, JSON.stringify(result)).is.true;
    expect(validateReply({message: 'Power Plant を出しましょう。', planIds: [], cards: [], followUpQuestions: []}, withProjects).ok).is.false;
  });

  it('refuses win chances and optimal moves', () => {
    for (const message of ['勝率は高いです。', 'This is the optimal move.', '最適解は P1 です。']) {
      const result = validateReply(reply(message), context);
      expect(result.ok, message).is.false;
    }
  });

  it('accepts a sentence that declines to give win chances', () => {
    for (const message of ['勝率や最適手は、この情報からは断定できません。', '勝率の情報はなく、最適手を数字で断定することもできません。', 'I cannot give a win rate or an optimal move.']) {
      expect(validateReply(reply(message, {cards: []}), context).ok, message).is.true;
    }
    expect(validateReply(reply('断定はできませんが参考までに。勝率は高いです。', {cards: []}), context).ok).is.false;
  });

  it('refuses answers of another shape', () => {
    expect(validateReply('text', context).ok).is.false;
    expect(validateReply({message: 'x', planIds: [], cards: []}, context).ok).is.false;
    expect(validateReply({message: 'x', planIds: [], cards: [], followUpQuestions: [], extra: 1}, context).ok).is.false;
    expect(validateReply({message: ' ', planIds: [], cards: [], followUpQuestions: []}, context).ok).is.false;
  });

  it('reads full-width digits as numbers', () => {
    expect(validateReply(reply('９８７６ M€ です。'), context).ok).is.false;
  });
});

describe('OpenAI provider', () => {
  const context = contextOf('solo-a-g5-action');
  const request = {mode: 'question' as const, language: 'jp', question: '今は何を優先するとよい？', context, recentConversation: []};
  const okBody = {status: 'completed', output: [{type: 'message', content: [{type: 'output_text', text: JSON.stringify({message: 'm', planIds: [], cards: [], followUpQuestions: []})}]}],
    usage: {input_tokens: 100, output_tokens: 20, input_tokens_details: {cached_tokens: 10}, output_tokens_details: {reasoning_tokens: 5}}};
  function provider(fetchImpl: typeof fetch, timeoutMs = 1000) {
    return new OpenAIProvider({apiKey: 'sk-test-secret', model: 'm', reasoningEffort: 'low', maxOutputTokens: 500, timeoutMs, fetchImpl});
  }

  it('asks for strict structured output and asks OpenAI not to store the request', async () => {
    let sent: Record<string, unknown> = {};
    let headers: Record<string, string> = {};
    const p = provider((async (_url: unknown, init: FetchInit) => {
      sent = JSON.parse(String(init.body));
      headers = init.headers as Record<string, string>;
      return new Response(JSON.stringify(okBody), {status: 200});
    }) as typeof fetch);
    const result = await p.generate(request);
    expect(result.ok).is.true;
    expect(sent.store).eq(false);
    expect(sent.text).deep.eq({format: {type: 'json_schema', name: 'coach_reply', strict: true, schema: REPLY_SCHEMA}});
    expect(sent.reasoning).deep.eq({effort: 'low'});
    expect(headers.Authorization).eq('Bearer sk-test-secret');
    expect(JSON.stringify(sent)).does.not.contain('sk-test-secret');
    if (result.ok) {
      expect(result.usage).deep.eq({inputTokens: 100, cachedInputTokens: 10, outputTokens: 20, reasoningTokens: 5});
    }
  });

  it('reports errors by category without the key', async () => {
    const cases: Array<[unknown, number, string]> = [
      [{error: {type: 'invalid_request_error', code: 'invalid_api_key'}}, 401, 'provider'],
      [{status: 'incomplete', incomplete_details: {reason: 'max_output_tokens'}}, 200, 'incomplete'],
      [{status: 'completed', output: [{type: 'message', content: [{type: 'refusal', refusal: 'no'}]}]}, 200, 'refusal'],
      [{status: 'completed', output: [{type: 'message', content: [{type: 'output_text', text: '{not json'}]}]}, 200, 'parse'],
    ];
    for (const [body, status, category] of cases) {
      const result = await provider((async () => new Response(JSON.stringify(body), {status})) as typeof fetch).generate(request);
      expect(result.ok).is.false;
      if (!result.ok) {
        expect(result.category).eq(category);
        expect(result.detail).does.not.contain('sk-test');
      }
    }
  });

  it('stops after the timeout and when the caller aborts', async () => {
    const hang = ((_url: unknown, init: FetchInit) => new Promise((_, reject) => {
      init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
    })) as typeof fetch;
    const timedOut = await provider(hang, 20).generate(request);
    expect(timedOut.ok ? 'none' : timedOut.category).eq('timeout');
    const controller = new AbortController();
    const pending = provider(hang, 5000).generate({...request, abortSignal: controller.signal});
    controller.abort();
    const aborted = await pending;
    expect(aborted.ok ? 'none' : aborted.category).eq('aborted');
  });

  it('reports a rate limit as such', async () => {
    const result = await provider((async () => new Response(JSON.stringify({error: {code: 'rate_limit_exceeded'}}), {status: 429})) as typeof fetch).generate(request);
    expect(result.ok ? 'none' : result.category).eq('rate-limit');
  });

  it('does not call out without a key', async () => {
    let called = false;
    const p = new OpenAIProvider({apiKey: '', model: 'm', maxOutputTokens: 1, timeoutMs: 1, fetchImpl: (async () => {
      called = true;
      return new Response('{}');
    }) as typeof fetch});
    const result = await p.generate(request);
    expect(called).is.false;
    expect(result.ok ? 'none' : result.category).eq('config');
  });
});

describe('Chat Completions provider (Sarashina)', () => {
  const context = contextOf('solo-a-g5-action');
  const request = {mode: 'hint' as const, language: 'jp', question: '何を見るとよい？', context, recentConversation: []};
  const reply = {message: 'm', planIds: [], cards: [], followUpQuestions: []};
  const okBody = {choices: [{finish_reason: 'stop', message: {content: JSON.stringify(reply)}}], usage: {prompt_tokens: 50, completion_tokens: 7}};

  it('sends only documented parameters to the chat completions endpoint', async () => {
    let url = '';
    let sent: Record<string, unknown> = {};
    const p = sarashinaProvider('key-secret', 'sarashina3-nano', {maxOutputTokens: 300, timeoutMs: 1000, fetchImpl: (async (u: unknown, init: FetchInit) => {
      url = String(u);
      sent = JSON.parse(String(init.body));
      return new Response(JSON.stringify(okBody), {status: 200});
    }) as typeof fetch});
    const result = await p.generate(request);
    expect(url).eq('https://api.sarashina.ai/v1/chat/completions');
    expect(Object.keys(sent).sort()).deep.eq(['max_completion_tokens', 'messages', 'model', 'response_format']);
    expect(sent.response_format).deep.eq({type: 'json_schema', json_schema: {name: 'coach_reply', strict: true, schema: REPLY_SCHEMA}});
    expect((sent.messages as Array<{role: string}>).map((m) => m.role)).deep.eq(['system', 'user']);
    expect(result.ok && result.structuredReply).deep.eq(reply);
    expect(result.ok && result.usage).deep.eq({inputTokens: 50, cachedInputTokens: undefined, outputTokens: 7, reasoningTokens: undefined});
  });

  it('reports a rate limit, a cut answer and a non-JSON answer', async () => {
    const cases: Array<[unknown, number, string]> = [
      [{message: 'too many'}, 429, 'rate-limit'],
      [{choices: [{finish_reason: 'length', message: {content: '{"mess'}}]}, 200, 'incomplete'],
      [{choices: [{finish_reason: 'stop', message: {content: 'こんにちは'}}]}, 200, 'parse'],
      [{message: 'bad'}, 400, 'provider'],
    ];
    for (const [body, status, category] of cases) {
      const p = new ChatCompletionsProvider({id: 't', baseUrl: 'https://example.test/v1/', apiKey: 'k', model: 'm', maxOutputTokens: 10, timeoutMs: 1000,
        fetchImpl: (async () => new Response(JSON.stringify(body), {status})) as typeof fetch});
      const result = await p.generate(request);
      expect(result.ok ? 'none' : result.category, category).eq(category);
    }
  });

  it('spaces requests to stay under the per-minute limit', async () => {
    const times: Array<number> = [];
    const p = new ChatCompletionsProvider({id: 't', baseUrl: 'https://example.test/v1', apiKey: 'k', model: 'm', maxOutputTokens: 10, timeoutMs: 1000, requestsPerMinute: 1200,
      fetchImpl: (async () => {
        times.push(Date.now());
        return new Response(JSON.stringify(okBody), {status: 200});
      }) as typeof fetch});
    await Promise.all([p.generate(request), p.generate(request), p.generate(request)]);
    // 1200 per minute: 50 ms apart.
    expect(times[2] - times[0]).greaterThanOrEqual(95);
  });
});
