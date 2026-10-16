import { createRemoteJWKSet, jwtVerify } from 'jose';

const keySets = new Map();
const denied = status => new Response(status === 503 ? 'Access configuration required' : 'Access denied', {
  status, headers: { 'cache-control': 'no-store', 'content-type': 'text/plain; charset=utf-8' },
});

export async function privateAccess(request, env, next, testKey) {
  const { ACCESS_TEAM_DOMAIN: domain, ACCESS_AUD: audience, OWNER_EMAIL: owner } = env;
  if (!domain || !/^[a-z0-9-]+\.cloudflareaccess\.com$/.test(domain) || !audience || !owner) return denied(503);
  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token) return denied(403);
  try {
    const issuer = `https://${domain}`;
    if (!testKey && !keySets.has(issuer)) keySets.set(issuer, createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`)));
    const { payload } = await jwtVerify(token, testKey ?? keySets.get(issuer), {
      issuer, audience, algorithms: ['RS256'], requiredClaims: ['exp', 'iat', 'sub', 'email'],
    });
    if (typeof payload.email !== 'string' || payload.email.toLowerCase() !== owner.trim().toLowerCase()) return denied(403);
  } catch {
    return denied(403);
  }
  return next();
}
