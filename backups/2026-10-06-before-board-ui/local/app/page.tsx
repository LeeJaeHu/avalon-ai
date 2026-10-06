'use client';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {manualNextStep} from '../lib/conversation.mjs';
import {resultPopup} from '../lib/result-popup.mjs';
import {Dialog,DialogContent,DialogTitle,DialogDescription,DialogClose} from '../components/ui/dialog';

const roleNames: Record<string,string> = { MERLIN:'멀린', LOYAL:'충신', ASSASSIN:'암살자', MINION:'악의 하수인' };
const phaseNames: Record<string,string> = { ROLE_REVEAL:'역할 확인', PROPOSE:'팀 초안 선정', TEAM_DISCUSSION:'원탁 토론', VOTE:'찬반 투표', VOTE_RESULT:'투표 결과', QUEST:'임무 카드', QUEST_RESULT:'원정 결과', ASSASSINATE:'암살', ENDED:'게임 종료' };
const progressLabels: Record<string,string> = { NEW:'새 게임을 준비하고 있습니다…', START:'게임을 시작하고 있습니다…', CHAT:'메시지를 보내고 있습니다…', PROPOSE:'팀 초안을 공유하고 있습니다…', START_VOTE:'투표를 시작하고 있습니다…', REQUEST_REVISION:'팀 재검토를 요청하고 있습니다…', VOTE:'투표를 저장하고 있습니다…', CARD:'임무 카드를 제출하고 있습니다…', CONTINUE:'다음 단계로 이동하고 있습니다…', ASSASSINATE:'암살 대상을 확인하고 있습니다…', PAUSE:'일시정지 중입니다…', RESUME:'게임을 재개하고 있습니다…', ADVANCE:'AI가 생각하고 있습니다…' };

