'use client';
import {useEffect,useMemo,useRef,useState} from 'react';
import type {ReactNode} from 'react';
import {ArrowUpRight,Check,Download,Minus,Plus,TriangleAlert} from 'lucide-react';
import {Tabs,TabsList,TabsTrigger,TabsContent} from '@/components/ui/tabs';
import {CATALOG,COSTS,forecastView,money,recommendation} from '@/lib/game';
import type {Action,Game,ForecastView} from '@/lib/game';
import {GP,MARKET,METHODS,SERVICE_LEVELS,WEEKDAYS,errorStats,fit,fmt,intervalZ,methodInfo,normCdf,normInv,normWeights,predictiveSd,table,weekday} from '@/lib/forecast';
import type {Fit,ForecastSettings} from '@/lib/forecast';

type Dispatch=(a:Action)=>{ok:boolean};
type Props={game:Game;dispatch:Dispatch};
const TS_LIMIT=4;
const C={ink:'#dce4d2',muted:'#93a193',grid:'#b6cb9c18',axis:'#8fa285',actual:'#d5dcb2',fc:'#b4a2ff',fut:'#ffcb6b',warn:'#e5bf77',cool:'#74b4ff',green:'#557856',weekend:'#b6cb9c0c'};
const PARAM={alpha:{sym:'α',name:'水平平滑'},beta:{sym:'β',name:'趋势平滑'}} as const;
const dayLabel=(t:number)=>t<=0?`历史 ${t}`:`第 ${t} 天`;
const signed=(x:number,dp=1)=>`${x>0?'+':x<0?'−':''}${Math.abs(x).toFixed(dp)}`;

export default function ForecastPanel({game,dispatch}:Props){
 return <Tabs defaultValue="board" className="terminal-tabs fc">
  <TabsList><TabsTrigger value="board">预测看板</TabsTrigger><TabsTrigger value="table">逐期计算表</TabsTrigger><TabsTrigger value="compare">方法对比</TabsTrigger><TabsTrigger value="order">订货建议</TabsTrigger></TabsList>
  <TabsContent value="board"><Board game={game} dispatch={dispatch}/></TabsContent>
  <TabsContent value="table"><Steps game={game} dispatch={dispatch}/></TabsContent>
  <TabsContent value="compare"><Compare game={game} dispatch={dispatch}/></TabsContent>
  <TabsContent value="order"><Order game={game} dispatch={dispatch}/></TabsContent>
 </Tabs>;
}

/* ---------- 共享数据 ---------- */
const useView=(game:Game)=>{const key=JSON.stringify(game.forecast);return useMemo(()=>forecastView(game),[game.day,key]);};
/** 六种方法在同一窗口、同一组参数下的拟合与误差 */
function useAllMethods(game:Game,v:ForecastView){
 const key=JSON.stringify(game.forecast);
 return useMemo(()=>METHODS.map(m=>{const f=m.id===game.forecast.method?v.fit:fit(v.series,{...game.forecast,method:m.id});return {m,f,e:errorStats(f.rows,v.from),next:f.ahead(v.N-1,1)};}),[v,key]);
}
/** 监听容器宽度，图表按真实像素绘制，文字不会被拉伸 */
function useWidth<T extends HTMLElement>(){
 const ref=useRef<T>(null);const [w,setW]=useState(640);
 useEffect(()=>{const el=ref.current;if(!el)return;const ro=new ResizeObserver(([e])=>setW(Math.max(200,Math.floor(e.contentRect.width))));ro.observe(el);return()=>ro.disconnect();},[]);
 return [ref,w] as const;
}
/** 数字平滑滚动到新值（尊重“减少动态效果”设置） */
function Tween({value,format=(x:number)=>String(Math.round(x))}:{value:number;format?:(x:number)=>string}){
 const [shown,setShown]=useState(value);const from=useRef(value);
 useEffect(()=>{const start=from.current,end=value;if(start===end)return;
  if(typeof window!=='undefined'&&window.matchMedia?.('(prefers-reduced-motion: reduce)').matches){from.current=end;setShown(end);return;}
  let raf=0;const t0=performance.now();const tick=(now:number)=>{const k=Math.min(1,(now-t0)/380),e=1-Math.pow(1-k,3),x=start+(end-start)*e;from.current=x;setShown(x);if(k<1)raf=requestAnimationFrame(tick);};
  raf=requestAnimationFrame(tick);return()=>cancelAnimationFrame(raf);},[value]);
 return <>{format(shown)}</>;
}
const Eyebrow=({children,right}:{children:ReactNode;right?:ReactNode})=><div className="fc-eyebrow"><span>{children}</span>{right&&<span>{right}</span>}</div>;

