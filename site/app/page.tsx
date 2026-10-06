'use client';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {manualNextStep} from '../lib/conversation.mjs';
import {resultPopup,questHistoryPopup} from '../lib/result-popup.mjs';
import {ROLE_GUIDES,roleGuide,privateRoleKnowledge,roleInteractions} from '../lib/role-guide.mjs';
import {Dialog,DialogContent,DialogTitle,DialogDescription,DialogClose} from '../components/ui/dialog';
import {Select,SelectTrigger,SelectValue,SelectContent,SelectItem} from '../components/ui/select';

const roleNames: Record<string,string> = { MERLIN:'멀린', LOYAL:'충신', ASSASSIN:'암살자', MINION:'악의 하수인' };
const phaseNames: Record<string,string> = { ROLE_REVEAL:'역할 확인', PROPOSE:'팀 초안 선정', TEAM_DISCUSSION:'원탁 토론', VOTE:'찬반 투표', VOTE_RESULT:'투표 결과', QUEST:'임무 카드', QUEST_RESULT:'원정 결과', ASSASSINATE:'암살', ENDED:'게임 종료' };
const progressLabels: Record<string,string> = { NEW:'새 게임을 준비하고 있습니다…', START:'게임을 시작하고 있습니다…', CHAT:'메시지를 보내고 있습니다…', PROPOSE:'팀 초안을 공유하고 있습니다…', START_VOTE:'투표를 시작하고 있습니다…', REQUEST_REVISION:'팀 재검토를 요청하고 있습니다…', VOTE:'투표를 저장하고 있습니다…', CARD:'임무 카드를 제출하고 있습니다…', CONTINUE:'다음 단계로 이동하고 있습니다…', ASSASSINATE:'암살 대상을 확인하고 있습니다…', PAUSE:'일시정지 중입니다…', RESUME:'게임을 재개하고 있습니다…', ADVANCE:'AI가 생각하고 있습니다…' };

function RoleDetails({guide,knowledge}:{guide:any,knowledge?:string}) {
  return <div className="role-details">
    <p className="role-summary">{guide.summary}</p>
    <dl><dt>승리 조건</dt><dd>{guide.win}</dd><dt>역할과 능력</dt><dd>{guide.ability}</dd>{knowledge&&<><dt>나만 아는 시작 정보</dt><dd className="private-knowledge">{knowledge}</dd></>}<dt>원정에서</dt><dd>{guide.quest}</dd></dl>
    {guide.notes.length>0&&<ul className="role-notes">{guide.notes.map((note:string)=><li key={note}>{note}</li>)}</ul>}
  </div>;
}

