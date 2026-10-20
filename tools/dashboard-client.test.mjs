import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
test('dashboard unlock renders both hosts and the CPU mean in actual client script',async()=>{
 const elements=new Map();
 const element=()=>({value:'',textContent:'',children:[],options:[],clientWidth:0,classList:{add(){},contains(){return false;}},replaceChildren(...rows){this.children=rows;},append(...rows){this.children.push(...rows);},after(){},querySelector(){return null;},focus(){},scrollIntoView(){},getContext(){return {};}});
 // head and querySelector are real: the client restyles the page on load and must not need a guard.
 const document={hidden:false,head:element(),getElementById(id){if(!elements.has(id))elements.set(id,element());return elements.get(id);},createElement:element,createTextNode:()=>({}),querySelector:()=>null,querySelectorAll:()=>[],addEventListener(){}};
 const row=(name,cpu)=>({name,cpu,online:true,hunts:2,ramUsedMB:1024,ramTotalMB:8192,huntSampleAt:new Date().toISOString()});
 const data={sample:null,worker:{configured:false},error:null,logNames:[],fleet:{rows:[row('Server #1',50),row('Server #2',5)],totals:{meanCpu:27.5,hunts:4,ramUsedMB:2048,ramTotalMB:16384,ramPercent:12.5,online:2,servers:2}}};
 vm.runInNewContext(await readFile(new URL('./dashboard-client.js',import.meta.url),'utf8'),{document,window:{addEventListener(){}},setInterval(){},AbortSignal,console,fetch:async()=>({ok:true,json:async()=>data})});
 document.getElementById('key').value='test-owner';document.getElementById('connect').onclick();
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(elements.get('error').textContent,'');
 assert.equal(elements.get('fleetMeanCpu').textContent,'27.5%');
 assert.equal(elements.get('fleetHunts').textContent,4);
 assert.equal(elements.get('fleetRows').children.length,2);
 assert.equal(elements.get('botLinked').textContent,'—');
 assert.equal(elements.get('botIssued').textContent,'—');
 data.sample={at:new Date().toISOString(),players:[],instances:[],locations:{},history:[],discord:{at:new Date().toISOString(),linkedAccounts:7,bot:{issued:20,unused:4,redeemed:15,pending:2,revoked:1},error:null}};
 document.getElementById('key').value='test-owner';document.getElementById('connect').onclick();
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(elements.get('error').textContent,'');
 assert.equal(elements.get('botLinked').textContent,7);
 assert.equal(elements.get('botIssued').textContent,20);
 assert.equal(elements.get('botRedeemed').textContent,15);
 data.aus={configured:true,online:true,sample:{at:new Date().toISOString(),cpu:20,ramUsedMB:4096,ramTotalMB:65536,logicalCpus:24,services:{deploy:true,backend:true,allowlist:true},hunts:[{kind:'hunt',port:8700,expectedPlayers:2,startedAt:new Date().toISOString()}]}};
 document.getElementById('key').value='test-owner';
 document.getElementById('connect').onclick();
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(elements.get('ausConnection').textContent,'Connected');
 assert.equal(elements.get('ausCpu').textContent,'20.0%');
 assert.equal(elements.get('ausHuntRows').children.length,1);
 assert.equal(elements.get('ausServices').children.length,4);
});

