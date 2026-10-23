import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_FORECAST,MARKET,demandAt,errorStats,fit,observed,sanitize,staticInit,table,windowStart,horizonRmse} from '../lib/forecast.ts';
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

test('Holt-Winters：初始季节指数合计为 7，在游戏数据上明显优于无季节的方法',()=>{
 const s=observed(14),from=windowStart(s.length);
 const hw=fit(s,cfg({method:'hw'}));
 const first7=hw.rows.slice(0,7).map(r=>r.season!);near(first7.reduce((a,b)=>a+b,0),7,1e-9);
 const mad=(m:ForecastSettings['method'])=>errorStats(fit(s,cfg({method:m})).rows,from).mad;
 assert.ok(mad('hw')<mad('holt')*.6&&mad('hw')<mad('ses')*.6&&mad('hw')<mad('sma')*.6);
});

test('误差指标：e = D − F，MAD、MSE、MAPE、跟踪信号',()=>{
 const rows=[{t:1,d:10,f:null},{t:2,d:12,f:11},{t:3,d:9,f:12},{t:4,d:20,f:16}];
 const e=errorStats(rows);assert.equal(e.n,3);near(e.mad,(1+3+4)/3);near(e.mse,(1+9+16)/3);near(e.bias,(1-3+4)/3);near(e.ts,2/((1+3+4)/3));
 near(e.mape,(1/12+3/9+4/20)/3*100);
 const t=table(rows);assert.equal(t[0].e,null);near(t[3].cum,2);near(t[3].ts,e.ts);
});

test('冲击之后跟踪信号报警（|TS| > 4）',()=>{
 const s=observed(21),f=fit(s,cfg({method:'hw'}));
 assert.ok(Math.abs(errorStats(f.rows,windowStart(s.length)).ts)>4);
});

test('参数会被限制在合理范围',()=>{
 const s=sanitize({method:'xx' as never,n:99,alpha:5,beta:-1,weights:[-1,0],z:9,review:0});
 assert.equal(s.method,DEFAULT_FORECAST.method);assert.equal(s.n,28);assert.equal(s.alpha,1);assert.equal(s.beta,.01);
 assert.deepEqual(s.weights,DEFAULT_FORECAST.weights);assert.equal(s.z,3.5);assert.equal(s.review,1);
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
 const g=act(initialGame(),{type:'forecast',settings:{method:'hw',z:1.96}}).game;
 assert.equal(g.forecast.method,'hw');assert.equal(g.forecast.z,1.96);
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
 const b=act(act(g,{type:'forecast',settings:{method:'hw'}}).game,{type:'next'}).game;
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
