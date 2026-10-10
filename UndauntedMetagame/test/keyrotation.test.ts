import {RemoveTestDb} from './setup';
import './authenv';
import './appenv';
import {after,test} from 'node:test';
import assert from 'node:assert/strict';
import {GetDb} from '../src/db';
import {MakePlayer} from './helpers';
import {HashUserAPIKey,GetUserIDForAPIKey,SignMetagameJWTForUid,ValidateMetagameJWTAndGetPayload} from '../src/controllers/auth';
import {BeginKeyRecovery,CompleteKeyRecovery,ProveRecoveryLink} from '../src/controllers/keyrotation';
import {LinkDiscordAccount} from '../src/controllers/discordlinks';
import {StartApp,StopApp,Call} from './appclient';
after(()=>RemoveTestDb(()=>GetDb().$client.close()));
let counter=0;
async function fixture(){
 const p=await MakePlayer();const id=String(100000000000000000n+BigInt(++counter));
 const key='UUK_'+crypto.randomUUID().replace(/-/g,'');
 GetDb().$client.prepare('INSERT INTO userapikeys VALUES(?,?)').run(p.UserId,HashUserAPIKey(key));
 return {...p,id,key};
}
test('verified recovery rotates atomically, revokes old key and JWT, and refuses replay',async()=>{
 const p=await fixture();const jwt=SignMetagameJWTForUid(p.UserId);
 assert.equal(ProveRecoveryLink(p.id,p.key),true);
 const challenge=BeginKeyRecovery(p.id)!;
 const key=CompleteKeyRecovery(p.id,challenge)!;
 assert.match(key,/^UUK_[a-f0-9]{64}$/);
 assert.equal(await GetUserIDForAPIKey(p.key),undefined);
 assert.equal(await GetUserIDForAPIKey(key),p.UserId);
 assert.throws(()=>ValidateMetagameJWTAndGetPayload(jwt),/session_revoked/);
 assert.equal(CompleteKeyRecovery(p.id,challenge),null);
 assert.doesNotThrow(()=>ValidateMetagameJWTAndGetPayload(SignMetagameJWTForUid(p.UserId)));
});
test('administrator-created link alone and wrong key do not prove ownership',async()=>{
 const p=await fixture();LinkDiscordAccount(p.id,p.UserId);
 assert.equal(ProveRecoveryLink(p.id,'wrong'),false);
 assert.equal(CompleteKeyRecovery(p.id,BeginKeyRecovery(p.id)!),null);
 assert.equal(await GetUserIDForAPIKey(p.key),p.UserId);
});
test('another Discord actor cannot redeem a challenge',async()=>{
 const p=await fixture(),other=await fixture();ProveRecoveryLink(p.id,p.key);
 const challenge=BeginKeyRecovery(p.id)!;
 assert.equal(CompleteKeyRecovery(other.id,challenge),null);
 assert.ok(CompleteKeyRecovery(p.id,challenge));
});
test('expired challenge and excessive attempts refuse without revoking the key',async()=>{
 const p=await fixture();const now=Date.now();ProveRecoveryLink(p.id,p.key,now);
 const challenge=BeginKeyRecovery(p.id,now)!;
 assert.equal(CompleteKeyRecovery(p.id,challenge,now+300001),null);
 for(let i=0;i<6;i++)BeginKeyRecovery(p.id,now+300002);
 assert.equal(BeginKeyRecovery(p.id,now+300003),null);
 assert.equal(await GetUserIDForAPIKey(p.key),p.UserId);
});
test('a database failure rolls back key rotation and leaves the challenge usable',async()=>{
 const p=await fixture();ProveRecoveryLink(p.id,p.key);const challenge=BeginKeyRecovery(p.id)!;
 const db=GetDb().$client;
 db.exec("CREATE TRIGGER fail_epoch BEFORE INSERT ON authepochs BEGIN SELECT RAISE(ABORT,'test failure'); END");
 try{assert.throws(()=>CompleteKeyRecovery(p.id,challenge));assert.equal(await GetUserIDForAPIKey(p.key),p.UserId);}
 finally{db.exec('DROP TRIGGER fail_epoch');}
 assert.ok(CompleteKeyRecovery(p.id,challenge));
});
test('recovery endpoint refuses ordinary players, admin headers and proxied service requests',async()=>{
 await StartApp();process.env.KEY_RECOVERY_SERVICE_SECRET=crypto.randomUUID()+crypto.randomUUID();
 try{
  const p=await fixture();
  assert.equal((await Call('POST','/internal/key-recovery/begin',{as:p.UserId,body:{discordId:p.id}})).status,403);
  assert.equal((await Call('POST','/internal/key-recovery/begin',{gs:true,body:{discordId:p.id}})).status,403);
  assert.equal((await Call('POST','/internal/key-recovery/begin',{headers:{'x-key-recovery-service':process.env.KEY_RECOVERY_SERVICE_SECRET,'x-forwarded-for':'192.0.2.1'},body:{discordId:p.id}})).status,403);
  const result=await Call('POST','/internal/key-recovery/begin',{headers:{'x-key-recovery-service':process.env.KEY_RECOVERY_SERVICE_SECRET},body:{discordId:p.id}});
  assert.equal(result.status,200);assert.match(result.json.challenge,/^[a-f0-9]{64}$/);
 }finally{delete process.env.KEY_RECOVERY_SERVICE_SECRET;await StopApp();}
});
