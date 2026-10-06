import fs from 'node:fs';
const source=new URL('../lib/prompts/v3.txt',import.meta.url);
const target=new URL('../lib/prompts/v3-template.mjs',import.meta.url);
const text=fs.readFileSync(source,'utf8');
for(const marker of ['[역할]','[역할별 목표]','[공개 게임 상태 JSON]','[자기 역할·알고 있는 플레이어·자기 투표·자기 카드·역할 추론 정보 JSON]','[행동 종류·발언자·답할 메시지 등의 JSON]'])if(!text.includes(marker))throw Error('V3 필수 자리표시자 누락: '+marker);
const generated='// Generated from v3.txt by scripts/sync-player-prompt.mjs.\nexport const TEMPLATE='+JSON.stringify(text)+';\n';
if(!fs.existsSync(target)||fs.readFileSync(target,'utf8')!==generated)fs.writeFileSync(target,generated);
