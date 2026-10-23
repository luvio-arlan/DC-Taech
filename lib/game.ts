export type Layer = 'all' | 'optical' | 'power' | 'storage' | 'compute' | 'cooling';
export type Place = 'office' | 'walk' | 'campus' | 'hall';
import {DEFAULT_FORECAST,MARKET,demandAt,fit,horizonRmse,observed,sanitize,windowStart} from './forecast.ts';
import type {ForecastSettings,Fit,Obs} from './forecast.ts';
export type Panel = 'supply' | 'clients' | 'forecast' | 'construction' | 'reports' | 'guide' | 'ranking' | 'teacher' | null;
export type ItemId = Exclude<Layer, 'all'>;
export const CATALOG: {id:ItemId;name:string;en:string;price:number;days:number;amount:number;unit:string;detail:string;color:string}[] = [
 {id:'compute',name:'GPU 计算机柜组',en:'COMPUTE / 64 GPU',price:1800000,days:5,amount:64,unit:'GPU',detail:'8 台八卡服务器（每批 64 GPU，可一次采购多批）。安装在 A1 计算区，需配套网络、存储和散热。',color:'#b4a2ff'},
 {id:'optical',name:'高速光互联',en:'NETWORK / 400 Gb/s',price:850000,days:3,amount:512,unit:'GPU 配套',detail:'行末交换机、光模块与顶部光纤。增加 512 GPU 的网络承载能力。',color:'#52cbe9'},
 {id:'power',name:'配电扩容模块',en:'POWER / +1 MW',price:1400000,days:6,amount:1,unit:'MW',detail:'变压器、UPS 和配电母线。将园区接入容量增加 1 MW。',color:'#ffcb6b'},
 {id:'storage',name:'并行存储阵列',en:'STORAGE / 500 TB',price:640000,days:2,amount:512,unit:'GPU 配套',detail:'数据与检查点存储。教学模型折算为 512 GPU 的数据供应能力。',color:'#74dfa9'},
 {id:'cooling',name:'液冷 CDU 单元',en:'COOLING / +512 GPU',price:1100000,days:4,amount:512,unit:'GPU 配套',detail:'冷却液分配单元与机柜歧管。增加 512 GPU 的散热能力。',color:'#74b4ff'},
];
export const CLIENTS = [
 {id:'orion',name:'Orion AI',type:'基础模型研发',abbr:'O',color:'#b4a2ff',gpu:256,rate:3.2,term:30,detail:'持续预训练任务，要求稳定的跨机架通信。合同按已交付 GPU 小时计费。'},
 {id:'helix',name:'Helix Research',type:'生命科学 · 模型训练',abbr:'H',color:'#74dfa9',gpu:512,rate:3.65,term:30,detail:'蛋白质结构模型训练，数据读取密集。高吞吐存储和稳定冷却缺一不可。'},
 {id:'frame',name:'Frame Studio',type:'视频生成 · 推理',abbr:'F',color:'#ffcb6b',gpu:128,rate:2.9,term:14,detail:'视频生成推理服务。规模较小，适合园区初期补充利用率。'},
 {id:'atlas',name:'Atlas Cloud',type:'企业级专属算力',abbr:'A',color:'#52cbe9',gpu:768,rate:3.4,term:30,detail:'大规模长期租用。签约前需预留足够可交付算力，无法与其他客户重复售卖。'},
];
export const LAYERS = [
 {id:'optical' as Layer,short:'光',name:'光互联',en:'OPTICAL NETWORK',color:'#52cbe9',location:'机柜顶部走线架 · 行末网络机柜',body:'跨机架的数据通过光纤和交换机流动。它让分布在不同服务器上的 GPU 协同训练；带宽不足，GPU 会等待其他节点。',flow:'计算节点 → 光模块 → 交换网络 → 其他计算节点',note:'机架内部分高速连接使用铜缆；本场景没有把所有 GPU 连接都标成光纤。'},
 {id:'power' as Layer,short:'电',name:'供配电',en:'POWER DISTRIBUTION',color:'#ffcb6b',location:'园区东侧变电站 · UPS · 机柜母排',body:'电网先接入变电站，经过变压器、UPS 和配电系统，再送到服务器。签约容量、已接入容量和实际负载是三件不同的事。',flow:'电网 → 变压器 → UPS → 配电母线 → 服务器',note:'全站用电 = IT 负载 × PUE。冷却的额外能耗已包含在 PUE 内。'},
 {id:'storage' as Layer,short:'存',name:'数据存储',en:'PARALLEL STORAGE',color:'#74dfa9',location:'机房西侧绿色存储柜 · 服务器本地 NVMe',body:'训练数据从共享存储读入，模型检查点再写回。容量决定能装多少数据，吞吐决定 GPU 等数据多久。',flow:'数据集 → 并行存储 → 存储网络 → GPU → 检查点',note:'为了便于经营，本游戏把存储容量与吞吐简化为可支持的 GPU 数量。'},
 {id:'compute' as Layer,short:'芯',name:'计算芯片',en:'GPU COMPUTE',color:'#b4a2ff',location:'A1 机房中央 · 计算机柜内服务器托盘',body:'GPU 安装在服务器中，服务器装入机柜。GPU 只有同时获得电力、网络、存储和冷却，才是可以出售的算力。',flow:'GPU 芯片 → 服务器 → 机柜 → 集群 → 客户任务',note:'场景按教学比例建模；机柜代表设备组，并非 Nebius 真实机房复刻。'},
 {id:'cooling' as Layer,short:'冷',name:'液冷散热',en:'LIQUID COOLING',color:'#74b4ff',location:'机柜后部歧管 · 行旁 CDU · 室外散热区',body:'冷却液流过冷板，把芯片热量带到 CDU，再通过设施侧回路送到室外换热设备。散热不足时，算力必须降额运行。',flow:'GPU 冷板 → 机柜歧管 → CDU → 室外换热器',note:'真实方案因气候和机架密度不同而变化；高密度机柜仍可能需要部分风冷。'},
];
export interface Order {id:number;item:ItemId;placed:number;due:number;price:number}
export interface Contract {id:string;start:number;end:number}
export interface Ledger {id:number;day:number;title:string;amount:number;kind:'capex'|'revenue'|'opex'|'penalty'}
export interface SpotDay {day:number;demand:number;served:number;idle?:number}
export interface Game {version:1;day:number;cash:number;gpu:number;optical:number;power:number;storage:number;cooling:number;progress:number;orders:Order[];contracts:Contract[];ledger:Ledger[];events:string[];visited:string[];won:boolean;lost:boolean;lastRevenue:number;lastCost:number;incident:number;mitigated:boolean;nextId:number;totalRevenue:number;totalCapex:number;forecast:ForecastSettings;spotLog:SpotDay[];totalLost:number;totalIdle:number}
export const initialGame = ():Game => ({version:1,day:1,cash:32000000,gpu:256,optical:512,power:2,storage:512,cooling:512,progress:42,orders:[],contracts:[],ledger:[],events:['欢迎履新。A1 机房已交付 256 GPU，A2 正在施工。','建议先签 Orion AI 合同，让现有设备产生收入。','按需算力市场每天都有新需求：打开「需求预测」，选一种方法预测它。'],visited:[],won:false,lost:false,lastRevenue:0,lastCost:0,incident:0,mitigated:false,nextId:1,totalRevenue:0,totalCapex:0,forecast:{...DEFAULT_FORECAST,weights:[...DEFAULT_FORECAST.weights]},spotLog:[],totalLost:0,totalIdle:0});