export default function Home() {
  const [game,setGame] = useState<any>(null);
  const [mode,setMode] = useState('practice');
  const [nextRouting,setNextRouting] = useState('baseline');
  const [nextAction,setNextAction] = useState('gemini');
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
  const [rolePanel,setRolePanel] = useState<'mine'|'roles'|null>(null);
  const roleTriggerRef=useRef<HTMLElement|null>(null);
  const [replyTo,setReplyTo] = useState<string|null>(null);
  const [popup,setPopup] = useState<any>(null);
  const [guessOpen,setGuessOpen] = useState(false);
  const [guesses,setGuesses] = useState<Record<string,string>>({});
  const viewedPopups=useRef(new Set<string>());
  const popupReturnRef=useRef<HTMLElement|null>(null);
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
    if(input.type==='NEW'){setRolePanel(null);setMessage('');setGuesses({});setGuessOpen(false);input={...input,routingMode:nextRouting,actionMode:nextAction};chatAtBottom.current=true;setReplyTo(null);}
    aiEpochRef.current++;
    // Let the server finish its ledger and release the lease; epochs discard stale UI replies.
    aiControllerRef.current=null;setAiBusy(false);
    if(input.type==='VOTE') setQueuedVote(true);
    if(input.type==='CHAT'){setMessage('');setReplyTo(null);}
    queueRef.current.push(input);setError('');
    void drainQueue();
  }
  useEffect(()=>{fetch('/api/game').then(r=>r.json()).then((d:any)=>{showGame(d.game);setMode(d.aiMode);setRoutingReady(!!d.routingReady);setNextRouting(d.routingReady?'jev':'baseline');setNextAction(d.routingReady?'jev':'gemini');if(d.error)setError(d.error);}).catch(()=>setError('게임을 불러오지 못했습니다.')).finally(()=>setLoading(false));},[]);
  const popupCandidate=resultPopup(game);
  const roleIntro=game?.phase==='ROLE_REVEAL';
  const mine=game?roleGuide(game.role,game.roleCounts):null;
  const roleCounts=game?.roleCounts??{};
  function showRolePanel(panel:'mine'|'roles',trigger:HTMLElement){roleTriggerRef.current=trigger;setRolePanel(panel);}
  function roleReturnFocus(event:Event){event.preventDefault();const trigger=roleTriggerRef.current;if(trigger?.isConnected)trigger.focus({preventScroll:true});else document.getElementById('game-phase')?.focus({preventScroll:true});}

  function openPopup(value:any,trigger?:HTMLElement){
    popupReturnRef.current=trigger??(document.activeElement instanceof HTMLElement?document.activeElement:null);
    setPopup(value);
  }
  useEffect(()=>{
    if(rolePanel)return;
    if(popup?.history&&popup.gameId===game?.id)return;
    if(!popupCandidate){setPopup(null);return;}
    let viewed=viewedPopups.current.has(popupCandidate.key);
    try{viewed ||= JSON.parse(sessionStorage.getItem(`avalon-popup:${game.id}`)??'[]').includes(popupCandidate.key);}catch{}
    if(!viewed)openPopup(popupCandidate);
  },[game?.id,popupCandidate?.key,popup?.history,rolePanel]);
  function closePopup(){
    if(popup&&!popup.history){
      viewedPopups.current.add(popup.key);
      try{const key=`avalon-popup:${game.id}`,seen=JSON.parse(sessionStorage.getItem(key)??'[]');sessionStorage.setItem(key,JSON.stringify([...new Set([...seen,popup.key])].slice(-30)));}catch{}
    }
    setPopup(null);
  }
  const guessPending=!!game?.roleGuess?.pending;
  useEffect(()=>{
    if(!guessPending){setGuessOpen(false);return;}
    if(popup||rolePanel)return;
    const candidate=resultPopup(game);
    let viewed=!candidate||viewedPopups.current.has(candidate.key);
    try{viewed ||= JSON.parse(sessionStorage.getItem(`avalon-popup:${game.id}`)??'[]').includes(candidate?.key);}catch{}
    if(viewed)setGuessOpen(true);
  },[game?.id,guessPending,popup?.key,rolePanel]);
  useEffect(()=>{setGuesses({});},[game?.id]);
  const aiTurn=game?.aiPending;
  useEffect(()=>{
    if(!game||popup||rolePanel||roleIntro||guessPending||busy||aiBusy||error||message.trim()||(!aiTurn&&!game.idleDueAt))return;
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
  },[game?.version,busy,aiBusy,error,aiTurn,game?.idleDueAt,message,popup?.key,guessPending,rolePanel,roleIntro]);
  useLayoutEffect(()=>{const el=messagesRef.current;if(el&&chatAtBottom.current)el.scrollTop=el.scrollHeight;},[game?.id,game?.messages?.length,game?.publicEvents?.length]);
  useEffect(()=>{setTeam(game?.leader==='human' ? game.team ?? [] : []);},[game?.id,game?.leader,game?.attempt,game?.team?.join(',')]);
  const toggle=(id:string)=>setTeam(v=>v.includes(id)?v.filter(x=>x!==id):v.length<game.size?[...v,id]:v);
  const voteResult=game?.phase==='VOTE_RESULT'?game.proposals.at(-1):null;
  const questResult=game?.phase==='QUEST_RESULT'?game.quests.at(-1):null;
  const replying=game?.messages.find((m:any)=>m.id===replyTo);
  const timeline=game ? [...game.messages.map((m:any)=>({...m,kind:'MESSAGE'})),...(game.publicEvents??[])].sort((a:any,b:any)=>a.at.localeCompare(b.at)||(a.version??0)-(b.version??0)) : [];
  const teamChanged=game?.team && (team.length!==game.team.length || team.some(id=>!game.team.includes(id)));
  const canEdit=game?.leader==='human' && ['PROPOSE','TEAM_DISCUSSION'].includes(game.phase);
  const step=['PROPOSE','TEAM_DISCUSSION'].includes(game?.phase)?0:['VOTE','VOTE_RESULT'].includes(game?.phase)?1:2;
  const nextStep=game?manualNextStep(game,{busy,aiBusy,draft:!!message.trim(),teamChanged:!!(canEdit&&teamChanged)}):{type:null,label:'다음 단계 →',reason:null,disabled:true};
  const displayedTeam=canEdit?team:(game?.team??[]);
  const playing=game&&game.phase!=='ROLE_REVEAL';
  const historyPopups=game?game.quests.map((q:any)=>questHistoryPopup(game,q.id)):[];
  const actions=game&&<div className="decision-area">
    {canEdit&&<div className="team-editor"><p>원탁에서 {game.size}명을 선택하세요. <b>{team.length} / {game.size}명</b></p><button className="primary" disabled={game.paused||busy||team.length!==game.size||(game.phase==='TEAM_DISCUSSION'&&!teamChanged)} onClick={()=>act({type:'PROPOSE',team})}>{game.phase==='PROPOSE'?'팀 초안 공유':'수정한 팀 공유'}</button></div>}
    {game.phase==='PROPOSE'&&game.leader!=='human'&&<p className="waiting">{name(game.leader)}님이 팀 초안을 고르고 있습니다.</p>}
    {game.phase==='TEAM_DISCUSSION'&&game.leader!=='human'&&<button className="outline" disabled={game.paused||busy||aiBusy||aiTurn||game.revisionRequested} onClick={()=>act({type:'REQUEST_REVISION'})}>리더에게 팀 재검토 요청</button>}
    {game.phase==='VOTE'&&<div><p>팀에 찬반을 선택하세요. 전원의 표는 동시에 공개됩니다.</p>{!game.voted?<div className="choices"><button className="primary" disabled={game.paused||queuedVote||busy} onClick={()=>act({type:'VOTE',choice:'APPROVE'})}>찬성</button><button className="outline" disabled={game.paused||queuedVote||busy} onClick={()=>act({type:'VOTE',choice:'REJECT'})}>반대</button></div>:<p className="waiting">내 표를 제출했습니다. 다른 참가자의 표를 기다립니다.</p>}</div>}
    {voteResult&&<div className="inline-result"><h3>원정팀 {voteResult.status==='APPROVED'?'승인':'부결'}</h3><p>찬성 {voteResult.approveCount} · 반대 {game.ids.length-voteResult.approveCount}</p></div>}
    {game.phase==='QUEST'&&<div><h3>원정 성공 여부 투표</h3><p>개별 선택은 공개되지 않습니다.</p>{game.team.includes('human')&&!game.cardSubmitted?<div className="choices"><button className="primary" disabled={game.paused||busy} onClick={()=>act({type:'CARD',choice:'SUCCESS'})}>성공</button>{['ASSASSIN','MINION'].includes(game.role)&&<button className="outline danger" disabled={game.paused||busy} onClick={()=>act({type:'CARD',choice:'FAIL'})}>실패</button>}</div>:<p className="waiting">원정팀의 성공 여부 투표를 기다립니다.</p>}</div>}
    {questResult&&<div className="inline-result"><h3 className={questResult.result==='SUCCESS'?'good':'bad'}>원정 {questResult.result==='SUCCESS'?'성공':'실패'}</h3><p>{questResult.team.map(name).join(' · ')} · 실패 카드 {questResult.fails}장</p></div>}
    {game.phase==='ASSASSINATE'&&<div><h3>마지막 선택, 멀린 암살</h3><p>암살자가 멀린을 맞히면 악이 승리합니다.</p>{game.role==='ASSASSIN'?<div className="choices">{game.ids.filter((id:string)=>id!=='human').map((id:string)=><button className="outline" key={id} disabled={game.paused||busy} onClick={()=>act({type:'ASSASSINATE',target:id})}>{name(id)} 지목</button>)}</div>:<p className="waiting">암살자의 선택을 기다립니다.</p>}</div>}
    {game.phase==='ENDED'&&<div className="outcome"><h2>{game.winner==='GOOD'?'선의 승리':'악의 승리'}</h2><p>{game.assassination?`암살 대상: ${name(game.assassination)}`:'임무와 투표 결과로 게임이 끝났습니다.'}</p><div className="revealed">{game.ids.map((id:string)=><span key={id}>{name(id)} · {roleNames[game.roles[id]]}</span>)}</div><a className="outline" href="/api/game?export=1" download={`avalon-${game.id}.json`}>게임 기록 다운로드</a></div>}
    {guessPending&&<button className="primary guess-reopen" disabled={busy||game.paused} onClick={()=>setGuessOpen(true)}>플레이어 역할 맞히기</button>}
    {game.phase==='ENDED'&&game.roleGuess&&<div className="guess-summary"><h3>역할 추측 · {game.roleGuess.correct} / {game.roleGuess.total}명 정답</h3><div>{Object.entries(game.roleGuess.guesses).map(([id,role])=><p key={id}><b>{name(id)}</b><span>{roleNames[String(role)]} → {roleNames[game.roles[id]]}</span><strong className={game.roleGuess.matches[id]?'good':'bad'}>{game.roleGuess.matches[id]?'정답':'오답'}</strong></p>)}</div></div>}
    {nextStep.type&&<div className="decision-reading"><button className="primary" disabled={nextStep.disabled} aria-describedby="next-stage-status" onClick={()=>act({type:nextStep.type})}>{nextStep.label}</button><small id="next-stage-status" role="status">{nextStep.reason??'의견을 더 나누거나 다음 단계로 이동하세요.'}</small></div>}
    {popupCandidate&&<button className="textbutton popup-reopen" onClick={event=>openPopup(popupCandidate,event.currentTarget)}>{popupCandidate.kind==='TEAM'?'팀 명단 자세히 보기':'결과 자세히 보기'} ↗</button>}
  </div>;
  return <main className={`shell ${playing?'in-game':''}`}>
    <header className="top"><div className="brand"><span className="sigil">♜</span><div><strong>AVALON</strong></div></div><div className="top-actions"><button className="outline" disabled={busy||!game||game.phase==='ENDED'} onClick={()=>act({type:game.paused?'RESUME':'PAUSE'})}>{game?.paused?'계속하기':'일시정지'}</button><button className="outline" disabled={busy} onClick={()=>{if(!game||confirm('현재 게임 기록을 자동 보관하고 새 게임을 시작할까요?')){act({type:'NEW'});}}}>새 게임</button>
      <details className="game-settings"><summary>설정</summary><div className="settings-content">
        {!loading&&<section className="routing-picker" aria-label="새 게임의 AI 방식"><label htmlFor="routing-mode">발언자 선택</label><select id="routing-mode" value={nextRouting} disabled={busy} onChange={e=>setNextRouting(e.target.value)}><option value="baseline">기존 규칙</option><option value="jev" disabled={!routingReady}>JEV 진행자</option></select><label htmlFor="action-mode">행동 선택</label><select id="action-mode" value={nextAction} disabled={busy} onChange={e=>setNextAction(e.target.value)}><option value="gemini">Gemini · 기존 방식</option><option value="jev" disabled={!routingReady}>JEV · 직접 선택</option></select><p>대화는 Gemini가 맡습니다. 다음 새 게임에 적용됩니다.{!routingReady&&' JEV 연결 준비 중입니다.'}</p></section>}
        {game?.usage&&<details className="usage-panel"><summary>이번 판 추정 비용 · {'$'+game.usage.costUsd.toFixed(6)}</summary><p>실제 API 응답 사용량 기준 · USD</p><table><thead><tr><th>모델</th><th>호출</th><th>입력</th><th>응답 / 추론</th><th>비용</th></tr></thead><tbody>{['gemini','jev'].map(provider=>{const u=game.usage.providers[provider];return <tr key={provider}><td>{provider==='gemini'?'Gemini':'JEV'}</td><td>{u.calls}</td><td>{u.input.toLocaleString()}</td><td>{u.output.toLocaleString()} / {u.thoughts.toLocaleString()}</td><td>{'$'+u.costUsd.toFixed(6)}</td></tr>;})}</tbody></table><small>일반 Global 단가 추정입니다. 재시도·폐기된 응답 포함, 중계·호스팅 비용 제외. 실제 청구액과 다를 수 있습니다.{game.usage.unknownCalls>0&&` 사용량 미확인 ${game.usage.unknownCalls}회는 미반영.`}{game.usage.legacyIncomplete&&' 기록 시작 전 사용량은 미포함.'}</small></details>}
        {game&&<a className="textbutton" href="/api/game?diagnostics=1" download={`avalon-diagnostics-${game.id}.json`}>진단 로그 다운로드</a>}
      </div></details>
    </div></header>
    {loading?<p>불러오는 중…</p>:!game?<section className="card welcome"><div className="crest">♜</div><p className="eyebrow">THE RESISTANCE · AVALON</p><h1>누구와 원정을 떠나시겠습니까?</h1><p>당신과 네 명의 AI가 원탁에 앉습니다. 팀을 제안하고, 서로의 근거를 묻고, 토론을 마치면 투표하세요.</p><button className="primary" disabled={busy} onClick={()=>act({type:'NEW'})}>원탁에 앉기 →</button></section>:game.paused&&!game.conversationVersion?<section className="card welcome pause-screen"><div className="crest">Ⅱ</div><h1>잠시 쉬어갑니다</h1><p>대화와 진행 상황은 저장되어 있습니다.</p><button className="primary" disabled={busy} onClick={()=>act({type:'RESUME'})}>원탁으로 돌아가기 →</button></section>:roleIntro?<section className="card welcome role-intro"><div className="crest">♜</div><h1>배정된 역할을 확인하세요</h1><p>역할과 승리 조건을 확인하면 게임을 시작합니다.</p></section>:<>
      <div className="status"><div><span className="eyebrow">QUEST {Math.min(game.quest,5)} / 5 · 제안 {game.attempt} / 5</span><h1 id="game-phase" tabIndex={-1}>{phaseNames[game.phase]}</h1></div><p>{game.paused?'게임이 일시정지되어 있습니다.':canEdit?`원정에 보낼 ${game.size}명을 선택하세요.`:`리더 ${name(game.leader)} · 원정팀 ${game.size}명`}</p></div>
      <nav className="quest-track" aria-label="원정 진행 및 기록">{[0,1,2,3,4].map(i=>{const completed=game.quests[i],detail=historyPopups[i];return <button key={i} className={`quest-dot ${completed?.result?.toLowerCase()??''} ${game.quest===i+1?'current':''}`} disabled={!detail} aria-label={`${i+1}번째 원정 ${completed?(completed.result==='SUCCESS'?'성공':'실패'):'미완료'}${detail?' · 기록 보기':''}`} onClick={event=>openPopup(detail,event.currentTarget)}><span>{['Ⅰ','Ⅱ','Ⅲ','Ⅳ','Ⅴ'][i]}</span><div><b>{completed?completed.result==='SUCCESS'?'성공':'실패':game.quest===i+1?'진행 중':`${i+1}번째 원정`}</b><small>{completed?`실패 ${completed.fails}장 · 기록 ↗`:`${[2,3,2,3,3][i]}명 원정`}</small></div></button>;})}</nav>
      <section className="roundtable">
        <aside className="game-controls" aria-label="플레이어와 게임 행동">
          <div className="roundtable-top"><div className="phase-steps" aria-label="이번 원정 흐름">{['팀 토론','찬반 투표','원정 결과'].map((label,i)=><span key={label} className={step===i?'active':''}>{i+1} · {label}</span>)}</div><div className="role-buttons"><button className="role-check" aria-haspopup="dialog" onClick={event=>showRolePanel('mine',event.currentTarget)}>♜ 내 역할 확인</button><button className="role-list-button" aria-haspopup="dialog" onClick={event=>showRolePanel('roles',event.currentTarget)}>이번 판 역할들</button></div></div>
          <div className="board-table">
            <div className="table-surface" aria-hidden="true"/>
            <div className="team-context"><span className="eyebrow">{canEdit?'원정대 구성':game.phase==='TEAM_DISCUSSION'?'현재 팀 초안':'현재 원정팀'}</span><strong>{displayedTeam.length}<small> / {game.size}</small></strong><p>{displayedTeam.length?displayedTeam.map(name).join(' · '):`${name(game.leader)}의 팀 제안 대기`}</p>{canEdit&&<span className="selection-hint">참가자를 눌러 선택 · 해제</span>}</div>
            <div className="players">{game.ids.map((id:string,index:number)=>{const selected=displayedTeam.includes(id),leader=id===game.leader&&game.phase!=='ENDED';return <button type="button" className={`player seat-${index} ${selected?'selected':''} ${leader?'leader':''}`} key={id} disabled={!canEdit||game.paused||busy||(!selected&&team.length>=game.size)} aria-pressed={selected} aria-label={`${name(id)}${leader?' 리더':''}${selected?' 원정대 선택됨':''}${canEdit?' · 팀 선택':''}`} onClick={()=>toggle(id)}><span className="avatar">{name(id).slice(0,1)}</span><b>{name(id)} {leader&&<span className="crown" aria-label="현재 리더">♛</span>}</b><small>{selected?'원정대 ✓':id==='human'?'당신':leader?'리더':'참가자'}</small>{voteResult&&<span className={`player-vote ${voteResult.votes.find((v:any)=>v.actor===id)?.choice==='APPROVE'?'approve':'reject'}`}>{voteResult.votes.find((v:any)=>v.actor===id)?.choice==='APPROVE'?'찬성':'반대'}</span>}</button>;})}</div>
          </div>
          {actions}
        </aside>
        <section className="conversation" aria-label="채팅 내역"><div className="chathead"><h2>채팅 내역</h2><small role="status">{aiBusy?'발언 준비 중…':aiTurn?'다음 발언 대기…':game.phase==='ENDED'?'대화 종료':'질문 · 반론 · 설득'}</small></div>
          <div className="messages" ref={messagesRef} onScroll={e=>{const el=e.currentTarget;chatAtBottom.current=el.scrollHeight-el.scrollTop-el.clientHeight<32;}}>{timeline.length===0&&<p className="empty">어떤 팀으로 시작할까요?<br/>참가자에게 이유를 물어보세요.</p>}{timeline.map((item:any)=>item.kind==='MESSAGE'?<div className={`bubble ${item.actor==='human'?'mine':''}`} key={item.id}><div className="bubble-heading"><b>{name(item.actor)}</b>{game.phase!=='ENDED'&&<button className="reply-button" onClick={()=>{setReplyTo(item.id);document.getElementById('msg')?.focus();}} aria-label={`${name(item.actor)}의 ${item.id} 발언에 답하기`}>답하기 ↩</button>}</div>{item.replyTo&&<div className="quoted">↳ {name(game.messages.find((m:any)=>m.id===item.replyTo)?.actor)}: {game.messages.find((m:any)=>m.id===item.replyTo)?.text}</div>}<p>{item.text}</p></div>:item.kind==='DISCUSSION'&&item.text.startsWith('진행자: ')?<div className="bubble moderator" key={item.id}><div className="bubble-heading"><b>진행자</b></div><p>{item.text.slice(5)}</p></div>:<div className={`table-event ${item.kind.toLowerCase()}`} key={item.id}><span className="event-mark">{item.kind==='QUEST_RESULT'?'◆':item.kind==='VOTE_RESULT'?'✓':'◇'}</span><p>{item.text}</p></div>)}</div>
          <div className="composer">{replying&&<div className="reply-context"><span>{name(replying.actor)}에게 답하기 · {replying.text}</span><button className="textbutton" onClick={()=>setReplyTo(null)} aria-label="답하기 취소">×</button></div>}<form onSubmit={e=>{e.preventDefault();if(message.trim())act({type:'CHAT',text:message.trim(),replyTo});}}><label htmlFor="msg" className="sr">채팅 메시지</label><input id="msg" maxLength={280} value={message} onChange={e=>setMessage(e.target.value)} placeholder={replying?`${name(replying.actor)}에게 질문하거나 답하세요…`:'의견이나 의심의 근거를 남기세요…'} disabled={(game.paused&&game.pauseSource!=='reading')||game.phase==='ENDED'}/><button disabled={(game.paused&&game.pauseSource!=='reading')||!message.trim()||game.phase==='ENDED'} aria-label="보내기">↑</button></form><small className="chatnote">{mode==='practice'?'연습 AI':'Gemini AI'} · {game.routingMode==='jev'?'JEV 적용':'기존 방식'} · 대화와 공개 기록이 저장됩니다</small></div>
        </section>
      </section>
    </>}
    <Dialog open={!!mine&&(rolePanel==='mine'||(roleIntro&&rolePanel!=='roles'))} onOpenChange={open=>{if(!open&&!roleIntro)setRolePanel(null);}}>
      {mine&&<DialogContent showCloseButton={false} className={`avalon-result-popup role-info-popup ${mine.side==='GOOD'?'good-role':'evil-role'}`} onCloseAutoFocus={roleReturnFocus}>
        <span className="eyebrow">나만 볼 수 있는 정보 · {mine.side==='GOOD'?'선':'악'} 진영</span>
        <DialogTitle>당신은 {mine.name}입니다</DialogTitle><DialogDescription>역할과 승리 조건을 확인하세요.</DialogDescription>
        <RoleDetails guide={mine} knowledge={privateRoleKnowledge(game)}/>
        {roleIntro?<><button className="role-list-button intro-role-list" onClick={event=>showRolePanel('roles',event.currentTarget)}>이번 판 역할들</button><button className="primary popup-confirm" disabled={busy} onClick={()=>{setRolePanel(null);act({type:'START'});}}>확인하고 게임 시작 →</button></>:<DialogClose asChild><button className="primary popup-confirm">확인하고 닫기</button></DialogClose>}
      </DialogContent>}
    </Dialog>
    <Dialog open={rolePanel==='roles'} onOpenChange={open=>{if(!open)setRolePanel(roleIntro?'mine':null);}}>
      <DialogContent showCloseButton={false} className="avalon-result-popup role-info-popup public-roles-popup" onCloseAutoFocus={roleReturnFocus}>
        <span className="eyebrow">공개 정보</span><DialogTitle>이번 판 역할들</DialogTitle><DialogDescription>역할을 눌러 규칙을 펼쳐보세요. 누가 어떤 역할인지는 공개되지 않습니다.</DialogDescription>
        {roleInteractions(roleCounts).length>0&&<div className="role-combinations"><h3>이번 판에서 달라지는 점</h3><ul>{roleInteractions(roleCounts).map((note:string)=><li key={note}>{note}</li>)}</ul></div>}
        {['GOOD','EVIL'].map(side=>{const roles=Object.entries(roleCounts).filter(([role,count])=>Number(count)>0&&ROLE_GUIDES[role as keyof typeof ROLE_GUIDES]?.side===side);return <section className="role-side" key={side}><h3>{side==='GOOD'?'선':'악'} 진영 · {roles.reduce((sum,[,count])=>sum+Number(count),0)}명</h3>{roles.map(([role,count])=><details className="role-entry" key={role}><summary><span>{ROLE_GUIDES[role as keyof typeof ROLE_GUIDES].name}</span><span>{Number(count)}명 <span aria-hidden="true">⌄</span></span></summary><RoleDetails guide={roleGuide(role,roleCounts)}/></details>)}</section>;})}
        <DialogClose asChild><button className="primary popup-confirm">{roleIntro?'내 역할로 돌아가기':'확인하고 닫기'}</button></DialogClose>
      </DialogContent>
    </Dialog>
    <Dialog open={guessOpen&&guessPending} onOpenChange={setGuessOpen}>
      <DialogContent showCloseButton={false} className="avalon-result-popup role-guess-popup">
        <span className="eyebrow">정체 공개 전 · 마지막 추측</span>
        <DialogTitle>누가 어떤 역할이었을까요?</DialogTitle>
        <DialogDescription>지금까지의 대화와 원정 결과로 네 사람의 역할을 맞혀보세요. 제출은 한 번만 가능하며 정답과 점수는 게임이 끝난 뒤 공개됩니다.</DialogDescription>
        <p className="guess-role-counts">멀린 1 · 충신 2 · 암살자 1 · 악의 하수인 1<br/>내 역할: {roleNames[game?.role]} · 채점에서 제외</p>
        <form onSubmit={event=>{event.preventDefault();act({type:'ROLE_GUESS',guesses});}}>
          <div className="guess-players">{game?.ids.filter((id:string)=>id!=='human').map((id:string)=><div className="guess-player" key={id}><span className={`popup-avatar ${id}`}>{name(id).slice(0,1)}</span><label id={`guess-label-${id}`} htmlFor={`guess-${id}`}>{name(id)}</label><Select value={guesses[id]??''} disabled={busy||game.paused} onValueChange={value=>setGuesses(current=>({...current,[id]:value}))}><SelectTrigger id={`guess-${id}`} aria-labelledby={`guess-label-${id}`} className="guess-select"><SelectValue placeholder="역할 선택"/></SelectTrigger><SelectContent className="guess-options">{Object.entries(roleNames).map(([role,label])=><SelectItem key={role} value={role}>{label}</SelectItem>)}</SelectContent></Select></div>)}</div>
          {error&&<p className="guess-error" role="alert">{error}</p>}
          <button className="primary popup-confirm" type="submit" disabled={busy||game?.paused||game?.ids.filter((id:string)=>id!=='human').some((id:string)=>!guesses[id])}>{busy?'추측 저장 중…':'추측 제출'}</button>
        </form>
        <button className="textbutton" disabled={busy} onClick={()=>setGuessOpen(false)}>기록을 보며 더 생각하기</button>
      </DialogContent>
    </Dialog>
    <Dialog open={!!popup} onOpenChange={open=>{if(!open)closePopup();}}>
      {popup&&<DialogContent showCloseButton={false} className={`avalon-result-popup ${popup.tone} ${popup.history?'quest-history-popup':''}`} onCloseAutoFocus={event=>{event.preventDefault();const trigger=popupReturnRef.current;if(trigger?.isConnected&&!trigger.hasAttribute('disabled'))trigger.focus({preventScroll:true});else document.getElementById('game-phase')?.focus({preventScroll:true});}}>
        <span className="eyebrow">{popup.history?'원정 기록 · ':''}QUEST {popup.quest} · 제안 {popup.attempt}</span>
        <div className={`result-emblem ${popup.emblem}`} aria-hidden="true"><svg viewBox="0 0 120 120" fill="none"><circle cx="60" cy="60" r="48"/>{popup.emblem==='team'?<path d="M42 87V31m0 2h38l-8 15 8 14H42"/>:popup.emblem==='success'||popup.emblem==='failure'?<><path d="M60 24 87 35v26c0 19-15 29-27 36-12-7-27-17-27-36V35Z"/>{popup.emblem==='success'?<path className="success-check" d="m46 59 10 10 20-24"/>:<path d="m47 46 26 27m0-27L47 73"/>}</>:popup.emblem==='approved'?<path d="m37 61 16 16 30-34"/>:<path d="m42 42 36 36m0-36L42 78"/>}</svg></div>
        <DialogTitle>{popup.title}</DialogTitle><DialogDescription>{popup.description}</DialogDescription>
        <div className="popup-roster"><h3>{popup.leader?`${popup.leader}의 원정 팀`:'이번 원정 멤버'} <span>{popup.players.length}명</span></h3><div className="popup-members">{popup.players.map((p:any)=><div className="popup-member" key={p.id}><span className={`popup-avatar ${p.id}`}>{p.name.slice(0,1)}</span><strong>{p.name}</strong><small>{p.id==='human'?'당신':'참가자'}</small></div>)}</div></div>
        {popup.votes&&<div className="popup-votes"><p><b>찬성 {popup.approve}</b><span>반대 {popup.reject}</span></p><div>{popup.votes.map((v:any)=><span key={v.id} className={v.choice==='APPROVE'?'approve':'reject'}><strong>{v.name}</strong>{v.choice==='APPROVE'?'찬성':'반대'}</span>)}</div></div>}
        {['QUEST_RESULT','QUEST_HISTORY'].includes(popup.kind)&&<div className="popup-card-result"><span>실패 카드</span><strong>{popup.fails}<small>장</small></strong><p>개별 카드의 주인은 공개되지 않습니다.</p></div>}
        <DialogClose asChild><button className="primary popup-confirm">확인 · {popup.history?'게임으로':'대화로'} 돌아가기</button></DialogClose>
      </DialogContent>}
    </Dialog>
    {(busy||aiBusy||(aiTurn&&!error&&!popup&&!rolePanel&&!roleIntro))&&<div className="progress" role="status" aria-live="polite"><span className="spinner" aria-hidden="true"/>{busy?progress:aiBusy?'AI가 생각하고 있습니다…':'AI 차례를 준비하고 있습니다…'}</div>}{notice&&<div className="error" role="status">{notice} <button onClick={()=>setNotice('')}>닫기</button></div>}{error&&<div className="error" role="alert">{error} <button onClick={()=>setError('')}>다시 시도</button></div>}
  </main>;
}