export default function Home() {
  const [game,setGame] = useState<any>(null);
  const [mode,setMode] = useState('practice');
  const [nextRouting,setNextRouting] = useState('baseline');
  const [routingReady,setRoutingReady] = useState(false);
  const [busy,setBusy] = useState(false);
  const [aiBusy,setAiBusy] = useState(false);
  const [queuedVote,setQueuedVote] = useState(false);
  const [progress,setProgress] = useState('');
  const [loading,setLoading] = useState(true);
  const [error,setError] = useState('');
  const [notice,setNotice] = useState('');
  const [team,setTeam] = useState<string[]>([]);
  const [message,setMessage] = useState('');
  const [reveal,setReveal] = useState(false);
  const [history,setHistory] = useState(false);
  const [replyTo,setReplyTo] = useState<string|null>(null);
  const [popup,setPopup] = useState<any>(null);
  const viewedPopups=useRef(new Set<string>());
  const popupReturnRef=useRef<HTMLButtonElement>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const chatAtBottom = useRef(true);
  const gameRef = useRef<any>(null);
  const queueRef = useRef<Record<string,unknown>[]>([]);
  const processingRef = useRef(false);
  const aiControllerRef = useRef<AbortController|null>(null);
  const aiEpochRef = useRef(0);
  const name = (id:string) => game?.names?.[id] ?? id;
  function showGame(next:any) {
    if (!next) return;
    const current=gameRef.current;
    if (current?.id===next.id && current.version>next.version) return;
    gameRef.current=next;
    setGame(next);
  }
  async function drainQueue() {
    if (processingRef.current) return;
    processingRef.current=true;
    setBusy(true);
    while (queueRef.current.length) {
      const input=queueRef.current[0];
      setProgress(progressLabels[String(input.type)] ?? '처리 중입니다…');
      try {
        for (let attempt=0; attempt<4; attempt++) {
          const r=await fetch('/api/game',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...input,version:gameRef.current?.version})});
          const d:any=await r.json();
          if (r.status===409 && d.game) {
            showGame(d.game);
            if (['START_VOTE','CONTINUE'].includes(String(input.type))) throw new Error('단계 상태가 변경됐습니다. 현재 화면을 확인한 뒤 다시 이동해 주세요.');
            if (attempt<3) continue;
          }
          if (!r.ok) throw new Error(d.error || '요청 실패');
          showGame(d.game);setMode(d.aiMode);setNotice(d.notice ?? '');
          if (input.type==='PROPOSE') setTeam([]);
          break;
        }
      } catch(e) {
        setError(e instanceof Error?e.message:'요청 실패');
        if (input.type==='CHAT') setMessage(current=>current || String(input.text));
      } finally {
        queueRef.current.shift();
        if (input.type==='VOTE') setQueuedVote(false);
      }
    }
    processingRef.current=false;setBusy(false);setProgress('');
  }
  function act(input:Record<string,unknown>) {
    if(input.type==='NEW'){setMessage('');input={...input,routingMode:nextRouting};chatAtBottom.current=true;setReplyTo(null);}
    aiEpochRef.current++;
    // Let the server finish its ledger and release the lease; epochs discard stale UI replies.
    aiControllerRef.current=null;setAiBusy(false);
    if(input.type==='VOTE') setQueuedVote(true);
    if(input.type==='CHAT'){setMessage('');setReplyTo(null);}
    queueRef.current.push(input);setError('');
    void drainQueue();
  }
  useEffect(()=>{fetch('/api/game').then(r=>r.json()).then((d:any)=>{showGame(d.game);setMode(d.aiMode);setRoutingReady(!!d.routingReady);setNextRouting(d.routingReady?'jev':'baseline');if(d.error)setError(d.error);}).catch(()=>setError('게임을 불러오지 못했습니다.')).finally(()=>setLoading(false));},[]);
  const popupCandidate=resultPopup(game);
  useEffect(()=>{
    if(!popupCandidate){setPopup(null);return;}
    let viewed=viewedPopups.current.has(popupCandidate.key);
    try{viewed ||= JSON.parse(sessionStorage.getItem(`avalon-popup:${game.id}`)??'[]').includes(popupCandidate.key);}catch{}
    if(!viewed)setPopup(popupCandidate);
  },[game?.id,popupCandidate?.key]);
  function closePopup(){
    if(popup){
      viewedPopups.current.add(popup.key);
      try{const key=`avalon-popup:${game.id}`,seen=JSON.parse(sessionStorage.getItem(key)??'[]');sessionStorage.setItem(key,JSON.stringify([...new Set([...seen,popup.key])].slice(-30)));}catch{}
    }
    setPopup(null);
  }
  const aiTurn=game?.aiPending;
  useEffect(()=>{
    if(!game||popup||busy||aiBusy||error||message.trim()||(!aiTurn&&!game.idleDueAt))return;
    const delay=aiTurn?850:Math.max(0,game.idleDueAt-Date.now())+50;
    const t=setTimeout(async()=>{
      if(processingRef.current||aiControllerRef.current)return;
      const controller=new AbortController();aiControllerRef.current=controller;setAiBusy(true);
      const epoch=aiEpochRef.current;
      try {
        const r=await fetch('/api/game',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type:'ADVANCE',version:gameRef.current?.version}),signal:controller.signal});
        const d:any=await r.json();
        if(epoch!==aiEpochRef.current)return;
        if(r.status===409&&d.game){showGame(d.game);return;}
        if(!r.ok)throw new Error(d.error||'AI 요청 실패');
        showGame(d.game);setMode(d.aiMode);setNotice(d.notice??'');
        if(d.retryAfterMs)await new Promise(resolve=>setTimeout(resolve,d.retryAfterMs));
      } catch(e) {
        if(!controller.signal.aborted&&epoch===aiEpochRef.current)setError(e instanceof Error?e.message:'AI 요청 실패');
      } finally {
        if(aiControllerRef.current===controller){aiControllerRef.current=null;setAiBusy(false);}
      }
    },delay);
    return()=>clearTimeout(t);
  },[game?.version,busy,aiBusy,error,aiTurn,game?.idleDueAt,message,popup?.key]);
  useLayoutEffect(()=>{const el=messagesRef.current;if(el&&chatAtBottom.current)el.scrollTop=el.scrollHeight;},[game?.id,game?.messages?.length,game?.publicEvents?.length]);
  useEffect(()=>{setTeam(game?.leader==='human' ? game.team ?? [] : []);},[game?.id,game?.leader,game?.attempt,game?.team?.join(',')]);
  const toggle=(id:string)=>setTeam(v=>v.includes(id)?v.filter(x=>x!==id):v.length<game.size?[...v,id]:v);
  const voteResult=game?.phase==='VOTE_RESULT'?game.proposals.at(-1):null;
  const questResult=game?.phase==='QUEST_RESULT'?game.quests.at(-1):null;
  const lastQuest=game?.quests.at(-1);
  const replying=game?.messages.find((m:any)=>m.id===replyTo);
  const knownInfo=game?.known?.length ? `${game.role==='MERLIN'?'악 플레이어':'악 동료'}: ${game.known.map(name).join(', ')}` : '다른 역할에 대한 시작 정보는 없습니다.';
  const timeline=game ? [...game.messages.map((m:any)=>({...m,kind:'MESSAGE'})),...(game.publicEvents??[])].sort((a:any,b:any)=>a.at.localeCompare(b.at)||(a.version??0)-(b.version??0)) : [];
  const teamChanged=game?.team && (team.length!==game.team.length || team.some(id=>!game.team.includes(id)));
  const canEdit=game?.leader==='human' && ['PROPOSE','TEAM_DISCUSSION'].includes(game.phase);
  const step=['PROPOSE','TEAM_DISCUSSION'].includes(game?.phase)?0:['VOTE','VOTE_RESULT'].includes(game?.phase)?1:2;
  const nextStep=game?manualNextStep(game,{busy,aiBusy,draft:!!message.trim(),teamChanged:!!(canEdit&&teamChanged)}):{type:null,label:'다음 단계 →',reason:null,disabled:true};
  const actions=game&&(<div className="decision-area"><div className="decision-reading"><button className="primary" disabled={nextStep.disabled} aria-describedby="next-stage-status" onClick={()=>act({type:nextStep.type})}>{nextStep.label}</button><small id="next-stage-status" role="status">{nextStep.reason??"추가 의견을 보내거나 준비되면 이동하세요."}</small></div>
          {canEdit&&<details className="team-editor" key={game.phase} {...(game.phase==='PROPOSE'?{open:true}:{})}><summary>{game.phase==='PROPOSE'?'팀 초안 고르기':'팀 명단 수정'}</summary><p>{game.phase==='PROPOSE'?`먼저 ${game.size}명의 팀 초안을 공유하세요.`:'대화를 듣고 팀을 수정할 수 있습니다.'}</p><div className="choices">{game.ids.map((id:string)=><button aria-pressed={team.includes(id)} className={team.includes(id)?'chosen':''} key={id} disabled={game.paused||busy} onClick={()=>toggle(id)}>{name(id)} {team.includes(id)?'✓':'+'}</button>)}</div><button className="outline" disabled={game.paused||busy||team.length!==game.size||(game.phase==='TEAM_DISCUSSION'&&!teamChanged)} onClick={()=>act({type:'PROPOSE',team})}>{game.phase==='PROPOSE'?'팀 초안 공유':'수정한 팀 공유'}</button></details>}
          {game.phase==='PROPOSE'&&game.leader!=='human'&&<p className="waiting">{name(game.leader)}님이 팀 초안을 고르고 있습니다.</p>}
          {game.phase==='TEAM_DISCUSSION'&&<div className="discussion-actions"><p>대화가 끝나면 버튼으로 투표를 시작하세요. 새 의견을 보내면 토론이 이어집니다.</p>{game.leader!=='human'&&<button className="outline" disabled={game.paused||busy||aiBusy||aiTurn||game.revisionRequested} onClick={()=>act({type:'REQUEST_REVISION'})}>리더에게 팀 재검토 요청</button>}</div>}
          {game.phase==='VOTE'&&<div><p>확정된 팀에 찬반을 선택하세요. 전원의 표는 동시에 공개됩니다.</p>{!game.voted?<div className="choices"><button className="primary" disabled={game.paused||queuedVote||busy} onClick={()=>act({type:'VOTE',choice:'APPROVE'})}>찬성</button><button className="outline" disabled={game.paused||queuedVote||busy} onClick={()=>act({type:'VOTE',choice:'REJECT'})}>반대</button></div>:<p className="waiting">내 표를 제출했습니다. 다른 참가자의 표를 기다립니다.</p>}</div>}
          {voteResult&&<div className="inline-result"><h3>원정팀 {voteResult.status==='APPROVED'?'승인':'부결'}</h3><p>찬성 {voteResult.approveCount} · 반대 {5-voteResult.approveCount}. 공개된 표에 대해 질문할 수 있습니다.</p></div>}
          {game.phase==='QUEST'&&<div><h3>원정 성공 여부 투표</h3><p>원정의 성공 또는 실패를 선택하세요. 누가 무엇을 선택했는지는 공개되지 않습니다.</p>{game.team.includes('human')&&!game.cardSubmitted?<div className="choices"><button className="primary" disabled={game.paused||busy} onClick={()=>act({type:'CARD',choice:'SUCCESS'})}>성공</button>{['ASSASSIN','MINION'].includes(game.role)&&<button className="outline" disabled={game.paused||busy} onClick={()=>act({type:'CARD',choice:'FAIL'})}>실패</button>}</div>:<p className="waiting">원정팀의 성공 여부 투표를 기다립니다.</p>}</div>}
          {questResult&&<div className="inline-result"><h3 className={questResult.result==='SUCCESS'?'good':'bad'}>원정 {questResult.result==='SUCCESS'?'성공':'실패'}</h3><p>{questResult.team.map(name).join(' · ')} · 실패 카드 {questResult.fails}장. {questResult.result==='SUCCESS'?'이 결과를 다음 팀 구성에 어떻게 반영할까요?':'실패한 팀에서 누구를 의심하나요?'}</p></div>}
          {game.phase==='ASSASSINATE'&&<div><h3>마지막 선택, 멀린 암살</h3><p>암살자가 멀린을 맞히면 악이 승리합니다.</p>{game.role==='ASSASSIN'?<div className="choices">{game.ids.filter((id:string)=>id!=='human').map((id:string)=><button key={id} disabled={game.paused||busy} onClick={()=>act({type:'ASSASSINATE',target:id})}>{name(id)} 지목</button>)}</div>:<p className="waiting">암살자의 선택을 기다립니다.</p>}</div>}
          {game.phase==='ENDED'&&<div className="outcome"><span className="eyebrow">FINAL RESULT</span><h2>{game.winner==='GOOD'?'선의 승리':'악의 승리'}</h2><p>{game.assassination?`암살 대상: ${name(game.assassination)}`:'임무와 투표 결과로 게임이 끝났습니다.'}</p><div className="revealed">{game.ids.map((id:string)=><span key={id}>{name(id)} · {roleNames[game.roles[id]]}</span>)}</div><a className="outline" href="/api/game?export=1" download={`avalon-${game.id}.json`}>게임 기록 JSON 다운로드</a></div>}
          {popupCandidate&&<button ref={popupReturnRef} className="textbutton popup-reopen" onClick={()=>setPopup(popupCandidate)}>{popupCandidate.kind==='TEAM'?'팀 명단 자세히 보기':'결과 자세히 보기'} ↗</button>}
        </div>);
  return <main className="shell"><header className="top"><div className="brand"><span className="sigil">✦</span><div><strong>AVALON</strong><small>다섯 사람의 비밀 원정</small></div></div><div className="top-actions">{game&&<a className="outline" href="/api/game?diagnostics=1" download={`avalon-diagnostics-${game.id}.json`}>진단 로그</a>}<button className="outline" disabled={busy||!game||game.phase==='ENDED'} onClick={()=>act({type:game.paused?'RESUME':'PAUSE'})}>{game?.paused?'계속하기':'일시정지'}</button><button className="outline" disabled={busy} onClick={()=>{if(!game||confirm('현재 게임 기록을 자동 보관하고 새 게임을 시작할까요?')){setReveal(false);act({type:'NEW'});}}}>새 게임</button></div></header>
  {!loading&&<section className="routing-picker" aria-label="새 게임의 AI 발언 방식"><label htmlFor="routing-mode">새 게임 방식</label><select id="routing-mode" value={nextRouting} disabled={busy} onChange={e=>setNextRouting(e.target.value)}><option value="baseline">기존 방식</option><option value="jev" disabled={!routingReady}>JEV 적용</option></select><span>{game?`현재 판: ${game.routingMode==='jev'?'JEV 적용':'기존 방식'} · 선택은 다음 새 게임에 적용됩니다.`:'두 방식 모두 Gemini가 대화합니다. JEV는 다음 발언자와 발언 목적을 판단합니다. 단계는 버튼으로 이동합니다.'}{!routingReady&&' · JEV 연결 준비 중'}</span></section>}
  {game?.usage&&<details className="usage-panel"><summary>이번 판 추정 비용 · {'$'+game.usage.costUsd.toFixed(6)}</summary><p>실제 API 응답 사용량으로 계산 · USD · 일반 Global 단가</p><table><thead><tr><th>모델</th><th>호출</th><th>입력 토큰</th><th>응답 / 추론 토큰</th><th>추정 비용</th></tr></thead><tbody>{['gemini','jev'].map(provider=>{const u=game.usage.providers[provider];return <tr key={provider}><td>{provider==='gemini'?'Gemini':'JEV'}</td><td>{u.calls}</td><td>{u.input.toLocaleString()}</td><td>{u.output.toLocaleString()} / {u.thoughts.toLocaleString()}</td><td>{'$'+u.costUsd.toFixed(6)}</td></tr>;})}</tbody></table><small>재시도와 폐기된 응답도 포함합니다. 실제 청구액 및 중계·호스팅 비용과 다를 수 있습니다.{game.usage.unknownCalls>0&&` 사용량 미확인 ${game.usage.unknownCalls}회: 합계에 미반영.`}{game.usage.legacyIncomplete&&' 이전 판은 기록 시작 전 사용량이 포함되지 않습니다.'}</small></details>}
  {loading?<p>불러오는 중…</p>:!game?<section className="card welcome"><div className="crest">✦</div><p className="eyebrow">THE RESISTANCE · AVALON</p><h1>말을 나누고,<br/>누구를 믿을지 결정하세요.</h1><p>당신과 네 명의 AI가 원탁에 앉습니다. 팀을 제안하고, 서로의 근거를 묻고, 토론을 마치면 투표하세요.</p><button className="primary" disabled={busy} onClick={()=>act({type:'NEW'})}>원탁에 앉기 →</button></section>:game.paused&&!game.conversationVersion?<section className="card welcome pause-screen"><div className="crest">Ⅱ</div><h1>잠시 쉬어갑니다</h1><p>대화와 진행 상황은 저장되어 있습니다.</p><button className="primary" disabled={busy} onClick={()=>act({type:'RESUME'})}>원탁으로 돌아가기 →</button></section>:game.phase==='ROLE_REVEAL'?<section className="card welcome role-intro"><div className="crest">♜</div><p className="eyebrow">YOUR SECRET ROLE</p><h1>당신은 {roleNames[game.role]}입니다</h1><p>{knownInfo}</p><p className="role-hint">당신만 아는 정보입니다. 확인하면 원탁의 대화가 시작됩니다.</p><button className="primary" disabled={busy} onClick={()=>act({type:'START'})}>확인하고 게임 시작 →</button></section>:<>
    <div className="status"><div><span className="eyebrow">QUEST {Math.min(game.quest,5)} / 5 · 제안 {game.attempt} / 5</span><h1>{phaseNames[game.phase]}</h1><p>{game.phase==='TEAM_DISCUSSION'?'질문하고 반박해 보세요. 투표는 준비됐을 때 시작합니다.':`리더 ${name(game.leader)} · 원정팀 ${game.size}명`}</p></div><div className="quest-track" aria-label="원정 진행">{[0,1,2,3,4].map(i=><div key={i} className={`quest-dot ${game.quests[i]?.result?.toLowerCase()??''} ${game.quest===i+1?'current':''}`}><span>{i+1}</span><small>{game.quests[i]?game.quests[i].result==='SUCCESS'?'성공':'실패':`${[2,3,2,3,3][i]}명`}</small></div>)}</div></div>
    <section className="card roundtable">
      <aside className="game-controls" aria-label="플레이어와 게임 행동">
      <div className="roundtable-top"><div className="phase-steps" aria-label="이번 원정 흐름">{['팀 토론','찬반 투표','원정 결과'].map((label,i)=><span key={label} className={step===i?'active':''}>{i+1} · {label}</span>)}</div><button className="textbutton secret-toggle" aria-expanded={reveal} onClick={()=>setReveal(!reveal)}>♜ {reveal?'역할 가리기':'내 역할 보기'}</button></div>
      {reveal&&<div className="secret-detail"><b>{roleNames[game.role]}</b><span>{knownInfo}</span></div>}
      <div className="players">{game.ids.map((id:string)=><div className={`player ${game.team?.includes(id)?'selected':''} ${id===game.leader&&game.phase!=='ENDED'?'leader':''}`} key={id}><span className="avatar">{id===game.leader&&game.phase!=='ENDED'&&<span className="crown" aria-label="현재 리더">♛</span>}{name(id).slice(0,1)}</span><b>{name(id)}</b><small>{id===game.leader?'리더':id==='human'?'당신':'AI'}</small>{voteResult&&<span className={`player-vote ${voteResult.votes.find((v:any)=>v.actor===id)?.choice==='APPROVE'?'approve':'reject'}`}>{voteResult.votes.find((v:any)=>v.actor===id)?.choice==='APPROVE'?'찬성':'반대'}</span>}</div>)}</div>
      <div className="team-context"><span className="eyebrow">{game.phase==='TEAM_DISCUSSION'?'현재 팀 초안':'현재 원정팀'}</span><strong>{game.team?game.team.map(name).join(' · '):`${name(game.leader)}의 팀 제안을 기다립니다`}</strong><span>{game.size}명</span></div>
      {lastQuest&&<div className="last-quest">최근 원정 · {lastQuest.team.map(name).join(' · ')} <b className={lastQuest.result==='SUCCESS'?'good':'bad'}>{lastQuest.result==='SUCCESS'?'성공':'실패'} · 실패 카드 {lastQuest.fails}장</b></div>}

      </aside>
      <section className="conversation" aria-label="원탁 대화"><div className="chathead"><h2>원탁 대화</h2><small role="status">{aiBusy?'AI가 응답 작성 중…':aiTurn?'AI 응답 준비 중…':game.phase==='ENDED'?'대화 종료':'질문 · 반론 · 설득'}</small></div>
        <div className="messages" ref={messagesRef} onScroll={e=>{const el=e.currentTarget;chatAtBottom.current=el.scrollHeight-el.scrollTop-el.clientHeight<32;}}>{timeline.length===0&&<p className="empty">어떤 팀으로 시작할까요?<br/>참가자에게 이유를 물어보세요.</p>}{timeline.map((item:any)=>item.kind==='MESSAGE'?<div className={`bubble ${item.actor==='human'?'mine':''}`} key={item.id}><div className="bubble-heading"><b>{name(item.actor)}</b>{game.phase!=='ENDED'&&<button className="reply-button" onClick={()=>{setReplyTo(item.id);document.getElementById('msg')?.focus();}} aria-label={`${name(item.actor)}의 ${item.id} 발언에 답하기`}>답하기 ↩</button>}</div>{item.replyTo&&<div className="quoted">↳ {name(game.messages.find((m:any)=>m.id===item.replyTo)?.actor)}: {game.messages.find((m:any)=>m.id===item.replyTo)?.text}</div>}<p>{item.text}</p></div>:item.kind==='DISCUSSION'&&item.text.startsWith('진행자: ')?<div className="bubble moderator" key={item.id}><div className="bubble-heading"><b>진행자</b></div><p>{item.text.slice(5)}</p></div>:<div className={`table-event ${item.kind.toLowerCase()}`} key={item.id}><span className="event-mark">{item.kind==='QUEST_RESULT'?'◆':item.kind==='VOTE_RESULT'?'✓':'◇'}</span><p>{item.text}</p></div>)}</div>
        {actions}
        <div className="composer">{replying&&<div className="reply-context"><span>{name(replying.actor)}에게 답하기 · {replying.text}</span><button className="textbutton" onClick={()=>setReplyTo(null)} aria-label="답하기 취소">×</button></div>}<form onSubmit={e=>{e.preventDefault();if(message.trim())act({type:'CHAT',text:message.trim(),replyTo});}}><label htmlFor="msg" className="sr">채팅 메시지</label><input id="msg" maxLength={280} value={message} onChange={e=>setMessage(e.target.value)} placeholder={replying?`${name(replying.actor)}에게 질문하거나 답하세요…`:'팀 의견이나 의심의 근거를 나눠보세요…'} disabled={(game.paused&&game.pauseSource!=='reading')||game.phase==='ENDED'}/><button disabled={(game.paused&&game.pauseSource!=='reading')||!message.trim()||game.phase==='ENDED'} aria-label="보내기">↑</button></form><small className="chatnote">{mode==='practice'?'연습 AI':'Gemini AI'} · {game.routingMode==='jev'?'JEV 적용':'기존 방식'} · 대화는 저장됩니다</small></div>
      </section>
    </section>
    <section className="card history"><button onClick={()=>setHistory(!history)} aria-expanded={history}>전체 원정 기록 <span>{history?'접기 −':'보기 +'}</span></button>{history&&<div className="records">{game.proposals.length===0&&<p>아직 제안이 없습니다.</p>}{game.proposals.map((p:any)=><div className="record" key={p.id}><b>{p.quest}번째 원정 · {p.attempt}번째 제안</b><p>{name(p.leader)} → {p.team.map(name).join(', ')}</p><small>{p.status==='DRAFT'?'토론 중 · 팀 초안':p.status==='VOTING'?'비밀 투표 중':`${p.status==='APPROVED'?'승인':'부결'} · 찬성 ${p.approveCount}명`}</small>{p.votes&&<p>{p.votes.map((v:any)=>`${name(v.actor)} ${v.choice==='APPROVE'?'찬성':'반대'}`).join(' · ')}</p>}</div>)}{game.quests.map((q:any)=><div className="record" key={q.id}><b>{q.id.replace('quest-','')}번째 원정 {q.result==='SUCCESS'?'성공':'실패'}</b><p>{q.team.map(name).join(' · ')} · 실패 카드 {q.fails}장</p></div>)}</div>}</section>
  </>}
  <Dialog open={!!popup} onOpenChange={open=>{if(!open)closePopup();}}>
    {popup&&<DialogContent showCloseButton={false} className={`avalon-result-popup ${popup.tone}`} onCloseAutoFocus={event=>{event.preventDefault();popupReturnRef.current?.focus({preventScroll:true});}}>
      <span className="eyebrow">QUEST {popup.quest} · 제안 {popup.attempt}</span>
      <div className={`result-emblem ${popup.emblem}`} aria-hidden="true"><svg viewBox="0 0 120 120" fill="none"><circle cx="60" cy="60" r="48"/>{popup.emblem==='team'?<path d="M42 87V31m0 2h38l-8 15 8 14H42"/>:popup.emblem==='success'||popup.emblem==='failure'?<><path d="M60 24 87 35v26c0 19-15 29-27 36-12-7-27-17-27-36V35Z"/>{popup.emblem==='success'?<path className="success-check" d="m46 59 10 10 20-24"/>:<path d="m47 46 26 27m0-27L47 73"/>}</>:popup.emblem==='approved'?<path d="m37 61 16 16 30-34"/>:<path d="m42 42 36 36m0-36L42 78"/>}<path className="result-spark" d="m99 18 2 5 5 2-5 2-2 5-2-5-5-2 5-2Z"/></svg></div>
      <DialogTitle>{popup.title}</DialogTitle>
      <DialogDescription>{popup.description}</DialogDescription>
      <div className="popup-roster"><h3>{popup.kind==='TEAM'?`${popup.leader}의 원정 팀`:'이번 원정 멤버'} <span>{popup.players.length}명</span></h3><div className="popup-members">{popup.players.map((p:any)=><div className="popup-member" key={p.id}><span className={`popup-avatar ${p.id}`}>{p.name.slice(0,1)}</span><strong>{p.name}</strong><small>{p.id==='human'?'당신':'AI'}</small></div>)}</div></div>
      {popup.kind==='VOTE_RESULT'&&<div className="popup-votes"><p><b>찬성 {popup.approve}</b><span>반대 {popup.reject}</span></p><div>{popup.votes.map((v:any)=><span key={v.id} className={v.choice==='APPROVE'?'approve':'reject'}><strong>{v.name}</strong>{v.choice==='APPROVE'?'찬성':'반대'}</span>)}</div></div>}
      {popup.kind==='QUEST_RESULT'&&<div className="popup-card-result"><span>실패 카드</span><strong>{popup.fails}<small>장</small></strong><p>개별 카드의 주인은 공개되지 않습니다.</p></div>}
      <DialogClose asChild><button className="primary popup-confirm">확인 · 대화로 돌아가기</button></DialogClose>
    </DialogContent>}
  </Dialog>
  {(busy||aiBusy||(aiTurn&&!error&&!popup))&&<div className="progress" role="status" aria-live="polite"><span className="spinner" aria-hidden="true"/>{busy?progress:aiBusy?'AI가 생각하고 있습니다…':'AI 차례를 준비하고 있습니다…'}</div>}{notice&&<div className="error" role="status">{notice} <button onClick={()=>setNotice('')}>닫기</button></div>}{error&&<div className="error" role="alert">{error} <button onClick={()=>setError('')}>다시 시도</button></div>}<footer>AVALON · 다섯 명의 비밀 원정</footer></main>;
}
