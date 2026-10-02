import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';

export async function saveGameLog(directory, log) {
  const id = log?.game?.id;
  const version = log?.game?.version;
  if (log?.format !== 'avalon-game-log-v1' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id ?? '')
    || !Number.isInteger(version) || version < 0) throw new Error('올바른 게임 로그가 아닙니다.');
  const root = resolve(directory);
  await mkdir(root, { recursive: true });
  const file = join(root, `avalon-${id}.json`);
  try {
    const previous = JSON.parse(await readFile(file, 'utf8'));
    if (previous.game?.version > version) return { file, saved: false };
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const temporary = file + '.tmp';
  await writeFile(temporary, JSON.stringify(log, null, 2), { encoding: 'utf8', mode: 0o600 });
  await rename(temporary, file);
  return { file, saved: true };
}
