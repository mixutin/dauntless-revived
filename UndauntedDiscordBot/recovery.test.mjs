import {test} from 'node:test';
import assert from 'node:assert/strict';
import {recoveryRequest,recoverInteraction,resendInteraction,sendPrivately} from './recovery.mjs';
test('recovery request binds the actor and dedicated loopback authentication',async()=>{
 process.env.KEY_RECOVERY_SERVICE_SECRET='test-only-'.repeat(5);
 try{
  await recoveryRequest('begin','123456789012345678',{discordId:'999999999999999999'},async(url,options)=>{
   assert.equal(url.hostname,'127.0.0.1');assert.equal(options.redirect,'error');
   assert.equal(JSON.parse(options.body).discordId,'123456789012345678');
   assert.equal(options.headers['x-undaunted-user-api-key'],undefined);
   return {ok:true,json:async()=>({challenge:'test'})};
  });
 }finally{delete process.env.KEY_RECOVERY_SERVICE_SECRET;}
});
for(const blocked of [false,true])test(`recovery privately delivers with DMs ${blocked?'blocked':'available'}`,async()=>{
 const old=globalThis.fetch;process.env.KEY_RECOVERY_SERVICE_SECRET='test-only-'.repeat(5);
 const key='UUK_'+'b'.repeat(64);let dm;const replies=[];
 globalThis.fetch=async()=>({ok:true,json:async()=>({key})});
 try{
  await recoverInteraction({ephemeral:true,user:{id:'123456789012345678',send:async message=>{if(blocked)throw Error('blocked');dm=message;}},options:{getString:()=> 'a'.repeat(64)},editReply:async text=>{replies.push(text);}});
  if(blocked){assert.equal(dm,undefined);assert.ok(replies.at(-1).content.includes(key));}
  else{assert.ok(dm.content.includes(key));assert.ok(!JSON.stringify(replies).includes(key));}
 }finally{globalThis.fetch=old;delete process.env.KEY_RECOVERY_SERVICE_SECRET;}
});
test('public interaction cannot rotate or disclose a key',async()=>{
 const old=globalThis.fetch;globalThis.fetch=()=>assert.fail('must not rotate');
 try{
  const interaction={ephemeral:false,user:{send:()=>assert.fail('must not send')}};
  await assert.rejects(()=>recoverInteraction(interaction),/Private acknowledgement/);
  await assert.rejects(()=>sendPrivately(interaction,'private'),/Private acknowledgement/);
 }finally{globalThis.fetch=old;}
});
test('resend reuses the actors invite without claiming or issuing another',async()=>{
 let delivered;
 await resendInteraction({ephemeral:true,user:{id:'123456789012345678',send:async message=>{delivered=message.content;}},editReply:async()=>{}},
  {run:async(id,claim)=>{assert.equal(id,'123456789012345678');assert.equal(claim,false);return {status:'ready',code:'existing'};}},code=>'invite:'+code);
 assert.equal(delivered,'invite:existing');
});
test('redeemed invites are never resent',async()=>{
 let reply;
 await resendInteraction({ephemeral:true,user:{id:'123456789012345678',send:()=>assert.fail('must not send')},editReply:async text=>{reply=text;}},
  {run:async()=>({status:'redeemed'})},()=>assert.fail('must not format'));
 assert.match(reply,/contact support/);
});
