// 需求预测教学模块
// 1. 按需算力市场的需求生成（趋势 + 周季节 + 噪声 + 一次需求冲击，固定随机种子，全班数据一致）
// 2. 六种预测方法：朴素法、简单移动平均、加权移动平均、一次指数平滑、Holt、高斯过程回归（GP）
// 3. 误差指标：MAD、MSE、RMSE、MAPE、偏差、跟踪信号 TS
// 4. h 步预测误差与 GP 后验预测标准差（用于安全量）
// 本文件不依赖游戏状态，可单独测试、单独拿去做课堂练习。

export type Method = 'naive' | 'sma' | 'wma' | 'ses' | 'holt' | 'gp';
export type Param = 'n' | 'weights' | 'alpha' | 'beta' | 'gp';
export type GPKernel = 'rbf' | 'rbf_periodic';
export interface ForecastSettings {method:Method;n:number;weights:number[];alpha:number;beta:number;gpKernel:GPKernel;ell:number;sf2:number;sp2:number;sn2:number;z:number;review:number}
export const DEFAULT_FORECAST:ForecastSettings = {method:'ses',n:7,weights:[0.5,0.3,0.2],alpha:0.3,beta:0.1,gpKernel:'rbf_periodic',ell:3,sf2:600,sp2:300,sn2:50,z:1.645,review:1};
const GP_KERNELS:GPKernel[]=['rbf','rbf_periodic'];
/** GP 训练窗口、周期核与数值稳定的教学常量 */
export const GP = {meanWindow:56,period:7,periodEll:1.5,maxHorizon:24,jitter:1e-8};

// 市场参数：教师可以改这里，生成不同的教学情景
export const MARKET = {
 seed:20261022,        // 随机种子：同一种子下全班看到完全相同的需求数据
 historyStart:-55,     // 开局前预置 8 周（56 天）历史，第 -55 天到第 0 天
 season:7,             // 季节周期：一周 7 天
 base:160,             // 第 1 天的需求水平（GPU）
 slope:2,              // 线性趋势：每天 +2 GPU
 shockDay:15,          // 需求冲击发生日
 shockSize:120,        // 冲击后需求水平永久抬升 120 GPU
 noise:0.05,           // 噪声：标准差为当日期望需求的 5%
 rate:3.5,             // 按需算力单价 $/GPU·h
 window:28,            // 误差指标统计最近 28 天（4 周）
 seasonal:[1.08,1.12,1.12,1.10,1.04,0.80,0.74], // 周一到周日的季节指数，合计 7
};
export const WEEKDAYS = ['一','二','三','四','五','六','日'];
/** 第 1 天是周一 */
export const weekday = (t:number) => ((t-1)%7+7)%7;

const rng = (seed:number) => {let a=seed>>>0;return () => {a=(a+0x6D2B79F5)>>>0;let t=a;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return ((t^(t>>>14))>>>0)/4294967296;};};
const gauss = (seed:number,t:number) => {const r=rng(seed*7919+t*104729+12345);const u=Math.max(r(),1e-12),v=r();return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v);};

/** 第 t 天按需市场需要的 GPU 数（当天的平均并发需求）。纯函数：同一天永远相同。 */
export function demandAt(t:number,seed=MARKET.seed){
 const level=MARKET.base+MARKET.slope*(t-1)+(t>=MARKET.shockDay?MARKET.shockSize:0);
 const z=Math.max(-3,Math.min(3,gauss(seed,t)));
 return Math.max(0,Math.round(level*MARKET.seasonal[weekday(t)]*(1+MARKET.noise*z)));
}
export interface Obs {t:number;d:number}
/** 已观测的需求：从历史起点到第 upTo 天（含） */
export function observed(upTo:number,seed=MARKET.seed):Obs[]{const out:Obs[]=[];for(let t=MARKET.historyStart;t<=upTo;t++)out.push({t,d:demandAt(t,seed)});return out;}

