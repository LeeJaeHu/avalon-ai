// Explicitly bounded smoke check; no retries and no automatic game.
import { existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildHumanlikeTurn, PROMPT_VERSION } from '../site/lib/prompts/humanlike-v3.mjs';
import { humanlikeCases } from '../site/tests/humanlike-v3-cases.mjs';
import { apply } from '../site/lib/game.mjs';
import { normalizeEvidence } from '../site/lib/evidence.mjs';
import { AI_MODEL } from '../site/lib/ai.mjs';

if (process.env.AVALON_LIVE_CHECK_LIMIT !== '2') throw new Error('사용자 승인 후 AVALON_LIVE_CHECK_LIMIT=2를 지정해야 합니다.');
const config = new URL('./.env.local', import.meta.url);
if (existsSync(config)) process.loadEnvFile(fileURLToPath(config));
if (!process.env.VERTEX_PROXY_URL || !process.env.VERTEX_PROXY_TOKEN) throw new Error('로컬 Vertex 설정이 필요합니다.');
const cases = humanlikeCases().filter(c => ['past-vote-question', 'evil-card-with-partner'].includes(c.id));
const results = [];
for (const scenario of cases) {
  const turn = buildHumanlikeTurn(scenario.game, scenario.request), started = Date.now();
  try {
    const response = await fetch(process.env.VERTEX_PROXY_URL, { method: 'POST',
      headers: { 'content-type': 'application/json', 'x-avalon-proxy-token': process.env.VERTEX_PROXY_TOKEN },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: turn.prompt }] }], generationConfig: {
        temperature: 0.7, maxOutputTokens: 768, responseMimeType: 'application/json', responseSchema: turn.schema } }),
      signal: AbortSignal.timeout(30000) });
    if (!response.ok) { results.push({ case: scenario.id, status: response.status, passed: false, latencyMs: Date.now() - started }); continue; }
    const data = await response.json();
    const raw = JSON.parse(data.candidates[0].content.parts.map(p => p.text ?? '').join(''));
    const action = Object.fromEntries(['type','text','speechAct','team','choice','target'].filter(k => Object.hasOwn(raw,k)).map(k => [k,raw[k]]));
    if (action.type !== scenario.request.type) throw new Error('WRONG_TYPE');
    apply(scenario.game, scenario.request.actor, action);
    const evidence = normalizeEvidence(raw.evidence, turn.input.request.evidenceReferenceIds);
    results.push({ case: scenario.id, passed: true, type: action.type, evidenceStatus: evidence.status,
      latencyMs: Date.now() - started, usage: data.usageMetadata ?? null,
      ...(action.type === 'CHAT' ? { publicText: action.text } : { choice: action.choice }) });
  } catch { results.push({ case: scenario.id, passed: false, error: 'GENERATION_OR_VALIDATION_FAILED', latencyMs: Date.now() - started }); }
}
const summary = { model: AI_MODEL, promptVersion: PROMPT_VERSION, at: new Date().toISOString(), calls: results.length, results };
mkdirSync(new URL('../.local-prototype/', import.meta.url), { recursive: true });
writeFileSync(new URL('../.local-prototype/live-check.json', import.meta.url), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
if (results.some(r => !r.passed)) process.exitCode = 1;