test('the grant panel offers only catalogued items and posts one grant it can retry',async()=>{
 const elements=new Map();
 const element=()=>({value:'',textContent:'',disabled:false,selectedIndex:-1,children:[],options:[],clientWidth:0,classList:{add(){},contains(){return false;}},replaceChildren(...rows){this.children=rows;},append(...rows){this.children.push(...rows);},after(){},querySelector(){return null;},focus(){},scrollIntoView(){},getContext(){return {};}});
 const document={hidden:false,head:element(),getElementById(id){if(!elements.has(id))elements.set(id,element());return elements.get(id);},createElement:element,createTextNode:()=>({}),querySelector:()=>null,querySelectorAll:()=>[],addEventListener(){}};
 const catalogue={items:[{catalogId:'ORB_FLAME',kind:'stacked',group:'material'},{catalogId:'ORB_FROST',kind:'stacked',group:'material'},{catalogId:'GEM_ALPHA',kind:'stacked',group:'material'},{catalogId:'BNC_FABRIC_000',kind:'instanced',group:'cosmetic'}]};
 const posts=[];
 const fetch=async(path,options)=>{
  if(path==='/api/grant-catalog')return {ok:true,json:async()=>catalogue};
  if(path==='/api/grant'){posts.push(JSON.parse(options.body));return {ok:true,json:async()=>({stacked:posts.at(-1).items.length,instanced:0,replayed:false})};}
  return {ok:true,json:async()=>({sample:null,worker:{configured:false},error:null,logNames:[],fleet:{rows:[],totals:{}}})};
 };
 vm.runInNewContext(await readFile(new URL('./dashboard-client.js',import.meta.url),'utf8'),{document,window:{addEventListener(){}},setInterval(){},AbortSignal,console,fetch});
 const el=id=>document.getElementById(id);
 el('key').value='test-owner';el('connect').onclick();
 await new Promise(resolve=>setImmediate(resolve));

 el('grantSearch').onfocus();
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(el('grantItem').children.length,4,'the picker lists the catalogue');
 assert.match(el('grantCatalogStatus').textContent,/4 of 4 items/);

 // Only one group, and only matches of the search text.
 el('grantGroup').value='cosmetic';el('grantGroup').onchange();
 assert.equal(el('grantItem').children.length,1);
 el('grantGroup').value='';el('grantSearch').value='orb';el('grantSearch').oninput();
 assert.equal(el('grantItem').children.length,2,'the search is case-insensitive');

 // An id that is not in the catalogue cannot reach the basket.
 el('grantItem').value='AR_INVENTED_CHEST';el('grantQuantity').value='1';el('grantAdd').onclick();
 assert.match(el('grantStatus').textContent,/not in this server's catalogue/);
 assert.equal(el('grantRows').children.length,0);
 assert.equal(el('grantSubmit').disabled,true);

 el('grantItem').value='ORB_FLAME';el('grantQuantity').value='0';el('grantAdd').onclick();
 assert.match(el('grantStatus').textContent,/whole number from 1/);
 el('grantQuantity').value='50';el('grantAdd').onclick();
 assert.equal(el('grantRows').children.length,1);
 assert.equal(el('grantSubmit').disabled,false);

 // The quick fill uses the catalogue's own material ids, never a hardcoded list.
 el('grantAllOrbs').onclick();
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(el('grantRows').children.length,2,'both orbs, the repeated one replaced not duplicated');

 // A grant needs an account and a reference before it will go.
 el('grantSubmit').onclick();
 await new Promise(resolve=>setImmediate(resolve));
 assert.match(el('grantStatus').textContent,/starts with UID-/);
 el('grantAccount').value='UID-player-1';
 el('grantSubmit').onclick();
 await new Promise(resolve=>setImmediate(resolve));
 assert.match(el('grantStatus').textContent,/reference/);
 assert.deepEqual(posts,[]);

 el('grantReference').value='compensation-42';
 el('grantSubmit').onclick();
 await new Promise(resolve=>setImmediate(resolve));
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(posts.length,1);
 assert.equal(posts[0].accountId,'UID-player-1');
 assert.equal(posts[0].reference,'compensation-42');
 assert.deepEqual(posts[0].items.map(i=>i.catalogId).sort(),['ORB_FLAME','ORB_FROST']);
 assert.ok(posts[0].items.every(i=>i.quantity===50));
 assert.equal(el('grantRows').children.length,0,'a delivered grant clears the list');
 assert.equal(el('grantSubmit').disabled,true);
});

test('overview and individual server panels remain separate in the HTML',async()=>{
 const html=await readFile(new URL('./dashboard.html',import.meta.url),'utf8');
 assert.ok(html.includes('</style></head><body>'));
 const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);assert.equal(new Set(ids).size,ids.length);
 for(const id of ['overview','server1','worker','aus','fleetPlayers','fleetCpuChart','fleetRamChart','fleetHuntChart'])assert.ok(ids.includes(id),id);
 const panels=[];let current=[];
 for(const m of html.matchAll(/<section\b[^>]*>|<\/section>/g)){
  if(m[0].startsWith('</')){assert.ok(current.length);current.pop();}
  else{const id=/\bid="([^"]+)"/.exec(m[0])?.[1];if(['overview','server1','worker','aus','backend'].includes(id)){assert.equal(current.length,0,id);panels.push(id);}current.push(id||'card');}
 }
 assert.equal(current.length,0);assert.equal(panels.length,5);
});