export const METHODS:{id:Method;name:string;short:string;params:Param[];formula:string[];idea:string}[] = [
 {id:'naive',name:'朴素法',short:'朴素',params:[],formula:['Fₜ₊₁ = Dₜ'],idea:'下一期等于本期实际值。没有参数，常作为比较基准：其他方法如果赢不了它，就没有意义。'},
 {id:'sma',name:'简单移动平均',short:'SMA',params:['n'],formula:['Fₜ₊₁ = (Dₜ + Dₜ₋₁ + … + Dₜ₋ₙ₊₁) / n'],idea:'最近 n 期等权平均。n 越大越平滑，但对趋势和突变反应越慢；有趋势时预测会系统性偏低。'},
 {id:'wma',name:'加权移动平均',short:'WMA',params:['weights'],formula:['Fₜ₊₁ = w₁Dₜ + w₂Dₜ₋₁ + … + wₙDₜ₋ₙ₊₁','Σwᵢ = 1，越近的数据权重越大'],idea:'给近期数据更大的权重，比 SMA 反应快。权重合计不为 1 时自动按比例归一。'},
 {id:'ses',name:'一次指数平滑',short:'SES',params:['alpha'],formula:['Fₜ₊₁ = αDₜ + (1 − α)Fₜ'],idea:'新预测 = 旧预测 + α × 上期误差。α 越大反应越快、噪声也越大。没有趋势项，面对增长会持续低估。'},
 {id:'holt',name:'Holt 双参数指数平滑',short:'Holt',params:['alpha','beta'],formula:['Lₜ = αDₜ + (1 − α)(Lₜ₋₁ + Tₜ₋₁)','Tₜ = β(Lₜ − Lₜ₋₁) + (1 − β)Tₜ₋₁','Fₜ₊ₕ = Lₜ + h·Tₜ'],idea:'分别平滑水平 L 和趋势 T，能跟上增长，但没有季节项，周末会系统性高估、工作日低估。'},
 {id:'gp',name:'高斯过程回归（GP）',short:'GP',params:['gp'],formula:['yₜ = m(xₜ) + f(xₜ) + εₜ，εₜ ~ N(0, σₙ²)','f ~ GP(0, k)，k = k_RBF（可选 + k_周期）','μ* = m(x*) + k*ᵀ(K + σₙ²I)⁻¹(y − m)','v* = k** − k*ᵀ(K + σₙ²I)⁻¹k*','Var(y*) = v* + σₙ²'],idea:'用核函数描述不同日期需求的相关性，返回完整的高斯预测分布：后验均值给出点预测，后验方差给出预测区间。均值函数包含线性趋势与周季节，GP 只拟合剩余相关结构；这是本讲的概率预测方法。'},
];
export const methodInfo=(id:Method)=>METHODS.find(x=>x.id===id)!;

const clamp=(x:number,lo:number,hi:number,fb:number)=>Number.isFinite(x)?Math.min(hi,Math.max(lo,x)):fb;
export function sanitize(s:Partial<ForecastSettings>={},base:ForecastSettings=DEFAULT_FORECAST):ForecastSettings{
 const b={...DEFAULT_FORECAST,...base};
 const m=METHODS.some(x=>x.id===s.method)?s.method!:(METHODS.some(x=>x.id===b.method)?b.method:DEFAULT_FORECAST.method);
 const w=Array.isArray(s.weights)?s.weights.map(Number).filter(x=>Number.isFinite(x)&&x>=0).slice(0,10):b.weights;
 const gpKernel=GP_KERNELS.includes(s.gpKernel as GPKernel)?s.gpKernel as GPKernel:(GP_KERNELS.includes(b.gpKernel)?b.gpKernel:'rbf_periodic');
 return {method:m,n:Math.round(clamp(Number(s.n??b.n),2,28,b.n)),weights:w.length&&w.reduce((a,c)=>a+c,0)>0?w:b.weights,
  alpha:clamp(Number(s.alpha??b.alpha),.01,1,b.alpha),beta:clamp(Number(s.beta??b.beta),.01,1,b.beta),
  gpKernel,ell:clamp(Number(s.ell??b.ell),.5,30,b.ell),sf2:clamp(Number(s.sf2??b.sf2),10,5000,b.sf2),
  sp2:clamp(Number(s.sp2??b.sp2),0,5000,b.sp2),sn2:clamp(Number(s.sn2??b.sn2),1,1000,b.sn2),
  z:clamp(Number(s.z??b.z),0,3.5,b.z),review:Math.round(clamp(Number(s.review??b.review),1,14,b.review))};
}
export const normWeights=(w:number[])=>{const s=w.reduce((a,b)=>a+b,0);return w.map(x=>x/s);};

