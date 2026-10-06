import {readFileSync} from 'node:fs';
import {compareModelLogs} from '../site/lib/comparison.mjs';
try {
  if(!process.argv.slice(2).length)throw new Error('사용법: node scripts/compare-models.mjs <종료 로그.json> [추가 로그.json ...]');
  console.log(JSON.stringify(compareModelLogs(process.argv.slice(2).map(file=>JSON.parse(readFileSync(file,'utf8')))),null,2));
} catch(error) { console.error(error.message);process.exitCode=1; }
