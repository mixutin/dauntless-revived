import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fastestRegion,RegionProbe} from '../src/main/autoregion';
import {settingsPatch} from '../src/main/ipc-validate';
const probes:RegionProbe[]=[{region:'main',host:'example.com',port:443},{region:'aus',host:'example.com',port:443},{region:'ger',host:'example.com',port:443},{region:'us',host:'example.com',port:443}];
test('automatic chooses the fastest reachable region rather than always Main',async()=>{
    assert.equal(await fastestRegion(probes,async p=>({main:200,aus:12,ger:90,us:100}[p.region])),'aus');
    assert.equal(await fastestRegion(probes,async p=>p.region==='us'?5:Infinity),'us');
    assert.equal(await fastestRegion(probes,async p=>p.region==='ger'?10:Infinity),'ger');
    assert.equal(await fastestRegion(probes,async()=>Infinity),undefined);
});
test('Automatic is selectable and manual region choices remain available',()=>{
    for(const huntRegion of ['auto','main','aus','ger','us'])assert.deepEqual(settingsPatch({huntRegion}),{huntRegion});
    assert.equal(settingsPatch({huntRegion:'unknown'}),null);
});