/** 最小二乘直线 y = a + b·x，x = 1..n */
export function ols(y:number[]){const n=y.length;let sx=0,sy=0,sxx=0,sxy=0;for(let k=0;k<n;k++){const x=k+1;sx+=x;sy+=y[k];sxx+=x*x;sxy+=x*y[k];}const b=n>1?(n*sxy-sx*sy)/(n*sxx-sx*sx):0;return {a:(sy-b*sx)/n,b};}

/** 一般最小二乘 y = a + b·x */
export function olsXY(x:number[],y:number[]){const n=x.length;let sx=0,sy=0,sxx=0,sxy=0;for(let k=0;k<n;k++){sx+=x[k];sy+=y[k];sxx+=x[k]*x[k];sxy+=x[k]*y[k];}const b=n>1?(n*sxy-sx*sy)/(n*sxx-sx*sx):0;return {a:(sy-b*sx)/n,b};}
/**
 * 静态法初始化（Chopra《供应链管理》）：
 * 1. 取前 K 期（默认 4 周），用 m 期中心移动平均去掉季节性；
 * 2. 对去季节后的需求回归 D̄ = L₀ + T₀·t；
 * 3. 季节指数 = 各星期“实际值 ÷ 回归值”的平均，再归一使合计为 m。
 * 直接对带季节的原始数据回归，斜率会被一周内“高—低”的形态拉偏，所以要先去季节。
 */
export function staticInit(d:number[],m=MARKET.season,K=4*MARKET.season){
 const k=Math.min(K,d.length),half=Math.floor(m/2),xs:number[]=[],ys:number[]=[];
 for(let t=half;t<k-half;t++){let sum=0;for(let j=t-half;j<=t+half;j++)sum+=d[j];xs.push(t+1);ys.push(sum/m);}
 const {a,b}=xs.length>=2?olsXY(xs,ys):ols(d.slice(0,k));
 const ratio:number[][]=Array.from({length:m},()=>[]);for(let j=0;j<k;j++)ratio[j%m].push(d[j]/(a+b*(j+1)));
 const raw=ratio.map(r=>r.length?r.reduce((x,y)=>x+y,0)/r.length:1),sum=raw.reduce((x,y)=>x+y,0);
 return {a,b,k,S0:raw.map(x=>x*m/sum),cma:xs.length};
}
export interface Row {t:number;d:number;f:number|null;level?:number;trend?:number;mean?:number;sd?:number}
export interface Fit {rows:Row[];ahead:(i:number,h:number)=>number|null;init:string;settings:ForecastSettings;sdAhead?:(i:number,h:number)=>number|null;gp?:{kernel:GPKernel;ell:number;sf2:number;sp2:number;sn2:number;meanWindow:number;logLik:number|null;last:{x:number;m:number;mean:number;latentVar:number;obsVar:number}}}

/* ---------- 高斯过程回归：核矩阵、Cholesky、条件高斯 ---------- */
export interface GPParams {ell:number;sf2:number;sn2:number;sp2?:number;ellP?:number;period?:number}
export interface GPPredictive {mean:number[];latentVar:number[];obsVar:number[];logLik:number}

