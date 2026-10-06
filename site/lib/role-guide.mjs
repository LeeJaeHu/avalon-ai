const GOOD_WIN='원정 3회를 성공시키고, 멀린이 마지막 암살을 피하면 선 진영이 승리합니다.';
const EVIL_WIN='원정 3회 실패, 팀 제안 5회 연속 부결, 또는 멀린 암살 성공으로 악 진영이 승리합니다.';
export const ROLE_GUIDES={
  LOYAL:{name:'충신',side:'GOOD',summary:'공개된 대화와 투표·원정 결과로 악을 찾아내는 역할입니다.',ability:'특수 능력은 없습니다. 다른 참가자의 진영과 역할을 모르고 시작합니다.'},
  MERLIN:{name:'멀린',side:'GOOD',summary:'악의 정체를 알고 있지만, 자신의 정체를 숨겨야 하는 역할입니다.',ability:'시작할 때 악 플레이어를 알 수 있습니다. 각자의 구체적인 역할까지 알지는 못합니다.'},
  ASSASSIN:{name:'암살자',side:'EVIL',summary:'원정이 3회 성공하면, 마지막으로 멀린을 암살해 승부를 뒤집을 수 있습니다.',ability:'원정 3회 성공 후 한 명을 한 번 지목합니다. 멀린이면 악의 승리, 아니면 선의 승리입니다. 악 동료는 알지만 멀린이 누구인지는 모릅니다.'},
  MINION:{name:'악의 하수인',side:'EVIL',summary:'악 동료와 함께 정체를 숨기고 원정을 방해하는 역할입니다.',ability:'악 동료를 알고 시작합니다. 마지막 암살 대상은 암살자가 선택합니다.'},
  PERCIVAL:{name:'퍼시벌',side:'GOOD',summary:'멀린에 관한 단서를 가지고 시작하는 역할입니다.',ability:'멀린이 누구인지 알고 시작합니다.'},
  MORGANA:{name:'모르가나',side:'EVIL',summary:'퍼시벌에게 멀린과 구별되지 않는 후보로 보이는 역할입니다.',ability:'퍼시벌은 당신과 멀린을 함께 보지만 둘을 구별하지 못합니다. 이 능력으로 당신이 멀린이나 퍼시벌의 정체를 알게 되는 것은 아닙니다.'},
  MORDRED:{name:'모드레드',side:'EVIL',summary:'멀린에게 정체가 드러나지 않는 악의 역할입니다.',ability:'멀린의 시작 정보에 포함되지 않습니다. 다른 악 동료와는 서로를 알아봅니다.'},
  OBERON:{name:'오베론',side:'EVIL',summary:'같은 편의 정체를 모른 채 활동하는 악의 역할입니다.',ability:'다른 악 플레이어와 서로를 알아보지 못합니다. 기본판 규칙에서 멀린에게는 악으로 보입니다.'},
};
export function publicRoleCounts(roles){
  const counts={};
  for(const role of Object.values(roles??{}))if(Object.hasOwn(ROLE_GUIDES,role))counts[role]=(counts[role]??0)+1;
  return Object.fromEntries(Object.keys(ROLE_GUIDES).filter(role=>counts[role]).map(role=>[role,counts[role]]));
}
export function roleGuide(role,counts={}){
  const guide=ROLE_GUIDES[role];if(!guide)return null;
  const notes=[];let ability=guide.ability;
  if(role==='MERLIN'){
    notes.push('원정 3회에 성공해도, 암살자가 당신을 지목하면 선 진영 전체가 패배합니다.');
    if(counts.MORDRED)notes.push('이번 판의 모드레드는 당신에게 보이지 않습니다. 알려진 악 목록에 없는 사람도 악일 수 있습니다.');
    if(counts.OBERON)notes.push('오베론은 다른 악에게는 보이지 않지만, 당신에게는 악으로 보입니다.');
  }
  if(guide.side==='EVIL'&&role!=='OBERON'&&counts.OBERON)notes.push('이번 판에는 오베론이 있습니다. 오베론은 악 진영이지만 당신의 동료 목록에 표시되지 않으며, 오베론 역시 다른 악 동료가 누구인지 모릅니다.');
  if(role==='PERCIVAL'&&counts.MORGANA){ability='멀린과 모르가나 두 명을 후보로 알지만, 누가 누구인지는 모릅니다.';notes.push('모르가나는 악입니다. 표시된 두 사람을 모두 같은 편으로 믿어서는 안 됩니다.');}
  return {...guide,ability,notes,win:guide.side==='GOOD'?GOOD_WIN:EVIL_WIN,quest:guide.side==='GOOD'?'반드시 성공을 선택합니다.':'성공 또는 실패를 선택할 수 있습니다. 반드시 실패를 선택할 필요는 없습니다.'};
}
export function privateRoleKnowledge(view){
  const role=view?.role,known=(view?.known??[]).filter(id=>view.ids?.includes(id)&&id!=='human').map(id=>view.names?.[id]??id);
  if(role==='LOYAL'||role==='OBERON')return role==='OBERON'?'다른 악 플레이어가 누구인지 모릅니다.':'다른 참가자의 진영과 역할을 모릅니다.';
  if(role==='PERCIVAL')return view.roleCounts?.MORGANA?`멀린 후보: ${known.join(' · ')||'정보 없음'}. 한 명은 멀린, 다른 한 명은 모르가나입니다.`:`멀린: ${known.join(' · ')||'정보 없음'}`;
  return `${role==='MERLIN'?'당신에게 알려진 악 플레이어':'당신의 악 동료'}: ${known.join(' · ')||'알려진 참가자 없음'}`;
}
export function roleInteractions(counts={}){
  const notes=[];
  if(counts.PERCIVAL&&counts.MORGANA)notes.push('퍼시벌은 멀린과 모르가나를 구별하지 못합니다.');
  if(counts.MORDRED)notes.push('멀린은 모드레드를 알아보지 못합니다.');
  if(counts.OBERON)notes.push('오베론과 다른 악 플레이어는 서로를 알아보지 못합니다. 멀린에게는 오베론이 악으로 보입니다.');
  return notes;
}
