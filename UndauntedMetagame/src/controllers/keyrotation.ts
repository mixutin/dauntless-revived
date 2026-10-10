import {createHash,randomBytes} from 'node:crypto';
import {EventEmitter} from 'node:events';
export const KeyRevocations=new EventEmitter();
import {GetDb} from '../db';
import {LinkDiscordAccount} from './discordlinks';
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const valid=(id:unknown):id is string=>typeof id==='string' && /^\d{17,20}$/.test(id);
export function AuthEpoch(userId:string):number {
 return (GetDb().$client.prepare('SELECT epoch FROM authepochs WHERE userId=?').get(userId) as any)?.epoch ?? 0;
}
function limited(id:string,now:number) {
 const db=GetDb().$client;
 const n=(db.prepare('SELECT count(*) n FROM recoveryevents WHERE discordId=? AND createdAt>?').get(id,now-900000) as any).n;
 return n>=5;
}
function audit(id:string,action:string,now:number) {
 GetDb().$client.prepare('INSERT INTO recoveryevents(discordId,action,createdAt) VALUES(?,?,?)').run(id,action,now);
}
// Historical administrator-created links alone are deliberately insufficient.
export function ProveRecoveryLink(id:unknown,key:unknown,now=Date.now()) {
 if(!valid(id)||typeof key!=='string'||key.length>2048) return false;
 const db=GetDb().$client;
 return db.transaction(()=>{
  if(limited(id,now))return false;
  audit(id,'link_attempt',now);
  const row=db.prepare('SELECT k.userId FROM userapikeys k JOIN users u ON u.userId=k.userId WHERE k.keyHash=? AND u.isAdmin=0').get(hash(key)) as any;
  if(!row || LinkDiscordAccount(id,row.userId).status!=='linked')return false;
  db.prepare('INSERT INTO recoveryproofs VALUES(?,?,?) ON CONFLICT(discordId) DO UPDATE SET userId=excluded.userId,keyHash=excluded.keyHash').run(id,row.userId,hash(key));
  return true;
 }).immediate();
}
export function BeginKeyRecovery(id:unknown,now=Date.now()) {
 if(!valid(id))return null;
 const db=GetDb().$client;
 return db.transaction(()=>{
  if(limited(id,now))return null;
  audit(id,'begin',now);
  const row=db.prepare('SELECT p.userId,p.keyHash FROM recoveryproofs p JOIN discordlinks d ON d.discordId=p.discordId AND d.userId=p.userId JOIN userapikeys k ON k.userId=p.userId AND k.keyHash=p.keyHash JOIN users u ON u.userId=p.userId WHERE p.discordId=? AND u.isAdmin=0').get(id) as any;
  const token=randomBytes(32).toString('hex');
  db.prepare('DELETE FROM recoverychallenges WHERE discordId=? OR expiresAt<?').run(id,now);
  db.prepare('INSERT INTO recoverychallenges(tokenHash,discordId,userId,keyHash,expiresAt) VALUES(?,?,?,?,?)').run(hash(token),id,row?.userId??null,row?.keyHash??null,now+300000);
  // Same response whether a trusted account link exists or not.
  return token;
 }).immediate();
}
export function CompleteKeyRecovery(id:unknown,token:unknown,now=Date.now()) {
 if(!valid(id)||typeof token!=='string'||! /^[a-f0-9]{64}$/.test(token))return null;
 const db=GetDb().$client;
 const result=db.transaction(()=>{
  if(limited(id,now))return null;
  audit(id,'confirm_attempt',now);
  const row=db.prepare('SELECT c.* FROM recoverychallenges c JOIN recoveryproofs p ON p.discordId=c.discordId AND p.userId=c.userId AND p.keyHash=c.keyHash JOIN discordlinks d ON d.discordId=p.discordId AND d.userId=p.userId JOIN userapikeys k ON k.userId=c.userId AND k.keyHash=c.keyHash JOIN users u ON u.userId=c.userId WHERE c.tokenHash=? AND c.discordId=? AND c.used=0 AND c.expiresAt>? AND u.isAdmin=0').get(hash(token),id,now) as any;
  if(!row)return null;
  const key='UUK_'+randomBytes(32).toString('hex');const digest=hash(key);
  db.prepare('UPDATE userapikeys SET keyHash=? WHERE userId=? AND keyHash=?').run(digest,row.userId,row.keyHash);
  db.prepare('DELETE FROM userapikeystoregister WHERE userId=?').run(row.userId);
  db.prepare('DELETE FROM accountkeyrecovery WHERE userId=?').run(row.userId);
  db.prepare('UPDATE recoveryproofs SET keyHash=? WHERE discordId=?').run(digest,id);
  db.prepare('UPDATE recoverychallenges SET used=1 WHERE tokenHash=?').run(hash(token));
  db.prepare('INSERT INTO authepochs(userId,epoch) VALUES(?,1) ON CONFLICT(userId) DO UPDATE SET epoch=epoch+1').run(row.userId);
  audit(id,'rotated',now);
  return {key,userId:row.userId};
 }).immediate();
 if(result)KeyRevocations.emit('revoke',result.userId);
 return result?.key ?? null;
}
