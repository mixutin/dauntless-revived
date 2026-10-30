import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fastestRegion,RegionProbe} from '../src/main/autoregion';
import {settingsPatch} from '../src/main/ipc-validate';
const probes:RegionProbe[]=[{region:'main',host:'example.com',port:443},{region:'ger',host:'example.com',port:443},{region:'us',host:'example.com',port:443}];
test('automatic chooses the fastest reachable region rather than always Main',async()=>{
    assert.equal(await fastestRegion(probes,async p=>({main:200,ger:90,us:12,sg:300,au:300}[p.region])),'us');
    assert.equal(await fastestRegion(probes,async p=>p.region==='us'?5:Infinity),'us');
    assert.equal(await fastestRegion(probes,async p=>p.region==='ger'?10:Infinity),'ger');
    assert.equal(await fastestRegion(probes,async()=>Infinity),undefined);
});
test('Automatic is selectable and manual region choices remain available',()=>{
    for(const huntRegion of ['auto','main','ger','us','sg'])assert.deepEqual(settingsPatch({huntRegion}),{huntRegion});
    assert.equal(settingsPatch({huntRegion:'unknown'}),null);
    assert.equal(settingsPatch({huntRegion:'aus'}),null);
});
test('Singapore wins when it is the closest reachable region',async()=>{
    const four:RegionProbe[]=[...probes,{region:'sg',host:'example.com',port:443}];
    assert.equal(await fastestRegion(four,async p=>({main:260,ger:240,us:190,sg:20,au:300}[p.region])),'sg');
    assert.equal(await fastestRegion(four,async p=>p.region==='sg'?Infinity:80),'main');
});

test('Australia wins when it is the closest reachable region',async()=>{
    const five:RegionProbe[]=[...probes,{region:'au',host:'example.com',port:443}];
    assert.equal(await fastestRegion(five,async p=>({main:260,ger:240,us:190,sg:300,au:20}[p.region])),'au');
});
