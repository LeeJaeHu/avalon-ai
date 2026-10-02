import test from 'node:test';
import assert from 'node:assert/strict';
import { discussionTask, buildDiscussionPrompt } from '../lib/prompts/discussion.mjs';
import { createGame, observe, observeModerator } from '../lib/game.mjs';

test('구체적 공개 근거·본인 공개 투표를 제공하고 비밀·타인 카드·미공개 투표는 복사하지 않는다', () => {
  const state = { team: ['ai1','ai2'], roles: 'SECRET_ROLE', known: 'SECRET_KNOWN', cards: 'SECRET_CARD',
    quests: [{ id: 'q1',team:['human','ai1'],fails:1,result:'FAIL' }],
    proposals: [{id:'p1',quest:1,team:['human','ai1'],votes:[{actor:'ai3',choice:'REJECT'},{actor:'ai1',choice:'APPROVE'}]},
      {id:'p2',quest:2,team:['ai1','ai2'],status:'VOTING'}],
    messages: [{id:'m1',actor:'ai3',text:'저는 신중하게 보고 싶어요.'}] };
  const task = discussionTask({actor:'ai3',type:'CHAT',replyMessage:{text:'왜 반대했나요?'}}, state);
  assert.match(task.goal, /직접 답/);
  assert.deepEqual(task.ownPublicVotes,[{proposalId:'p1',quest:1,team:[{id:'human',name:'나'},{id:'ai1',name:'하린'}],choice:'REJECT'}]);
  assert.equal(task.questEvidence[0].fails,1);
  assert.deepEqual(task.recentOwnStatements,[{id:'m1',text:'저는 신중하게 보고 싶어요.'}]);
  assert.ok(!JSON.stringify(task).includes('SECRET'));
  assert.match(task.requirements.join(' '), /당시 판단 이유는 저장되지/);
  assert.equal(task.requiredContent.length,3);
});

test('토론 과제는 CHAT 요청에만 포함하고 첫 원정에는 없는 근거를 생성하지 않는다', () => {
  const game = createGame(() => 0.5);
  const view = observe(game,'ai2');
  for (const type of ['CHAT','PROPOSE','VOTE','CARD','ASSASSINATE']) {
    const prompt = buildDiscussionPrompt({request:{actor:'ai2',type},view,publicState:observeModerator(game),personalInfo:{}});
    const request = JSON.parse(prompt.split('이번 요청은 다음과 같습니다.')[1].trim().split('\n')[0]);
    assert.equal(!!request.discussionTask,type==='CHAT');
    if (type==='CHAT') {
      assert.deepEqual(request.discussionTask.questEvidence,[]);
      assert.deepEqual(request.discussionTask.ownPublicVotes,[]);
      assert.match(request.discussionTask.requirements.join(' '), /첫 원정/);
    }
  }
});
