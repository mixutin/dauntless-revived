import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startDashboard, scrubLog, tailLog } from './dashboard.mjs';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parsePerformance, readPerformance } from './dashboard-performance.mjs';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

test('chart inspection selects timestamps, preserves selection on refresh and handles missing samples', async () => {
  const source = await readFile(new URL('./dashboard-client.js', import.meta.url), 'utf8');
  const renderer = source.slice(source.indexOf('  function graph('), source.indexOf('  function renderDiscord('));
  const labels=[];
  const ctx=new Proxy({measureText:()=>({width:50}),fillText:text=>labels.push(text)}, {get:(target,key)=>target[key]??(()=>{})});
  const canvas={clientWidth:300,style:{},dataset:{},parentElement:{querySelector:()=>({textContent:'CPU · %'})},getContext:()=>ctx,setAttribute:()=>{},getBoundingClientRect:()=>({left:0})};
  const history=[{at:'2026-10-17T01:00:00Z',cpu:12},{at:'2026-10-17T01:00:05Z',cpu:null},{at:'2026-10-17T01:00:10Z',cpu:24}];
  const scope={el:()=>canvas,window:{devicePixelRatio:1},history};
  runInNewContext(renderer+"\ngraph('cpu',history);",scope);
  canvas.onpointermove({clientX:150});
  assert.equal(canvas.dataset.selectedAt,history[1].at);
  assert.match(labels.at(-1),/Unavailable/);
  canvas.onkeydown({key:'ArrowRight',preventDefault(){}});
  assert.equal(canvas.dataset.selectedAt,history[2].at);
  runInNewContext("graph('cpu',history);",scope);
  assert.match(labels.at(-1),/24/);
  canvas.onkeydown({key:'Escape'});
  assert.equal(canvas.dataset.selectedAt,undefined);
  assert.match(labels.at(-1),/Current 24/);
});

test('fleet host without a detail panel does not interrupt dashboard unlock', async () => {
  const source = await readFile(new URL('./dashboard-client.js', import.meta.url), 'utf8');
  const renderer = source.slice(source.indexOf('  function renderWorker('), source.indexOf('\n  function list('));
  assert.doesNotThrow(() => runInNewContext(renderer + "\nrenderWorker({online:true}, 'eu2');", {
    document: {getElementById: () => null},
  }));
});

test('optional IP bans use backend observations, ignore submitted IPs, and fail closed without an observation',async()=>{
  const key='test-ip-moderation-owner';const writes=[];let address='203.0.113.20';
  const server=await startDashboard({key,port:0,backend:'http://127.0.0.1:61000',fetcher:async(url,opts)=>{
    if(opts?.method==='POST'){writes.push(JSON.parse(opts.body));return {status:200,json:async()=>({})};}
    if(url.pathname.startsWith('/undaunted/api/Moderation/'))return {status:200,json:async()=>({addresses:address?[{address}]:[]})};
    return {ok:true,json:async()=>({Users:[],players:[],instances:[],playersOnline:0})};
  }});
  try{
    const base=`http://127.0.0.1:${server.address().port}`;
    const send=body=>fetch(base+'/api/moderation',{method:'POST',headers:{'x-dashboard-key':key,'content-type':'application/json',origin:base},body:JSON.stringify({accountId:'UID-test',reason:'verified test',active:true,address:'198.51.100.99',...body})});
    assert.equal((await send({includeDevice:true})).status,200);assert.equal(writes.at(-1).address,null);assert.equal(writes.at(-1).includeDevice,true);
    assert.equal((await send({includeIp:true})).status,200);assert.equal(writes.at(-1).address,address);assert.equal(writes.at(-1).durationHours,168);assert.equal(writes.at(-1).includeIp,undefined);
    address=null;assert.equal((await send({includeIp:true})).status,409);assert.equal(writes.length,2);
    assert.equal((await send({includeIp:true,active:false})).status,200);assert.equal(writes.at(-1).address,null);
  }finally{await new Promise(resolve=>server.close(resolve));}
});

test('moderation history requires owner auth and bounded pagination',async()=>{
  const key='test-history-owner-key';let reads=0;
  const server=await startDashboard({key,port:0,backend:'http://127.0.0.1:61000',fetcher:async(url,opts)=>{
    if(url.pathname==='/undaunted/api/ModerationLog'){reads++;assert.equal(opts.headers['x-undaunted-user-api-key'],key);return {status:200,json:async()=>({rows:[],nextOffset:null})};}
    return {ok:true,json:async()=>({Users:[],players:[],instances:[],playersOnline:0})};
  }});
  try {
    const base=`http://127.0.0.1:${server.address().port}`;
    assert.equal((await fetch(base+'/api/moderation-log?kind=events')).status,401);
    assert.equal((await fetch(base+'/api/moderation-log?kind=events&offset=-1',{headers:{'x-dashboard-key':key}})).status,400);
    const response=await fetch(base+'/api/moderation-log?kind=events&offset=0',{headers:{'x-dashboard-key':key}});
    assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(reads,1);
  }finally{await new Promise(resolve=>server.close(resolve));}
});

