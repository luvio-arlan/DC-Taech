import {test} from 'node:test';
import assert from 'node:assert/strict';
import {act,initialGame,metrics,CLIENTS} from '../lib/game.ts';
import {demandAt} from '../lib/forecast.ts';
const advance=(state:ReturnType<typeof initialGame>,days:number)=>{for(let i=0;i<days;i++)state=act(state,{type:'next'}).game;return state};
test('orders deduct capex immediately and deliver exactly on due day',()=>{
 const g=initialGame(),r=act(g,{type:'buy',item:'compute'}).game;
 assert.equal(r.cash,30200000);assert.equal(r.gpu,256);assert.equal(r.totalCapex,1800000);assert.equal(r.orders[0].due,6);
 const before=advance(r,4);assert.equal(before.day,5);assert.equal(before.gpu,256);
 const delivered=advance(before,1);assert.equal(delivered.gpu,320);assert.equal(delivered.orders.length,0);assert.equal(g.cash,32000000);
});
test('insufficient funds and overselling leave original state unchanged',()=>{
 const g=initialGame();g.cash=1;assert.equal(act(g,{type:'buy',item:'compute'}).ok,false);
 assert.equal(g.cash,1);assert.equal(g.orders.length,0);
 assert.equal(act(g,{type:'sign',client:'helix'}).ok,false);
 const signed=act(g,{type:'sign',client:'orion'}).game;
 assert.equal(metrics(signed).free,0);assert.equal(act(signed,{type:'sign',client:'orion'}).ok,false);
 assert.equal(act(signed,{type:'sign',client:'frame'}).ok,false);
});
test('each infrastructure constraint can independently limit capacity',()=>{
 for(const field of ['gpu','optical','storage','cooling'] as const){const g=initialGame();g.gpu=g.optical=g.storage=g.cooling=2048;g.progress=100;g.power=20;g[field]=128;assert.equal(metrics(g).capacity,128,field)}
 const g=initialGame();g.gpu=g.optical=g.storage=g.cooling=2048;g.progress=99;g.power=20;assert.equal(metrics(g).capacity,512);
 g.progress=100;g.power=.2;assert.equal(metrics(g).capacity,128);
});
test('power budget holds even when many uncommissioned GPUs are installed',()=>{
 const g=initialGame();g.gpu=100000;g.optical=g.storage=g.cooling=100000;g.progress=100;g.power=2;
 g.contracts=CLIENTS.map(c=>({id:c.id,start:1,end:30}));const m=metrics(g);assert.ok(m.load<=g.power);assert.ok(m.delivered<=m.capacity);
});
test('daily revenue, expenses and cash reconcile with individual customer ledger',()=>{
 const g=initialGame();g.gpu=1024;g.optical=g.storage=g.cooling=1024;g.progress=100;
 const one=act(g,{type:'sign',client:'orion'}).game,two=act(one,{type:'sign',client:'helix'}).game;
 const m=metrics(two,demandAt(two.day)),r=act(two,{type:'next'}).game;
 assert.ok(Math.abs(r.cash-two.cash-m.profit)<.000001);
 const revenue=r.ledger.filter(x=>x.kind==='revenue');assert.equal(revenue.filter(x=>!x.title.startsWith('按需算力')).length,2);
 assert.ok(revenue.some(x=>x.title.startsWith('Orion AI')));assert.ok(revenue.some(x=>x.title.startsWith('Helix Research')));
 assert.ok(Math.abs(revenue.reduce((s,x)=>s+x.amount,0)-r.lastRevenue)<.000001);
 assert.equal(r.totalRevenue,r.lastRevenue);
});
test('fault derates cooling; repair restores it and deducts its cost once',()=>{
 let g=initialGame();g.gpu=g.optical=g.storage=g.cooling=1024;g.progress=100;
 g=act(g,{type:'sign',client:'atlas'}).game;g=advance(g,11);
 assert.equal(g.day,12);assert.equal(g.incident,1);assert.equal(metrics(g).capacity,512);assert.ok(metrics(g).penalty>0);
 const r=act(g,{type:'repair'}).game;assert.equal(r.cash,g.cash-120000);assert.equal(metrics(r).capacity,1024);assert.equal(act(r,{type:'repair'}).ok,false);
});
test('short contract accrues exactly its duration before resource release',()=>{
 let g=initialGame();g=act(g,{type:'sign',client:'frame'}).game;g.mitigated=true;
 g=advance(g,14);assert.equal(g.day,15);assert.equal(g.contracts.length,0);
 const frame=g.ledger.filter(x=>x.title.startsWith('Frame Studio')).reduce((a,x)=>a+x.amount,0);
 assert.ok(Math.abs(frame-128*2.9*24*14)<.00001);
});
test('construction cannot charge for work after completion',()=>{
 const g=initialGame();g.progress=96;const r=act(g,{type:'expedite'}).game;
 assert.equal(r.progress,100);assert.equal(r.cash,g.cash-350000);assert.equal(act(r,{type:'expedite'}).ok,false);
});
test('a balanced expansion wins and remains solvent',()=>{
 let g=act(initialGame(),{type:'sign',client:'orion'}).game;
 g=act(g,{type:'buy',item:'compute',qty:12}).game;
 for(const item of ['optical','storage','cooling'] as const)g=act(g,{type:'buy',item}).game;
 g=advance(g,11);g=act(g,{type:'repair'}).game;g=advance(g,4);g=act(g,{type:'sign',client:'helix'}).game;
 assert.equal(g.won,true);assert.ok(g.cash>0);assert.equal(metrics(g).contractDelivered,768);assert.ok(metrics(g).delivered>=768);assert.ok(metrics(g).profit>0);
 assert.equal(g.totalCapex,24190000);
});
test('bankruptcy stops financial actions; reset creates a fresh game',()=>{
 const g=initialGame();g.cash=0;g.gpu=0;const r=act(g,{type:'next'}).game;assert.equal(r.lost,true);assert.equal(act(r,{type:'buy',item:'power'}).ok,false);assert.equal(act(r,{type:'reset'}).game.cash,32000000);
});
test('all-time capital total persists after ledger rotation',()=>{
 let g=act(initialGame(),{type:'buy',item:'storage'}).game;g=advance(g,160);assert.equal(g.totalCapex,640000);assert.equal(g.ledger.length,150);
});
