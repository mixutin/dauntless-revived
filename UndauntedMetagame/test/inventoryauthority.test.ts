import {RemoveTestDb} from './setup';
import './authenv';
import './appenv';
import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {StartApp,StopApp,Call} from './appclient';
import {GetDb} from '../src/db';
import {MakePlayer,StackQuantity} from './helpers';
before(StartApp);
after(async()=>{await StopApp();RemoveTestDb(()=>GetDb().$client.close())});
test('player cannot mint currency by forging a gameserver source',async()=>{
 const p=await MakePlayer();
 const result=await Call('POST','/inventory',{as:p.UserId,body:{accountId:p.UserId,characterId:p.CharacterId,transactionId:'forged-reward',source:'owner-authorized:reward',addStackedItems:[{catalogId:'CURRENCY_NOTES',quantity:1000000}]}});
 assert.equal(result.status,403);
 assert.equal(StackQuantity(p.CharacterId,'CURRENCY_NOTES'),0);
});
test('player cannot insert an unearned item through saveInstancedItems',async()=>{
 const p=await MakePlayer();
 const result=await Call('POST','/inventory',{as:p.UserId,body:{accountId:p.UserId,characterId:p.CharacterId,transactionId:'forged-save',saveInstancedItems:[{catalogId:'AC_HEAD_HALO',instanceId:'forged-instance',updateVersion:0}]}});
 assert.equal(result.status,403);
});
test('authenticated native reward still succeeds and identical retry grants once',async()=>{
 const p=await MakePlayer();const body={accountId:p.UserId,characterId:p.CharacterId,transactionId:'native-reward',addStackedItems:[{catalogId:'CURRENCY_NOTES',quantity:5}]};
 assert.equal((await Call('POST','/inventory',{gs:true,body})).status,200);
 assert.equal((await Call('POST','/inventory',{gs:true,body})).status,200);
 assert.equal(StackQuantity(p.CharacterId,'CURRENCY_NOTES'),5);
});
test('foreign character, invented catalog, negative quantity and impossible upgrade cannot mutate inventory',async()=>{
 const p=await MakePlayer(),other=await MakePlayer();
 for(const body of [
  {accountId:other.UserId,characterId:other.CharacterId,addStackedItems:[{catalogId:'CURRENCY_NOTES',quantity:10}]},
  {accountId:p.UserId,characterId:p.CharacterId,addInstancedItems:[{catalogId:'NONEXISTENT',instanceId:'fake',updateVersion:0}]},
  {accountId:p.UserId,characterId:p.CharacterId,removeStackedItems:[{catalogId:'CURRENCY_NOTES',quantity:-10}]},
  {accountId:p.UserId,characterId:p.CharacterId,saveInstancedItems:[{catalogId:'WEAPON_TEST',instanceId:'fake',updateVersion:999,itemData:'{"Level":999}'}]}
 ])assert.ok([400,403].includes((await Call('POST','/inventory',{as:p.UserId,body:{...body,transactionId:crypto.randomUUID()}})).status));
 assert.equal(StackQuantity(other.CharacterId,'CURRENCY_NOTES'),0);
 assert.equal((await Call('POST','/inventory/instanceditem',{as:p.UserId,body:{characterId:p.CharacterId,instanceId:'fake',catalogId:'WEAPON_TEST',itemData:'{"Level":999}',updateVersion:999}})).status,403);
});
test('mutation quota is per player and does not stop native rewards or reads',async()=>{
 const p=await MakePlayer();const body={characterId:p.CharacterId,addStackedItems:[{catalogId:'CURRENCY_NOTES',quantity:1}]};
 for(let i=0;i<60;i++)assert.equal((await Call('POST','/inventory',{as:p.UserId,body})).status,403);
 assert.equal((await Call('POST','/inventory',{as:p.UserId,body})).status,429);
 assert.equal((await Call('GET',`/inventory/${p.UserId}/${p.CharacterId}`,{as:p.UserId})).status,200);
 assert.equal((await Call('POST','/inventory',{gs:true,body:{...body,accountId:p.UserId,transactionId:'native-after-rate'}})).status,200);
});
