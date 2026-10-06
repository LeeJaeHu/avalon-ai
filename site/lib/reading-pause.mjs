// Only reading-owned pauses resume automatically; manual pauses remain under human control.
export function readingPauseAction(game,reading,blocked=false) {
  if(blocked||!game?.conversationVersion||['ROLE_REVEAL','ENDED'].includes(game.phase))return null;
  if(reading&&!game.paused)return {type:'PAUSE',readingAuto:true};
  if(!reading&&game.paused&&game.pauseSource==='reading')return {type:'RESUME',readingAuto:true};
  return null;
}