/* ---------- 方法选择与参数 ---------- */
function MethodRail({game,dispatch,all}:Props&{all:ReturnType<typeof useAllMethods>}){
 const best=Math.min(...all.map(x=>x.e.mad)),max=Math.max(...all.map(x=>x.e.mad));
 return <div className="fc-rail" role="radiogroup" aria-label="预测方法">{all.map(({m,e})=>{const on=m.id===game.forecast.method;return <button key={m.id} role="radio" aria-checked={on} className={on?'fc-method on':'fc-method'} title={m.idea} onClick={()=>dispatch({type:'forecast',settings:{method:m.id}})}>
  <span className="fc-method-top"><b>{m.short}</b><em>{fmt(e.mad)}</em></span>
  <span className="fc-method-name">{m.name.replace(/（.*）/,'')}</span>
  <span className="fc-meter"><i style={{width:`${Math.max(6,e.mad/max*100)}%`}} className={e.mad===best?'best':''}/></span>
 </button>})}</div>;
}
function Slider({label,sym,value,min,max,step,onChange,format=(x:number)=>x.toFixed(2)}:{label:string;sym?:string;value:number;min:number;max:number;step:number;onChange:(v:number)=>void;format?:(x:number)=>string}){
 const [local,setLocal]=useState(value);useEffect(()=>setLocal(value),[value]);
 const pct=(local-min)/(max-min)*100;
 return <label className="fc-slider"><span className="fc-slider-head"><span>{sym&&<i className="fc-sym">{sym}</i>}{label}</span><b>{format(local)}</b></span>
  <input type="range" min={min} max={max} step={step} value={local} style={{'--pct':`${pct}%`} as React.CSSProperties}
   onChange={e=>{const x=Number(e.target.value);setLocal(x);onChange(x);}}/></label>;
}
function Params({game,dispatch}:Props){
 const s=game.forecast,info=methodInfo(s.method),set=(p:Partial<ForecastSettings>)=>dispatch({type:'forecast',settings:p});
 if(!info.params.length)return <div className="fc-params"><p className="fc-hint">朴素法没有参数：下一期就等于本期实际值。它是检验其他方法的基准线。</p></div>;
 const w=normWeights(s.weights);
 return <div className="fc-params">
  {info.params.includes('n')&&<Slider label="移动期数 n" value={s.n} min={2} max={28} step={1} format={x=>`${x} 天`} onChange={v=>set({n:v})}/>}
  {info.params.includes('weights')&&<div className="fc-weights"><span className="fc-slider-head"><span>权重 w（从最近一期起，自动归一）</span><span className="fc-weight-ops">
    <button aria-label="减少一期" disabled={s.weights.length<=2} onClick={()=>set({weights:s.weights.slice(0,-1)})}><Minus size={12}/></button>
    <button aria-label="增加一期" disabled={s.weights.length>=6} onClick={()=>set({weights:[...s.weights,s.weights.at(-1)!/2||.1]})}><Plus size={12}/></button></span></span>
   <div className="fc-weight-grid">{s.weights.map((x,i)=><Slider key={i} label={`w${i+1}`} value={x} min={0} max={1} step={.05} format={()=>w[i].toFixed(2)} onChange={v=>set({weights:s.weights.map((y,j)=>j===i?v:y)})}/>)}</div></div>}
  {(['alpha','beta'] as const).filter(p=>info.params.includes(p)).map(p=><Slider key={p} sym={PARAM[p].sym} label={PARAM[p].name} value={s[p]} min={.05} max={1} step={.05} onChange={v=>set({[p]:v})}/>)}
  {info.params.includes('gp')&&<>
   <div className="fc-slider fc-gp-kernel">
    <span className="fc-slider-head"><span><i className="fc-sym">k</i> 核函数</span><b>{s.gpKernel==='rbf_periodic'?'RBF + 周期':'RBF'}</b></span>
    <div className="fc-seg" role="radiogroup" aria-label="GP 核函数">
     <button role="radio" aria-checked={s.gpKernel==='rbf'} className={s.gpKernel==='rbf'?'on':''} onClick={()=>set({gpKernel:'rbf'})}>RBF<em>平滑相关</em></button>
     <button role="radio" aria-checked={s.gpKernel==='rbf_periodic'} className={s.gpKernel==='rbf_periodic'?'on':''} onClick={()=>set({gpKernel:'rbf_periodic'})}>RBF + 周期<em>周季节</em></button>
    </div>
   </div>
   <Slider sym="ℓ" label="RBF 长度尺度" value={s.ell} min={.5} max={30} step={.5} format={x=>`${x.toFixed(1)} 天`} onChange={v=>set({ell:v})}/>
   <Slider sym="σf²" label="RBF 信号方差" value={s.sf2} min={10} max={3000} step={10} format={x=>x.toFixed(0)} onChange={v=>set({sf2:v})}/>
   {s.gpKernel==='rbf_periodic'&&<Slider sym="σp²" label="周期核方差" value={s.sp2} min={0} max={3000} step={10} format={x=>x.toFixed(0)} onChange={v=>set({sp2:v})}/>}
   <Slider sym="σn²" label="观测噪声方差" value={s.sn2} min={1} max={500} step={1} format={x=>x.toFixed(0)} onChange={v=>set({sn2:v})}/>
   <p className="fc-hint fc-gp-hint">均值函数 = 线性趋势 × 星期因子（最近 {GP.meanWindow} 天估计）；GP 对去均值后的残差建模，返回均值与含噪声的预测方差。</p>
  </>}
 </div>;
}

