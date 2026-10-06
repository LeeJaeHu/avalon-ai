// Accept only the already published player view; never copy whole records into the dialog.
export function resultPopup(game) {
  if(!game)return null;
  const proposal=game.proposals?.at(-1),quest=game.quests?.at(-1);
  const kind=game.phase==='TEAM_DISCUSSION'&&proposal?.status==='DRAFT'?'TEAM':game.phase==='VOTE_RESULT'&&['APPROVED','REJECTED'].includes(proposal?.status)?'VOTE_RESULT':game.phase==='QUEST_RESULT'&&['SUCCESS','FAIL'].includes(quest?.result)?'QUEST_RESULT':null;
  if(!kind)return null;
  const record=kind==='QUEST_RESULT'?quest:proposal;
  const event=game.publicEvents?.findLast(e=>e.kind===kind);
  const players=(record.team??[]).filter(id=>game.ids.includes(id)).map(id=>({id,name:game.names[id]??id}));
  const common={key:`${game.id}:${event?.id??kind+':'+record.id+':'+players.map(p=>p.id).join(',')}`,kind,quest:record.quest??game.quest,attempt:proposal?.attempt??game.attempt,players};
  if(kind==='TEAM')return {...common,tone:'team',title:'원정 팀 초안',description:`${game.names[proposal.leader]}의 제안입니다. 아직 투표 전이며 토론 중에 수정할 수 있습니다.`,leader:game.names[proposal.leader],emblem:'team'};
  if(kind==='VOTE_RESULT') {
    const votes=(proposal.votes??[]).filter(v=>game.ids.includes(v.actor)&&['APPROVE','REJECT'].includes(v.choice)).map(v=>({id:v.actor,name:game.names[v.actor]??v.actor,choice:v.choice}));
    if(votes.length!==game.ids.length)return null;
    const approve=votes.filter(v=>v.choice==='APPROVE').length,approved=proposal.status==='APPROVED';
    return {...common,tone:approved?'approved':'rejected',title:approved?'원정 팀 승인':'원정 팀 부결',description:approved?'과반수가 찬성했습니다. 이 멤버들이 원정에 참여합니다.':proposal.attempt===5?'다섯 번째 팀이 부결되었습니다. 결과를 확인하면 악의 승리가 확정됩니다.':'과반수가 반대했습니다. 다음 리더가 새로운 팀을 제안합니다.',emblem:approved?'approved':'rejected',votes,approve,reject:votes.length-approve};
  }
  const success=quest.result==='SUCCESS';
  return {...common,tone:success?'success':'failure',title:success?'원정 성공':'원정 실패',description:success?'원정대가 임무를 완수했습니다. 선의 원정 기록에 성공 하나가 더해집니다.':'실패 카드가 나왔습니다. 이번 원정 멤버와 이전 발언을 함께 살펴보세요.',emblem:success?'success':'failure',fails:quest.fails};
}