/** RBF（平方指数）核：k(x,x′) = σ_f² exp(−(x−x′)² / (2ℓ²)) */
export function rbfKernel(a:number,b:number,ell:number,sf2=1){const dx=a-b;return sf2*Math.exp(-(dx*dx)/(2*ell*ell));}
/** RBF + 周期核；周期核周期默认 7 天，长度尺度默认 1.5 天 */
export function gpKernel(a:number,b:number,p:GPParams){
 const dx=a-b,ellP=p.ellP??GP.periodEll,period=p.period??GP.period,sp2=p.sp2??0;
 let k=rbfKernel(a,b,p.ell,p.sf2);
 if(sp2>0){const s=Math.sin(Math.PI*Math.abs(dx)/period);k+=sp2*Math.exp(-2*s*s/(ellP*ellP));}
 return k;
}
/** Cholesky 分解 A = L Lᵀ；非正定返回 null */
export function cholesky(A:number[][]){
 const n=A.length,L:number[][]=Array.from({length:n},()=>Array(n).fill(0));
 for(let i=0;i<n;i++)for(let j=0;j<=i;j++){
  let sum=A[i][j];for(let k=0;k<j;k++)sum-=L[i][k]*L[j][k];
  if(i===j){if(!(sum>0)||!Number.isFinite(sum))return null;L[i][j]=Math.sqrt(sum);}
  else L[i][j]=sum/L[j][j];
 }
 return L;
}
const dot=(a:number[],b:number[])=>{let s=0;for(let i=0;i<a.length;i++)s+=a[i]*b[i];return s;};
const solveLower=(L:number[][],b:number[])=>{const n=L.length,y=Array(n).fill(0);for(let i=0;i<n;i++){let s=b[i];for(let k=0;k<i;k++)s-=L[i][k]*y[k];y[i]=s/L[i][i];}return y;};
const solveUpper=(L:number[][],b:number[])=>{const n=L.length,x=Array(n).fill(0);for(let i=n-1;i>=0;i--){let s=b[i];for(let k=i+1;k<n;k++)s-=L[k][i]*x[k];x[i]=s/L[i][i];}return x;};
const solveCholesky=(L:number[][],b:number[])=>solveUpper(L,solveLower(L,b));
/**
 * 零均值 GP 后验。输入 x/y 是训练点，xs 是预测点；
 * 返回后验均值、潜在函数方差、未来观测方差（潜在方差 + σₙ²）与边际对数似然。
 * 计算使用 Cholesky 分解，不显式求逆。
 */
export function gpPosterior(x:number[],y:number[],xs:number[],p:GPParams):GPPredictive|null{
 const n=x.length;
 if(!n||n!==y.length||!xs.length)return null;
 const ell=p.ell,sf2=p.sf2,sn2=Math.max(0,p.sn2),sp2=p.sp2??0;
 if(!(ell>0)||!(sf2>0)||!x.every(Number.isFinite)||!y.every(Number.isFinite))return null;
 const K:number[][]=Array.from({length:n},(_,i)=>Array.from({length:n},(_,j)=>gpKernel(x[i],x[j],p)));
 const jitter=GP.jitter*(sf2+sp2+sn2);
 for(let i=0;i<n;i++)K[i][i]+=sn2+jitter;
 const L=cholesky(K);if(!L)return null;
 const alpha=solveCholesky(L,y);
 let logDet=0;for(let i=0;i<n;i++)logDet+=Math.log(L[i][i]);
 const logLik=-0.5*dot(y,alpha)-logDet-0.5*n*Math.log(2*Math.PI);
 const mean:number[]=[],latentVar:number[]=[],obsVar:number[]=[];
 for(const t of xs){
  const ks=x.map(xi=>gpKernel(xi,t,p));
  const vv=solveCholesky(L,ks);
  const mu=dot(ks,alpha);
  const latent=Math.max(0,gpKernel(t,t,p)-dot(ks,vv));
  mean.push(mu);latentVar.push(latent);obsVar.push(latent+sn2);
 }
 return {mean,latentVar,obsVar,logLik};
}

/* ---------- GP 的结构均值：线性趋势 × 星期因子 ---------- */
interface MeanModel {a:number;b:number;s:number[]}
function gpMeanModel(x:number[],y:number[]):MeanModel{
 const n=x.length;
 if(n<2)return {a:y[n-1]??0,b:0,s:Array(7).fill(1)};
 const start=Math.max(0,n-GP.meanWindow),xs=x.slice(start),ys=y.slice(start);
 let a=0,b=0;const s=Array(7).fill(1);
 if(xs.length<14){const fit=olsXY(xs,ys);return {a:fit.a,b:fit.b,s};}
 // 交替估计趋势与乘法星期因子：先去季节再回归，避免原始数据的周内高低把斜率拉偏。
 for(let iter=0;iter<3;iter++){
  const des=ys.map((v,k)=>v/s[weekday(xs[k])]);
  const fit=olsXY(xs,des);a=fit.a;b=fit.b;
  const sum=Array(7).fill(0),cnt=Array(7).fill(0);
  for(let k=0;k<xs.length;k++){
   const base=a+b*xs[k];
   if(base>1e-6){const j=weekday(xs[k]);sum[j]+=ys[k]/base;cnt[j]++;}
  }
  // 向 1 收缩：样本越少的星期越接近“无季节差异”
  for(let j=0;j<7;j++)if(cnt[j])s[j]=(sum[j]+1)/(cnt[j]+1);
  const total=s.reduce((u,v)=>u+v,0);
  if(total>0)for(let j=0;j<7;j++)s[j]=s[j]*7/total;
 }
 return {a,b,s};
}
const gpMeanAt=(x:number,m:MeanModel)=>Math.max(0,m.a+m.b*x)*m.s[weekday(x)];

