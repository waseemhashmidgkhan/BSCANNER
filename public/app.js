import {FRAMES,MS,analyze} from './engine.js';
import {fetchData} from './data.js';
const $=s=>document.querySelector(s),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=n=>Number.isFinite(n)?n.toLocaleString('en-US',{maximumSignificantDigits:8}):'—';
let records=new Map(),universe=[],running=false,filter='SETUPS',sample=false,done=0,errors=0,pass=0,generation=0,clockOffset=0,nextRequest=0;
const candleCache=new Map();
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let source='browser',blockedUntil=0;
async function api(endpoint,market='usd',args={}){
 const slot=Math.max(Date.now(),nextRequest);nextRequest=slot+150;await sleep(Math.max(0,slot-Date.now()));
 try{return await fetchData(endpoint,market,args,source,Date.now()+clockOffset);}
 catch(e){if(e.retryMs)blockedUntil=Math.max(blockedUntil,Date.now()+e.retryMs);throw e;}
}
function status(r){return !sample&&r.expires&&Date.now()+clockOffset>=r.expires?'STALE':r.status;}
function render(){
 const rows=[...records.values()].map(r=>({...r,visible:status(r)}));
 $('#universe').textContent=universe.length||'—';$('#coverage').textContent=done;$('#pass').textContent=sample?'SAMPLE DATA':pass?`Pass ${pass} · ${Math.max(0,universe.length-done)} remaining`:'Ready to scan';
 $('#signals').textContent=rows.filter(r=>['BUY','SELL'].includes(r.visible)).length;$('#bar').style.width=(done/Math.max(universe.length,1)*100)+'%';
 const q=$('#search').value.toUpperCase();
 const list=rows.filter(r=>r.symbol.includes(q)&&(filter==='ALL'||filter==='SETUPS'&&['BUY','SELL'].includes(r.visible)||r.visible===filter)).sort((a,b)=>((['BUY','SELL'].includes(b.visible)?1000:0)+b.score)-((['BUY','SELL'].includes(a.visible)?1000:0)+a.score));
 $('#empty').hidden=!!list.length;$('#empty').textContent=records.size?'No matching fresh setups. Select All contracts to see waiting, stale, or failed analyses.':'Start live scanning, or preview the interface with clearly labeled sample data.';
 $('#rows').innerHTML=list.map(r=>`<tr><td><b>${esc(r.symbol)}</b><small>${r.market==='usd'?'USDⓈ-M':'COIN-M'} · ${esc(r.contractType||'')}</small></td><td><span class="badge ${r.visible}">${r.visible}</span><small>${r.score?`${r.score}/100 agreement`:'—'}</small></td><td>${fmt(r.price)}<small>${Number(r.change||0).toFixed(2)}% in 24h</small></td><td><div class="frames">${FRAMES.map(f=>`<span class="frame ${r.frames?.[f]===1?'up':r.frames?.[f]===-1?'down':'flat'}">${f}<b>${r.frames?.[f]===1?'↑':r.frames?.[f]===-1?'↓':'·'}</b></span>`).join('')}</div></td><td>${r.pump?'Extended up':r.dump?'Extended down':r.support&&r.price-r.support<=r.atr?'Near support':r.resistance&&r.resistance-r.price<=r.atr?'Near resistance':r.price?'Within range':'Pending'}<small>${r.volume?fmt(r.volume/1e6)+'M USD turnover':'—'}</small></td><td>${r.plan&&r.visible===r.status?Number(r.plan.netRR).toFixed(2)+' : 1':'—'}</td><td>${r.checked?Math.max(0,Math.floor((Date.now()+clockOffset-r.checked)/60000))+'m':'—'}</td><td><button class="secondary" data-id="${esc(r.market+':'+r.symbol)}">Details</button></td></tr>`).join('');
}
function detail(id){const r=records.get(id);if(!r)return;const fresh=['BUY','SELL'].includes(status(r)),p=fresh?r.plan:null;
 $('#detailBody').innerHTML=`<p class="eyebrow">${sample?'SAMPLE · NOT A LIVE SIGNAL':esc(r.market.toUpperCase())}</p><h2>${esc(r.symbol)} <span class="badge ${status(r)}">${status(r)}</span></h2><p class="reason">${esc(r.reasons?.join(' · '))}</p>${p?`<p>${p.side} · Plan reference at the last candle close. Refresh and check the market before entering.</p><div class="plan">${[['Entry reference',p.entry],['Entry zone low',p.entryLow],['Entry zone high',p.entryHigh],['Stop-loss',p.stop],...p.targets.map((v,i)=>['TP'+(i+1),v]),['Net R:R to TP3',p.netRR]].map(([k,v])=>`<div><small>${k}</small><b>${fmt(v)}</b></div>`).join('')}</div><p>Suggested exit sequence: 40% at TP1, 35% at TP2, 25% at TP3. Net R:R shown is to TP3 only; partial exits reduce blended reward. Exit remaining size at the stop. Funding is not included.</p><p>Skip if price has left the entry zone, a target or stop has already traded, or the next 5m candle has closed. Levels are proposals, not exchange orders.</p>`:'<p>No actionable entry or exit plan. '+(status(r)==='STALE'?'This analysis has expired; scan again for a fresh setup.':'Wait for the listed conditions to improve.')+'</p>'}<div class="plan"><div><small>Support</small>${fmt(r.support)}</div><div><small>Resistance</small>${fmt(r.resistance)}</div><div><small>5m RSI</small>${fmt(r.rsi)}</div></div><p class="reason">${r.candleEnd?'Signal candle closed: '+new Date(r.candleEnd).toLocaleString():''}</p>`;
 $('#detail').showModal();}
