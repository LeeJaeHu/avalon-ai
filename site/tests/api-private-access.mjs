// No credentials or model calls: verify deployed authentication before playing.
import assert from 'node:assert/strict';
const origin = process.argv[2];
assert.ok(origin && new URL(origin).protocol === 'https:', 'Pass the deployed HTTPS origin');
const pending = process.argv.includes('--pending');
for (const path of ['/', '/api/game', '/api/logs', '/favicon.svg']) {
  for (const method of ['GET', 'POST']) {
    const response = await fetch(new URL(path, origin), {
      method, redirect: 'manual', signal: AbortSignal.timeout(15000),
      headers: { 'Cf-Access-Jwt-Assertion': 'forged', 'Cf-Access-Authenticated-User-Email': 'spoof@example.com' },
    });
    const location = response.headers.get('location');
    const loginRedirect = [302, 303, 307].includes(response.status) && location
      && new URL(location, origin).hostname.endsWith('.cloudflareaccess.com');
    assert.ok(response.status === 403 || loginRedirect || (pending && response.status === 503), `${method} ${path}: unexpected ${response.status}`);
    await response.body?.cancel();
    console.log(`${method} ${path}: ${response.status} blocked`);
  }
}
