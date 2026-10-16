import test from 'node:test';import assert from 'node:assert/strict';import {once} from 'node:events';
import {GEMINI_MODELS} from '../lib/gemini-models.mjs';
test('Vertex 중계는 인증·모델 허용 목록·상한을 유지하고 요청한 모델로만 전달한다',async()=>{
 const original=globalThis.fetch,oldPort=process.env.PORT,oldToken=process.env.VERTEX_PROXY_TOKEN;
 process.env.PORT='0';process.env.VERTEX_PROXY_TOKEN='synthetic-token-for-test-only-123456789';
 const upstream=[];let server;
 try{
  globalThis.fetch=async(url,init)=>{
   if(String(url).startsWith('http://metadata.google.internal/'))return Response.json({access_token:'synthetic-access',expires_in:3600});
   assert.match(String(url),/^https:\/\/aiplatform\.googleapis\.com\//);upstream.push({url:String(url),payload:JSON.parse(init.body)});
   assert.equal(init.headers.Authorization,'Bearer synthetic-access');return Response.json({model:String(url).split('/models/')[1].split(':')[0]});
  };
  const proxy=await import('../vertex-proxy/server.mjs');server=proxy.server;if(!server.listening)await once(server,'listening');
  assert.deepEqual([...proxy.allowedModels].sort(),Object.keys(GEMINI_MODELS).sort());
  const url=`http://127.0.0.1:${server.address().port}/generate`;
  const call=(model,token=process.env.VERTEX_PROXY_TOKEN,level)=>original(url,{method:'POST',headers:{'content-type':'application/json','x-avalon-proxy-token':token},body:JSON.stringify({model,contents:[{role:'user',parts:[{text:'synthetic'}]}],generationConfig:{maxOutputTokens:99999,...(level?{thinkingConfig:{thinkingLevel:level}}:{})}})});
  assert.equal((await call('gemini-3.5-flash','wrong')).status,401);assert.equal((await call('invalid')).status,400);assert.equal(upstream.length,0);
  for(const model of proxy.allowedModels){const response=await call(model);assert.equal(response.status,200);assert.equal((await response.json()).model,model);const last=upstream.at(-1);assert.equal(last.payload.generationConfig.maxOutputTokens,8192);assert.ok(!Object.hasOwn(last.payload,'model'));assert.ok(!JSON.stringify(last.payload).includes(process.env.VERTEX_PROXY_TOKEN));}
  for(const [model,level] of [['gemini-3.5-flash-lite','HIGH'],['gemini-3.5-flash-lite','MEDIUM'],['gemini-3.5-flash','MINIMAL']]){assert.equal((await call(model,process.env.VERTEX_PROXY_TOKEN,level)).status,200);assert.equal(upstream.at(-1).payload.generationConfig.thinkingConfig.thinkingLevel,level);}
  const count=upstream.length;assert.equal((await call('gemini-3.5-flash',process.env.VERTEX_PROXY_TOKEN,'INVALID')).status,400);assert.equal(upstream.length,count);
 }finally{
  globalThis.fetch=original;if(oldPort===undefined)delete process.env.PORT;else process.env.PORT=oldPort;if(oldToken===undefined)delete process.env.VERTEX_PROXY_TOKEN;else process.env.VERTEX_PROXY_TOKEN=oldToken;
  if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
 }
});