$('#rows').addEventListener('click',e=>{const b=e.target.closest('[data-id]');if(b)detail(b.dataset.id);});$('#close').onclick=()=>$('#detail').close();
$('.tabs').onclick=e=>{const b=e.target.closest('[data-filter]');if(!b)return;filter=b.dataset.filter;document.querySelectorAll('[data-filter]').forEach(x=>x.classList.toggle('active',x===b));render();};$('#search').oninput=render;
function controls(){ $('#start').disabled=running;$('#stop').disabled=!running;$('#demo').disabled=running;$('#source').disabled=running;document.querySelectorAll('.fields input').forEach(x=>x.disabled=running);}
async function loadUniverse(){
 const all=[];let unavailable=[];
 for(const market of ['usd','coin']){
  try{const info=await api('exchangeInfo',market),tickers=await api('ticker',market);if(!Array.isArray(info.symbols)||!Array.isArray(tickers))throw Error('Invalid exchange response');const by=new Map(tickers.map(x=>[x.symbol,x]));
   for(const s of info.symbols.filter(x=>(x.status||x.contractStatus)==='TRADING')){const t=by.get(s.symbol)||{};const volume=market==='usd'?Number(t.quoteVolume||0):Number(t.baseVolume||0)*Number(t.weightedAvgPrice||t.lastPrice||0);all.push({...s,market,volume,change:+t.priceChangePercent||0,tick:+s.filters?.find(x=>x.filterType==='PRICE_FILTER')?.tickSize||0});}
  }catch(e){unavailable.push(`${market}: ${e.message}`);if(e.fatal)throw e;}
 }
 if(!all.length)throw Error('No active contracts could be loaded. '+unavailable.join(' '));
 if(unavailable.length)throw Error('Cannot scan the complete universe: '+unavailable.join(' '));
 return all.sort((a,b)=>b.volume-a.volume);
}
async function getCandles(m,f){const now=Date.now()+clockOffset,key=m.market+':'+m.symbol+':'+f,boundary=Math.floor((now-3000)/MS[f])*MS[f];const cached=candleCache.get(key);if(cached?.boundary===boundary)return cached.data;const data=await api('klines',m.market,{symbol:m.symbol,interval:f});if(!Array.isArray(data))throw Error('Invalid candle data');candleCache.set(key,{boundary,data});return data;}
async function start(){
 if(running)return;if(Date.now()<blockedUntil){$('#status').textContent=`Rate-limit cooldown: wait ${Math.ceil((blockedUntil-Date.now())/1000)} seconds before restarting.`;return;}source=$('#source').value;clockOffset=0;const opts={minVolume:+$('#liquidity').value,minRR:+$('#rr').value,feeBps:+$('#fee').value,slippageBps:+$('#slip').value};
 if(Object.values(opts).some(v=>!Number.isFinite(v)||v<0)||opts.minRR<1){$('#status').textContent='Enter valid nonnegative filters and reward/risk of at least 1.';return;}
 running=true;sample=false;const token=++generation;records.clear();candleCache.clear();done=0;pass=0;errors=0;controls();$('#health').textContent='Loading';$('#status').textContent=`Loading all active USDⓈ-M and COIN-M contracts via ${source==='browser'?'your browser':'Cloudflare'}…`;
 try{
  const before=Date.now(),time=await api('time');clockOffset=time.serverTime-(before+Date.now())/2;
  const loaded=await loadUniverse();if(token!==generation||!running)return;universe=loaded;for(const m of universe)records.set(m.market+':'+m.symbol,{...m,status:'PENDING',score:0,reasons:['Not analyzed yet']});
  while(running&&token===generation){pass++;done=0;let index=0;$('#health').textContent='Live';
   async function lane(){while(running&&token===generation){const m=universe[index++];if(!m)return;const id=m.market+':'+m.symbol;
    try{const series={};for(const f of FRAMES){if(!running||token!==generation)return;series[f]=await getCandles(m,f);}if(token!==generation||!running)return;records.set(id,analyze(series,m,opts,Date.now()+clockOffset));}
    catch(e){if(token!==generation||!running)return;errors++;records.set(id,{...m,status:'ERROR',score:0,reasons:[e.message],checked:Date.now()+clockOffset});if(e.fatal){running=false;$('#status').textContent=e.message+' Scanning stopped; inspect the error before restarting.';$('#health').textContent='Blocked';}}
    done++;$('#errors').textContent=`${errors} failed analyses`;if(running)$('#status').textContent=`Scanning ${done} / ${universe.length} · All six timeframes per contract · Most liquid first`;render();
   }}
   await Promise.all([lane(),lane(),lane()]);
   if(running&&token===generation){$('#status').textContent='Pass complete. Next pass starts after the next 5m close.';await sleep(Math.max(3000,300000-((Date.now()+clockOffset)%300000)+3500));if(running&&token===generation){const refreshed=await loadUniverse();if(token!==generation||!running)return;universe=refreshed;const ids=new Set(universe.map(m=>m.market+':'+m.symbol));for(const id of records.keys())if(!ids.has(id))records.delete(id);}}
  }
 }catch(e){if(token===generation){$('#status').textContent=e.message;$('#health').textContent='Unavailable';}}
 finally{if(token===generation){running=false;controls();render();}}
}
$('#start').onclick=start;$('#stop').onclick=()=>{running=false;generation++;$('#health').textContent='Paused';$('#status').textContent='Scan paused. Existing signals expire at the next 5m close.';controls();render();};
$('#demo').onclick=()=>{sample=true;generation++;records.clear();universe=[{symbol:'SAMPLEUSDT'}];done=1;pass=0;records.set('usd:SAMPLEUSDT',{symbol:'SAMPLEUSDT',market:'usd',contractType:'PERPETUAL',status:'BUY',score:81,price:100,volume:50000000,change:2.1,frames:{'5m':1,'15m':1,'30m':1,'1h':1,'4h':0,'1d':1},support:98,resistance:106,rsi:54,checked:Date.now(),reasons:['SAMPLE DATA — illustrates the layout only'],plan:{side:'BUY / LONG',entry:100,entryLow:99.9,entryHigh:100.1,stop:98.5,targets:[101.5,103,104.5],netRR:2.61}});$('#health').textContent='Sample';$('#errors').textContent='Not connected to Binance';$('#status').textContent='SAMPLE DATA — this is not a live signal. Start live scan for real market data.';render();};
setInterval(()=>{$('#clock').textContent=new Date().toLocaleString(undefined,{timeZoneName:'short'});render();if($('#detail').open){const r=[...records.values()].find(x=>$('#detailBody h2')?.textContent.startsWith(x.symbol));if(r&&!sample&&status(r)==='STALE'&&$('#detailBody').textContent.includes('Entry reference')){$('#detailBody').innerHTML='<h2>Setup expired</h2><p>The next 5m candle has closed. Refresh this contract before considering an entry.</p>';}}},10000);render();
