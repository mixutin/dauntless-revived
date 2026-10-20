(() => {
  let key = '', busy = false, lastSample = null, lastWorker = null, lastAus = null, lastGermany = null, accountPage = [], accountOffset = 0, nextOffset = null, accountsBusy = false;
  const el = id => document.getElementById(id);
  const number = (n, suffix = '') => Number.isFinite(n) ? `${n.toFixed(1)}${suffix}` : '—';
  const duration = seconds => Number.isFinite(seconds) && seconds >= 0 ? `${Math.floor(seconds / 86400)}d ${Math.floor(seconds / 3600) % 24}h ${Math.floor(seconds / 60) % 60}m` : '—';

  const polish=document.createElement('style');
  polish.textContent=`
  :root{--bg:#08090b;--panel:#101114;--line:#25262b;--muted:#91939e;--accent:#f0f0f3;color-scheme:dark}
  html{min-height:100%;background:#08090b}
  body{min-height:100vh;background-repeat:no-repeat;background-attachment:fixed;background:radial-gradient(ellipse at 65% -30%,#252630 0,transparent 55%),#08090b;background-repeat:no-repeat;background-attachment:fixed;color:#f1f1f4;font:14px/1.6 'Segoe UI',system-ui,sans-serif;letter-spacing:.1px}
  header{height:88px;padding:22px 36px;background:#0b0c0ee8;border-bottom:1px solid #ffffff0d;backdrop-filter:blur(20px)}
  header h1{font-size:20px;letter-spacing:-.7px;font-weight:650}.eyebrow{color:#8f929d;font-size:10px;letter-spacing:2px}.badge{color:#b6cfc2;background:#92d9ac08;border-color:#92d9ac22}
  main{max-width:none;padding:32px 40px}.login{max-width:480px;margin:10vh auto;padding:36px!important}.login h2{font-size:28px;letter-spacing:-1px}
  body:has(#data:not([hidden])) main{margin-left:240px;max-width:1760px}
  .ops-sidebar{position:fixed;left:0;top:88px;bottom:0;width:240px;padding:28px 16px;background:#0c0d10;border-right:1px solid #ffffff0d;display:flex;flex-direction:column;align-items:stretch;gap:20px;overflow-y:auto}
  .ops-sidebar:before{content:'WORKSPACE';padding:0 16px;color:#626570;font-size:10px;letter-spacing:2px}
  .ops-sidebar nav{display:flex;flex-direction:column;gap:5px;flex-wrap:nowrap;margin:0;padding:0;background:none;border:0;border-radius:0}
  .ops-sidebar nav button{text-align:left;padding:12px 15px;background:transparent;color:#92949e;border:1px solid transparent;border-radius:9px;font-size:13px;white-space:normal}
  .ops-sidebar nav button:before{content:'◇';display:inline-block;width:25px;color:#60636e}
  .ops-sidebar nav button:hover{background:#ffffff05;color:#fff;box-shadow:none}
  .ops-sidebar nav button[aria-pressed=true]{background:#ffffff0c;color:#fff;border-color:#ffffff10;font-weight:600}
  .ops-sidebar nav button[aria-pressed=true]:before{color:#fff}.ops-sidebar #logout{margin-top:auto;background:transparent;color:#989aa4;border-color:#ffffff14}
  h2{font-size:17px;font-weight:600;letter-spacing:-.4px}h3{font-size:12px;color:#9799a5;font-weight:500}p{color:#8d909c;font-size:13px}
  .card{background:linear-gradient(135deg,#15161a,#101114);border:1px solid #ffffff0d;border-radius:16px;padding:24px;box-shadow:0 12px 36px #00000018;margin-bottom:22px}
  .grid{gap:20px}.metrics{gap:16px}.metric strong{font-size:34px;font-weight:600;letter-spacing:-1.3px;line-height:1.3;font-variant-numeric:tabular-nums;margin:10px 0}.metric span,small{font-size:11px;color:#858894}
  .ops-hero{background:radial-gradient(ellipse at top right,#ffffff07,transparent 65%),#101114;padding:30px!important}
  .ops-hero h2{font-size:30px;letter-spacing:-1.1px;margin:5px 0 6px}.ops-hero .metrics{margin:26px 0 0}.ops-hero .metric{border-top:1px solid #ffffff0c;padding-top:18px}
  .ops-charts{margin:22px 0}.ops-charts .card{min-width:0}.ops-charts h2{font-size:14px}
  button,input,select{background:#191a20;border-color:#ffffff16;border-radius:9px;padding:10px 14px}button{transition:background .16s,border-color .16s,color .16s}button:hover{background:#24252c;border-color:#ffffff30;box-shadow:none}
  .primary{background:#eeeeef;color:#141419;border-color:#eee}.primary:hover{background:#fff;color:#000}input:focus-visible,button:focus-visible,select:focus-visible,canvas:focus-visible{outline:2px solid #a6a9c4;outline-offset:3px}
  .table-wrap{border:1px solid #ffffff0b;border-radius:12px}table{font-size:12px}th{font-size:10px;text-transform:uppercase;letter-spacing:.7px;background:#ffffff02;color:#787c88}td,th{padding:15px 16px;border-bottom:1px solid #ffffff08}tbody tr:last-child td{border:0}tbody tr:hover{background:#ffffff03}
  canvas{cursor:crosshair;border-radius:8px}pre{background:#090a0d;border:1px solid #ffffff0c}#freshness{color:#7c808d}.footnote{color:#686d79;font-size:11px}.view{animation:ops-enter .18s ease-out}
  @keyframes ops-enter{from{opacity:.5;transform:translateY(4px)}to{opacity:1;transform:none}}
  @media(min-width:1500px){main{padding:38px 52px}.ops-hero h2{font-size:36px}}
  @media(max-width:1000px){.ops-sidebar{width:190px;padding:20px 10px}body:has(#data:not([hidden])) main{margin-left:190px;padding:24px}.ops-sidebar nav button{padding:10px;font-size:12px}}
  @media(max-width:700px){header{height:auto;padding:18px}body:has(#data:not([hidden])) main{margin-left:0;padding:16px}.ops-sidebar{position:static;width:auto;padding:0;background:none;border:0;gap:12px;margin-bottom:20px}.ops-sidebar:before{display:none}.ops-sidebar nav{flex-direction:row;overflow-x:auto;padding-bottom:8px}.ops-sidebar nav button{white-space:nowrap}.ops-sidebar nav button:before{display:none}.ops-sidebar #logout{align-self:flex-end}.card{padding:18px}.ops-hero h2{font-size:26px}}
  @media(prefers-reduced-motion:reduce){.view{animation:none}button{transition:none}}
  `;
  document.head.append(polish);
  const navigation=document.querySelector('#data nav');
  if(navigation)navigation.parentElement.classList.add('ops-sidebar');
  const overview=document.getElementById('overview');
  if(overview){
    const hero=overview.querySelector('.card');
    if(hero){
      hero.classList.add('ops-hero');
      hero.querySelector('h2').textContent='Your realm. At a glance.';
      hero.querySelector('p').textContent='EU · Germany · US (NA). Shared accounts and progression across the realm.';
    }
    const charts=Array.from(overview.children).find(node=>node.classList.contains('grid')&&node.querySelector('canvas'));
    if(charts&&hero){charts.classList.add('ops-charts');hero.after(charts);}
  }

  const fleetHistory=[];
  const fleetCharts=['fleetCpuChart','fleetRamChart','fleetHuntChart'];
  const charts = ['cpu', 'ramUsedMB', 'players', 'backendMs', 'requestsPerSecond', 'errorPercent', 'eventLoopP95Ms', 'backendRssMB', 'backendHeapMB'];
  function table(id, rows) { el(id).replaceChildren(...rows.map(cells => { const tr = document.createElement('tr'); for (const text of cells) { const td = document.createElement('td'); td.textContent = text; tr.append(td); } return tr; })); }
  async function get(path) {
    const response = await fetch(path, {headers: {'x-dashboard-key': key}, signal: AbortSignal.timeout(35000)});
    if (!response.ok) throw new Error(response.status === 401 ? 'Owner key rejected.' : 'Dashboard request failed.');
    return response.json();
  }
  function graph(id, history) {
    const canvas = el(id);
    if (!canvas || !canvas.clientWidth) return;
    const ctx = canvas.getContext('2d'), ratio = window.devicePixelRatio || 1;
    const width = canvas.clientWidth, height = 180, left = 12, right = width - 12, top = 32, bottom = 150;
    canvas.width = width * ratio; canvas.height = height * ratio;
    canvas.style.height = height + 'px';
    ctx.scale(ratio, ratio);
    const values = history.map(row => row[id]);
    const finite = values.filter(Number.isFinite), peak = Math.max(0, ...finite), max = Math.max(1, peak);
    const x = i => left + i / Math.max(1, values.length - 1) * (right - left);
    const y = v => bottom - v / max * (bottom - top);
    const time = i => Number.isFinite(Date.parse(history[i]?.at)) ? new Date(history[i].at).toLocaleTimeString() : 'Time unavailable';
    const value = v => Number.isFinite(v) ? v.toLocaleString(undefined, {maximumFractionDigits:2}) : 'Unavailable';
    const label = canvas.parentElement.querySelector('h2,h3')?.textContent || id;
    canvas.tabIndex = 0; canvas.setAttribute('role','img');
    canvas.setAttribute('aria-label', label + '. Hover to inspect; arrow keys select a sample; Escape returns to live.');
    canvas.title = 'Hover or touch to inspect · ← → browse samples · Escape to return to live';
    const selectedAt = canvas.dataset.selectedAt;
    let selected = selectedAt ? history.findIndex(row => String(row.at) === selectedAt) : -1;
    function draw() {
      ctx.clearRect(0,0,width,height);
      ctx.font = '12px system-ui'; ctx.lineWidth = 1;
      for (let n=0;n<=3;n++) {
        const line = top + n*(bottom-top)/3;
        ctx.strokeStyle = '#262830'; ctx.beginPath();ctx.moveTo(left,line);ctx.lineTo(right,line);ctx.stroke();
      }
      ctx.strokeStyle = '#b8bdd9';ctx.lineWidth=2;ctx.beginPath();
      let gap=true;
      values.forEach((v,i)=>{if(!Number.isFinite(v)){gap=true;return;} if(gap)ctx.moveTo(x(i),y(v));else ctx.lineTo(x(i),y(v));gap=false;});ctx.stroke();
      ctx.fillStyle='#858996';ctx.fillText(time(0),left,174);
      const end=time(history.length-1);ctx.fillText(end,Math.max(left,right-ctx.measureText(end).width),174);
      ctx.fillStyle='#edf3f8';
      ctx.fillText(selected<0 ? `Current ${value(values.at(-1))} · Peak ${finite.length?value(peak):'Unavailable'}` : `${time(selected)} · ${value(values[selected])}`,left,18);
      if(selected>=0 && selected<values.length){
        ctx.strokeStyle='#edf3f8';ctx.lineWidth=1;ctx.setLineDash([3,3]);ctx.beginPath();ctx.moveTo(x(selected),top);ctx.lineTo(x(selected),bottom);ctx.stroke();ctx.setLineDash([]);
        if(Number.isFinite(values[selected])){ctx.fillStyle='#fff';ctx.beginPath();ctx.arc(x(selected),y(values[selected]),4,0,Math.PI*2);ctx.fill();}
      }
    }
    function select(index){selected=index; if(index>=0)canvas.dataset.selectedAt=String(history[index].at);else delete canvas.dataset.selectedAt;draw();}
    canvas.onpointermove=event=>{if(!values.length)return;const pos=event.clientX-canvas.getBoundingClientRect().left;select(Math.max(0,Math.min(values.length-1,Math.round((pos-left)/(right-left)*(values.length-1)))));};
    canvas.onpointerleave=()=>select(-1);
    canvas.onkeydown=event=>{if(event.key==='Escape'){select(-1);return;}if(!values.length||!['ArrowLeft','ArrowRight'].includes(event.key))return;event.preventDefault();select(Math.max(0,Math.min(values.length-1,(selected<0?values.length-1:selected)+(event.key==='ArrowLeft'?-1:1))));};
    draw();
  }

  function renderDiscord(stats) {
    const fields={botLinked:stats?.linkedAccounts,botIssued:stats?.bot?.issued,botUnused:stats?.bot?.unused,botRedeemed:stats?.bot?.redeemed,botPending:stats?.bot?.pending,botRevoked:stats?.bot?.revoked};
    for(const [id,value] of Object.entries(fields)) el(id).textContent=Number.isSafeInteger(value)&&value>=0 ? value : '—';
    el('botStatsStatus').textContent=stats ? `${stats.error || 'Counts from the central account database and bot claim history.'} Updated ${new Date(stats.at).toLocaleTimeString()}` : 'Bot statistics unavailable.';
  }


  function renderFleet(fleet) {
    if (!fleet) return;
    table('fleetRows',fleet.rows.map(s=>[s.name,s.online?'Online':'Unavailable / stale',s.hunts ?? '—',number(s.cpu,'%'),`${number(s.ramUsedMB===null?null:s.ramUsedMB/1024)} / ${number(s.ramTotalMB===null?null:s.ramTotalMB/1024)} GB`,s.huntSampleAt ? new Date(s.huntSampleAt).toLocaleTimeString() : '—']));
    const t=fleet.totals;
    fleetHistory.push({at:new Date().toISOString(),fleetCpuChart:t.meanCpu,fleetRamChart:t.ramUsedMB,fleetHuntChart:t.hunts});
    if(fleetHistory.length>720)fleetHistory.shift();
    for(const id of fleetCharts)graph(id,fleetHistory);
    el('fleetOnline').textContent=`${t.online} / ${t.servers}`;
    el('fleetMeanCpu').textContent=number(t.meanCpu,'%');
    el('fleetHunts').textContent=t.hunts ?? '—';
    el('fleetRam').textContent=`${number(t.ramUsedMB===null?null:t.ramUsedMB/1024)} / ${number(t.ramTotalMB===null?null:t.ramTotalMB/1024)} GB`;
    el('fleetRamPercent').textContent=`${number(t.ramPercent,'%')} of combined capacity`;
    el('fleetAvailability').textContent=`${t.online}/${t.servers} servers reporting. Totals remain unavailable when a required reading is stale.`;
  }

  function renderWorker(worker, prefix='worker') {
    // Fleet rows may include hosts without a dedicated detail panel.
    if (!document.getElementById(prefix+'Connection')) return;
    if(prefix==='worker')lastWorker=worker;else if(prefix==='aus')lastAus=worker;else lastGermany=worker;
    const el=id=>document.getElementById(id.replace(/^worker/,prefix));
    const s=worker?.sample;
    el('workerConnection').textContent=!worker?.configured?'Not configured':worker.online?(worker.status==='delayed'?'Monitoring delayed · last sample retained':'Connected'):'Monitoring unavailable';
    el('workerError').textContent=worker?.error||'';
    if(!s)return;
    el('workerFreshness').textContent=`${Date.now()-Date.parse(s.at)>30000?'STALE — ':''}Sample: ${new Date(s.at).toLocaleString()}`;
    el('workerCpu').textContent=number(s.cpu,'%');el('workerCores').textContent=`${s.logicalCpus} logical processors`;
    el('workerMemory').textContent=`${number(s.ramUsedMB/1024)} / ${number(s.ramTotalMB/1024)} GB`;
    el('workerDisk').textContent=`Disk free ${number(s.diskFreeGB)} GB`;
    el('workerHunts').textContent=s.hunts.filter(h=>!['city','dojo'].includes(h.kind)).length;
    el('workerUptime').textContent=`Host uptime ${duration(s.hostUptimeSeconds)}`;
    table(prefix+'Services',[['Worker monitor',worker.online?'Up':'Unavailable'],['Hunt deployment',s.services.deploy?'Up':'Unavailable'],['Shared backend connection',s.services.backend?'Up':'Unavailable'],['Player allowlist',s.services.allowlist?'Up':'Unavailable']]);
    const f=s.firewall;
    el('workerFirewall').textContent=f?`UDP ${f.ports} · ${f.addresses} authenticated addresses · Firewall ${f.ok===false?'update failed':f.enabled?'open for allowed players':'closed'}${f.pending?' · update pending':''}`:'Firewall state unavailable';
    for(const id of ['CpuChart','RamChart'])graph(prefix+id,(worker.history||[]).map(row=>({...row,[prefix+id]:row['worker'+id]})));
    const p=s.processes;
    el('workerProcessFreshness').textContent=p?`${Date.now()-Date.parse(p.at)>150000?'STALE — ':''}Process sample: ${new Date(p.at).toLocaleString()}`:'Waiting for process sample';
    el('workerNetwork').textContent=p?`Network in ${number(p.netInKbit)} / out ${number(p.netOutKbit)} kbit/s`:'';
    table(prefix+'ProcessRows',(p?.processes||[]).map(v=>[v.role,`${v.pid} / ${v.port??'—'}`,number(v.cpuPercent,'%'),number(v.workingSetMB,' MB'),number(v.privateMB,' MB'),duration((Date.now()-Date.parse(v.startedAt))/1000)]));
    table(prefix+'HuntRows',s.hunts.map(v=>[v.huntId||v.kind,v.port,v.expectedPlayers,duration((Date.now()-Date.parse(v.startedAt))/1000)]));
  }

  function list(id, values) { el(id).replaceChildren(...values.map(text => { const item = document.createElement('li'); item.textContent = text; return item; })); }
  async function refresh() {
    if (!key || busy || document.hidden) return;
    busy = true;
    try {
      const result = await get('/api/status');
      el('error').textContent = result.error || '';
      renderDiscord(result.sample?.discord);

      renderFleet(result.fleet);

      renderWorker(result.worker);
      renderWorker(result.aus,'aus');
      renderWorker(result.germany,'germany');
      el('login').hidden = true; el('data').hidden = false;
      el('invites').hidden = !result.invitesEnabled;
      el('invitesUnavailable').hidden = result.invitesEnabled;
      el('connection').textContent = result.error ? 'Backend unavailable · stale' : 'Connected · private access';
      const s = result.sample;
      if (s) {
        lastSample = s;
        el('serverName').textContent = s.name || 'Owner dashboard';
        el('fleetPlayers').textContent=s.players.length;
        el('fleetAccounts').textContent=s.accounts ?? '—';
        el('fleetLocations').textContent=`Ramsgate ${s.locations.city ?? 0} · Hunts ${s.locations.hunt ?? 0} · Menu ${s.locations.menu ?? 0}`;
        el('onlineValue').textContent = s.players.length;
        el('cityValue').textContent = `Ramsgate ${s.locations.city} · Hunts ${s.locations.hunt}`;
        el('cpuValue').textContent = number(s.cpu, '%'); el('coresValue').textContent = `${s.logicalCpus} logical processors`;
        el('ramValue').textContent = `${number(s.ramUsedMB / 1024)} / ${number(s.ramTotalMB / 1024)} GB`;
        el('ramFreeValue').textContent = `Free ${number((s.ramTotalMB - s.ramUsedMB) / 1024)} GB`;
        el('accountValue').textContent = s.accounts; el('newValue').textContent = `${s.newAccountsObserved} observed additions since startup`;
        el('freshness').textContent = `Last successful sample: ${new Date(s.at).toLocaleString()}`;
        for (const id of charts) graph(id, s.history);
        const r = s.health?.requests;
        el('health').textContent = r ? `Last 60 seconds: ${r.completed} responses · ${r.clientErrors} client errors · ${r.serverErrors} server errors · ${r.aborted} aborted · latency upper bounds p50 ${r.latencyP50UpperMs ?? 'n/a'} ms / p95 ${r.latencyP95UpperMs ?? 'n/a'} ms` : 'Waiting for backend health readings.';
        el('healthError').textContent = s.healthError || '';
        el('locations').textContent = `Ramsgate: ${s.locations.city} · Hunts: ${s.locations.hunt} · Dojo: ${s.locations.dojo} · Tutorial: ${s.locations.tutorial} · Menu: ${s.locations.menu} · Unknown: ${s.locations.unknown}`;
        el('uptimes').textContent = `VPS uptime: ${duration(s.hostUptimeSeconds)} · Backend: ${duration(s.uptimeSeconds)} · Dashboard: ${duration(s.dashboardUptimeSeconds)}`;
        list('playerList', s.players.length ? s.players.map(player => `${player.name} — ${player.where}`) : ['No players online']);
        list('worldList', s.instances.length ? s.instances.map(world => `${world.title}: ${world.players}/${world.maxPlayers}`) : ['No registered worlds']);
        const perf = s.performance;
        el('performanceStatus').textContent = perf ? `${perf.stale || Date.now() - Date.parse(perf.at) > 150000 ? 'STALE — ' : ''}Sample: ${new Date(perf.at).toLocaleString()} · collected approximately once per minute` : 'Performance log unavailable. Configure DASHBOARD_PERFORMANCE_DIR and enable the kit sampler.';
        el('hostExtra').textContent = perf ? `Disk free ${number(perf.host.disk_free_gb)} GB · Network in ${number(perf.host.net_in_kbit_s)} / out ${number(perf.host.net_out_kbit_s)} kbit/s` : '';
        table('processRows', (perf?.processes || []).map(p => [p.role, `${p.pid ?? '—'} / ${p.udp_port ?? '—'}`, number(p.cpu_host_percent, '%'), number(p.working_set_mb, ' MB'), number(p.private_mb, ' MB'), duration((Date.now() - Date.parse(p.started_utc)) / 1000)]));
      }
      if (el('logs').options.length === 0) for (const name of result.logNames) { const option = document.createElement('option'); option.textContent = name; option.value = name; el('logs').append(option); }
    } catch (error) { el('connection').textContent = 'Disconnected · readings stale'; el('error').textContent = `${error.message} Displayed readings may be stale.`; }
    finally { busy = false; }
  }
  el('connect').onclick = () => { key = el('key').value.trim(); el('key').value = ''; refresh(); };
  el('key').onkeydown = event => { if (event.key === 'Enter') el('connect').click(); };
  el('keyFile').onchange = async () => { const file = el('keyFile').files[0]; if (!file) return; if (file.size > 4096) { el('error').textContent = 'Select the small owner.key text file, not a backup archive.'; return; } key = (await file.text()).trim(); el('keyFile').value = ''; refresh(); };
  el('logout').onclick = () => { key = ''; location.reload(); };
  for (const button of document.querySelectorAll('[data-view]')) button.onclick = () => {
    for (const panel of document.querySelectorAll('.view')) panel.hidden = panel.id !== button.dataset.view;
    for (const tab of document.querySelectorAll('[data-view]')) tab.setAttribute('aria-pressed', String(tab === button));
    if (lastSample) for (const id of charts) graph(id, lastSample.history);
    if (button.dataset.view === 'overview')for(const id of fleetCharts)graph(id,fleetHistory);
    if (button.dataset.view === 'people') loadAccounts();
    if (button.dataset.view === 'worker' && lastWorker) renderWorker(lastWorker);
    if (button.dataset.view === 'aus' && lastAus) renderWorker(lastAus,'aus');
    if (button.dataset.view === 'germany' && lastGermany) renderWorker(lastGermany,'germany');
  };
  function showAccounts() {
    const query = el('accountSearch').value.trim().toLowerCase();
    const visible=accountPage.filter(a => `${a.name} ${a.id} ${a.keyFingerprint || ''}`.toLowerCase().includes(query));
    table('accountRows',visible.map(a => [a.name,a.id,a.developer?'Server Developer':a.admin?'Administrator':'Player',a.keyFingerprint || 'No active key']));
    Array.from(el('accountRows').children).forEach((row,i)=>{
      const account=visible[i],cell=row.children[3];
      const reveal=document.createElement('button');reveal.textContent='Show login key';
      reveal.onclick=async()=>{
        reveal.disabled=true;
        try {
          const result=await get('/api/account-key?accountId='+encodeURIComponent(account.id));
          cell.textContent=result.key || 'No recovery copy yet. Original keys were stored as hashes; a successful launcher sign-in saves a recovery copy.';
        } catch {cell.textContent='Recovery unavailable. Try again.';}
      };
      cell.append(document.createTextNode(' '),reveal);
      // One click fills the grant panel with this account, so nobody has to retype a UID.
      const give=document.createElement('button');give.textContent='Give items';
      give.onclick=()=>{
        const field=el('grantAccount');
        if(!field)return;
        field.value=account.id;
        el('grantCard')?.scrollIntoView({block:'nearest'});
        el('grantReference')?.focus();
      };
      if(el('grantAccount'))row.children[1].append(document.createTextNode(' '),give);
      if(!visible[i]?.developer)return;
      row.classList.add('developer-row');
      const role=row.children[2];role.textContent='';
      for(const [text,cls] of [['[ ','developer-bracket'],['Server Developer','developer-label'],[' ]','developer-bracket']]){
        const span=document.createElement('span');span.textContent=text;span.className=cls;role.appendChild(span);
      }
    });
  }
  let pendingAccountSearch=false, searchTimer;
  async function loadAccounts() {
    if (!key) return;
    if (accountsBusy) { pendingAccountSearch=true; return; }
    accountsBusy = true; el('refreshAccounts').disabled = true;
    try { const result = await get(`/api/accounts?offset=${accountOffset}&q=${encodeURIComponent(el('accountSearch').value.trim())}`); accountPage = result.accounts; nextOffset = result.nextOffset; showAccounts(); el('accountStatus').textContent = `Accounts ${accountOffset + (accountPage.length ? 1 : 0)}–${accountOffset + accountPage.length}. Search covers all accounts.`; }
    catch (error) { accountPage = []; nextOffset = null; showAccounts(); el('accountStatus').textContent = `${error.message} Account directory may require a backend update.`; }
    finally { accountsBusy = false; el('refreshAccounts').disabled = false; el('previousAccounts').disabled = accountOffset === 0; el('nextAccounts').disabled = nextOffset === null; if(pendingAccountSearch){pendingAccountSearch=false;void loadAccounts();} }
  }
  el('accountSearch').oninput = () => {accountOffset=0;clearTimeout(searchTimer);searchTimer=setTimeout(loadAccounts,300);};
  el('loadModeration').onclick = async () => {
    try {const info=await get(`/api/moderation?accountId=${encodeURIComponent(el('moderationAccount').value.trim())}`);el('moderationInfo').textContent=JSON.stringify(info,null,2);el('moderationStatus').textContent='Current moderation status loaded.';}
    catch(error){el('moderationStatus').textContent=error.message;}
  };
  async function moderate(active){
    const accountId=el('moderationAccount').value.trim(),reason=el('banReason').value.trim();
    if(!accountId || !reason){el('moderationStatus').textContent='Account ID and reason are required.';return;}
    el('banAccount').disabled=el('unbanAccount').disabled=true;
    try {
      const response=await fetch('/api/moderation',{method:'POST',headers:{'x-dashboard-key':key,'content-type':'application/json'},body:JSON.stringify({accountId,reason,active,includeDevice:active && el('banDevice').checked,includeIp:active && el('banIp').checked,...(active?{durationHours:Number(el('banDuration').value)}:{})}),signal:AbortSignal.timeout(65000)});
      const result=await response.json();if(!response.ok)throw Error(result.error || 'Moderation failed');
      el('moderationInfo').textContent=JSON.stringify(result,null,2);el('moderationStatus').textContent=active?'Player banned. Reason will appear in the launcher.':'Player unbanned.';
      void loadModerationLog('bans');void loadModerationLog('events');
    }catch(error){el('moderationStatus').textContent=error.message;}
    finally{el('banAccount').disabled=el('unbanAccount').disabled=false;}
  }
  el('banAccount').onclick=()=>moderate(true);
  el('unbanAccount').onclick=()=>moderate(false);
  const moderationOffsets={bans:null,events:null};
  async function loadModerationLog(kind,append=false){
    const tbody=el(kind==='bans'?'banRows':'moderationRows'),more=el(kind==='bans'?'moreBans':'moreModerationLog');
    more.disabled=true;
    try {
      const result=await get(`/api/moderation-log?kind=${kind}&offset=${append?(moderationOffsets[kind]??0):0}`);
      if(!append)tbody.replaceChildren();
      for(const row of result.rows){
        const tr=document.createElement('tr');
        const expires=row.expires_at?new Date(row.expires_at).toLocaleString():'Permanent';
        const values=kind==='bans'?[`${row.username??'Unknown'} / ${row.account_id}`,row.reason,expires]:[new Date(row.created_at).toLocaleString(),`${row.username??'Unknown'} / ${row.account_id}`,row.active?'Ban issued':'Ban revoked',row.reason,row.active?expires:'—',row.actor];
        for(const value of values){const td=document.createElement('td');td.textContent=value;tr.append(td);}
        if(kind==='bans'){const td=document.createElement('td'),button=document.createElement('button');button.textContent='Select for review / revoke';button.onclick=()=>{el('moderationAccount').value=row.account_id;el('loadModeration').click();};td.append(button);tr.append(td);}
        tbody.append(tr);
      }
      moderationOffsets[kind]=result.nextOffset;more.disabled=result.nextOffset===null;
      el('moderationListStatus').textContent='Moderation records loaded. Expired suspensions no longer block login.';
    }catch(error){el('moderationListStatus').textContent=error.message;}
  }
  el('refreshBans').onclick=()=>loadModerationLog('bans');
  el('refreshModerationLog').onclick=()=>loadModerationLog('events');
  el('moreBans').onclick=()=>loadModerationLog('bans',true);
  el('moreModerationLog').onclick=()=>loadModerationLog('events',true);
  el('refreshAccounts').onclick = loadAccounts;
  el('nextAccounts').onclick = () => { if (!accountsBusy && nextOffset !== null) { accountOffset = nextOffset; loadAccounts(); } };
  el('previousAccounts').onclick = () => { if (!accountsBusy) { accountOffset = Math.max(0, accountOffset - 100); loadAccounts(); } };
  el('identifyKey').onclick = async () => {
    const value = el('matchKey').value.trim(); el('matchKey').value = '';
    if (!value) return;
    try { const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)); const fingerprint = [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 16); el('matchResult').textContent = `Fingerprint: ${fingerprint}. Computed in this browser; the key was not sent. Compare against the account list.`; el('accountSearch').value = fingerprint; accountOffset=0; loadAccounts(); }
    catch { el('matchResult').textContent = 'Local hashing unavailable. Use the dashboard through localhost.'; }
  };
  el('createInvite').onclick = async () => {
    if (!key) return;
    el('createInvite').disabled = true; el('copyInvite').disabled = true; el('inviteLink').value = '';
    el('inviteStatus').textContent = 'Creating invite…';
    try {
      const response = await fetch('/api/invites', {method: 'POST', headers: {'x-dashboard-key': key, 'content-type': 'application/json'}, body: JSON.stringify({name: el('inviteName').value.trim(), uses: Number(el('inviteUses').value)}), signal: AbortSignal.timeout(20000)});
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || `Invite request refused (${response.status}).`);
      el('inviteLink').value = result.invite; el('copyInvite').disabled = false;
      el('inviteStatus').textContent = `Ready: ${result.uses} account registration(s).`;
    } catch (error) { el('inviteStatus').textContent = `${error.message} A timed-out request may have created an invite; do not retry blindly.`; }
    finally { el('createInvite').disabled = false; }
  };
  el('copyInvite').onclick = async () => {
    try { await navigator.clipboard.writeText(el('inviteLink').value); el('inviteStatus').textContent = 'Link copied.'; }
    catch { el('inviteLink').select(); el('inviteStatus').textContent = 'Press Ctrl+C to copy the selected link.'; }
  };
  el('refreshLog').onclick = async () => { if (!key || !el('logs').value) return; try { el('logText').textContent = (await get(`/api/log?name=${encodeURIComponent(el('logs').value)}`)).text; } catch (error) { el('logText').textContent = error.message; } };
  // ---- Giving items to a player ----
  // Wrapped whole: if a selector here is missing because the page and this script are different
  // versions, moderation and everything above it must still bind.
  try {
    let catalogue = [], catalogueState = 'idle';
    const basket = new Map();
    const MAX_ITEMS = 64, MAX_QUANTITY = 1000000;

    function showItems() {
      const needle = el('grantSearch').value.trim().toUpperCase(), group = el('grantGroup').value;
      const found = catalogue.filter(item => (!group || item.group === group) && item.catalogId.includes(needle));
      const shown = found.slice(0, 400);
      const selector = el('grantItem'), chosen = selector.value;
      selector.replaceChildren(...shown.map(item => {
        const option = document.createElement('option');
        option.value = item.catalogId;
        option.textContent = `${item.catalogId} · ${item.group}`;
        return option;
      }));
      if (shown.some(item => item.catalogId === chosen)) selector.value = chosen;
      else if (shown.length) selector.selectedIndex = 0;
      if (catalogueState !== 'ready') return;
      el('grantCatalogStatus').textContent = found.length === shown.length
        ? `${found.length} of ${catalogue.length} items. Double-click one to add it.`
        : `First ${shown.length} of ${found.length} matches. Narrow the search.`;
    }

    async function loadCatalogue() {
      if (!key || catalogueState === 'loading' || catalogueState === 'ready') return;
      catalogueState = 'loading';
      el('grantCatalogStatus').textContent = 'Loading the item catalogue…';
      try {
        const result = await get('/api/grant-catalog');
        catalogue = Array.isArray(result.items) ? result.items : [];
        catalogueState = catalogue.length ? 'ready' : 'idle';
        showItems();
        if (!catalogue.length) el('grantCatalogStatus').textContent = 'The backend returned no items.';
      } catch (error) {
        catalogueState = 'idle';
        el('grantCatalogStatus').textContent = `${error.message} The metagame may need updating for the item catalogue route.`;
      }
    }

    function showBasket() {
      const rows = [...basket.values()];
      table('grantRows', rows.map(item => [item.catalogId, String(item.quantity), item.kind === 'instanced' ? 'its own item' : 'a stack', '']));
      Array.from(el('grantRows').children).forEach((row, index) => {
        const remove = document.createElement('button');
        remove.textContent = 'Remove';
        remove.onclick = () => { basket.delete(rows[index].catalogId); showBasket(); };
        row.children[3].append(remove);
      });
      el('grantSubmit').disabled = rows.length === 0;
      el('grantSubmit').textContent = rows.length ? `Give ${rows.length} item${rows.length === 1 ? '' : 's'}` : 'Give these items';
    }

    // Only ids the backend listed: a typed id would be accepted by the inventory core and then sit
    // in the player's bags as something the client cannot draw.
    function add(catalogId, quantity) {
      const known = catalogue.find(item => item.catalogId === catalogId);
      if (!known) { el('grantStatus').textContent = `${catalogId} is not in this server's catalogue.`; return false; }
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY) { el('grantStatus').textContent = `Quantity must be a whole number from 1 to ${MAX_QUANTITY}.`; return false; }
      if (basket.size >= MAX_ITEMS && !basket.has(catalogId)) { el('grantStatus').textContent = `One grant carries at most ${MAX_ITEMS} different items.`; return false; }
      basket.set(catalogId, {catalogId, quantity, kind: known.kind});
      showBasket();
      return true;
    }

    async function quickFill(prefix, quantity, label) {
      await loadCatalogue();
      const picked = catalogue.filter(item => item.group === 'material' && item.catalogId.startsWith(prefix));
      if (!picked.length) { el('grantStatus').textContent = `No ${label} in this server's catalogue.`; return; }
      for (const item of picked) add(item.catalogId, quantity);
      el('grantStatus').textContent = `${picked.length} ${label} added at ${quantity} each.`;
    }

    el('grantSearch').oninput = showItems;
    el('grantSearch').onfocus = () => void loadCatalogue();
    el('grantGroup').onchange = showItems;
    el('grantItem').ondblclick = () => el('grantAdd').click();
    el('grantAdd').onclick = () => {
      const chosen = el('grantItem').value;
      if (!chosen) { el('grantStatus').textContent = 'Pick an item from the list first.'; return; }
      if (add(chosen, Number(el('grantQuantity').value))) el('grantStatus').textContent = `${chosen} added to the list.`;
    };
    el('grantClear').onclick = () => { basket.clear(); showBasket(); el('grantStatus').textContent = 'List cleared.'; };
    el('grantAllOrbs').onclick = () => void quickFill('ORB_', 50, 'orbs');
    el('grantStones').onclick = () => void quickFill('GEM_', 50, 'upgrade stones');
    el('grantSubmit').onclick = async () => {
      const accountId = el('grantAccount').value.trim(), reference = el('grantReference').value.trim();
      if (!/^UID-[A-Za-z0-9-]{1,100}$/.test(accountId)) { el('grantStatus').textContent = 'Enter the account ID — it starts with UID-.'; return; }
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(reference)) { el('grantStatus').textContent = 'Give the grant a reference: letters, digits, dash or underscore.'; return; }
      if (!basket.size) return;
      el('grantSubmit').disabled = true;
      el('grantStatus').textContent = 'Granting…';
      try {
        const response = await fetch('/api/grant', {method: 'POST', headers: {'x-dashboard-key': key, 'content-type': 'application/json'},
          body: JSON.stringify({accountId, reference, items: [...basket.values()].map(item => ({catalogId: item.catalogId, quantity: item.quantity}))}),
          signal: AbortSignal.timeout(40000)});
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || `Grant refused (${response.status}).`);
        if (result.replayed) {
          el('grantStatus').textContent = `Nothing changed: ${accountId} already received the grant named "${reference}". Change the reference to give these items again.`;
        } else {
          el('grantStatus').textContent = `Given to ${accountId}: ${result.stacked} stacked and ${result.instanced} own item(s). It appears after their next inventory refresh.`;
          basket.clear();
        }
      } catch (error) { el('grantStatus').textContent = error.message; }
      finally { showBasket(); }
    };
    document.querySelector('[data-view="people"]')?.addEventListener('click', () => void loadCatalogue());
    showBasket();
  } catch (error) { console.error('The item grant panel did not bind', error); }
  setInterval(refresh, 5000);
  document.addEventListener('visibilitychange', refresh);
})();
