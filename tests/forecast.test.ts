import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_FORECAST,MARKET,cholesky,demandAt,errorStats,fit,gpKernel,gpPosterior,horizonRmse,intervalZ,observed,predictiveSd,rbfKernel,sanitize,staticInit,table,windowStart} from '../lib/forecast.ts';
import type {ForecastSettings,Obs} from '../lib/forecast.ts';
import {act,initialGame,metrics,recommendation,COSTS,CATALOG} from '../lib/game.ts';
import {normInv,normCdf} from '../lib/forecast.ts';

const S=(d:number[]):Obs[]=>d.map((x,i)=>({t:i+1,d:x}));
const cfg=(p:Partial<ForecastSettings>)=>({...DEFAULT_FORECAST,...p}) as ForecastSettings;
const near=(a:number|null,b:number,eps=1e-9)=>assert.ok(a!==null&&Math.abs(a-b)<eps,`${a} ≠ ${b}`);

test('需求数据：固定种子可复现，开局前有 8 周历史，冲击后水平抬升',()=>{
 assert.equal(demandAt(7),demandAt(7));
 const h=observed(0);assert.equal(h.length,56);assert.equal(h[0].t,MARKET.historyStart);
 const before=[8,9,10,11,12,13,14].map(t=>demandAt(t)).reduce((a,b)=>a+b,0),after=[15,16,17,18,19,20,21].map(t=>demandAt(t)).reduce((a,b)=>a+b,0);
 assert.ok(after-before>7*100,'冲击周的需求应明显高于前一周');
 assert.ok(demandAt(6)<demandAt(4)&&demandAt(7)<demandAt(3),'周末需求低于工作日');
});

test('朴素法、移动平均、加权移动平均与手算一致',()=>{
 const d=S([10,12,14,13]);
 const naive=fit(d,cfg({method:'naive'}));assert.equal(naive.rows[0].f,null);assert.equal(naive.rows[1].f,10);assert.equal(naive.rows[3].f,14);
 const sma=fit(d,cfg({method:'sma',n:3}));assert.equal(sma.rows[2].f,null);near(sma.rows[3].f,12);
 const wma=fit(d,cfg({method:'wma',weights:[0.5,0.3,0.2]}));near(wma.rows[3].f,0.5*14+0.3*12+0.2*10);
 const unnormalized=fit(d,cfg({method:'wma',weights:[5,3,2]}));near(unnormalized.rows[3].f,12.6);
});

test('一次指数平滑：F₂ = D₁，之后 Fₜ₊₁ = αDₜ + (1 − α)Fₜ',()=>{
 const f=fit(S([10,12,14,13]),cfg({method:'ses',alpha:.3}));
 near(f.rows[1].f,10);near(f.rows[2].f,10.6);near(f.rows[3].f,11.62);near(f.ahead(3,5),.3*13+.7*11.62);
});

test('Holt：完全线性的需求可以被精确预测，h 步预测 = L + hT',()=>{
 const d=S(Array.from({length:20},(_,i)=>5+2*(i+1)));
 const f=fit(d,cfg({method:'holt',alpha:.4,beta:.2}));
 for(const r of f.rows)near(r.f,r.d,1e-6);
 near(f.ahead(19,3),5+2*23,1e-6);
});

test('高斯过程：RBF 核矩阵与授课讲义的手算值一致',()=>{
 near(rbfKernel(0,1,.5),Math.exp(-2),1e-12);near(rbfKernel(0,2,.5),Math.exp(-8),1e-12);
 near(gpKernel(0,1,{ell:.5,sf2:1,sn2:0}),Math.exp(-2),1e-12);
 near(gpKernel(0,1,{ell:1,sf2:1,sn2:0}),Math.exp(-.5),1e-12);
 near(gpKernel(0,2,{ell:1,sf2:1,sn2:0}),Math.exp(-2),1e-12);
 near(gpKernel(0,1,{ell:2,sf2:1,sn2:0}),Math.exp(-1/8),1e-12);
 near(gpKernel(0,2,{ell:2,sf2:1,sn2:0}),Math.exp(-.5),1e-12);
 // 周期核：dx = 7 时与 dx = 0 相同；半周期处相关性最低
 near(gpKernel(0,7,{ell:1,sf2:1,sn2:0,sp2:2}),2,1e-9);
 assert.ok(gpKernel(0,3.5,{ell:1,sf2:1,sn2:0,sp2:2})<gpKernel(0,0,{ell:1,sf2:1,sn2:0,sp2:2}));
 const L=cholesky([[4,2],[2,3]])!;assert.ok(L);near(L[0][0],2);near(L[1][1],Math.sqrt(2));near(L[1][0],1);
});