interface GPPoint {m:number;mean:number;latentVar:number;obsVar:number}
function fitGP(series:Obs[],s:ForecastSettings):Fit{
 const N=series.length,x=series.map(o=>o.t),d=series.map(o=>o.d);
 const H=GP.maxHorizon,sp2=s.gpKernel==='rbf_periodic'?s.sp2:0;
 const params:GPParams={ell:s.ell,sf2:s.sf2,sn2:s.sn2,sp2,ellP:GP.periodEll,period:GP.period};
 const predictIndex=(i:number,h:number):GPPoint|null=>{
  if(h<1||!Number.isFinite(h))return null;
  const start=Math.max(0,i-GP.meanWindow+1),xt=x.slice(start,i+1),yt=d.slice(start,i+1);
  if(!xt.length)return null;
  const model=gpMeanModel(xt,yt),mTrain=xt.map(v=>gpMeanAt(v,model)),resid=yt.map((v,k)=>v-mTrain[k]);
  const xs=[x[i]+h],gp=gpPosterior(xt,resid,xs,params);
  if(!gp){const m=gpMeanAt(xs[0],model),v=s.sf2+sp2;return {m,mean:m,latentVar:v,obsVar:v+s.sn2};}
  return {m:gpMeanAt(xs[0],model),mean:gpMeanAt(xs[0],model)+gp.mean[0],latentVar:gp.latentVar[0],obsVar:gp.obsVar[0]};
 };
 const pred:GPPoint[][]=[];
 let logLik:number|null=null;
 for(let i=0;i<N;i++){
  const start=Math.max(0,i-GP.meanWindow+1),xt=x.slice(start,i+1),yt=d.slice(start,i+1);
  const model=gpMeanModel(xt,yt),mTrain=xt.map(v=>gpMeanAt(v,model)),resid=yt.map((v,k)=>v-mTrain[k]);
  const xs=Array.from({length:H},(_,k)=>x[i]+k+1),gp=gpPosterior(xt,resid,xs,params);
  if(gp){logLik=gp.logLik;pred.push(xs.map((xv,k)=>({m:gpMeanAt(xv,model),mean:gpMeanAt(xv,model)+gp.mean[k],latentVar:gp.latentVar[k],obsVar:gp.obsVar[k]})));}
  else{const v=s.sf2+sp2;pred.push(xs.map(xv=>({m:gpMeanAt(xv,model),mean:gpMeanAt(xv,model),latentVar:v,obsVar:v+s.sn2})));}
 }
 const get=(i:number,h:number)=>{const ii=Math.max(0,Math.min(N-1,Math.floor(i)));return h>=1&&h<=H?pred[ii][h-1]:predictIndex(ii,h);};
 const rows:Row[]=series.map((o,i)=>{
  const r:Row={t:o.t,d:o.d,f:i===0?null:pred[i-1][0].mean};
  if(i>0){r.mean=pred[i-1][0].m;r.sd=Math.sqrt(Math.max(0,pred[i-1][0].obsVar));}
  return r;
 });
 const last=pred[N-1][0],lastX=x[N-1]+1;
 const kernelName=s.gpKernel==='rbf_periodic'?'RBF + 周期核（周期 7 天，ℓ_p=1.5）':'RBF 核';
 const init=`均值函数 m(x) = (a + b·x) × 星期因子，用最近 ${Math.min(GP.meanWindow,N)} 天估计；核 = ${kernelName}；ℓ = ${s.ell}，σ_f² = ${s.sf2}${sp2>0?`，σ_p² = ${sp2}`:''}，σ_n² = ${s.sn2}。GP 只拟合去均值后的残差；mₜ 列是结构均值，σₜ 列是含观测噪声的预测标准差。`;
 return {rows,ahead:(i,h)=>get(i,h)?.mean??null,init,settings:s,sdAhead:(i,h)=>{const q=get(i,h);return q?Math.sqrt(Math.max(0,q.obsVar)):null;},
  gp:{kernel:s.gpKernel,ell:s.ell,sf2:s.sf2,sp2,sn2:s.sn2,meanWindow:GP.meanWindow,logLik,last:{x:lastX,m:last.m,mean:last.mean,latentVar:last.latentVar,obsVar:last.obsVar}}};
}