test('moderation writes require owner authentication and same origin and never retry',async()=>{
  const key='test-moderation-owner-key';let writes=0;
  const server=await startDashboard({key,port:0,backend:'http://127.0.0.1:61000',fetcher:async(url,opts)=>{
    if(opts?.method==='POST'){writes++;assert.equal(url.pathname,'/undaunted/api/Moderation');const body=JSON.parse(opts.body);assert.equal(body.durationHours,168);assert.equal(body.address,null);return {status:200,json:async()=>({ban:{active:1},addresses:[]})};}
    return {ok:true,json:async()=>({Users:[],players:[],instances:[],playersOnline:0})};
  }});
  try{
    const base=`http://127.0.0.1:${server.address().port}`,body=JSON.stringify({accountId:'UID-test',reason:'test',active:true});
    assert.equal((await fetch(base+'/api/moderation',{method:'POST',body})).status,401);
    assert.equal((await fetch(base+'/api/moderation',{method:'POST',headers:{'x-dashboard-key':key,'content-type':'application/json'},body})).status,403);
    assert.equal((await fetch(base+'/api/moderation',{method:'POST',headers:{'x-dashboard-key':key,'content-type':'application/json',origin:base},body})).status,200);
    assert.equal(writes,1);
  }finally{await new Promise(resolve=>server.close(resolve));}
});
test('item grants require owner authentication and same origin, and are bounded and retriable',async()=>{
  const key='test-grant-owner-key';let grants=0,catalogueReads=0;
  const server=await startDashboard({key,port:0,backend:'http://127.0.0.1:61000',fetcher:async(url,opts)=>{
    if(url.pathname==='/undaunted/api/GrantCatalog'){catalogueReads++;return {ok:true,status:200,json:async()=>({items:[
      {catalogId:'ORB_FLAME',kind:'stacked',group:'material',secret:'must not pass through'},
      {catalogId:'not a catalog id',kind:'stacked',group:'material'}
    ]})};}
    if(url.pathname==='/undaunted/api/GrantItems'){
      grants++;
      const body=JSON.parse(opts.body);
      assert.deepEqual(Object.keys(body).sort(),['Items','Reference','UserId']);
      assert.equal(body.UserId,'UID-test');
      assert.equal(body.Reference,'ticket-7');
      assert.deepEqual(body.Items,[{catalogId:'ORB_FLAME',quantity:50}]);
      return {status:200,json:async()=>({stacked:1,instanced:0,replayed:false})};
    }
    return {ok:true,json:async()=>({Users:[],players:[],instances:[],playersOnline:0})};
  }});
  try{
    const base=`http://127.0.0.1:${server.address().port}`;
    const owner={'x-dashboard-key':key,'content-type':'application/json',origin:base};
    const good=JSON.stringify({accountId:'UID-test',reference:'ticket-7',items:[{catalogId:'ORB_FLAME',quantity:50}]});

    assert.equal((await fetch(base+'/api/grant',{method:'POST',body:good})).status,401);
    assert.equal((await fetch(base+'/api/grant',{method:'POST',headers:{'x-dashboard-key':key,'content-type':'application/json'},body:good})).status,403,'no origin');
    assert.equal((await fetch(base+'/api/grant',{method:'POST',headers:{'x-dashboard-key':key,origin:base},body:good})).status,415);
    assert.equal(grants,0);

    // Nothing malformed reaches the backend.
    for(const body of [
      '{', '{}',
      JSON.stringify({accountId:'not-a-uid',reference:'r',items:[{catalogId:'ORB_FLAME',quantity:1}]}),
      JSON.stringify({accountId:'UID-test',reference:'',items:[{catalogId:'ORB_FLAME',quantity:1}]}),
      JSON.stringify({accountId:'UID-test',reference:'bad ref',items:[{catalogId:'ORB_FLAME',quantity:1}]}),
      JSON.stringify({accountId:'UID-test',reference:'r',items:[]}),
      JSON.stringify({accountId:'UID-test',reference:'r',items:[{catalogId:'ORB FLAME',quantity:1}]}),
      JSON.stringify({accountId:'UID-test',reference:'r',items:[{catalogId:'ORB_FLAME',quantity:0}]}),
      JSON.stringify({accountId:'UID-test',reference:'r',items:[{catalogId:'ORB_FLAME',quantity:1.5}]}),
      JSON.stringify({accountId:'UID-test',reference:'r',items:[{catalogId:'ORB_FLAME',quantity:1000001}]}),
      JSON.stringify({accountId:'UID-test',reference:'r',items:Array.from({length:65},()=>({catalogId:'ORB_FLAME',quantity:1}))})
    ]) assert.equal((await fetch(base+'/api/grant',{method:'POST',headers:owner,body})).status,400,body.slice(0,60));
    assert.equal(grants,0);

    assert.equal((await fetch(base+'/api/grant',{method:'POST',headers:owner,body:good})).status,200);
    assert.equal(grants,1);

    // The catalogue is projected to the fields the picker uses and cached after the first read.
    const catalogue=await (await fetch(base+'/api/grant-catalog',{headers:{'x-dashboard-key':key}})).json();
    assert.deepEqual(catalogue,{items:[{catalogId:'ORB_FLAME',kind:'stacked',group:'material'}]});
    await fetch(base+'/api/grant-catalog',{headers:{'x-dashboard-key':key}});
    assert.equal(catalogueReads,1,'cached');
    assert.equal((await fetch(base+'/api/grant-catalog')).status,401);
  }finally{await new Promise(resolve=>server.close(resolve));}
});
test('an ambiguous grant tells the owner to resend the same reference rather than a new one',async()=>{
  const key='test-grant-ambiguous-key';
  const server=await startDashboard({key,port:0,backend:'http://127.0.0.1:61000',fetcher:async(url,opts)=>{
    if(opts?.method==='POST')throw new Error('connection reset');
    return {ok:true,json:async()=>({Users:[],players:[],instances:[],playersOnline:0})};
  }});
  try{
    const base=`http://127.0.0.1:${server.address().port}`;
    const response=await fetch(base+'/api/grant',{method:'POST',headers:{'x-dashboard-key':key,'content-type':'application/json',origin:base},
      body:JSON.stringify({accountId:'UID-test',reference:'ticket-9',items:[{catalogId:'ORB_FLAME',quantity:1}]})});
    assert.equal(response.status,502);
    assert.match((await response.json()).error,/same reference/);
  }finally{await new Promise(resolve=>server.close(resolve));}
});
test('dashboard isolates owner data and only polls read routes', async () => {
  const routes = [];
  const key = 'test-owner-key-not-a-real-secret';
  const server = await startDashboard({key, port: 0, backend: 'http://127.0.0.1:61000', fetcher: async (url, options) => {
    routes.push(url.pathname);
    if (url.pathname === '/gameservers') {
      assert.equal(url.port, '61001');
      assert.equal(options.headers, undefined);
      return Response.json({capacity:{running:4,pending:1,limit:10,cpu:{blocked:false}}});
    }
    return {ok: true, json: async () => url.pathname.endsWith('GetAllUsers') ? {Users: [{UserId: 'fixture', Username: 'Tester'}]} : {players: [{name: 'Tester', where: 'city'}], instances: [], playersOnline: 1, uptimeSeconds: 60, name: 'Test'} };
  }});
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    assert.equal((await fetch(base + '/api/status')).status, 401);
    assert.equal((await fetch(base + '/api/status', {headers: {'x-dashboard-key': key, origin: 'https://untrusted.example'}})).status, 403);
    const response = await fetch(base + '/api/status', {headers: {'x-dashboard-key': key}});
    const data = await response.json();
    assert.equal(data.sample.accounts, 1);
    assert.equal(data.sample.newAccountsObserved, 0);
    assert.equal(data.sample.players[0].name, 'Tester');
    assert.equal(JSON.stringify(data).includes(key), false);
    assert.equal((await fetch(base + '/api/log?name=../../secrets', {headers: {'x-dashboard-key': key}})).status, 404);
    assert.equal(data.sample.locations.city, 1);
    assert.equal(data.sample.locations.hunt, 0);
    assert.equal(data.fleet.totals.hunts, 4);
    assert.equal(data.fleet.rows[0].capacity.pending, 1);
    assert.deepEqual(routes.sort(), ['/gameservers', '/undaunted/api/BackendHealth', '/undaunted/api/DiscordKeyStats', '/undaunted/api/GetAllUsers', '/undaunted/api/ServerStatus']);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
test('redacts credential lines and caps log line count', () => {
  assert.equal(scrubLog('ready\nAuthorization: Bearer secret\nUUK_test\npassword=hello').includes('hello'), false);
  assert.equal(scrubLog(Array(200).fill('ready').join('\n')).split('\n').length, 150);
});
test('refuses an external backend', async () => {
  await assert.rejects(startDashboard({key: 'test-owner-key-long', backend: 'http://example.com'}), /loopback/);
});
test('log reader bounds large files and includes the latest complete line', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dr-dashboard-test-'));
  try {
    const path = join(dir, 'sample.log');
    await writeFile(path, 'old line\n'.repeat(10000) + 'latest line\n');
    const text = await tailLog(path);
    assert.ok(text.includes('latest line'));
    assert.ok(text.length < 32768);
    assert.ok(text.split('\n').length <= 150);
  } finally { await rm(dir, {recursive: true}); }
});
test('backend failure returns an explicit unavailable state without fabricated readings', async () => {
  const key = 'test-owner-key-not-a-real-secret';
  const server = await startDashboard({key, port: 0, backend: 'http://127.0.0.1:61000', fetcher: async () => { throw new Error('offline'); }});
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/status`, {headers: {'x-dashboard-key': key}});
    const data = await response.json();
    assert.equal(data.sample, null);
    assert.match(data.error, /unavailable/);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('invites require owner authentication, same origin, bounded input and fixed server destination', async () => {
  const key = 'test-owner-key-not-a-real-secret';
  const writes = [];
  const serverConfig = {Mode: 'Public', PublicHost: '203.0.113.10', Ports: {gateway: 443}, CertFingerprint: 'a'.repeat(64), ServerName: 'Test server'};
  const server = await startDashboard({key, port: 0, backend: 'http://127.0.0.1:61000', serverConfig, fetcher: async (url, options) => {
    if (options.method === 'POST') { writes.push({url, options}); return {ok: true, json: async () => ({code: 'TEST-ONLY-1234'})}; }
    return {ok: true, json: async () => url.pathname.endsWith('GetAllUsers') ? {Users: []} : {players: [], instances: [], playersOnline: 0}};
  }});
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const send = (body, extra = {}) => fetch(base + '/api/invites', {method: 'POST', headers: {'x-dashboard-key': key, origin: base, 'content-type': 'application/json', ...extra}, body: JSON.stringify(body)});
    assert.equal((await send({uses: 1, name: ''}, {'x-dashboard-key': 'wrong'})).status, 401);
    assert.equal((await send({uses: 1, name: ''}, {origin: 'https://evil.example'})).status, 403);
    assert.equal((await send({uses: 1, name: ''}, {origin: ''})).status, 403);
    for (const uses of [0, 101, 1.5, '1']) assert.equal((await send({uses, name: ''})).status, 400);
    assert.equal((await send({uses: 1, name: 'x'.repeat(3000)})).status, 413);
    assert.equal(writes.length, 0);
    const result = await (await send({uses: 2, name: 'Friends', host: 'evil.example'})).json();
    const link = new URL(result.invite);
    assert.equal(link.searchParams.get('host'), serverConfig.PublicHost);
    assert.equal(link.searchParams.get('fp'), serverConfig.CertFingerprint);
    assert.equal(link.searchParams.get('code'), 'TEST-ONLY-1234');
    assert.equal(result.uses, 2);
    assert.equal(writes.length, 1);
    assert.equal(writes[0].url.pathname, '/undaunted/api/CreateInvite');
    assert.deepEqual(JSON.parse(writes[0].options.body), {uses: 2, name: 'Friends'});
    assert.equal(JSON.stringify(result).includes(key), false);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('invite writes are never automatically retried after an ambiguous failure', async () => {
  const key = 'test-owner-key-not-a-real-secret';
  let writes = 0;
  const server = await startDashboard({key, port: 0, backend: 'http://127.0.0.1:61000', serverConfig: {Mode: 'Public', PublicHost: '203.0.113.10', Ports: {gateway: 443}, CertFingerprint: 'a'.repeat(64)}, fetcher: async (_url, options) => { if (options.method === 'POST') writes++; throw new Error('offline'); }});
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const response = await fetch(base + '/api/invites', {method: 'POST', headers: {'x-dashboard-key': key, origin: base, 'content-type': 'application/json'}, body: JSON.stringify({uses: 1, name: ''})});
    assert.equal(response.status, 502);
    assert.match((await response.json()).error, /result unknown/);
    assert.equal(writes, 1);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('performance reads numeric kit rows with whole-host CPU and explicit staleness', async () => {
  const at = '2026-09-30T12:00:00Z';
  const host = `${at},host,,,,,,,,,2,8192,4096,82.5,2,3,1,0`;
  const game = `${at},ramsgate,123,8777,2026-09-30T11:00:00Z,0,100,1024,1200,,,,,,,,,`;
  const csv = `${host}\n${game}\n`;
  const sample = parsePerformance(csv, Date.parse(at) + 1000);
  assert.equal(sample.processes[0].cpu_host_percent, 50);
  assert.equal(sample.host.disk_free_gb, 82.5);
  assert.equal(sample.stale, false);
  assert.equal(parsePerformance(csv, Date.parse(at) + 180000).stale, true);
  assert.equal(parsePerformance(`${host}\nmalformed,row\npartial`).processes.length, 0);
  const dir = await mkdtemp(join(tmpdir(), 'dr-dashboard-perf-'));
  try {
    await writeFile(join(dir, 'performance-2026-09-30.csv'), csv);
    assert.equal((await readPerformance(dir, Date.parse('2026-10-01T00:00:01Z'))).stale, true);
  } finally { await rm(dir, {recursive: true}); }
});

test('account proxy strips unexpected fields, validates paging, and preserves unavailable health', async () => {
  const key = 'test-owner-key-not-a-real-secret';
  const server = await startDashboard({key, port: 0, backend: 'http://127.0.0.1:61000', fetcher: async url => {
    if (url.pathname.endsWith('BackendHealth')) return {ok: false};
    if (url.pathname.endsWith('DashboardAccounts')) return {ok: true, json: async () => ({accounts: [{id: 'UID-test', name: 'Tester', admin: true, keyFingerprint: 'a'.repeat(16), UUK: 'SHOULD-NOT-LEAK'}], nextOffset: null})};
    return {ok: true, json: async () => url.pathname.endsWith('GetAllUsers') ? {Users: []} : {players: [], instances: [], playersOnline: 0}};
  }});
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    assert.equal((await fetch(base + '/api/accounts?offset=0')).status, 401);
    const headers = {'x-dashboard-key': key};
    assert.equal((await fetch(base + '/api/accounts?offset=-1', {headers})).status, 400);
    const result = await (await fetch(base + '/api/accounts?offset=0', {headers})).json();
    assert.equal(result.accounts[0].name, 'Tester');
    assert.equal(JSON.stringify(result).includes('SHOULD-NOT-LEAK'), false);
    const status = await (await fetch(base + '/api/status', {headers})).json();
    assert.equal(status.sample.requestsPerSecond, null);
    assert.match(status.sample.healthError, /BACKEND_HEALTH/);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('account recovery requires owner authentication and is never cached',async()=>{
 const key='test-recovery-owner-key';let recovered=0;
 const server=await startDashboard({key,port:0,backend:'http://127.0.0.1:61000',fetcher:async url=>{
   if(url.pathname.startsWith('/undaunted/api/AccountRecovery/')){recovered++;return {status:200,json:async()=>({accountId:'UID-test',key:'fixture-login-key'})};}
   return {ok:true,json:async()=>({Users:[],players:[],instances:[],playersOnline:0})};
 }});
 try {
   const base=`http://127.0.0.1:${server.address().port}`,route='/api/account-key?accountId=UID-test';
   assert.equal((await fetch(base+route)).status,401);assert.equal(recovered,0);
   const response=await fetch(base+route,{headers:{'x-dashboard-key':key}});
   assert.equal(response.headers.get('cache-control'),'no-store');assert.equal((await response.json()).key,'fixture-login-key');assert.equal(recovered,1);
 }finally{await new Promise(resolve=>server.close(resolve));}
});

test('slow moderation completes once and account totals are cached across polls', async () => {
  const {setTimeout: delay} = await import('node:timers/promises');
  const key='test-owner-key-not-a-real-secret';
  let users=0, writes=0;
  const server=await startDashboard({key,port:0,backend:'http://127.0.0.1:61000',fetcher:async (url,options)=>{
    if(options.method==='POST'){
      writes++;
      await delay(10500,undefined,{signal:options.signal});
      return {status:200,json:async()=>({active:false})};
    }
    if(url.pathname.endsWith('GetAllUsers')) users++;
    return {ok:true,json:async()=>url.pathname.endsWith('GetAllUsers')?{Users:[]}:{players:[],instances:[],playersOnline:0}};
  }});
  try {
    const base='http://127.0.0.1:'+server.address().port;
    const response=await fetch(base+'/api/moderation',{method:'POST',headers:{'x-dashboard-key':key,'content-type':'application/json',origin:base},body:JSON.stringify({accountId:'UID-fixture',active:false,reason:'test'})});
    assert.equal(response.status,200);
    assert.equal((await response.json()).active,false);
    assert.equal(writes,1);
    assert.equal(users,1);
  } finally {await new Promise(resolve=>server.close(resolve));}
});
