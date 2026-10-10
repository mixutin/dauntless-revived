import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { RegionalRouter, AusUrl } from '../src/controllers/regions';
import { CapacityUnavailable } from '../src/controllers/capacity';
process.env.AUS_DEPLOYSERVER_URL='http://127.0.0.1:61021';
after(()=>delete process.env.AUS_DEPLOYSERVER_URL);
const body={GameMode:'ISLAND',GameArgs:'',HuntId:'hunt',ExpectedPlayers:['one','two']};
const main={host:'main',port:8762}, aus={host:'aus',port:8700};
const load=async()=>({running:10,pending:1,limit:22});

test('US stays regional for city, training and hunts, including failures',async()=>{
 process.env.US_DEPLOYSERVER_URL='http://127.0.0.1:61041';
 process.env.US_PUBLIC_HOST='us';
 const us={host:'us',port:8900};
 try {
  const router=new RegionalRouter(load,async(url,request)=>{assert.equal(url.port,'61041');assert.deepEqual(request.ExpectedPlayers,body.ExpectedPlayers);return us;});
  for(const GameMode of ['CITY','SHARED','ISLAND'])
   assert.deepEqual(await router.launch({...body,GameMode},'us',async()=>{throw Error('Must not reach EU');}),us);
  await assert.rejects(new RegionalRouter(load,async()=>undefined).launch(body,'us',async()=>main),CapacityUnavailable);
  await assert.rejects(new RegionalRouter(load,async()=>main).launch(body,'us',async()=>main),/outside/);
  await assert.rejects(new RegionalRouter(load,async()=>{throw Error('timeout');}).launch(body,'us',async()=>main),/timeout/);
  delete process.env.US_DEPLOYSERVER_URL;
  await assert.rejects(router.launch(body,'us',async()=>main),CapacityUnavailable);
 } finally {delete process.env.US_DEPLOYSERVER_URL;delete process.env.US_PUBLIC_HOST;}
});

test('Germany stays regional for city, training and hunts; Main may overflow there',async()=>{
 process.env.GERMANY_DEPLOYSERVER_URL='http://127.0.0.1:61031';
 process.env.GERMANY_PUBLIC_HOST='germany';
 const germany={host:'germany',port:8800};
 try {
  const router=new RegionalRouter(load,async(url)=>{assert.equal(url.port,'61031');return germany;});
  for(const GameMode of ['CITY','SHARED','ISLAND'])
   assert.deepEqual(await router.launch({...body,GameMode},'ger',async()=>{throw Error('Must not reach Main');}),germany);
  assert.deepEqual(await router.launch(body,'main',async()=>{throw new CapacityUnavailable('cpu');}),germany);
  await assert.rejects(new RegionalRouter(load,async()=>undefined).launch(body,'ger',async()=>main),CapacityUnavailable);
  await assert.rejects(new RegionalRouter(load,async()=>main).launch(body,'ger',async()=>main),/outside/);
  await assert.rejects(new RegionalRouter(load,async()=>{throw Error('timeout');}).launch(body,'ger',async()=>main),/timeout/);
 } finally {delete process.env.GERMANY_DEPLOYSERVER_URL;delete process.env.GERMANY_PUBLIC_HOST;}
});
test('AUS keeps the whole party and all hunt arguments; CITY respects OCE and Training respect OCE',async()=>{
    let calls=0;
    const router=new RegionalRouter(load,async(_url,request)=>{calls++;assert.deepEqual(request.ExpectedPlayers,body.ExpectedPlayers);return aus;});
    assert.deepEqual(await router.launch(body,'aus',async()=>main),aus);
    assert.deepEqual(await router.launch({...body,GameMode:'CITY'},'aus',async()=>main),aus);
    assert.deepEqual(await router.launch({...body,GameMode:'SHARED'},'aus',async()=>main),aus);
    assert.equal(calls,3);
});
test('explicit capacity fallback works in both directions; ambiguous failures do not duplicate hunts',async()=>{
    await assert.rejects(new RegionalRouter(load,async()=>undefined).launch(body,'aus',async()=>{throw Error('Must not fall back');}),CapacityUnavailable);
    assert.deepEqual(await new RegionalRouter(load,async()=>aus).launch(body,'main',async()=>{throw new CapacityUnavailable('hunts');}),aus);
    let calls=0;
    await assert.rejects(new RegionalRouter(load,async()=>{throw new Error('timeout');}).launch(body,'aus',async()=>{calls++;return main;}),/timeout/);
    assert.equal(calls,0);
});
test('mixed parties choose available pool by capacity utilization, not raw hunt count',async()=>{
    const router=new RegionalRouter(load,async()=>aus,async()=>({running:12,pending:0,limit:40}));
    assert.deepEqual(await router.launch(body,'mixed',async()=>main),aus);
    const full=new RegionalRouter(load,async()=>aus,async()=>({running:24,pending:0,limit:24}));
    assert.deepEqual(await full.launch(body,'mixed',async()=>main),main);
});
test('regional worker URL must be a private loopback tunnel',()=>{
    process.env.AUS_DEPLOYSERVER_URL='http://example.com';
    assert.throws(AusUrl,/loopback/);
    process.env.AUS_DEPLOYSERVER_URL='http://127.0.0.1:61021';
});

test('OCE fails closed when worker returns an EU destination',async()=>{
 process.env.AUS_PUBLIC_HOST='aus';
 try {await assert.rejects(new RegionalRouter(load,async()=>main).launch(body,'aus',async()=>main),/outside/);}
 finally {delete process.env.AUS_PUBLIC_HOST;}
});
test('EU overflow preserves reserved AU slots, explicit AU still allocates',async()=>{
 process.env.AUS_RESERVED_HUNTS='8';let calls=0;
 const router=new RegionalRouter(load,async()=>{calls++;return aus;},async()=>({running:16,pending:0,limit:24}));
 try {
  await assert.rejects(router.launch(body,'main',async()=>{throw new CapacityUnavailable('cpu');}),CapacityUnavailable);
  assert.equal(calls,0);
  assert.deepEqual(await router.launch(body,'aus',async()=>main),aus);
 }finally{delete process.env.AUS_RESERVED_HUNTS;}
});