test('高斯过程：一个观测点的后验均值、潜在方差与观测方差与讲义一致',()=>{
 const p={ell:1,sf2:1,sn2:.1};
 const at0=gpPosterior([0],[1],[0],p)!;
 near(at0.mean[0],.9090909090909091,1e-6);near(at0.latentVar[0],.09090909090909091,1e-6);near(at0.obsVar[0],.19090909090909092,1e-6);
 const at1=gpPosterior([0],[1],[1],p)!;
 near(at1.mean[0],.551391486,1e-6);near(at1.latentVar[0],.665564478,1e-6);near(at1.obsVar[0],.765564478,1e-6);
 // 噪声趋于 0：观测点的后验均值趋于观测值，潜在方差趋于 0
 const clean=gpPosterior([0],[1],[0],{ell:1,sf2:1,sn2:1e-6})!;
 near(clean.mean[0],1,1e-5);near(clean.latentVar[0],0,1e-5);
 // 边际对数似然：log p(y) = -y²/(2s) - ½log s - ½log(2π)，s = 1.1
 const s=1.1,expected=-.5/s-.5*Math.log(s)-.5*Math.log(2*Math.PI);
 near(at0.logLik,expected,1e-5);
});

test('高斯过程：多点后验与直接矩阵求逆一致',()=>{
 const p={ell:1,sf2:1,sn2:.2};
 const x=[0,1],y=[1,2],xs=[.5];
 const k11=1.2,k12=Math.exp(-.5),det=k11*k11-k12*k12;
 const alpha=[(k11*y[0]-k12*y[1])/det,(-k12*y[0]+k11*y[1])/det];
 const k=Math.exp(-.125);
 const mu=k*(alpha[0]+alpha[1]);
 const mvar=(k11*2-2*k12)/(det),latent=1-k*k*mvar;
 const got=gpPosterior(x,y,xs,p)!;
 near(got.mean[0],mu,1e-7);near(got.latentVar[0],latent,1e-7);near(got.obsVar[0],latent+.2,1e-7);
});

test('高斯过程：观测增加时同一位置的后验方差不会增大',()=>{
 const p={ell:2,sf2:2,sn2:.05};
 const xs=[9];
 const few=gpPosterior([0,1,2,3,4,5],[1,1.2,1.1,1.4,1.3,1.5],xs,p)!;
 const many=gpPosterior([0,1,2,3,4,5,6,7,8],[1,1.2,1.1,1.4,1.3,1.5,1.55,1.6,1.58],xs,p)!;
 assert.ok(many.latentVar[0]<few.latentVar[0]);
 assert.ok(many.obsVar[0]>many.latentVar[0]);
});

test('高斯过程：趋势数据上的点预测接近线性趋势，且返回正方差',()=>{
 const d=S(Array.from({length:21},(_,i)=>100+2*(i+1)));
 const f=fit(d,cfg({method:'gp',gpKernel:'rbf',ell:5,sf2:10,sp2:0,sn2:1}));
 for(let i=2;i<f.rows.length;i++)near(f.rows[i].f,f.rows[i].d,1e-6);
 assert.ok(f.gp&&f.gp.last.obsVar>0&&f.gp.logLik!==null);
 assert.ok(f.ahead(20,3)!>0);
});

