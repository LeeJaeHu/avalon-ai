import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';

const project = 'project-c1511084-5489-4d98-8db';
const model = 'gemini-3.5-flash-lite';
const vertexUrl = `https://aiplatform.googleapis.com/v1/projects/${project}/locations/global/publishers/google/models/${model}:generateContent`;
const secret = process.env.VERTEX_PROXY_TOKEN;
if (!secret || secret.length < 32) throw new Error('VERTEX_PROXY_TOKEN is required');
let cachedToken;

function authorized(header) {
  const actual = Buffer.from(header ?? '');
  const expected = Buffer.from(secret);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

async function accessToken() {
  if (cachedToken?.expiresAt > Date.now()) return cachedToken.value;
  const response = await fetch('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token', {
    headers: { 'Metadata-Flavor': 'Google' }, signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error(`Metadata token HTTP ${response.status}`);
  const data = await response.json();
  if (!data.access_token) throw new Error('Metadata token missing');
  cachedToken = { value: data.access_token, expiresAt: Date.now() + (data.expires_in - 60) * 1000 };
  return cachedToken.value;
}

createServer(async (request, response) => {
  if (request.method !== 'POST' || request.url !== '/generate') {
    response.writeHead(404).end();
    return;
  }
  if (!authorized(request.headers['x-avalon-proxy-token'])) {
    response.writeHead(401).end();
    return;
  }
  try {
    let body = '';
    for await (const chunk of request) {
      body += chunk;
      if (body.length > 65536) { response.writeHead(413).end(); return; }
    }
    const input = JSON.parse(body);
    if (input.contents?.length !== 1 || input.contents[0]?.role !== 'user'
      || input.contents[0]?.parts?.length !== 1 || typeof input.contents[0].parts[0]?.text !== 'string'
      || input.contents[0].parts[0].text.length > 30000) {
      response.writeHead(400).end();
      return;
    }
    const payload = { contents: input.contents, generationConfig: {
      responseMimeType: 'application/json', temperature: input.generationConfig?.temperature ?? 0.7,
      maxOutputTokens: Math.min(1024, Math.max(300, Number(input.generationConfig?.maxOutputTokens) || 300)),
      ...(input.generationConfig?.responseSchema ? { responseSchema: input.generationConfig.responseSchema } : {}) } };
    const upstream = await fetch(vertexUrl, { method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await accessToken()}` },
      body: JSON.stringify(payload), signal: AbortSignal.timeout(25000) });
    response.writeHead(upstream.status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    response.end(upstream.ok ? await upstream.text() : '{}');
  } catch {
    response.writeHead(502).end();
  }
}).listen(Number(process.env.PORT ?? 8080));
