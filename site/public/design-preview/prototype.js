'use strict';
// Standalone design fixture: no game API, persistence, or model requests.
const people = [
  { name: '나', color: '#d2b67d', symbol: '♜', label: '당신', role: '충신' },
  { name: '하린', color: '#d2a08b', symbol: '♞', label: '참가자', role: '암살자' },
  { name: '도윤', color: '#9aaecb', symbol: '♝', label: '리더', role: '멀린' },
  { name: '서아', color: '#a4bb99', symbol: '❧', label: '참가자', role: '충신' },
  { name: '지호', color: '#b7a0bd', symbol: '♖', label: '참가자', role: '악의 하수인' },
];
const $ = id => document.getElementById(id);
const escapeText = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let state;
let toastTimer;
const names = team => team.map(i => people[i].name).join(' · ');
function initialMessages() {
  return [
    { event: '세 번째 원정 · 도윤이 나와 하린을 제안했습니다' },
    { actor: 2, text: '첫 원정을 성공시킨 두 명으로 다시 가보죠. 당신과 하린을 추천해요.' },
    { actor: 3, text: '성공했다고 둘 다 선인 건 아니에요. 하린은 실패한 두 번째 원정에도 있었잖아요.' },
    { actor: 1, text: '맞아. 하지만 그 원정엔 서아랑 지호도 있었어. 나만 빼야 할 다른 이유가 있어?' },
    { actor: 4, text: '서아는 하린 대신 누구를 넣고 싶은 거야? 대안도 같이 들어보자.' },
  ];
}
function setScene(scene) {
  state = { phase: scene, team: [0, 1], proposed: [0, 1], replyTo: null, inspected: null, attempt: 1, vote: 'APPROVE', messages: initialMessages(), resultNumber: 3 };
  $('chat-input').value = '';
  $('evidence-panel').classList.remove('open');
  render();
}
function render() {
  const late = ['assassination', 'ended'].includes(state.phase);
  const labels = { discussion: '누구와 함께 갈까요?', vote: '이 팀을 믿으시나요?', votes: '다섯 사람의 선택', quest: '당신의 카드를 내세요', result: '원정이 돌아왔습니다', assassination: '아직, 끝나지 않았습니다', ended: '원탁에 남은 진실' };
  $('chapter-label').textContent = late ? 'THE LAST CHOICE · 마지막 선택' : `QUEST 0${state.resultNumber} · ${state.attempt}번째 팀 제안`;
  $('scene-title').textContent = labels[state.phase];
  const questResults = late ? ['success', 'fail', 'success', 'success'] : state.phase === 'result' ? ['success', 'fail', 'success'] : ['success', 'fail'];
  $('quest-track').innerHTML = [0, 1, 2, 3, 4].map((i) => `<div class="quest-stop ${questResults[i] || ''} ${i === (late ? 3 : state.resultNumber - 1) ? 'current' : ''}"><button data-record="${i + 1}" aria-label="${i + 1}번째 원정 기록"><span>${questResults[i] === 'success' ? '✓' : questResults[i] === 'fail' ? '×' : i + 1}</span></button><span>${questResults[i] === 'success' ? '성공' : questResults[i] === 'fail' ? '실패' : [2,3,2,3,3][i] + '명'}</span></div>`).join('');
  $('scoreline').innerHTML = `<span class="score-good">원정 성공 <b>${late ? 3 : state.phase === 'result' ? 2 : 1}</b></span><span class="score-bad">실패 <b>1</b></span>`;
  document.querySelectorAll('[data-scene]').forEach(b => { const active = b.dataset.scene === state.phase || (b.dataset.scene === 'vote' && ['votes','quest'].includes(state.phase)) || (b.dataset.scene === 'assassination' && state.phase === 'ended'); b.classList.toggle('active',active); b.setAttribute('aria-pressed',String(active)); });
  $('seats').innerHTML = people.map((p, i) => `<button class="seat ${state.team.includes(i) ? 'in-team' : ''} ${state.inspected === i ? 'inspected' : ''}" style="--person:${p.color}" data-person="${i}" aria-label="${p.name} 공개 기록 보기" aria-pressed="${state.inspected === i}">${i === 2 && !late ? '<span class="leader-pin" aria-label="리더">♛</span>' : ''}<span class="portrait" aria-hidden="true">${p.symbol}</span><span><span class="seat-name">${p.name}</span><span class="seat-sub">${i === 0 ? '당신' : i === 2 && !late ? '리더' : '참가자'}</span></span>${state.team.includes(i) ? '<span class="team-tick" aria-label="원정팀">◆</span>' : ''}</button>`).join('');
  $('team-label').textContent = late ? '원정 성공 3회' : state.phase === 'discussion' ? '리더의 팀 초안' : '확정된 원정팀';
  $('team-members').textContent = late ? '멀린이 살아남으면 선의 승리' : names(state.team) + '  /  2명';
  $('suggest-button').hidden = state.phase !== 'discussion';
  $('conversation-hint').textContent = late ? '끝까지 정체를 지키세요' : '서로의 근거를 묻고, 판단을 나누세요';
  renderConversation(); renderDecision(); renderRecords(); renderReply();
  $('chat-input').disabled = state.phase === 'ended';
  document.querySelector('.send').disabled = state.phase === 'ended';
  $('chat-input').placeholder = state.phase === 'ended' ? '이번 판의 대화가 끝났습니다' : state.replyTo !== null ? `${people[state.replyTo].name}에게 질문하거나 답하세요…` : '누구의 말이 마음에 걸리나요?';
}
function messageHTML(m, index) {
  if (m.event) return `<div class="event">${escapeText(m.event)}</div>`;
  const p = people[m.actor];
  return `<article class="message ${m.actor === 0 ? 'mine' : ''}" style="--person:${p.color}"><span class="mini-avatar" aria-hidden="true">${p.symbol}</span><div class="message-body"><div class="message-meta"><b>${p.name}</b><small>${m.actor === 0 ? '당신' : m.actor === 2 ? '리더' : '원탁의 일원'}</small>${m.actor !== 0 && state.phase !== 'ended' ? `<button data-reply="${m.actor}" aria-label="${p.name}의 ${index + 1}번째 발언에 답하기">답하기 ↩</button>` : ''}</div>${m.quote ? `<div class="quote">${escapeText(m.quote)}</div>` : ''}<p>${escapeText(m.text)}</p></div></article>`;
}
function renderConversation() {
  let content = state.messages.map(messageHTML).join('');
  if (state.phase === 'votes') {
    const votes = [state.vote === 'APPROVE', true, true, false, false];
    const approved = votes.filter(Boolean).length >= 3;
    content = `<div class="scene-card"><span class="stamp">모든 표가 동시에 공개되었습니다</span><h3>${approved ? '이 팀으로 떠납니다' : '다시, 원탁으로'}</h3><p>찬성 ${approved ? 3 : 2} · 반대 ${approved ? 2 : 3}</p></div><div class="reveal-votes">${people.map((p,i) => `<div class="revealed-vote ${votes[i] ? '' : 'reject'}">${p.name}<b>${votes[i] ? '찬성' : '반대'}</b></div>`).join('')}</div>` + messageHTML({actor:3,text:state.team.includes(1) ? '나는 반대했어요. 성공했던 팀이라는 이유만으로 하린을 다시 보내기는 어려워요.' : '명단은 바뀌었지만 아직 확신은 없어요. 이번 표는 반대로 남길게요.'},0);
  } else if (state.phase === 'quest') {
    content = `<div class="scene-card"><div class="scene-symbol">♜</div><span class="stamp">SEALED IN SECRET</span><h3>${state.team.includes(0) ? '당신은 원정대의 일원입니다' : '원정대의 귀환을 기다립니다'}</h3><p>${state.team.includes(0) ? '당신은 선의 충신이므로 성공 카드만 낼 수 있습니다.' : '이번 원정팀은 ' + names(state.team) + '입니다. 당신은 카드를 내지 않습니다.'}<br>누가 어떤 카드를 냈는지는 공개되지 않습니다.</p><div class="result-cards"><div class="quest-card"><div>${state.team.includes(0) ? '✧<small>성공</small>' : '◇<small>비공개</small>'}</div></div></div></div>`;
  } else if (state.phase === 'result') {
    content = `<div class="scene-card"><span class="stamp">QUEST 03 · 원정 보고</span><h3>세 번째 원정, 성공</h3><p>${names(state.team)}이 돌아왔습니다.</p><div class="result-cards"><div class="quest-card"><div>✧<small>성공</small></div></div><div class="quest-card"><div>✧<small>성공</small></div></div></div><p>실패 카드 0장 · 개별 제출자는 비공개</p></div>` + messageHTML({actor:3,text:'성공은 좋은 소식이지만, 이것만으로 팀원의 정체까지 확정할 수는 없어요. 다음 원정은 세 명이 필요하네요.'},0);
  } else if (state.phase === 'assassination') {
    content = `<div class="event">원정 세 번 성공 · 악에게 마지막 기회가 주어집니다</div><div class="scene-card"><div class="scene-symbol">♞</div><h3>멀린은 누구였을까요?</h3><p>마지막 논의가 끝나면 암살자가 한 사람을 지목합니다.<br>공개된 말과 선택을 다시 돌아보세요.</p></div>` + messageHTML({actor:1,text:'도윤은 위험한 팀을 잘 피했어. 운이 좋았던 걸까, 아니면 뭔가 알고 있었던 걸까?'},0) + messageHTML({actor:2,text:'서아가 짚었던 실패 팀과 반대표를 보고 판단했을 뿐이에요.'},1) + state.messages.filter(m => m.custom).map(messageHTML).join('');
  } else if (state.phase === 'ended') {
    content = `<div class="scene-card"><span class="stamp">THE TRUTH REVEALED</span><h3>멀린이 지목되었습니다</h3><p>암살자 하린의 선택은 도윤.<br>원정은 세 번 성공했지만, 마지막 암살로 <strong>악이 승리했습니다.</strong></p><div class="final-roles">${people.map(p => `<div>${p.name}<span class="${['암살자','악의 하수인'].includes(p.role) ? 'evil-role' : ''}">${p.role}</span></div>`).join('')}</div><div class="suspicion-note"><b>이번 판을 돌아보면</b><br>첫 원정의 성공이 하린의 신뢰로 이어졌습니다.<br>두 번째 원정은 실패했고, 서아는 하린의 재참여에 반대했습니다.<br>성공 카드만으로는 하린의 정체를 알 수 없었습니다.</div><p style="margin-top:12px;font-size:9px">이 복기는 미리 구성한 시연 장면입니다.</p></div>`;
  }
  $('conversation').innerHTML = content;
  // New scene starts at its beginning; only user messages scroll to the bottom.
}
function decision(copy, detail, buttons, label = '지금 당신의 선택') {
  return `<div class="decision-copy"><div class="decision-label">${label}</div><b>${copy}</b><p>${detail}</p></div><div class="decision-actions">${buttons}</div>`;
}
const gold = (action, text) => `<button class="gold-button" data-action="${action}">${text}</button>`;
const quiet = (action, text) => `<button class="quiet-button" data-action="${action}">${text}</button>`;
function renderDecision() {
  const phases = {
    discussion: () => decision('이 두 명을 원정에 보내도 될까요?', `연속 부결 ${state.attempt - 1}회 · ${state.attempt === 5 ? '이번에도 부결되면 악이 승리합니다' : '준비되면 토론을 마치고 투표하세요'}`, gold('start-vote','이 팀으로 투표 →')),
    vote: () => decision(names(state.team), '3명 이상 찬성하면 원정에 출발합니다.', quiet('reject','반대') + gold('approve','찬성'), '비밀 투표 · 전원 제출 후 동시 공개'),
    votes: () => decision(state.vote === 'APPROVE' ? '원정팀 승인' : '원정팀 부결', '공개된 표는 원정 기록에서 다시 볼 수 있습니다.', gold('continue-vote', state.vote === 'APPROVE' ? '원정 출발 →' : '토론 장면 다시보기 →'),'투표 결과'),
    quest: () => decision('카드는 비밀리에 제출됩니다',state.team.includes(0) ? '선은 성공 카드만 낼 수 있습니다.' : '이번 팀원들의 카드 제출을 기다립니다.',gold('card',state.team.includes(0) ? '성공 카드 제출 →' : '예시 결과 확인 →')),
    result: () => decision('선의 원정 성공 2 / 3','성공한 팀에도 악이 숨어 있을 수 있습니다.',gold('next','마지막 장면 보기 →'),'원정 결과'),
    assassination: () => decision('마지막 논의를 마치셨나요?','공개 기록을 돌아보고, 준비되면 결과를 확인하세요.',gold('reveal','암살 결과 확인 →'),'최종 논의 · 결과 공개 전'),
    ended: () => decision('어떤 순간에 판단이 바뀌었나요?','공개 기록과 역할을 함께 돌아보세요.',gold('reset','처음부터 살펴보기 ↺'),'이번 판의 복기'),
  };
  $('decision').innerHTML = phases[state.phase]();
}
function renderRecords() {
  const late = ['assassination','ended'].includes(state.phase);
  const records = [
    { n:1, team:[0,1], success:true, votes:[true,true,true,false,true], leader:'하린' },
    { n:2, team:[1,3,4], success:false, votes:[false,true,false,true,true], leader:'서아' },
  ];
  if (['votes','quest','result'].includes(state.phase) || late) records.push({n:3,team:state.team,success:state.phase === 'result' || late ? true : null,votes:[state.vote === 'APPROVE',true,true,false,false],leader:'도윤'});
  if (late) records.push({n:4,team:[0,2,3],success:true,votes:[true,false,true,true,true],leader:'지호'});
  $('records').innerHTML = records.map(r => `<article class="record-card" id="record-${r.n}"><div class="record-title"><b>0${r.n}번째 원정</b><span class="result-badge ${r.success === false ? 'fail' : ''}">${r.success === null ? state.vote === 'REJECT' ? '팀 부결' : '팀 승인' : r.success ? '성공' : '실패'}</span></div><p class="record-team">${names(r.team)}</p><p class="record-fact">${r.success === null ? '원정 결과 없음' : `실패 카드 ${r.success ? '0' : '1'}장`} · 리더 ${r.leader}</p><div class="vote-mini" aria-label="공개된 찬반">${people.map((p,i) => `<span>${p.name}<b class="${r.votes[i] ? '' : 'no'}">${r.votes[i] ? '찬성' : '반대'}</b></span>`).join('')}</div><p class="record-caption">전원 제출 후 공개된 표</p></article>`).join('');
  const person = state.inspected;
  $('person-evidence').hidden = person === null;
  if (person !== null) {
    const descriptions = ['1차 원정에 참여했고 성공했습니다. 2차 원정팀에는 반대했습니다.','1차 성공 팀, 2차 실패 팀에 모두 참여했습니다. 두 팀에 모두 찬성했습니다.','1차 팀에는 찬성했고 2차 팀에는 반대했습니다. 현재 팀의 리더입니다.','2차 실패 팀에 참여하고 찬성했습니다. 현재 하린의 재참여에 의문을 제기했습니다.','2차 실패 팀에 참여하고 찬성했습니다. 현재 대안 명단을 묻고 있습니다.'];
    $('person-evidence').innerHTML = `<div class="person-card"><strong style="color:${people[person].color}">${people[person].symbol} ${people[person].name}의 공개 행동</strong><p>${descriptions[person]}</p>${person !== 0 && state.phase !== 'ended' ? `<button data-reply="${person}">${people[person].name}에게 질문하기 ↗</button>` : ''}</div>`;
  }
}
function renderReply() {
  $('reply-context').hidden = state.replyTo === null;
  $('reply-context').innerHTML = state.replyTo === null ? '' : `<span>↳ ${people[state.replyTo].name}에게 답하기</span><button type="button" data-action="cancel-reply" aria-label="답장 취소">×</button>`;
}
function toast(text) { clearTimeout(toastTimer); $('toast').textContent = text; $('toast').hidden = false; toastTimer = setTimeout(() => { $('toast').hidden = true; }, 3500); }
function openRecords() { $('evidence-panel').classList.add('open'); if (matchMedia('(max-width:760px)').matches) document.querySelector('.close-records').focus(); }
function go(phase) { state.phase = phase; state.replyTo = null; render(); $('conversation').scrollTop = 0; }
function chooseTeam() { $('team-choices').innerHTML = people.map((p,i) => `<button data-team="${i}" aria-pressed="${state.proposed.includes(i)}">${p.symbol}<br>${p.name}</button>`).join(''); $('share-team').disabled = state.proposed.length !== 2; }
document.addEventListener('click', event => {
  const target = event.target.closest('button'); if (!target) return;
  if (target.dataset.scene) { setScene(target.dataset.scene); return; }
  if (target.dataset.person !== undefined) { state.inspected = Number(target.dataset.person); renderRecords(); document.querySelectorAll('.seat').forEach((s,i) => {s.classList.toggle('inspected',i === state.inspected);s.setAttribute('aria-pressed',String(i === state.inspected));});openRecords();return; }
  if (target.dataset.reply !== undefined) {
    state.replyTo = Number(target.dataset.reply); renderReply(); $('chat-input').placeholder = `${people[state.replyTo].name}에게 질문하거나 답하세요…`; $('evidence-panel').classList.remove('open'); $('chat-input').focus(); return;
  }
  if (target.dataset.record) { const r = $(`record-${target.dataset.record}`); if (!r) {toast('아직 공개된 기록이 없는 원정입니다.');return;}openRecords();r.scrollIntoView({block:'nearest'});return; }
  if (target.dataset.team !== undefined) {const i = Number(target.dataset.team);if(state.proposed.includes(i))state.proposed=state.proposed.filter(p=>p!==i);else if(state.proposed.length<2)state.proposed.push(i);else toast('두 명을 선택할 수 있습니다. 한 명을 먼저 해제해 주세요.');chooseTeam();return;}
  switch (target.dataset.action) {
    case 'reset': setScene('discussion');toast('처음 토론 장면으로 돌아왔습니다.');break;
    case 'role': $('role-dialog').showModal();break;
    case 'close-role': $('role-dialog').close();break;
    case 'records': openRecords();break;
    case 'close-records': $('evidence-panel').classList.remove('open');document.querySelector('.mobile-records').focus();break;
    case 'cancel-reply': state.replyTo=null;renderReply();$('chat-input').placeholder='누구의 말이 마음에 걸리나요?';break;
    case 'suggest': state.proposed=[...state.team];chooseTeam();$('team-dialog').showModal();break;
    case 'close-team': $('team-dialog').close();break;
    case 'share-team':
      if(state.proposed.length!==2)return;
      state.team=[...state.proposed];state.messages.push({actor:0,text:`저는 ${names(state.team)} 구성을 제안할게요.`},{actor:2,text:`그럼 ${state.team.map(i => i === 0 ? '당신' : i === 2 ? '저' : people[i].name).join(' · ')}로 초안을 바꿔볼게요. 이 명단을 보고 투표해 주세요.`},{event:`도윤이 팀 초안을 ${names(state.team)}으로 수정했습니다`});$('team-dialog').close();render();$('conversation').scrollTop=$('conversation').scrollHeight;break;
    case 'start-vote': go('vote');break;
    case 'approve': state.vote='APPROVE';go('votes');break;
    case 'reject': state.vote='REJECT';go('votes');break;
    case 'continue-vote':
      if(state.vote==='APPROVE')go('quest');
      else {setScene('discussion');toast('다음 제안의 화면 예시로 돌아왔습니다.');}break;
    case 'card': go('result');break;
    case 'next': setScene('assassination');break;
    case 'reveal': go('ended');break;
  }
});
$('chat-form').addEventListener('submit',event => {
  event.preventDefault();const text=$('chat-input').value.trim();if(!text||state.phase==='ended')return;
  if(!['discussion','vote','assassination'].includes(state.phase)){toast('대화 시연은 토론·투표·암살 장면에서 해볼 수 있습니다.');return;}
  const actor = state.replyTo ?? 2;
  state.messages.push({actor:0,text,custom:true});
  const examples = ['','첫 원정은 성공했지만 두 번째엔 나도 있었지. 그 점을 의심하는 건 이해해. 다만 서아와 지호도 같이 봐줬으면 해.','하린이 첫 원정을 함께 성공시켰다는 점을 봤어요. 하지만 서아 말처럼 그걸로 정체가 확정되지는 않죠. 다른 구성도 듣고 싶어요.','저라면 하린 대신 도윤에게 기회를 줄래요. 지난 실패 팀에서 한 명을 바꿔 결과를 비교하고 싶어요.','하린을 빼는 안과 그대로 가는 안, 둘 중 어떤 쪽에 찬성할 수 있는지 먼저 들어보자.'];
  state.messages.push({actor,text: state.phase==='assassination' ? '기록에 남은 표와 팀 선정만으로는 확신하기 어려워요. 마지막까지 다른 가능성도 생각해 봐야죠.' : examples[actor],quote:`나: ${text}`,custom:true});
  state.replyTo=null;$('chat-input').value='';render();$('conversation').scrollTop=$('conversation').scrollHeight;
  toast('선택한 상대의 고정 예시 답변입니다. 실제 AI 응답은 아닙니다.');
});
document.addEventListener('keydown',event=>{if(event.key==='Escape')$('evidence-panel').classList.remove('open');});
setScene('discussion');
