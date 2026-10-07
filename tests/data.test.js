import test from 'node:test';
import assert from 'node:assert/strict';
import {dataURL,fetchData,withRetries} from '../public/data.js';
test('browser uses official USD-M and COIN-M public hosts',()=>{
 assert.equal(dataURL('time','usd',{},'browser'),'https://fapi.binance.com/fapi/v1/time');
 assert.equal(dataURL('ticker','coin',{},'browser'),'https://dapi.binance.com/dapi/v1/ticker/24hr');
});
test('direct candle requests are bounded and closed at the selected interval',()=>{
 const now=1800000005000;const u=new URL(dataURL('klines','usd',{symbol:'BTCUSDT',interval:'5m'},'browser',now));
 assert.equal(u.searchParams.get('limit'),'180');assert.equal(+u.searchParams.get('endTime'),Math.floor((now-3000)/300000)*300000-1);
 assert.match(dataURL('time','coin',{},'server'),/^\/api\/time\?market=coin$/);
 assert.throws(()=>dataURL('klines','usd',{symbol:'../../anything',interval:'5m'}));
});
test('HTML 403 is reported clearly without an automatic source switch',async()=>{
 let calls=0;await assert.rejects(fetchData('time','usd',{},'browser',Date.now(),async()=>{calls++;return new Response('<html>Access denied</html>',{status:403});}),e=>e.fatal&&/HTTP 403/.test(e.message)&&/browser/.test(e.message));assert.equal(calls,1);
});
test('CORS/network errors explain lack of data',async()=>{
 await assert.rejects(fetchData('time','usd',{},'browser',Date.now(),async()=>{throw new TypeError('Failed to fetch');}),e=>!e.fatal&&e.retryable&&/CORS/.test(e.message));
});
test('rate limits preserve Retry-After cooldown',async()=>{
 await assert.rejects(fetchData('time','usd',{},'browser',Date.now(),async()=>new Response('',{status:429,headers:{'Retry-After':'120'}})),e=>e.fatal&&e.retryMs===120000);
});
test('public data requests omit credentials and parse normal JSON',async()=>{
 const out=await fetchData('time','usd',{},'browser',Date.now(),async(u,opts)=>{assert.equal(opts.credentials,'omit');return Response.json({serverTime:42});});assert.equal(out.serverTime,42);
});

test('isolated transient failures retry and recover with bounded delays',async()=>{
 let calls=0;const delays=[];
 const result=await withRetries(async()=>{if(++calls<3){const e=new Error('timeout');e.retryable=true;throw e;}return 42;},{wait:async ms=>delays.push(ms)});
 assert.equal(result,42);assert.equal(calls,3);assert.deepEqual(delays,[1500,4000]);
});
test('persistent transient failures stop after three attempts',async()=>{
 let calls=0;await assert.rejects(withRetries(async()=>{calls++;const e=new Error('network');e.retryable=true;throw e;},{wait:async()=>{}}),/network/);assert.equal(calls,3);
});
test('access blocks are not retried and cancelled scans send no request',async()=>{
 let calls=0;await assert.rejects(withRetries(async()=>{calls++;const e=new Error('403');e.fatal=true;e.retryable=true;throw e;}),/403/);assert.equal(calls,1);
 await assert.rejects(withRetries(async()=>{calls++;},{active:()=>false}),e=>e.cancelled);assert.equal(calls,1);
});
test('failed requests identify market, contract and timeframe',async()=>{
 await assert.rejects(fetchData('klines','usd',{symbol:'BTCUSDT',interval:'15m'},'browser',Date.now(),async()=>{throw Error('timeout');}),/USD BTCUSDT 15m/);
});
