export const FRAMES=['5m','15m','30m','1h','4h','1d'];
export const MS={'5m':300000,'15m':900000,'30m':1800000,'1h':3600000,'4h':14400000,'1d':86400000};
export const mean=a=>a.reduce((x,y)=>x+y,0)/a.length;
export function ema(a,n){let e=a[0];for(const x of a.slice(1))e+=2/(n+1)*(x-e);return e;}
export function rsi(a,n=14){let up=0,down=0;for(let i=1;i<=n;i++){const d=a[i]-a[i-1];up+=Math.max(d,0)/n;down+=Math.max(-d,0)/n;}for(let i=n+1;i<a.length;i++){let d=a[i]-a[i-1];up=(up*(n-1)+Math.max(d,0))/n;down=(down*(n-1)+Math.max(-d,0))/n;}return down===0?(up===0?50:100):100-100/(1+up/down);}
export function candles(raw,now){return raw.filter(x=>+x[6]<now).map(x=>({time:+x[0],o:+x[1],h:+x[2],l:+x[3],c:+x[4],v:+x[5],end:+x[6]}));}
export function stats(a){
 const closes=a.map(x=>x.c),last=a.at(-1),prev=a.at(-2);
 const tr=a.slice(1).map((x,i)=>Math.max(x.h-x.l,Math.abs(x.h-a[i].c),Math.abs(x.l-a[i].c)));
 let atr=mean(tr.slice(0,14));for(const v of tr.slice(14))atr=(atr*13+v)/14;
 const e20=ema(closes,20),e50=ema(closes,50);
 const trend=last.c>e50&&e20>e50?1:last.c<e50&&e20<e50?-1:0;
 const levels=[];for(let i=2;i<a.length-2;i++){
  const w=a.slice(i-2,i+3);if(a[i].h===Math.max(...w.map(x=>x.h)))levels.push(a[i].h);
  if(a[i].l===Math.min(...w.map(x=>x.l)))levels.push(a[i].l);
 }
 return {last,prev,atr,e20,e50,trend,rsi:rsi(closes),vol:last.v/Math.max(mean(a.slice(-21,-1).map(x=>x.v)),1e-12),levels,
 high:Math.max(...a.slice(-21,-1).map(x=>x.h)),low:Math.min(...a.slice(-21,-1).map(x=>x.l)),
 changeHour:100*(last.c/a.at(-13).c-1),extension:(last.c-e20)/atr};
}
export function analyze(series,meta,options={},now=Date.now()){
 const base={symbol:meta.symbol,market:meta.market,contractType:meta.contractType,volume:meta.volume,change:meta.change,checked:now,status:'WAIT',score:0,reasons:[],plan:null};
 const s={};
 for(const f of FRAMES){const a=candles(series[f]||[],now);if(a.length<150||a.some(x=>![x.o,x.h,x.l,x.c,x.v].every(Number.isFinite)))return {...base,status:'INSUFFICIENT',reasons:[`Need 150 valid closed ${f} candles`]};
 if(now-a.at(-1).end>MS[f]+15000)return {...base,status:'STALE',reasons:[`${f} candles are stale`]};s[f]=stats(a);}
 const x=s['5m'],p=x.last.c,atr=x.atr;
 if(!(atr>0))return {...base,reasons:['No usable volatility']};
 const levels=FRAMES.flatMap(f=>s[f].levels);
 const support=Math.max(0,...levels.filter(v=>v<p-atr*.15));
 const resistance=Math.min(Infinity,...levels.filter(v=>v>p+atr*.15));
 const pump=x.extension>2.5||x.changeHour>6, dump=x.extension< -2.5||x.changeHour< -6;
 const votes=FRAMES.slice(1).reduce((v,f)=>v+s[f].trend,0);
 const strategies=[];
 for(const dir of [1,-1]){
  const aligned=s['15m'].trend===dir&&s['1h'].trend===dir;
  const confirm=dir===1?x.last.c>x.last.o&&x.last.c>x.prev.c:x.last.c<x.last.o&&x.last.c<x.prev.c;
  if(aligned&&x.trend===dir&&Math.abs(p-x.e20)<atr*1.25&&confirm)strategies.push({name:'Trend pullback',dir});
  if(aligned&&x.vol>=1.5&&(dir===1?p>x.high&&x.prev.c<=x.high:p<x.low&&x.prev.c>=x.low))strategies.push({name:'Volume breakout',dir});
  const history=candles(series['5m'],now).slice(-13,-1);
  const floor=Math.min(...history.map(a=>a.l));
  const ceiling=Math.max(...history.map(a=>a.h));
  const wick=dir===1?Math.min(x.last.o,p)-x.last.l:x.last.h-Math.max(x.last.o,p);
  if(confirm&&wick>Math.abs(p-x.last.o)*1.3&&wick>atr*.25&&(dir===1?x.last.l<=floor+atr*.2&&x.rsi<45:x.last.h>=ceiling-atr*.2&&x.rsi>55)&&s['4h'].trend!==-dir)strategies.push({name:'Support / resistance reversal',dir});
 }
 const candidate=strategies.sort((a,b)=>b.dir*votes-a.dir*votes)[0];
 const out={...base,price:p,support,resistance:Number.isFinite(resistance)?resistance:null,pump,dump,frames:Object.fromEntries(FRAMES.map(f=>[f,s[f].trend])),rsi:x.rsi,atr,volumeRatio:x.vol,candleEnd:x.last.end,expires:x.last.end+MS['5m'],strategies:strategies.map(z=>z.name)};
 if(!candidate)return {...out,reasons:['No confirmed strategy trigger on the last closed 5m candle']};
 const dir=candidate.dir,reasons=[],same=strategies.filter(z=>z.dir===dir);
 let score=45+Math.max(0,dir*votes)*6+Math.min(10,Math.max(0,x.vol-1)*5)+Math.min(10,(same.length-1)*10);
 if((dir===1&&pump)||(dir===-1&&dump))reasons.push('Price is extended: wait for a pullback');
 if(s['4h'].trend===-dir&&s['1d'].trend===-dir)reasons.push('4h and daily trend oppose this trade');
 if((meta.volume||0)<(options.minVolume??5000000))reasons.push('24h dollar turnover below liquidity filter');
 const tick=meta.tick||p*1e-8;
 const round=(v,up=false)=>(up?Math.ceil(v/tick):Math.floor(v/tick))*tick;
 const entry=round(p,dir===1);
 const stop=round(dir===1?Math.min(...candles(series['5m'],now).slice(-7).map(a=>a.l))-atr*.2:Math.max(...candles(series['5m'],now).slice(-7).map(a=>a.h))+atr*.2,dir===-1);
 const risk=dir*(entry-stop), cost=entry*((options.feeBps??5)+(options.slippageBps??3))*2/10000;
 if(risk<atr*.6||risk>atr*3.5||stop<=0)reasons.push('Stop distance is unsuitable');
 const barrier=dir===1?resistance:support;
 const room=dir===1?barrier-entry:entry-barrier;
 const rr=(room-cost)/(risk+cost);
 if(!Number.isFinite(room)||barrier===0)reasons.push('No confirmed target-side structure');
 if(rr<(options.minRR??2))reasons.push('Insufficient room before support / resistance after costs');
 if(score<65)reasons.push('Weak multi-timeframe agreement');
 const targetR=Math.min(3,Math.max(0,room*.95/risk));
 const targets=[1,Math.min(2,targetR),targetR].map(r=>round(entry+dir*risk*r,dir===-1));
 const netRR=(dir*(targets[2]-entry)-cost)/(risk+cost);
 if(netRR<(options.minRR??2))reasons.push('Final target fails minimum net reward/risk');
 const plan={side:dir===1?'BUY / LONG':'SELL / SHORT',entry,entryLow:entry-atr*.15,entryHigh:entry+atr*.15,stop,targets,netRR,feeBps:options.feeBps??5,slippageBps:options.slippageBps??3};
 return {...out,status:reasons.length?'WAIT':dir===1?'BUY':'SELL',score:Math.round(Math.min(95,score)),reasons:reasons.length?reasons:[`${candidate.name}; ${Math.max(0,dir*votes)} net higher-timeframe votes`],plan:reasons.length?null:plan};
}