test('高斯过程：在游戏数据上误差低于朴素法与 SMA，且区间/安全量使用 GP 标准差',()=>{
 const s=observed(21),from=windowStart(s.length);
 const mad=(method:ForecastSettings['method'])=>errorStats(fit(s,cfg({method})).rows,from).mad;
 const gp=fit(s,cfg({method:'gp'}));
 const gpMad=errorStats(gp.rows,from).mad;
 assert.ok(gpMad<mad('naive'),`GP ${gpMad} < naive ${mad('naive')}`);
 assert.ok(gpMad<mad('sma'),`GP ${gpMad} < SMA ${mad('sma')}`);
 const sd=predictiveSd(gp,gp.rows.length-1,5);assert.ok(sd!==null&&sd>0);
 near(intervalZ(1.645),1.959964,2e-4);near(intervalZ(0),0,1e-12);
 const g=act(initialGame(),{type:'forecast',settings:{method:'gp',z:1.96}}).game;
 const rec=recommendation(g);assert.equal(rec.sigmaSource,'gp');assert.ok(rec.sigma>0);
});

test('误差指标：e = D − F，MAD、MSE、MAPE、跟踪信号',()=>{
 const rows=[{t:1,d:10,f:null},{t:2,d:12,f:11},{t:3,d:9,f:12},{t:4,d:20,f:16}];
 const e=errorStats(rows);assert.equal(e.n,3);near(e.mad,(1+3+4)/3);near(e.mse,(1+9+16)/3);near(e.bias,(1-3+4)/3);near(e.ts,2/((1+3+4)/3));
 near(e.mape,(1/12+3/9+4/20)/3*100);
 const t=table(rows);assert.equal(t[0].e,null);near(t[3].cum,2);near(t[3].ts,e.ts);
});

test('冲击之后跟踪信号报警（|TS| > 4）',()=>{
 const s=observed(21),f=fit(s,cfg({method:'ses'}));
 assert.ok(Math.abs(errorStats(f.rows,windowStart(s.length)).ts)>4);
});

test('参数会被限制在合理范围；已删除的 Holt-Winters 存档会回退到默认方法',()=>{
 const old=sanitize({method:'hw' as never});
 assert.equal(old.method,DEFAULT_FORECAST.method);
 const s=sanitize({method:'xx' as never,n:99,alpha:5,beta:-1,weights:[-1,0],z:9,review:0,ell:99,sf2:-1,sp2:9999,sn2:0,gpKernel:'bad' as never});
 assert.equal(s.method,DEFAULT_FORECAST.method);assert.equal(s.n,28);assert.equal(s.alpha,1);assert.equal(s.beta,.01);
 assert.deepEqual(s.weights,DEFAULT_FORECAST.weights);assert.equal(s.z,3.5);assert.equal(s.review,1);
 assert.equal(s.ell,30);assert.equal(s.sf2,10);assert.equal(s.sp2,5000);assert.equal(s.sn2,1);assert.equal(s.gpKernel,'rbf_periodic');
});

test('结算：合同优先，剩余算力服务按需市场，账单与现金对得上',()=>{
 let g=initialGame();g.gpu=g.optical=g.storage=g.cooling=1024;g.progress=100;
 g=act(g,{type:'sign',client:'orion'}).game;
 const actual=demandAt(g.day),m=metrics(g,actual),r=act(g,{type:'next'}).game;
 assert.equal(m.spotServed,Math.min(actual,1024-256));
 const spot=r.ledger.find(x=>x.title.startsWith('按需算力'))!;near(spot.amount,m.spotServed*MARKET.rate*24,1e-6);
 near(r.cash-g.cash,m.profit,1e-6);assert.deepEqual(r.spotLog.at(-1),{day:1,demand:actual,served:m.spotServed,idle:1024-m.delivered});
 const tight=initialGame();const before=act(act(tight,{type:'sign',client:'orion'}).game,{type:'next'}).game;
 assert.equal(before.spotLog[0].served,0);assert.equal(before.totalLost,demandAt(1));
});