/* ---------- 图表 ---------- */
interface FuturePoint {t:number;f:number;band:number}
function DemandChart({v,future,today,height=260}:{v:ForecastView;future:FuturePoint[];today:number;height?:number}){
 const [ref,W]=useWidth<HTMLDivElement>();const [hover,setHover]=useState<number|null>(null);
 const past=v.fit.rows.slice(Math.max(0,v.N-42));
 const pad={l:44,r:14,t:22,b:28},H=height,iw=W-pad.l-pad.r,ih=H-pad.t-pad.b;
 const t0=past[0].t,t1=future.length?future.at(-1)!.t:today;
 const top=Math.max(...past.map(r=>Math.max(r.d,r.f??0)),...future.map(p=>p.f+p.band));
 const step=top>600?200:top>300?100:50,yMax=Math.ceil(top*1.08/step)*step;
 const X=(t:number)=>pad.l+(t-t0)/(t1-t0)*iw,Y=(y:number)=>pad.t+ih-Math.max(0,y)/yMax*ih,dx=iw/(t1-t0);
 const path=(pts:[number,number][])=>pts.map((p,i)=>`${i?'L':'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('');
 const actual=path(past.map(r=>[X(r.t),Y(r.d)]));
 const fc=path(past.filter(r=>r.f!==null).map(r=>[X(r.t),Y(r.f!)]));
 const last=past.at(-1)!;
 const fut=path([[X(last.t),Y(last.d)],...future.map(p=>[X(p.t),Y(p.f)] as [number,number])]);
 const band=future.length?path([...future.map(p=>[X(p.t),Y(p.f+p.band)] as [number,number]),...[...future].reverse().map(p=>[X(p.t),Y(p.f-p.band)] as [number,number])])+'Z':'';
 const every=7*Math.max(1,Math.ceil(64/(7*dx)));const firstMon=Array.from({length:7},(_,k)=>t0+k).find(t=>weekday(t)===0)!;
 const ticks:number[]=[];for(let t=t1-((t1-firstMon)%every+every)%every;t>=t0;t-=every)ticks.unshift(t);
 const shock=MARKET.shockDay,shockRow=today>shock?past.find(r=>r.t===shock):undefined;
 const hp=hover===null?null:hover<today?past.find(r=>r.t===hover):future.find(p=>p.t===hover);
 const onMove=(e:React.PointerEvent<SVGRectElement>)=>{const box=e.currentTarget.getBoundingClientRect();const t=Math.round(t0+(e.clientX-box.left)/box.width*(t1-t0));setHover(Math.min(t1,Math.max(t0,t)));};
 return <div className="fc-chart" ref={ref}>
  <svg width={W} height={H} role="img" aria-label="按需需求：实际值、一步预测与未来预测区间">
   {Array.from({length:t1-t0+1},(_,i)=>t0+i).filter(t=>weekday(t)>=5).map(t=><rect key={t} x={X(t)-dx/2} y={pad.t} width={dx} height={ih} fill={C.weekend}/>)}
   <rect x={X(today-.5)} y={pad.t} width={X(t1)+dx/2-X(today-.5)} height={ih} fill="#ffcb6b07"/>
   {Array.from({length:yMax/step+1},(_,i)=>i*step).map(y=><g key={y}><line x1={pad.l} x2={W-pad.r} y1={Y(y)} y2={Y(y)} stroke={C.grid}/><text x={pad.l-8} y={Y(y)+4} textAnchor="end" className="fc-axis">{y}</text></g>)}
   {ticks.map(t=><text key={t} x={X(t)} y={H-8} textAnchor="middle" className="fc-axis">{W<520?(t<=0?String(t):`D${t}`):dayLabel(t)}</text>)}
   {band&&<path d={band} fill="#ffcb6b1c" className="fc-anim"/>}
   <path d={fc} fill="none" stroke={C.fc} strokeWidth={1.5} strokeDasharray="4 3" className="fc-anim"/>
   <path d={actual} fill="none" stroke={C.actual} strokeWidth={2} strokeLinejoin="round"/>
   <path d={fut} fill="none" stroke={C.fut} strokeWidth={2} strokeLinejoin="round" className="fc-anim"/>
   <line x1={X(today-.5)} x2={X(today-.5)} y1={pad.t-6} y2={pad.t+ih} stroke={C.actual} strokeDasharray="2 4"/>
   <text x={X(today-.5)+6} y={pad.t+6} className="fc-axis" fill={C.actual}>今天 · 第 {today} 天</text>
   {shockRow&&<g><circle cx={X(shock)} cy={Y(shockRow.d)} r={4.5} fill="none" stroke={C.warn} strokeWidth={1.5}/><text x={X(shock)-9} y={Y(shockRow.d)-4} textAnchor="end" className="fc-axis" fill={C.warn}>需求冲击</text></g>}
   {hover!==null&&<line x1={X(hover)} x2={X(hover)} y1={pad.t} y2={pad.t+ih} stroke="#d5dcb260"/>}
   <rect x={pad.l} y={pad.t} width={iw} height={ih} fill="transparent" onPointerMove={onMove} onPointerLeave={()=>setHover(null)}/>
  </svg>
  {hover!==null&&hp&&<div className="fc-tip" style={{left:Math.min(W-170,Math.max(0,X(hover)+10)),top:pad.t+4}}>
   <b>{dayLabel(hover)} · 周{WEEKDAYS[weekday(hover)]}</b>
   {'d' in hp?<><span><i style={{background:C.actual}}/>实际 {hp.d}</span>{hp.f!==null&&<span><i style={{background:C.fc}}/>预测 {fmt(hp.f)}　误差 {signed(hp.d-hp.f)}</span>}</>
    :<span><i style={{background:C.fut}}/>预测 {fmt(hp.f)} ± {fmt(hp.band,0)}</span>}
  </div>}
 </div>;
}
function TsChart({rows,height=104}:{rows:ReturnType<typeof table>;height?:number}){
 const [ref,W]=useWidth<HTMLDivElement>();
 const pts=rows.filter(r=>r.e!==null),m=Math.max(6,...pts.map(r=>Math.abs(r.ts)))*1.1;
 const pad={l:26,r:6,t:6,b:6},iw=W-pad.l-pad.r,ih=height-pad.t-pad.b;
 const X=(i:number)=>pad.l+i/Math.max(1,pts.length-1)*iw,Y=(v:number)=>pad.t+ih/2-v/m*ih/2;
 return <div ref={ref}><svg width={W} height={height} role="img" aria-label="跟踪信号控制图">
  <rect x={pad.l} y={Y(TS_LIMIT)} width={iw} height={Y(-TS_LIMIT)-Y(TS_LIMIT)} fill="#55785630"/>
  <line x1={pad.l} x2={W-pad.r} y1={Y(0)} y2={Y(0)} stroke={C.grid}/>
  {[TS_LIMIT,-TS_LIMIT].map(v=><text key={v} x={pad.l-5} y={Y(v)+4} textAnchor="end" className="fc-axis">{v>0?'+4':'−4'}</text>)}
  <path d={pts.map((r,i)=>`${i?'L':'M'}${X(i).toFixed(1)},${Y(r.ts).toFixed(1)}`).join('')} fill="none" stroke={C.actual} strokeWidth={1.5} className="fc-anim"/>
  {pts.map((r,i)=>Math.abs(r.ts)>TS_LIMIT&&<circle key={i} cx={X(i)} cy={Y(r.ts)} r={2.8} fill={C.warn}/>)}
 </svg></div>;
}

/* ---------- 公式：教科书排版 + 最近一期实时代入 ---------- */
const V=({c,s}:{c:string;s?:ReactNode})=><><var>{c}</var>{s!==undefined&&<sub>{s}</sub>}</>;
const n1=(x:number|null|undefined,dp=1)=>x===null||x===undefined?'—':x.toFixed(dp);
function Formula({f,s,v}:{f:Fit;s:ForecastSettings;v:ForecastView}){
 const i=v.N-1,r=f.rows[i],t=r.t,d=t+1,prev=f.rows[i-1],out=f.ahead(i,1);
 const D=(k:number)=>v.series[i-k].d;
 let lines:ReactNode[]=[],sub:ReactNode=null;
 if(s.method==='naive'){lines=[<><V c="F" s="t+1"/> = <V c="D" s="t"/></>];sub=<><V c="F" s={d}/> = <V c="D" s={t}/> = <b>{D(0)}</b></>;}
 else if(s.method==='sma'){const n=s.n,terms=Array.from({length:n},(_,k)=>D(k));lines=[<><V c="F" s="t+1"/> = (<V c="D" s="t"/> + <V c="D" s="t−1"/> + … + <V c="D" s="t−n+1"/>) / <var>n</var></>];
  sub=<><V c="F" s={d}/> = ({(n>4?[...terms.slice(0,3),'…',terms.at(-1)]:terms).join(' + ')}) / {n} = <b>{n1(out)}</b></>;}
 else if(s.method==='wma'){const w=normWeights(s.weights);lines=[<><V c="F" s="t+1"/> = <V c="w" s="1"/><V c="D" s="t"/> + <V c="w" s="2"/><V c="D" s="t−1"/> + … ，Σ<var>w</var> = 1</>];
  sub=<><V c="F" s={d}/> = {w.map((x,k)=>`${x.toFixed(2)}×${D(k)}`).join(' + ')} = <b>{n1(out)}</b></>;}
 else if(s.method==='ses'){lines=[<><V c="F" s="t+1"/> = <var>α</var><V c="D" s="t"/> + (1 − <var>α</var>)<V c="F" s="t"/></>];
  sub=<><V c="F" s={d}/> = {s.alpha} × {D(0)} + {(1-s.alpha).toFixed(2)} × {n1(r.f)} = <b>{n1(out)}</b></>;}
 else if(s.method==='holt'){lines=[<><V c="L" s="t"/> = <var>α</var><V c="D" s="t"/> + (1 − <var>α</var>)(<V c="L" s="t−1"/> + <V c="T" s="t−1"/>)</>,<><V c="T" s="t"/> = <var>β</var>(<V c="L" s="t"/> − <V c="L" s="t−1"/>) + (1 − <var>β</var>)<V c="T" s="t−1"/></>,<><V c="F" s="t+h"/> = <V c="L" s="t"/> + <var>h</var>·<V c="T" s="t"/></>];
  sub=<><V c="L" s={t}/> = {s.alpha} × {D(0)} + {(1-s.alpha).toFixed(2)} × ({n1(prev?.level)} + {n1(prev?.trend,2)}) = {n1(r.level)}<br/><V c="F" s={d}/> = {n1(r.level)} + {n1(r.trend,2)} = <b>{n1(out)}</b></>;}
 else{const g=f.gp,last=g?.last;
  lines=[<><var>m</var>(<var>x</var>) = (<var>a</var> + <var>b</var>·<var>x</var>) · <var>S</var><sub>weekday</sub></>,<>f(<var>x</var>) ~ GP(0, <var>k</var>)，<var>k</var> = <var>k</var><sub>RBF</sub>{g?.kernel==='rbf_periodic'?' + k周期':''}</>,<>μ* = <var>m</var>(<var>x</var>*) + <var>k</var>*ᵀ(<var>K</var> + σ<sub>n</sub>²<var>I</var>)⁻¹(<var>y</var> − <var>m</var>)</>,<><var>v</var>* = <var>k</var>** − <var>k</var>*ᵀ(<var>K</var> + σ<sub>n</sub>²<var>I</var>)⁻¹<var>k</var>*</>,<>ŷ* = μ*，Var(ŷ*) = <var>v</var>* + σ<sub>n</sub>²</>];
  sub=last?<><var>x</var>* = 第 {last.x} 天：<var>m</var>(<var>x</var>*) = {n1(last.m)}，μ* = <b>{n1(last.mean)}</b><br/><var>v</var>* = {n1(last.latentVar,2)}，σ = √(<var>v</var>* + σ<sub>n</sub>²) = <b>{n1(Math.sqrt(last.obsVar))}</b></>:'样本不足，暂用先验均值。';}
 return <div className="fc-formula">
  <div className="fc-math">{lines.map((l,k)=><div key={k}>{l}</div>)}</div>
  <div className="fc-sub"><span className="fc-eyebrow-inline">代入第 {t} 天的数据</span><div className="fc-math small">{sub}</div></div>
 </div>;
}

/* ---------- ① 预测看板 ---------- */
function Board({game,dispatch}:Props){
 const v=useView(game),all=useAllMethods(game,v),info=methodInfo(game.forecast.method);
 const L=CATALOG.find(x=>x.id==='compute')!.days,z=game.forecast.z,zBand=intervalZ(z);
 const e=all.find(x=>x.m.id===game.forecast.method)!.e;
 const future=useMemo<FuturePoint[]>(()=>Array.from({length:14},(_,k)=>{const h=k+1,f=v.fit.ahead(v.N-1,h),sd=predictiveSd(v.fit,v.N-1,h,v.from)??(predictiveSd(v.fit,v.N-1,1,v.from)??0)*Math.sqrt(h);return {t:game.day+k,f:Math.max(0,f??0),band:zBand*sd};}),[v,zBand,game.day]);
 const today=future[0],arrival=future[L];
 const tsRows=useMemo(()=>table(v.fit.rows,v.from),[v]);
 const last=game.spotLog.at(-1),fill=last&&last.demand?last.served/last.demand:null;
 const level=SERVICE_LEVELS.find(x=>Math.abs(x.z-z)<.001)?.label??`${(normCdf(z)*100).toFixed(0)}%`;
 const lostCost=game.totalLost*COSTS.under,idleCost=(game.totalIdle||0)*COSTS.over,tradeTotal=lostCost+idleCost||1;
 return <div className="fc-board">
  <Eyebrow right={`最近 ${MARKET.window} 天 MAD`}>FORECAST · {info.short.toUpperCase()} · DAY {String(game.day).padStart(2,'0')}</Eyebrow>
  <MethodRail game={game} dispatch={dispatch} all={all}/>
  <Params game={game} dispatch={dispatch}/>
  <div className="fc-hero">
   <div className="fc-hero-main"><small>今日（第 {game.day} 天 · 周{WEEKDAYS[weekday(game.day)]}）需求预测</small><strong><Tween value={today.f}/><em>GPU</em></strong><span>结算前的经营预估就用这个数</span></div>
   <div><small>交期日（第 {arrival.t} 天）</small><b><Tween value={arrival.f}/><em>± <Tween value={arrival.band}/></em></b><span>{level} 预测区间 · 今天下单 {L} 天后到货</span></div>
   <div><small>昨日满足率</small><b className={fill!==null&&fill<.95?'warn':''}>{fill===null?'—':`${Math.round(fill*100)}%`}</b><span>{last?`需求 ${last.demand}，满足 ${last.served}`:'第一天结算后显示'}</span></div>
   <div className="fc-trade"><small>缺货 vs 闲置（开局以来）</small>
    <div className="fc-trade-row"><span><i className="lost"/>缺货 {game.totalLost.toLocaleString()} GPU·天</span><b>{money(lostCost,true)}</b></div>
    <div className="fc-trade-row"><span><i className="idle"/>闲置 {(game.totalIdle||0).toLocaleString()} GPU·天</span><b>{money(idleCost,true)}</b></div>
    <div className="fc-trade-bar" title="两类成本的占比"><i className="lost" style={{width:`${lostCost/tradeTotal*100}%`}}/><i className="idle" style={{width:`${idleCost/tradeTotal*100}%`}}/></div></div>
  </div>
  <DemandChart v={v} future={future} today={game.day}/>
  <div className="fc-legend"><span><i style={{background:C.actual}}/>实际需求 Dₜ</span><span><i className="dash" style={{borderColor:C.fc}}/>一步预测 Fₜ</span><span><i style={{background:C.fut}}/>未来 14 天预测</span><span><i className="area"/>{level} 预测区间</span><span><i className="weekend"/>周末</span></div>
  <div className="fc-signal">
   <div className="fc-kpis">
    <div><small>MAD</small><b><Tween value={e.mad} format={x=>x.toFixed(1)}/></b><span>平均绝对偏差</span></div>
    <div><small>MAPE</small><b>{fmt(e.mape)}<em>%</em></b><span>RMSE {fmt(e.rmse)}</span></div>
    <div><small>偏差</small><b>{signed(e.bias)}</b><span>{e.bias>0?'正：预测偏低':'负：预测偏高'}</span></div>
   </div>
   <div className={Math.abs(e.ts)>TS_LIMIT?'fc-ts alarm':'fc-ts'}>
    <div className="fc-ts-head"><span>跟踪信号 TS · 控制图</span><b>{Math.abs(e.ts)>TS_LIMIT&&<TriangleAlert size={12}/>}{fmt(e.ts,2)}{Math.abs(e.ts)>TS_LIMIT?` 超出 ±${TS_LIMIT}`:` 在 ±${TS_LIMIT} 内`}</b></div>
    <TsChart rows={tsRows}/>
   </div>
  </div>
  <Eyebrow right={info.name}>FORMULA</Eyebrow>
  <Formula f={v.fit} s={game.forecast} v={v}/>
  <p className="fc-note"><b>{info.idea}</b> 初始化：{v.fit.init}</p>
  <p className="fc-note">记号：误差 eₜ = Dₜ − Fₜ，正数表示预测偏低。误差指标统计最近 {MARKET.window} 天。跟踪信号 TS = Σeₜ ÷ MAD，超出 ±{TS_LIMIT} 通常说明需求模式变了，或方法跟不上趋势。预测区间 = 预测值 ± {zBand.toFixed(2)} × {game.forecast.method==='gp'?'GP 后验预测标准差（含观测噪声 σₙ²）':'回测得到的 h 步误差均方根'}；{zBand.toFixed(2)} 是把当前服务水平换算成同覆盖率双侧区间后的分位数（95% 服务 → 1.96），与「订货建议」的安全量使用同一服务水平。</p>
 </div>;
}

/* ---------- ② 逐期计算表 ---------- */
function Steps({game,dispatch}:Props){
 const v=useView(game),all=useAllMethods(game,v),info=methodInfo(game.forecast.method),rows=table(v.fit.rows,v.from);
 const hasL=rows.some(r=>r.level!==undefined),hasT=rows.some(r=>r.trend!==undefined),hasMean=rows.some(r=>r.mean!==undefined),hasSD=rows.some(r=>r.sd!==undefined),nState=+hasL+ +hasT+ +hasMean+ +hasSD;
 const emax=Math.max(1,...rows.map(r=>Math.abs(r.e??0)));
 const exportCsv=()=>{
  const head=['运营日','星期','实际需求D','预测F','误差e=D-F','|e|','e^2','APE%',hasL?'水平L':'',hasT?'趋势T':'',hasMean?'结构均值m':'',hasSD?'预测标准差sigma':''].filter(Boolean);
  const lines=v.fit.rows.map(r=>{const e=r.f===null?null:r.d-r.f;return [r.t,'周'+WEEKDAYS[weekday(r.t)],r.d,r.f===null?'':r.f.toFixed(4),e===null?'':e.toFixed(4),e===null?'':Math.abs(e).toFixed(4),e===null?'':(e*e).toFixed(4),e===null||!r.d?'':(Math.abs(e)/r.d*100).toFixed(4),...(hasL?[r.level?.toFixed(4)??'']:[]),...(hasT?[r.trend?.toFixed(4)??'']:[]),...(hasMean?[r.mean?.toFixed(4)??'']:[]),...(hasSD?[r.sd?.toFixed(4)??'']:[])].join(',');});
  const blob=new Blob(['﻿'+[head.join(','),...lines].join('\n')],{type:'text/csv;charset=utf-8'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`NEXUS需求预测_${info.short}_第${game.day}天.csv`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),2000);
 };
 return <div>
  <Eyebrow right={info.name}>STEP-BY-STEP · 最近 {rows.length} 期</Eyebrow>
  <MethodRail game={game} dispatch={dispatch} all={all}/>
  <Params game={game} dispatch={dispatch}/>
  <div className="fc-table-head"><span>Σe、MAD、TS 从窗口第一期开始滚动累计。误差条：<i className="swatch warm"/>预测偏低　<i className="swatch cool"/>预测偏高</span><button className="secondary-button" onClick={exportCsv}><Download size={14}/>导出全部历史 CSV</button></div>
  <div className="fc-table steps"><table>
   <thead><tr className="group"><th colSpan={4}>数据</th><th colSpan={4}>误差</th>{nState>0&&<th colSpan={nState}>方法状态</th>}<th colSpan={3}>累计</th></tr>
    <tr><th>运营日</th><th>星期</th><th>Dₜ</th><th>Fₜ</th><th className="ebar-h">eₜ = Dₜ − Fₜ</th><th>|eₜ|</th><th>eₜ²</th><th>APE</th>{hasL&&<th>Lₜ</th>}{hasT&&<th>Tₜ</th>}{hasMean&&<th>mₜ</th>}{hasSD&&<th>σₜ</th>}<th>Σe</th><th>MAD</th><th>TS</th></tr></thead>
   <tbody>{rows.map((r,i)=><FragmentRow key={r.t} divider={r.t===1&&i>0} span={11+nState}>
    <tr className={`${r.t>=1?'game':'hist'}${weekday(r.t)>=5?' weekend':''}`}>
     <td>{dayLabel(r.t)}</td><td>{WEEKDAYS[weekday(r.t)]}</td><td>{r.d}</td><td>{fmt(r.f)}</td>
     <td className="ebar">{r.e===null?'—':<span className="ebar-cell"><span className="ebar-track"><i className={r.e>0?'warm':'cool'} style={{width:`${Math.abs(r.e)/emax*50}%`,[r.e>0?'left':'right']:'50%'}}/></span><span className="ebar-num">{signed(r.e)}</span></span>}</td>
     <td>{r.e===null?'—':fmt(Math.abs(r.e))}</td><td>{r.e===null?'—':fmt(r.e*r.e,0)}</td><td>{r.e===null||!r.d?'—':fmt(Math.abs(r.e)/r.d*100)+'%'}</td>
     {hasL&&<td>{fmt(r.level,2)}</td>}{hasT&&<td>{fmt(r.trend,3)}</td>}{hasMean&&<td>{fmt(r.mean,2)}</td>}{hasSD&&<td>{fmt(r.sd,2)}</td>}
     <td>{signed(r.cum)}</td><td>{fmt(r.mad)}</td><td><span className={Math.abs(r.ts)>TS_LIMIT?'fc-badge warn':'fc-badge'}>{fmt(r.ts,2)}</span></td>
    </tr></FragmentRow>)}</tbody></table></div>
  <p className="fc-note">“历史”是开局前预置的数据（第 −55 天到第 0 天），“第 n 天”是经营中已经结算的日子；今天的需求要点「下一天」结算后才会出现。周末行有浅色底纹。导出的 CSV 带全部历史与方法中间量，可在 Excel 里逐格复算。{hasSD?' GP 的 mₜ 是结构均值（趋势 × 星期因子），σₜ 是含观测噪声的预测标准差。GP 使用固定 56 天滚动窗口；在平稳核下，各期一步预测的相对位置相同，因此窗口内 σₜ 基本相同，h 步区间才会随 h 变宽。':''}</p>
 </div>;
}
function FragmentRow({divider,span,children}:{divider:boolean;span:number;children:ReactNode}){
 return <>{divider&&<tr className="divider"><td colSpan={span}><span>开局 · 以下为经营中已结算的日子</span></td></tr>}{children}</>;
}

/* ---------- ③ 方法对比 ---------- */
function Compare({game,dispatch}:Props){
 const v=useView(game),all=useAllMethods(game,v);
 const ranked=[...all].sort((a,b)=>a.e.mad-b.e.mad),max=Math.max(...all.map(x=>x.e.mad)),bmax=Math.max(1,...all.map(x=>Math.abs(x.e.bias)));
 return <div>
  <Eyebrow right={`最近 ${MARKET.window} 天 · 按 MAD 从小到大`}>LEADERBOARD</Eyebrow>
  <div className="fc-rank">
   <div className="fc-rank-head"><span>#</span><span>方法</span><span>MAD</span><span>RMSE</span><span>MAPE</span><span>偏差</span><span>TS</span><span>今日预测</span><span/></div>
   {ranked.map(({m,e,next},i)=>{const on=m.id===game.forecast.method;return <div key={m.id} className={`fc-rank-row${on?' on':''}${i===0?' top':''}`}>
    <span className="fc-rank-no">{i+1}</span>
    <span className="fc-rank-name"><b>{m.name.replace(/（.*）/,'')}</b><small>{m.short}</small></span>
    <span className="fc-rank-mad"><span className="fc-meter wide"><i className={i===0?'best':''} style={{width:`${Math.max(4,e.mad/max*100)}%`}}/></span><b>{fmt(e.mad)}</b></span>
    <span>{fmt(e.rmse)}</span><span>{fmt(e.mape)}%</span>
    <span className="fc-bias"><span className="fc-bias-track"><i className={e.bias>0?'warm':'cool'} style={{width:`${Math.abs(e.bias)/bmax*50}%`,[e.bias>0?'left':'right']:'50%'}}/></span><small>{signed(e.bias)}</small></span>
    <span><span className={Math.abs(e.ts)>TS_LIMIT?'fc-badge warn':'fc-badge'}>{fmt(e.ts,2)}</span></span>
    <span>{next===null?'—':Math.round(next)}</span>
    <span>{on?<span className="fc-inuse"><Check size={13}/>使用中</span>:<button className="secondary-button fc-small" onClick={()=>dispatch({type:'forecast',settings:{method:m.id}})}>使用</button>}</span>
   </div>})}
  </div>
  <p className="fc-note">参数沿用你当前的设置：{game.forecast.method==='gp'?<>GP 核 = {game.forecast.gpKernel==='rbf_periodic'?'RBF + 周期':'RBF'}，ℓ = {game.forecast.ell} 天，σ_f² = {game.forecast.sf2}{game.forecast.gpKernel==='rbf_periodic'?`，σ_p² = ${game.forecast.sp2}`:''}，σ_n² = {game.forecast.sn2}。</>:<>n = {game.forecast.n}，权重 {normWeights(game.forecast.weights).map(x=>x.toFixed(2)).join(' / ')}，α = {game.forecast.alpha}，β = {game.forecast.beta}。</>}偏差条向右（暖色）表示预测系统性偏低，向左（冷色）表示偏高。可以讨论：哪种方法偏差接近 0？需求冲击后谁的 TS 最先报警、又最先恢复？排名第一只代表过去 4 周，不保证未来。</p>
 </div>;
}

/* ---------- ④ 订货建议 ---------- */
function Order({game,dispatch}:Props){
 const key=JSON.stringify(game.forecast)+game.day+game.orders.length+game.contracts.length+game.gpu+game.progress+game.cash;
 const r=useMemo(()=>recommendation(game),[key]);
 const set=(p:Partial<ForecastSettings>)=>dispatch({type:'forecast',settings:p});
 const buy=(item:(typeof CATALOG)[number]['id'],n:number)=>dispatch({type:'buy',item,qty:n}).ok;
 const buyAll=()=>{for(const x of r.items)if(x.lots&&!buy(x.id,x.lots))break;};
 const scale=Math.max(r.target,...r.items.map(x=>x.have+x.pipeline))*1.08;
 const parts=[{k:'到货时仍有效的合同',v:r.contracted,c:'seg-contract'},{k:'按需需求预测',v:r.peak,c:'seg-forecast'},{k:`安全量 z·σ`,v:r.safety,c:'seg-safety'}];
 const need=r.items.filter(x=>x.lots>0),zStar=+normInv(COSTS.critical).toFixed(3);
 return <div>
  <Eyebrow right={`预测方法：${methodInfo(game.forecast.method).name.replace(/（.*）/,'')}`}>REPLENISHMENT</Eyebrow>
  <div className="fc-order-controls">
   <div><small>目标服务水平</small><div className="fc-seg" role="radiogroup">{SERVICE_LEVELS.map(x=><button key={x.z} role="radio" aria-checked={Math.abs(x.z-r.z)<.001} className={Math.abs(x.z-r.z)<.001?'on':''} onClick={()=>set({z:x.z})}>{x.label.replace('（不留安全量）','')}<em>z {x.z}</em></button>)}
    <button role="radio" aria-checked={Math.abs(r.z-zStar)<.001} className={Math.abs(r.z-zStar)<.001?'on star':'star'} onClick={()=>set({z:zStar})} title="按缺货成本与闲置成本算出的临界比">临界比 {(COSTS.critical*100).toFixed(0)}%<em>z {zStar}</em></button></div></div>
   <div><small>检查周期 R</small><div className="fc-stepper"><button aria-label="减少一天" disabled={r.review<=1} onClick={()=>set({review:r.review-1})}><Minus size={13}/></button><b>{r.review} 天</b><button aria-label="增加一天" disabled={r.review>=14} onClick={()=>set({review:r.review+1})}><Plus size={13}/></button></div></div>
  </div>
  <div className="fc-target">
   <div className="fc-target-head"><span>目标就绪容量 S</span><strong><Tween value={r.target} format={x=>Math.round(x).toLocaleString()}/><em>GPU</em></strong></div>
   <div className="fc-stack">{parts.map(p=><i key={p.c} className={p.c} style={{width:`${p.v/r.target*100}%`}} title={`${p.k}：${fmt(p.v)}`}/>)}</div>
   <div className="fc-stack-legend">{parts.map(p=><span key={p.c}><i className={p.c}/>{p.k}<b>{fmt(p.v,0)}</b></span>)}</div>
   <div className="fc-math small">S = {r.contracted} + {fmt(r.peak)} + {r.z} × {fmt(r.sigma)} = <b>{r.target.toLocaleString()}</b></div>
   <p className="fc-note tight">今天下单的 GPU 第 {game.day+r.L} 天到货（提前期 L = {r.L} 天），容量要覆盖第 {r.path[0].day}{r.path.length>1?` – ${r.path.at(-1)!.day}`:''} 天，取其中“合同 + 预测”最大的第 {r.peakDay} 天。{r.expiring>0?` 有 ${r.expiring} GPU 的合同会在到货前到期，已扣除。`:''}σ 是 {r.sigmaSource==='gp'?`GP 在交货窗口内的最大预测标准差（含观测噪声 σₙ² = ${game.forecast.sn2}）`:r.sigmaSource==='backtest'?`回测得到的 ${r.h0} 步预测误差均方根`:`一步误差 × √${r.h0}（回测样本不足时的教材近似）`}。</p>
  </div>
  <h3 className="section-title">各系统：现有 + 在途 vs 目标 <span>{need.length?`缺口在 ${need.map(x=>x.name.replace(/(计算机柜组|模块|阵列|单元|高速)/g,'').trim()).join('、')}`:'全部达标'}</span></h3>
  <div className="fc-cap">{r.items.map(x=><div key={x.id} className={x.gap?'fc-cap-row short':'fc-cap-row'}>
   <span className="fc-cap-name">{x.name}<small>每批 {x.lot.toLocaleString()} · {x.days} 天交付</small></span>
   <span className="fc-cap-bar"><i className="have" style={{width:`${x.have/scale*100}%`}}/><i className="pipe" style={{width:`${x.pipeline/scale*100}%`}}/><b className="target" style={{left:`${r.target/scale*100}%`}}/></span>
   <span className="fc-cap-num">{(x.have+x.pipeline).toLocaleString()}<em>/ {r.target.toLocaleString()}</em></span>
   <span className="fc-cap-act">{x.lots?<button className="secondary-button fc-small" disabled={game.cash<x.cost||game.lost} onClick={()=>buy(x.id,x.lots)}>{x.lots} 批 · {money(x.cost,true)}</button>:<span className="fc-ok"><Check size={13}/>达标</span>}</span>
  </div>)}</div>
  <div className="fc-cap-legend"><span><i className="have"/>现有</span><span><i className="pipe"/>在途</span><span><i className="target"/>目标 S</span></div>
  {r.spaceShort&&<div className="fault"><TriangleAlert/><div><h3>机房空间不够：A1 最多 {r.space} GPU</h3><p>目标容量 {r.target} GPU 超过当前空间。A2 预计 {r.spaceDays} 天后完工，可以在「施工进度」中加速。</p></div></div>}
  <div className="fc-costs">
   <div><small>缺货成本 C<sub>u</sub></small><b>{money(COSTS.under)}<em>/ GPU·天</em></b><span>流失的按需收入 ${(MARKET.rate*24).toFixed(0)}，减去省下的电费</span></div>
   <div><small>闲置成本 C<sub>o</sub></small><b>{money(COSTS.over)}<em>/ GPU·天</em></b><span>折旧 ${COSTS.depreciation.toFixed(1)} + 资金占用 ${COSTS.capital.toFixed(1)} + 维护 ${COSTS.maintenance.toFixed(1)} + 待机电费 ${COSTS.idlePower.toFixed(1)}</span></div>
   <div><small>临界比 C<sub>u</sub> / (C<sub>u</sub> + C<sub>o</sub>)</small><b>{COSTS.critical.toFixed(2)}<em>→ z = {zStar}</em></b><span>报童模型的思路：缺一台比多一台贵得多时，服务水平应定得更高</span></div>
  </div>
  <div className="fc-buyall">
   <div><b>{need.length?`按建议采购 ${need.reduce((a,x)=>a+x.lots,0)} 批`:'不需要采购'}</b><span>合计 {money(r.total,true)} · 当前现金 {money(game.cash,true)}</span></div>
   <button className="primary-button" disabled={!need.length||game.cash<r.total||game.lost} onClick={buyAll}>{game.cash<r.total?'资金不足':'一键采购'}<ArrowUpRight size={14}/></button>
  </div>
  <p className="fc-note">容量都折算为“可支持的 GPU 数”，电力按每 MW 支持 {Math.floor(1000/1.56)} GPU。和教材的库存补货不同，GPU 是产能而不是消耗品：需求是“每天同时要用多少 GPU”，所以目标是一个容量水平，而不是提前期内的累计需求量。服务水平越高，安全量越大，缺货越少，但设备更早到货、闲置占用资金。冷却临时故障不计入建议。</p>
 </div>;
}

