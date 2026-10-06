import {IDS} from './game.mjs';
export function previousThinking(game,actor){return IDS.includes(actor)&&actor!=='human'?game.privateThinking?.[actor]??null:null;}
export function rememberThinking(next,decision){
 const actor=decision.thinkingOwner;
 if(decision.thinkingStateVersion!==next.version-1)return next;
 if(decision.mode!=='gemini'||!IDS.includes(actor)||actor==='human'||typeof decision.thinking!=='string'||!decision.thinking.trim())return next;
 next.privateThinking??={};
 next.privateThinking[actor]={text:decision.thinking,stateVersion:next.version,requestType:decision.thinkingRequestType,at:new Date().toISOString()};
 return next;
}
export function thinkingDetail(decision){return typeof decision.thinking==='string'?{thinking:decision.thinking,thinkingOwner:decision.thinkingOwner,thinkingSource:'model-json-self-report'}:{};}