/** 当前可见的需求数据：开局前的历史 + 已经结算过的运营日（不含今天） */
export interface ForecastView {series:Obs[];fit:Fit;N:number;from:number}
export function forecastView(g:Game,settings:ForecastSettings=g.forecast):ForecastView{const series=observed(g.day-1);return {series,fit:fit(series,settings),N:series.length,from:windowStart(series.length)};}
/** 今天的按需需求在结算前未知，经营预估使用所选方法的一步预测 */
export function spotPreview(g:Game){const v=forecastView(g);return Math.max(0,Math.round(v.fit.ahead(v.N-1,1)??v.series[v.N-1].d));}
export const GPU_PER_MW=1000/(1.3*1.2);
/**
 * 缺货与闲置的单位成本（每 GPU·天），用于“缺货 vs 过量备货”的权衡与临界比。教学假设，教师可修改。
 * 缺货成本 = 按需单价 × 24h − 满载与待机的电费差（流失一单只是少赚，不罚款）
 * 闲置成本 = 直线折旧（5 年）+ 资金占用（年化 10%）+ 每卡日维护 $1.5 + 待机电费
 */
export const COSTS=(()=>{const gpu=CATALOG.find(x=>x.id==='compute')!,unit=gpu.price/gpu.amount,kwh=.075,pue=1.2;
 const idlePower=.13*pue*24*kwh,fullPower=1.3*pue*24*kwh;
 const depreciation=unit/(5*365),capital=unit*.10/365,maintenance=1.5;
 const under=MARKET.rate*24-(fullPower-idlePower),over=depreciation+capital+maintenance+idlePower;
 return {unit,under,over,depreciation,capital,maintenance,idlePower,critical:under/(under+over)};})();
