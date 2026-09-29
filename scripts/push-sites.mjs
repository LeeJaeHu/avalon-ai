import { spawnSync } from 'node:child_process';

const [remote, sha, branch = 'main'] = process.argv.slice(2);
if (!remote || !sha) throw new Error('remote and commit SHA required');
if (process.stdin.isTTY) process.stdin.setRawMode(true);
process.stdin.resume();
const input = await new Promise(resolve => {
  let value = '';
  process.stdin.on('data', chunk => {
    value += chunk.toString();
    if (value.trimEnd().endsWith('}')) resolve(value.trim());
  });
});
if (process.stdin.isTTY) process.stdin.setRawMode(false);
process.stdin.pause();
const { token } = JSON.parse(input);
if (!token) throw new Error('missing credential');
const env = { ...process.env, GIT_CONFIG_COUNT:'1',
  GIT_CONFIG_KEY_0:'http.extraheader',
  GIT_CONFIG_VALUE_0:`Authorization: Bearer ${token}`,
  GIT_TERMINAL_PROMPT:'0' };
const result = spawnSync('git', ['push', remote, `${sha}:refs/heads/${branch}`],
  { stdio:'inherit', env });
process.exit(result.status ?? 1);
