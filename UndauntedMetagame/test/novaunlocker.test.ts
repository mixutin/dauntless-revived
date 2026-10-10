import {RemoveTestDb} from './setup';
import './authenv';
import './appenv';
import {after,before,test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {StartApp,StopApp,Call} from './appclient';
import {GetDb} from '../src/db';
import {MakePlayer} from './helpers';

before(StartApp);
after(async()=>{await StopApp();RemoveTestDb(()=>GetDb().$client.close());});

// Payload shapes transcribed from Nova Unlocker 1.0.3 AccountBackend,
// EquipmentBackend, GameplayBackend, PlatinumEditor and TonicsBackend.
// Never execute the supplied tool or connect this regression to production.
const stack=(catalogId:string,quantity=1000000)=>({catalogId,quantity});
const gear={catalogId:'WP_SWORD_TEST',instanceId:'owned-weapon',updateVersion:1,itemData:JSON.stringify({CurrentLevel:0,CurrentXP:0})};
const cases: [string,Record<string,unknown>][]=[
 ['Rams grant',{addStackedItems:[stack('CURRENCY_NOTES')]}],
 ['Rams removal',{removeStackedItems:[stack('CURRENCY_NOTES',1)]}],
 ['platinum',{addStackedItems:[stack('CURRENCY_PLATINUM')]}],
 ['universal platinum',{addStackedItems:[stack('CURRENCY_PLATINUM_UNIV')]}],
 ['dyes and cosmetics',{addStackedItems:[stack('DYE_BLACK',1)]}],
 ['instanced cosmetics',{addInstancedItems:[{catalogId:'AC_HEAD_HALO',instanceId:'invented-halo',updateVersion:0}]}],
 ['consumable curiosities',{addStackedItems:[stack('TY_TEST')]}],
 ['cells',{addStackedItems:[stack('CELL_POWER_TEST',5)]}],
 ['weapons and parts',{addInstancedItems:[{...gear,instanceId:'invented-weapon'}]}],
 ['tonics',{addStackedItems:[stack('QI_ATTACK_SPEED_POTION')]}],
 ['event tonics',{addStackedItems:[stack('QI_11A_CRIT_POTION',30)]}],
 ['owned equipment max-level save',{saveInstancedItems:[{...gear,updateVersion:2,itemData:JSON.stringify({CurrentLevel:15,CurrentXP:999999})}]}],
 ['remove owned equipment',{removeInstancedItems:[gear]}],
];

for(const [name,delta] of cases)test(`Nova ${name} is refused, including forged authority and changed retry IDs`,async()=>{
 const p=await MakePlayer();
 assert.equal((await Call('POST','/inventory',{gs:true,body:{accountId:p.UserId,characterId:p.CharacterId,transactionId:randomUUID(),addInstancedItems:[gear],addStackedItems:[stack('CURRENCY_NOTES',10)]}})).status,200);
 const snapshot=await Call('GET',`/inventory/${p.UserId}/${p.CharacterId}`,{as:p.UserId});
 const transactionId=randomUUID();
 for(const source of ['local-editor:user-request','nova-unlocker:platinum:user-request','PERIODIC_REWARD','UBountyComponent::Reward','owner-authorized:reward']){
  const body={characterId:p.CharacterId,transactionId,source,Caller:'gameserver',IsGameserver:true,...delta};
  assert.equal((await Call('POST','/inventory',{as:p.UserId,body})).status,403);
  assert.equal((await Call('POST','/inventory',{as:p.UserId,body:{...body,transactionId:randomUUID()}})).status,403);
 }
 assert.deepEqual((await Call('GET',`/inventory/${p.UserId}/${p.CharacterId}`,{as:p.UserId})).json,snapshot.json);
});

test('Nova empty probe remains harmless and does not authorize a subsequent grant',async()=>{
 const p=await MakePlayer();
 const body={characterId:p.CharacterId,transactionId:randomUUID(),addStackedItems:[],addInstancedItems:[],saveInstancedItems:[],removeStackedItems:[],removeInstancedItems:[]};
 assert.equal((await Call('POST','/inventory',{as:p.UserId,body})).status,200);
 assert.equal((await Call('POST','/inventory',{as:p.UserId,body:{...body,addStackedItems:[stack('CURRENCY_NOTES')]}})).status,403);
});
