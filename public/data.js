const BASES={usd:'https://fapi.binance.com/fapi/v1/',coin:'https://dapi.binance.com/dapi/v1/'};
const PERIODS={'5m':300000,'15m':900000,'30m':1800000,'1h':3600000,'4h':14400000,'1d':86400000};
export function dataURL(endpoint,market='usd',args={},source='browser',now=Date.now()){
 if(!BASES[market]||!['time','exchangeInfo','ticker','klines'].includes(endpoint))throw Error('Invalid market-data request');
 if(source==='server')return '/api/'+endpoint+'?'+new URLSearchParams({market,...args});
 if(source!=='browser')throw Error('Invalid data source');
 const u=new URL(BASES[market]+(endpoint==='ticker'?'ticker/24hr':endpoint));
 if(endpoint==='klines'){
  if(!/^[A-Z0-9_]{3,40}$/.test(args.symbol||'')||!PERIODS[args.interval])throw Error('Invalid candle request');
  u.searchParams.set('symbol',args.symbol);u.searchParams.set('interval',args.interval);
  u.searchParams.set('limit','180');u.searchParams.set('endTime',String(Math.floor((now-3000)/PERIODS[args.interval])*PERIODS[args.interval]-1));
 }
 return u.toString();
}
export async function fetchData(endpoint,market,args,source,now=Date.now(),fetcher=globalThis.fetch){
 const label=`${market.toUpperCase()} ${args?.symbol||endpoint}${args?.interval?' '+args.interval:''}`;
 const annotate=e=>{e.message=`${label}: ${e.message}`;return e;};
 let r;
 try{r=await fetcher(dataURL(endpoint,market,args,source,now),{signal:AbortSignal.timeout(18000),cache:'no-store',credentials:'omit'});}
 catch{
  const e=new Error(source==='browser'?'Browser could not reach Binance. Possible causes include browser cross-origin (CORS) restrictions, a network block, or a timeout. No live data is available.':'Cloudflare data request failed or timed out.');e.fatal=false;e.retryable=true;throw annotate(e);
 }
 let body;try{body=await r.json();}catch{body=null;}
 if(!r.ok){
  const route=source==='browser'?'your browser connection':'the Cloudflare server';
  let reason=r.status===403?`Binance denied access from ${route} (HTTP 403). This may be an IP/firewall block; the precise cause is not confirmed.`:r.status===451?`Binance reports location-restricted access from ${route} (HTTP 451).`:[418,429].includes(r.status)?`Binance rate-limited ${route} (HTTP ${r.status}). Scanning is paused.`:body?.error||`Market-data request failed (HTTP ${r.status}).`;
  const e=new Error(reason);e.fatal=[403,418,429,451].includes(r.status);
  if([418,429].includes(r.status)){const header=r.headers.get('Retry-After');const sec=Number(header);e.retryMs=header&&Number.isFinite(sec)?Math.max(60000,sec*1000):Math.max(60000,(Date.parse(header)||0)-Date.now());}
  e.retryable=r.status>=500;throw annotate(e);
 }
 if(body===null||typeof body!=='object'){const e=new Error('Binance returned an invalid market-data response.');e.fatal=false;e.retryable=true;throw annotate(e);}
 return body;
}

// Retry only transient failures; never retry access denials or rate limits automatically.
export async function withRetries(operation,{wait=ms=>new Promise(r=>setTimeout(r,ms)),active=()=>true,onRetry=()=>{}}={}){
 for(let attempt=0;attempt<3;attempt++){
  if(!active()){const e=new Error('Scan cancelled');e.cancelled=true;throw e;}
  try{return await operation();}
  catch(e){if(e.fatal||!e.retryable||attempt===2)throw e;onRetry(e,attempt+1);await wait(attempt===0?1500:4000);}
 }
}