export function metrics(g:Game,spot?:number) {
 const cooling=Math.floor(g.cooling*(g.incident && !g.mitigated ? .5 : 1));
 const power=Math.floor(g.power*GPU_PER_MW);
 const space=g.progress>=100?4096:512;
 const capacity=Math.max(0,Math.min(g.gpu,g.optical,g.storage,cooling,power,space));
 const demand=g.contracts.reduce((s,c)=>s+(CLIENTS.find(x=>x.id===c.id)?.gpu||0),0);
 // 合同优先交付；剩余就绪算力再服务按需市场，满足不了的按需需求直接流失（缺货损失，不罚款）
 const contractDelivered=Math.min(demand,capacity);
 const spotDemand=Math.max(0,Math.round(spot??spotPreview(g)));
 const spotServed=Math.min(spotDemand,capacity-contractDelivered);
 const delivered=contractDelivered+spotServed;
 const share=demand?contractDelivered/demand:1;
 const utilization=capacity?Math.round(delivered/capacity*100):0;
 const itKW=delivered*1.3+(capacity-delivered)*.13;
 const load=itKW*1.2/1000;
 const contractValue=g.contracts.reduce((s,c)=>{const x=CLIENTS.find(x=>x.id===c.id)!;return s+x.gpu*x.rate*24},0);
 const spotRevenue=spotServed*MARKET.rate*24;
 const revenue=contractValue*share+spotRevenue;
 const cost=6000+g.gpu*1.5+load*1000*24*.075;
 const penalty=demand>contractDelivered ? contractValue*(1-share)*.2:0;
 const constraints=[['GPU',g.gpu],['光互联',g.optical],['存储',g.storage],['冷却',cooling],['电力',power],['机房空间',space]] as [string,number][];
 return {capacity,demand,contractDelivered,share,spotDemand,spotServed,spotLost:spotDemand-spotServed,spotRevenue,delivered,utilization,load,revenue,cost,penalty,profit:revenue-cost-penalty,free:Math.max(0,capacity-demand),constraints,bottleneck:constraints.filter(x=>x[1]===capacity).map(x=>x[0]).join(' / ')};
}
export type Action = {type:'buy';item:ItemId;qty?:number}|{type:'sign';client:string}|{type:'next'}|{type:'expedite'}|{type:'repair'}|{type:'visit';id:string}|{type:'forecast';settings:Partial<ForecastSettings>}|{type:'reset'};
export function act(state:Game,a:Action): {game:Game;message:string;ok:boolean} {
 if(a.type==='reset')return {game:initialGame(),message:'新一轮经营已开始。',ok:true};
 const fail=(message:string)=>({game:state,message,ok:false});
 if(state.lost && a.type!=='visit' && a.type!=='forecast')return fail('资金已耗尽，请重新开始。');
 const g:Game=structuredClone(state);
 const entry=(title:string,amount:number,kind:Ledger['kind'])=>{g.ledger.unshift({id:g.nextId++,day:g.day,title,amount,kind});if(kind==='capex')g.totalCapex=(g.totalCapex||0)-amount;};
 let message='';
 if(a.type==='buy'){
  const x=CATALOG.find(x=>x.id===a.item);if(!x)return fail('未找到设备。');
  const qty=Math.max(1,Math.min(32,Math.floor(Number(a.qty)||1))),total=x.price*qty;
  if(g.cash<total)return fail(qty>1?`现金不足，${qty} 批需要 ${money(total,true)}。`:'现金不足，暂时无法采购。');
  g.cash-=total;for(let k=0;k<qty;k++)g.orders.push({id:g.nextId++,item:x.id,placed:g.day,due:g.day+x.days,price:x.price});
  entry('采购 · '+x.name+(qty>1?` × ${qty}`:''),-total,'capex');message=`${x.name}${qty>1?` ${qty} 批`:''}已下单，预计第 ${g.day+x.days} 天交付。`;
 }else if(a.type==='sign'){
  const x=CLIENTS.find(x=>x.id===a.client);if(!x)return fail('未找到客户。');
  if(g.contracts.some(c=>c.id===x.id))return fail('该客户已签约。');
  if(metrics(g).free<x.gpu)return fail(`需预留 ${x.gpu} GPU，当前可用 ${metrics(g).free} GPU。`);
  g.contracts.push({id:x.id,start:g.day,end:g.day+x.term});message=`已签约 ${x.name}，从本日开始交付 ${x.gpu} GPU。`;
 }else if(a.type==='expedite'){
  if(g.progress>=100)return fail('A2 机房已完成施工。');if(g.cash<350000)return fail('现金不足。');
  g.cash-=350000;g.progress=Math.min(100,g.progress+12);entry('A2 施工加班与设备调度',-350000,'capex');message='施工加速 12%，已支付 $350,000。';
 }else if(a.type==='repair'){
  if(!g.incident || g.mitigated)return fail('当前没有待处理的冷却故障。');if(g.cash<120000)return fail('维修需要 $120,000。');
  g.cash-=120000;g.mitigated=true;entry('备用 CDU 调度与维修',-120000,'opex');message='备用冷却单元已接入，散热能力恢复。';
 }else if(a.type==='visit'){
  if(!g.visited.includes(a.id))g.visited.push(a.id);return {game:g,message:'',ok:true};
 }else if(a.type==='forecast'){
  g.forecast=sanitize(a.settings,sanitize(g.forecast||DEFAULT_FORECAST));return {game:g,message:'',ok:true};
 }else if(a.type==='next'){
  const actual=demandAt(g.day);
  const m=metrics(g,actual);g.cash+=m.profit;g.lastRevenue=m.revenue;g.lastCost=m.cost+m.penalty;g.totalRevenue+=m.revenue;
  for(const contract of g.contracts){const c=CLIENTS.find(x=>x.id===contract.id)!;const amount=c.gpu*c.rate*24*m.share;if(amount)entry(c.name+' · '+Math.round(c.gpu*m.share)+' GPU × 24h × $'+c.rate.toFixed(2),amount,'revenue');}
  if(m.spotServed)entry(`按需算力 · ${m.spotServed} GPU × 24h × $${MARKET.rate.toFixed(2)}`,m.spotRevenue,'revenue');
  const idle=Math.max(0,g.gpu-m.delivered);g.spotLog=[...(g.spotLog||[]),{day:g.day,demand:actual,served:m.spotServed,idle}].slice(-400);g.totalLost=(g.totalLost||0)+m.spotLost;g.totalIdle=(g.totalIdle||0)+idle;
  entry('电力、维护与人员支出',-m.cost,'opex');if(m.penalty)entry('交付不足 · SLA 服务抵扣',-m.penalty,'penalty');
  if(g.day===MARKET.shockDay)g.events.unshift('市场快讯：一款开源大模型发布，按需推理需求明显走高。看看你的预测方法多久才跟上——留意跟踪信号。');
  g.day++;g.progress=Math.min(100,g.progress+4);
  const due=g.orders.filter(x=>x.due<=g.day);g.orders=g.orders.filter(x=>x.due>g.day);
  for(const o of due){const x=CATALOG.find(x=>x.id===o.item)!;if(o.item==='compute')g.gpu+=x.amount;else g[o.item]+=x.amount;}
  const expired=g.contracts.filter(x=>x.end<=g.day);g.contracts=g.contracts.filter(x=>x.end>g.day);
  if(g.day===12){g.incident=1;g.mitigated=false;g.events.unshift('运维警报：CDU 泵组故障，散热能力降至 50%。请在施工与运维面板处理。');}
  if(g.day===16&&g.incident&&!g.mitigated){g.mitigated=true;g.events.unshift('CDU 常规维修完成，冷却容量恢复。');}
  message=`第 ${g.day} 天 · 上日收入 ${money(m.revenue)}，支出 ${money(m.cost+m.penalty)}。上日按需需求 ${actual} GPU，满足 ${m.spotServed}。`;
  if(due.length)message+=` ${due.length} 项设备已交付。`;
  if(expired.length)g.events.unshift('部分短期客户合同已到期，可在客户电脑重新签约。');
  g.events.unshift(message);
 }
 // 胜负判定只看已经发生的事实：按需部分用最近一次结算的实际需求，不受所选预测方法影响
 const m=metrics(g,g.spotLog?.at(-1)?.demand??0);
 if(!g.won && g.gpu>=1024 && m.delivered>=768 && m.profit>0 && g.progress>=100 && g.cash>0){g.won=true;g.events.unshift(`董事会目标达成：第 ${g.day} 天，算力园区完成扩建并实现正向日经营现金流。`);}
 if(g.cash<0)g.lost=true;
 g.events=g.events.slice(0,25);g.ledger=g.ledger.slice(0,150);
 return {game:g,message,ok:true};
}
export function money(n:number,compact=false){return new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:compact?2:0,...(compact?{notation:'compact' as const}:{})}).format(n)}
/**
 * 产能版“订货点 / 补货到目标水平”建议。
 * GPU 是产能而不是消耗品：需求是“每天同时要用多少 GPU”，所以目标是一个容量水平，而不是提前期内的累计需求量。
 * 目标就绪容量 S = 已签合同 GPU + 交货窗口内按需需求预测的峰值 + z × σ(L+1)
 * σ(L+1) 用历史回测得到的 (L+1) 步预测误差均方根；样本不足时退回教材近似 σ₁·√(L+1)。
 * 每个系统：缺口 = S − (现有 + 在途)，建议批数 = ⌈缺口 ÷ 每批容量⌉。
 */
