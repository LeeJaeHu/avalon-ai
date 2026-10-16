import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPair, SignJWT } from 'jose';
import { privateAccess } from '../lib/private-access.mjs';
import { existsSync, readFileSync } from 'node:fs';

const { privateKey, publicKey } = await generateKeyPair('RS256');
const env = { ACCESS_TEAM_DOMAIN: 'avalon-test.cloudflareaccess.com', ACCESS_AUD: 'game-app', OWNER_EMAIL: 'owner@example.com' };
async function signed(overrides = {}, key = privateKey) {
  return new SignJWT({ email: env.OWNER_EMAIL, ...overrides })
    .setProtectedHeader({ alg: 'RS256' }).setSubject('test-owner').setIssuedAt()
    .setIssuer(overrides.iss ?? `https://${env.ACCESS_TEAM_DOMAIN}`)
    .setAudience(overrides.aud ?? env.ACCESS_AUD).setExpirationTime(overrides.exp ?? '5m').sign(key);
}
async function check(token, config = env, path = '/') {
  let calls = 0;
  const request = new Request(`https://game.example${path}`, { headers: {
    ...(token ? { 'Cf-Access-Jwt-Assertion': token } : {}),
    'Cf-Access-Authenticated-User-Email': env.OWNER_EMAIL,
  } });
  const response = await privateAccess(request, config, () => { calls++; return new Response('private game'); }, publicKey);
  return { status: response.status, calls };
}
test('only a signed owner token reaches the game', async () => {
  assert.deepEqual(await check(await signed()), { status: 200, calls: 1 });
  assert.deepEqual(await check(await signed({ email: 'OWNER@example.com' })), { status: 200, calls: 1 });
});
test('missing config and untrusted headers fail closed on every route', async () => {
  for (const path of ['/', '/api/game', '/api/logs', '/favicon.svg', '/assets/game.js']) {
    assert.deepEqual(await check(null, env, path), { status: 403, calls: 0 });
    assert.deepEqual(await check(await signed(), {}, path), { status: 503, calls: 0 });
  }
});
test('wrong identity, issuer, audience, expiry, signature and malformed tokens are rejected', async () => {
  const other = await generateKeyPair('RS256');
  const tokens = [
    await signed({ email: 'other@example.com' }), await signed({ iss: 'https://attacker.example' }),
    await signed({ aud: 'other-app' }), await signed({ exp: 1 }), await signed({}, other.privateKey), 'invalid',
  ];
  for (const token of tokens) assert.deepEqual(await check(token), { status: 403, calls: 0 });
});
test('independent deploy protects assets and disables preview URLs', () => {
  // 실제 설정은 계정 ID 때문에 Git에서 제외되므로, 있으면 예시와 함께 검사한다.
  for (const name of ['../wrangler.cloudflare.example.jsonc', '../wrangler.cloudflare.jsonc']) {
    const url = new URL(name, import.meta.url);
    if (!existsSync(url)) continue;
    const config = JSON.parse(readFileSync(url));
    assert.equal(config.assets.run_worker_first, true);
    assert.equal(config.preview_urls, false);
    assert.equal(config.main, './build/cloudflare-worker.ts');
  }
});