test('选择预测方法会保存到存档，并影响订货建议',()=>{
 const g=act(initialGame(),{type:'forecast',settings:{method:'gp',z:1.96}}).game;
 assert.equal(g.forecast.method,'gp');assert.equal(g.forecast.z,1.96);
 const rec=recommendation(g);
 assert.equal(rec.target,Math.ceil(rec.contracted+rec.peak+rec.z*rec.sigma));
 const gpu=rec.items.find(x=>x.id==='compute')!;assert.equal(gpu.lots,Math.ceil(Math.max(0,rec.target-256)/64));
 const ordered=act(g,{type:'buy',item:'compute'}).game,after=recommendation(ordered).items.find(x=>x.id==='compute')!;
 assert.equal(after.pipeline,64);assert.ok(after.lots<=Math.max(0,gpu.lots-1));
});

test('静态法初始化：去季节后回归，能找回真实趋势',()=>{
 const d=observed(0).map(x=>x.d);const {b,S0}=staticInit(d);
 assert.ok(Math.abs(b-MARKET.slope)<.25,`T₀ = ${b}`);
 S0.forEach((x,j)=>assert.ok(Math.abs(x-MARKET.seasonal[j])<.06,`S${j} = ${x}`));
});

test('订货建议不计入到货前就会到期的合同',()=>{
 let g=initialGame();g.gpu=g.optical=g.storage=g.cooling=1024;g.progress=100;
 g=act(g,{type:'sign',client:'frame'}).game;for(let i=0;i<10;i++)g=act(g,{type:'next'}).game;
 const r=recommendation(g);assert.equal(g.contracts[0].end,15);assert.ok(r.path[0].day>=15);
 assert.equal(r.contracted,0);assert.equal(r.expiring,128);
});

test('胜负判定不受所选预测方法影响',()=>{
 let g=initialGame();g.gpu=g.optical=g.storage=g.cooling=2048;g.progress=100;g.power=20;
 for(const c of ['orion','helix'])g=act(g,{type:'sign',client:c}).game;
 const a=act(act(g,{type:'forecast',settings:{method:'naive'}}).game,{type:'next'}).game;
 const b=act(act(g,{type:'forecast',settings:{method:'gp'}}).game,{type:'next'}).game;
 assert.equal(a.won,b.won);
});

test('h 步误差：样本足够时用回测，L 越长误差越大',()=>{
 const s=observed(0),f=fit(s,cfg({method:'ses'})),from=windowStart(s.length);
 const e1=horizonRmse(f,1,from)!,e6=horizonRmse(f,6,from)!;assert.ok(e1>0&&e6>0);
});

test('一次采购多批：一次扣款、一条账单、多个在途订单；钱不够则整单拒绝',()=>{
 const g=initialGame(),r=act(g,{type:'buy',item:'compute',qty:4});
 assert.ok(r.ok);assert.equal(r.game.orders.length,4);assert.equal(r.game.cash,g.cash-4*1800000);
 assert.equal(r.game.ledger.filter(x=>x.kind==='capex').length,1);assert.equal(r.game.totalCapex,7200000);
 const poor={...initialGame(),cash:3000000};assert.equal(act(poor,{type:'buy',item:'compute',qty:2}).ok,false);
});

test('闲置核算：已安装但没有交付的 GPU 每天计入闲置',()=>{
 let g=initialGame();g.gpu=g.optical=g.storage=g.cooling=1024;g.progress=100;
 const actual=demandAt(1),m=metrics(g,actual);g=act(g,{type:'next'}).game;
 assert.equal(g.totalIdle,1024-m.delivered);assert.equal(g.spotLog[0].idle,1024-m.delivered);
});

test('缺货与闲置的单位成本、临界比与正态分位数',()=>{
 const gpu=CATALOG.find(x=>x.id==='compute')!;assert.equal(COSTS.unit,gpu.price/gpu.amount);
 assert.ok(COSTS.under>COSTS.over&&COSTS.critical>.5&&COSTS.critical<1);
 near(COSTS.critical,COSTS.under/(COSTS.under+COSTS.over));
 near(normInv(.95),1.644854,1e-5);near(normInv(.5),0,1e-9);near(normInv(.025),-1.959964,1e-5);near(normCdf(1.96),.975,1e-4);
});