/**
 * 对整段序列做滚动预测。rows[i].f 是在观测到第 i−1 期后，对第 i 期做的一步预测；
 * ahead(i,h) 是在观测到第 i 期后，对第 i+h 期的预测。
 */
export function fit(series:Obs[],raw:ForecastSettings):Fit{
 const s=sanitize(raw),d=series.map(x=>x.d),N=d.length,m=MARKET.season;
 if(s.method==='gp')return fitGP(series,s);
 const level:number[]=[],trend:number[]=[];
 let ahead:(i:number,h:number)=>number|null,init='',first:number|null=null;
 if(s.method==='naive'){ahead=i=>d[i];init='没有参数，也不需要初始化；第一期没有预测值。';}
 else if(s.method==='sma'){const n=s.n;ahead=i=>i+1>=n?d.slice(i-n+1,i+1).reduce((a,b)=>a+b,0)/n:null;init=`凑齐前 ${n} 期数据后才开始预测。`;}
 else if(s.method==='wma'){const w=normWeights(s.weights),k=w.length;ahead=i=>i+1>=k?w.reduce((sum,wj,j)=>sum+wj*d[i-j],0):null;init=`归一后的权重（从最近一期起）：${w.map(x=>x.toFixed(3)).join('、')}；凑齐前 ${k} 期后开始预测。`;}
 else if(s.method==='ses'){for(let i=0;i<N;i++)level[i]=i===0?d[0]:s.alpha*d[i]+(1-s.alpha)*level[i-1];ahead=i=>level[i];init='初始预测 F₂ = D₁，即用第一期实际值作为起点。表中的 Lₜ 列就是 Fₜ₊₁。';}
 else{const {a,b,k}=staticInit(d,m);first=a+b;
  for(let i=0;i<N;i++){const pL=i?level[i-1]:a,pT=i?trend[i-1]:b;level[i]=s.alpha*d[i]+(1-s.alpha)*(pL+pT);trend[i]=s.beta*(level[i]-pL)+(1-s.beta)*pT;}
  ahead=(i,h)=>level[i]+h*trend[i];init=`用前 ${k} 期做 ${m} 日中心移动平均去季节，再回归 D̄ = L₀ + T₀·t，得到 L₀ = ${a.toFixed(2)}，T₀ = ${b.toFixed(3)}（静态法）。`;}
 const rows:Row[]=series.map((o,i)=>{const r:Row={t:o.t,d:o.d,f:i===0?first:ahead(i-1,1)};if(level[i]!==undefined)r.level=level[i];if(trend[i]!==undefined&&s.method!=='ses')r.trend=trend[i];return r;});
 return {rows,ahead,init,settings:s};
}