export function recommendation(g:Game,settings:ForecastSettings=g.forecast){
 const s=sanitize(settings),v=forecastView(g,s),gpu=CATALOG.find(x=>x.id==='compute')!,L=gpu.days;
 const h0=L+1,horizons=Array.from({length:s.review},(_,k)=>h0+k);
 // 只计入在到货窗口内仍然有效的合同：合同在第 end 天到期并释放资源
 const activeOn=(day:number)=>g.contracts.filter(c=>c.end>day).reduce((sum,c)=>sum+(CLIENTS.find(x=>x.id===c.id)?.gpu||0),0);
 const path=horizons.map(h=>{const day=g.day+h-1;return {h,day,f:v.fit.ahead(v.N-1,h)??v.series[v.N-1].d,contracted:activeOn(day)};});
 const top=path.reduce((best,x)=>x.contracted+x.f>best.contracted+best.f?x:best,path[0]),peak=top.f,contracted=top.contracted;
 const expiring=metrics(g).demand-activeOn(path[0].day);
 const one=horizonRmse(v.fit,1,v.from),hs=horizonRmse(v.fit,h0,v.from);
 const sigma=hs??(one!==null?one*Math.sqrt(h0):0),sigmaSource=hs!==null?'backtest':'sqrt';
 const safety=s.z*sigma,target=Math.ceil(contracted+peak+safety);
 const items=CATALOG.map(x=>{const per=x.id==='power'?GPU_PER_MW:1,stock=x.id==='compute'?g.gpu:g[x.id];
  const have=Math.floor(stock*per),pipeline=Math.floor(g.orders.filter(o=>o.item===x.id).length*x.amount*per),lot=Math.floor(x.amount*per);
  const gap=Math.max(0,target-have-pipeline),lots=Math.ceil(gap/lot);return {id:x.id,name:x.name,have,pipeline,lot,gap,lots,cost:lots*x.price,days:x.days};});
 const space=g.progress>=100?4096:512,spaceDays=g.progress>=100?0:Math.ceil((100-g.progress)/4);
 return {L,h0,review:s.review,path,peak,peakDay:top.day,expiring,sigma,sigmaSource,z:s.z,safety,contracted,target,items,space,spaceShort:target>space,spaceDays,total:items.reduce((a,b)=>a+b.cost,0)};
}
export const SOURCES=[
 {title:'Nebius · 2025 年第四季度及全年财务结果',url:'https://assets.nebius.com/assets/2829268f-924f-4846-87b5-2365b7e58b41/Financial%20results_Q4%202025_11022026.pdf',text:'2025 年集团收入 5.298 亿美元；购置物业、设备及无形资产的现金支出约 40.660 亿美元。重资产扩建会先消耗现金，收入在交付后逐步产生。'},
 {title:'Nebius · Q4 2025 股东信',url:'https://assets.nebius.com/assets/e59fb92e-9027-473a-8cac-04f9d2e9ea9a/Shareholder%20Letter%20Q4%202025.pdf',text:'2025 年底 active power 约 170 MW。签约电力、接入电力、IT 设备实际使用电力应分开看待。'},
 {title:'Nebius · 芬兰 Mäntsälä 数据中心',url:'https://nebius.com/sustainability/our-greenfield-data-center-in-finland',text:'官方介绍满负载 PUE 为 1.13，使用当地室外空气冷却并回收余热。本游戏液冷场景为教学设计，不是该园区的复刻。'},
 {title:'NVIDIA · DGX GB200 硬件指南',url:'https://docs.nvidia.com/dgx/dgxgb200-user-guide/hardware.html',text:'NVL72 参考机架含 18 个计算托盘、72 个 GPU 和 9 个 NVLink 交换托盘。机架内 NVLink 使用被动铜缆背板。'},
 {title:'NVIDIA · GB200 存储参考架构',url:'https://docs.nvidia.com/dgx-superpod/reference-architecture-scalable-infrastructure-gb200/latest/storage-architecture.html',text:'训练数据读取、缓存与模型检查点写入共同决定存储负载。吞吐不足会让 GPU 等待数据。'},
];
