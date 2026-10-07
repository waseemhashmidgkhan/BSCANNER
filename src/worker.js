const bases={usd:'https://fapi.binance.com/fapi/v1/',coin:'https://dapi.binance.com/dapi/v1/'};
const intervals={'5m':300,'15m':900,'30m':1800,'1h':3600,'4h':14400,'1d':86400};
const json=(body,status=200,headers={})=>Response.json(body,{status,headers:{'Cache-Control':'no-store',...headers}});
export default {
 async fetch(request,env,ctx){
  const u=new URL(request.url);
  if(!u.pathname.startsWith('/api/'))return env.ASSETS.fetch(request);
  if(request.method!=='GET')return json({error:'GET only'},405);
  const market=u.searchParams.get('market')||'usd';
  if(!bases[market])return json({error:'Invalid market'},400);
  const name=u.pathname.slice(5);
  if(!['exchangeInfo','ticker','klines','time'].includes(name))return json({error:'Unknown endpoint'},404);
  const upstream=new URL(bases[market]+(name==='ticker'?'ticker/24hr':name));
  let ttl=name==='exchangeInfo'?3600:name==='ticker'?20:1;
  if(name==='klines'){
   const symbol=u.searchParams.get('symbol'),interval=u.searchParams.get('interval');
   if(!/^[A-Z0-9_]{3,40}$/.test(symbol||'')||!intervals[interval])return json({error:'Invalid candle request'},400);
   upstream.searchParams.set('symbol',symbol);upstream.searchParams.set('interval',interval);upstream.searchParams.set('limit','180');
   // Fetch only closed candles. Fixed boundary keys allow safe reuse until the next close.
   const end=Math.floor((Date.now()-2000)/(intervals[interval]*1000))*intervals[interval]*1000-1;
   upstream.searchParams.set('endTime',String(end));ttl=intervals[interval];
  }
  const key=new Request(upstream.toString());
  const cache=globalThis.caches?.default;
  if(cache&&name!=='time'){const hit=await cache.match(key);if(hit)return hit;}
  try{
   const r=await fetch(upstream,{signal:AbortSignal.timeout(12000),headers:{Accept:'application/json'}});
   if(!r.ok){
    const retry=r.headers.get('Retry-After')||'60';
    return json({error:`Binance returned HTTP ${r.status}. ${r.status===403?'Access from the Cloudflare server was denied. An IP/firewall block is possible; the precise cause is not confirmed.':r.status===451?'Binance reports location-restricted access from the Cloudflare server.':'Scanning is paused for rate limits or upstream failure.'}`,upstreamStatus:r.status},r.status,{'Retry-After':retry});
   }
   const data=await r.json();
   const response=Response.json(data,{headers:{'Cache-Control':`public, max-age=${ttl}`,'X-Content-Type-Options':'nosniff'}});
   if(cache&&name!=='time')ctx.waitUntil(cache.put(key,response.clone()));
   return response;
  }catch{return json({error:'Binance connection timed out or failed. No market data was fabricated.'},502);}
 }
};