export interface Errors {n:number;mad:number;mse:number;rmse:number;mape:number;bias:number;cum:number;ts:number}
/** 误差 eₜ = Dₜ − Fₜ（实际 − 预测），只统计 rows[from..] 中有预测值的期 */
export function errorStats(rows:Row[],from=0):Errors{
 let n=0,abs=0,sq=0,ape=0,cum=0,apeN=0;
 for(let i=Math.max(0,from);i<rows.length;i++){const r=rows[i];if(r.f===null)continue;const e=r.d-r.f;n++;abs+=Math.abs(e);sq+=e*e;cum+=e;if(r.d>0){ape+=Math.abs(e)/r.d;apeN++;}}
 const mad=n?abs/n:0;return {n,mad,mse:n?sq/n:0,rmse:n?Math.sqrt(sq/n):0,mape:apeN?ape/apeN*100:0,bias:n?cum/n:0,cum,ts:mad?cum/mad:0};
}
export interface TableRow extends Row {e:number|null;cum:number;mad:number;ts:number}
/** 逐期计算表：在统计窗口内滚动计算累计误差、MAD 和跟踪信号 */
export function table(rows:Row[],from=0):TableRow[]{
 let cum=0,abs=0,n=0;const out:TableRow[]=[];
 for(let i=Math.max(0,from);i<rows.length;i++){const r=rows[i];const e=r.f===null?null:r.d-r.f;if(e!==null){cum+=e;abs+=Math.abs(e);n++;}const mad=n?abs/n:0;out.push({...r,e,cum,mad,ts:mad?cum/mad:0});}
 return out;
}
/** h 步预测误差的均方根：用于“提前期内”的安全量 */
export function horizonRmse(f:Fit,h:number,from=0){
 let n=0,sq=0;const N=f.rows.length;
 for(let i=0;i+h<N;i++){if(i+h<from)continue;const p=f.ahead(i,h);if(p===null)continue;const e=f.rows[i+h].d-p;sq+=e*e;n++;}
 return n>=5?Math.sqrt(sq/n):null;
}
/** 预测标准差：GP 用后验预测分布（含观测噪声），其他方法用回测的 h 步误差均方根 */
export function predictiveSd(f:Fit,i:number,h:number,from=0){
 const gp=f.sdAhead?.(i,h);
 if(gp!==null&&gp!==undefined&&Number.isFinite(gp))return gp;
 return horizonRmse(f,h,from);
}
/** 把“单侧服务水平”的 z 换算成“同一覆盖率的双侧预测区间”的 z（95% 服务 → 1.96） */
export function intervalZ(z:number){if(!(z>0))return 0;return normInv((1+normCdf(z))/2);}
/** 统计窗口起点（数组下标） */
export const windowStart=(N:number)=>Math.max(0,N-MARKET.window);
export const SERVICE_LEVELS=[{z:0,label:'50%（不留安全量）'},{z:1.282,label:'90%'},{z:1.645,label:'95%'},{z:1.96,label:'97.5%'},{z:2.326,label:'99%'}];
export const fmt=(x:number|null|undefined,dp=1)=>x===null||x===undefined||!Number.isFinite(x)?'—':x.toFixed(dp);
/** 标准正态分布的分位数 z = Φ⁻¹(p)（Acklam 有理逼近，误差 < 1.2e-9） */
export function normInv(p:number){
 if(!(p>0&&p<1))return p<=0?-Infinity:Infinity;
 const a=[-39.69683028665376,220.9460984245205,-275.9285104469687,138.357751867269,-30.66479806614716,2.506628277459239];
 const b=[-54.47609879822406,161.5858368580409,-155.6989798598866,66.80131188771972,-13.28068155288572];
 const c=[-.007784894002430293,-.3223964580411365,-2.400758277161838,-2.549732539343734,4.374664141464968,2.938163982698783];
 const d=[.007784695709041462,.3224671290700398,2.445134137142996,3.754408661907416];
 const lo=.02425,hi=1-lo;let q,r;
 if(p<lo){q=Math.sqrt(-2*Math.log(p));return (((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5])/((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);}
 if(p>hi){q=Math.sqrt(-2*Math.log(1-p));return -(((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5])/((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);}
 q=p-.5;r=q*q;return (((((a[0]*r+a[1])*r+a[2])*r+a[3])*r+a[4])*r+a[5])*q/(((((b[0]*r+b[1])*r+b[2])*r+b[3])*r+b[4])*r+1);
}
/** 标准正态分布函数 Φ(z)，用于把任意 z 显示成服务水平 */
export function normCdf(z:number){const t=1/(1+.2316419*Math.abs(z)),y=.3989422804014327*Math.exp(-z*z/2)*t*(.31938153+t*(-.356563782+t*(1.781477937+t*(-1.821255978+t*1.330274429))));return z>0?1-y:y;}
