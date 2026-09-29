import { env } from 'cloudflare:workers';
import { NextRequest, NextResponse } from 'next/server';
import { createGame, observe, apply } from '../../../lib/game.mjs';
import { decide, nextAiAction } from '../../../lib/ai.mjs';

export const runtime = 'edge';
const cookie = 'avalon_game';

function json(value: unknown, status = 200) {
  return NextResponse.json(value, { status, headers: { 'cache-control': 'no-store' } });
}

function view(game: any) { return { ...observe(game), aiPending: !!nextAiAction(game) }; }

async function readGame(request: NextRequest) {
  const id = request.cookies.get(cookie)?.value;
  if (!id || !/^[0-9a-f-]{36}$/.test(id)) return null;
  const row = await env.DB!.prepare('SELECT state FROM games WHERE id = ?').bind(id).first<{ state: string }>();
  return row ? JSON.parse(row.state) : null;
}

async function save(previous: any, next: any, actor: string, type: string, detail: object = {}) {
  const at = new Date().toISOString();
  const updated = env.DB!.prepare('UPDATE games SET state = ?, version = ?, updated_at = ? WHERE id = ? AND version = ?')
    .bind(JSON.stringify(next), next.version, at, next.id, previous.version);
  const event = env.DB!.prepare('INSERT INTO events (game_id, version, actor, type, detail, at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(next.id, next.version, actor, type, JSON.stringify(detail), at);
  const results = await env.DB!.batch([updated, event]);
  if (!results[0].meta.changes) throw new Error('다른 요청이 먼저 반영됐습니다. 새로고침 후 다시 시도하세요.');
}

export async function GET(request: NextRequest) {
  try {
    const game = await readGame(request);
    return json({ game: game ? view(game) : null, aiMode: env.GEMINI_API_KEY ? 'gemini' : 'practice' });
  } catch (error) {
    console.error(JSON.stringify({ event: 'game_read_failure', message: String(error) }));
    return json({ error: '게임을 불러오지 못했습니다.' }, 503);
  }
}

export async function POST(request: NextRequest) {
  try {
    const origin = request.headers.get('origin');
    if (origin && origin !== new URL(request.url).origin) return json({ error: '요청 출처가 맞지 않습니다.' }, 403);
    const body: any = await request.json();
    if (body.type === 'NEW') {
      const game = createGame();
      const at = new Date().toISOString();
      await env.DB!.prepare('INSERT INTO games (id, version, state, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
        .bind(game.id, game.version, JSON.stringify(game), at, at).run();
      await env.DB!.prepare('INSERT INTO events (game_id, version, actor, type, detail, at) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(game.id, 0, 'system', 'GAME_CREATED', '{}', at).run();
      const response = json({ game: view(game), aiMode: env.GEMINI_API_KEY ? 'gemini' : 'practice' });
      response.cookies.set(cookie, game.id, { httpOnly: true, secure: new URL(request.url).protocol === 'https:', sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 30 });
      return response;
    }
    const game = await readGame(request);
    if (!game) return json({ error: '게임이 없습니다. 새 게임을 시작하세요.' }, 404);
    if (body.version !== game.version) return json({ error: '상태가 변경됐습니다. 다시 확인하세요.', game: view(game) }, 409);
    if (body.type === 'ADVANCE') {
      const requestAction = nextAiAction(game);
      if (!requestAction) return json({ game: view(game), aiMode: env.GEMINI_API_KEY ? 'gemini' : 'practice' });
      const { action, usage, mode } = await decide(game, requestAction, env.GEMINI_API_KEY);
      const next = apply(game, requestAction.actor, action);
      await save(game, next, requestAction.actor, action.type, { aiMode: mode, inputTokens: usage?.input ?? null,
        outputTokens: usage?.output ?? null, latencyMs: usage?.latencyMs ?? null });
      return json({ game: view(next), aiMode: mode });
    }
    if (!['START', 'CHAT', 'PROPOSE', 'VOTE', 'CARD', 'CONTINUE', 'ASSASSINATE'].includes(body.type)) return json({ error: '허용되지 않는 행동입니다.' }, 400);
    const next = apply(game, 'human', body);
    await save(game, next, 'human', body.type, body.type === 'CHAT' ? { length: String(body.text).length } : {});
    return json({ game: view(next), aiMode: env.GEMINI_API_KEY ? 'gemini' : 'practice' });
  } catch (error) {
    console.error(JSON.stringify({ event: 'game_action_failure', message: String(error) }));
    return json({ error: error instanceof Error ? error.message : '요청 실패' }, 400);
  }
}
