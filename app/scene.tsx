'use client';
import {useEffect,useRef,useState} from 'react';
import * as THREE from 'three';
import {Game,Layer,Place,Panel,forecastView,metrics,money} from '@/lib/game';
import {errorStats,intervalZ,methodInfo,predictiveSd} from '@/lib/forecast';

type Props={game:Game;place:Place;layer:Layer;blocked:boolean;onOpen:(panel:Panel)=>void;onReady:()=>void;onPlace:(p:Place)=>void};
export default function Scene({game,place,layer,blocked,onOpen,onReady,onPlace}:Props){
 const host=useRef<HTMLDivElement>(null);
 const refs=useRef({game,place,layer,blocked,onOpen,onReady,onPlace});refs.current={game,place,layer,blocked,onOpen,onReady,onPlace};
 const [error,setError]=useState('');
 useEffect(()=>{
  const el=host.current!;let renderer:THREE.WebGLRenderer;
  try{renderer=new THREE.WebGLRenderer({antialias:true,alpha:false,powerPreference:'high-performance'});}catch{setError('此设备无法启动 3D。请启用浏览器硬件加速，或使用支持 WebGL 2 的浏览器。');return;}
  renderer.setPixelRatio(Math.min(devicePixelRatio,1.65));renderer.setSize(el.clientWidth,el.clientHeight);renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.05;el.appendChild(renderer.domElement);
  const scene=new THREE.Scene();scene.background=new THREE.Color('#c2cbd0');scene.fog=new THREE.FogExp2('#bdc6c7',.006);
  const camera=new THREE.PerspectiveCamera(57,el.clientWidth/el.clientHeight,.08,700);camera.position.set(0,2.55,6.7);camera.lookAt(0,2,-25);camera.rotation.order='YXZ';
  scene.add(new THREE.HemisphereLight('#d8ecff','#77654e',2.2));
  const sun=new THREE.DirectionalLight('#ffe4ad',4.2);sun.position.set(-30,45,-5);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);Object.assign(sun.shadow.camera,{left:-50,right:50,top:45,bottom:-55,near:1,far:150});sun.shadow.normalBias=.035;sun.target.position.set(0,0,-20);scene.add(sun,sun.target);
  const lamp=new THREE.PointLight('#ffcd91',14,17,2);lamp.position.set(-3,3,1);scene.add(lamp);
  const materials=new Map<string,THREE.MeshStandardMaterial>();const boxGeo=new THREE.BoxGeometry(1,1,1);
  const material=(color:string,metal=.0,rough=.65)=>{const key=color+metal+rough;if(!materials.has(key))materials.set(key,new THREE.MeshStandardMaterial({color,metalness:metal,roughness:rough}));return materials.get(key)!;};
  const box=(w:number,h:number,d:number,x:number,y:number,z:number,color:string,parent:THREE.Object3D=scene,metal=0)=>{const m=new THREE.Mesh(boxGeo,material(color,metal));m.scale.set(w,h,d);m.position.set(x,y,z);m.receiveShadow=true;if(w*h*d>0.06)m.castShadow=true;parent.add(m);return m;};
  const cylinder=(r:number,h:number,x:number,y:number,z:number,color:string,parent:THREE.Object3D=scene)=>{const m=new THREE.Mesh(new THREE.CylinderGeometry(r,r,h,12),material(color,.25));m.position.set(x,y,z);m.castShadow=true;parent.add(m);return m;};
  const beam=(a:THREE.Vector3,b:THREE.Vector3,width:number,color:string,parent:THREE.Object3D=scene)=>{const m=box(width,a.distanceTo(b),width,0,0,0,color,parent,.3);m.position.copy(a).add(b).multiplyScalar(.5);m.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),b.clone().sub(a).normalize());return m;};
  const path=(pts:number[][],color:string,radius=.065,parent:THREE.Object3D=scene)=>{const curve=new THREE.CatmullRomCurve3(pts.map(p=>new THREE.Vector3(...p as [number,number,number])),false,'catmullrom',.1);const m=new THREE.Mesh(new THREE.TubeGeometry(curve,50,radius,5,false),new THREE.MeshStandardMaterial({color,emissive:color,emissiveIntensity:.5,roughness:.4}));parent.add(m);return m;};
  const texture=(draw:(ctx:CanvasRenderingContext2D)=>void,w=1024,h=512)=>{const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;draw(canvas.getContext('2d')!);const t=new THREE.CanvasTexture(canvas);t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=4;return t;};
  const plane=(w:number,h:number,x:number,y:number,z:number,map:THREE.Texture,parent:THREE.Object3D=scene)=>{const m=new THREE.Mesh(new THREE.PlaneGeometry(w,h),new THREE.MeshBasicMaterial({map,side:THREE.DoubleSide}));m.position.set(x,y,z);parent.add(m);return m;};
  const sign=(text:string,w:number,x:number,y:number,z:number,color='#d6e5db',bg='#23332f')=>plane(w,w*.21,x,y,z,texture(c=>{c.fillStyle=bg;c.fillRect(0,0,1024,256);c.fillStyle=color;c.font='500 64px sans-serif';c.textAlign='center';c.fillText(text,512,158);},1024,256));
  const interactables:THREE.Object3D[]=[];
  function interactive(obj:THREE.Object3D,panel:Panel,label:string){obj.userData={panel,label};interactables.push(obj);}
  const office=new THREE.Group();scene.add(office);
  // A continuous floor, walnut joinery, glazed facade and physical desk.
  box(19,.28,14,0,-.2,1,'#514d45',office);
  for(let i=0;i<24;i++)box(.015,.008,14,-9+i*.8,-.052,1,'#6a6054',office);
  box(.35,6,14,-9.5,2.95,1,'#343b39',office);box(.35,6,14,9.5,2.95,1,'#39403c',office);box(19,6,.35,0,2.95,8,'#303833',office);box(19,.2,14,0,6,1,'#262d29',office);
  for(let x=-9;x<=9;x+=3){box(.10,6,.16,x,2.95,-5.4,'#252e2c',office,.7);box(.15,.12,12,x,5.85,1,'#54574b',office);}
  box(19,.14,.16,0,3.4,-5.4,'#303b37',office,.6);box(19,.12,.16,0,.05,-5.4,'#303b37',office,.6);
  const glass=new THREE.Mesh(new THREE.PlaneGeometry(19,6),new THREE.MeshPhysicalMaterial({color:'#bdcfce',transparent:true,opacity:.045,roughness:.05,metalness:.4,side:THREE.DoubleSide,depthWrite:false}));glass.position.set(0,3,-5.43);office.add(glass);
  box(6.7,.2,2.7,0,1.25,1.6,'#7e5136',office);box(6.75,.045,2.75,0,1.365,1.6,'#916342',office);
  for(const x of[-2.65,2.65]){box(.13,1.3,2.25,x,.6,1.6,'#202a28',office,.7);box(.6,.1,2.45,x,.02,1.6,'#1b2421',office,.5);}
  box(3.9,.022,1.1,0,1.399,2.03,'#252c28',office);
  const screenTextures:THREE.CanvasTexture[]=[];
  for(let i=0;i<2;i++){
   const x=i===0?-1.32:1.32;const group=new THREE.Group();group.position.set(x,0,.74);group.rotation.y=i===0?.09:-.09;office.add(group);
   box(2.38,1.45,.12,0,2.21,0,'#111b1b',group,.3);box(.14,.4,.13,0,1.53,-.035,'#1a2525',group,.7);box(.72,.045,.4,0,1.42,.09,'#253031',group,.6);
   const t=texture(()=>{});screenTextures.push(t);const s=plane(2.24,1.3,0,2.22,.067,t,group);interactive(s,i===0?'supply':'clients',i===0?'供应链与采购':'客户与算力合同');
   cylinder(.014,.014,1.04,1.535,.075,'#90ecbc',group).rotation.x=Math.PI/2;
   box(1.05,.055,.38,0,1.44,1.4,'#4b514c',group);for(let row=0;row<4;row++)for(let col=0;col<13;col++)box(.061,.011,.058,-.47+col*.077,1.473,1.26+row*.085,'#858680',group);
  }
  // 需求预测屏：两台显示器中间的支架上，略向下倾斜朝向座位，点击打开「需求预测」
  {cylinder(.035,1.75,0,2.24,.4,'#1a2525',office);box(.5,.04,.3,0,1.39,.4,'#253031',office);
   const group=new THREE.Group();group.position.set(0,3.6,.5);group.rotation.x=.12;office.add(group);
   box(2.16,1.27,.1,0,0,0,'#111b1b',group,.3);box(.3,.16,.12,0,0,-.08,'#1a2525',group,.6);
   const t=texture(()=>{},1024,576);screenTextures.push(t);const s=plane(2.02,1.14,0,0,.056,t,group);interactive(s,'forecast','需求预测');}
  box(.23,.09,.34,1.67,1.445,2.2,'#8f9087',office);
  // Files are actual objects in the room and open the research dossier.
  for(let i=0;i<3;i++){const folder=box(.85,.035,.68,-2.7,1.43+i*.037,1.9,'#cfc6ae',office);folder.rotation.y=-.12+i*.09;interactive(folder,'reports','项目资料 / Nebius 研究');}
  const paper=plane(.64,.48,-2.7,1.55,1.9,texture(c=>{c.fillStyle='#ece6d5';c.fillRect(0,0,1024,512);c.fillStyle='#304842';c.font='bold 60px sans-serif';c.fillText('NEXUS / 01',80,100);c.font='32px sans-serif';c.fillText('INFRASTRUCTURE BRIEF',80,165);for(let j=0;j<7;j++){c.fillStyle='#b2b5a4';c.fillRect(80,210+j*30,760-j%3*140,7);}}),office);paper.rotation.x=-Math.PI/2;interactive(paper,'reports','桌面研究资料');
  cylinder(.18,.34,2.8,1.55,2.1,'#eee7d9',office);cylinder(.14,.01,2.8,1.724,2.1,'#432d22',office);
  const handle=new THREE.Mesh(new THREE.TorusGeometry(.12,.03,8,16),material('#e4dccd'));handle.position.set(3.01,1.57,2.1);office.add(handle);
  box(.65,.055,.35,-3.0,1.42,.4,'#1c2927',office);cylinder(.035,.7,-3,1.75,.4,'#c2a572',office);const shade=new THREE.Mesh(new THREE.ConeGeometry(.27,.23,24,1,true),material('#2c3e35',.45));shade.rotation.z=.45;shade.position.set(-2.94,2.15,.4);office.add(shade);
  // Chair, sofa and storage shelves support walking around the office.
  box(1,.19,.92,0,.8,4.3,'#1d2824',office);box(1.05,1.18,.18,0,1.39,4.7,'#25312b',office);cylinder(.07,.62,0,.35,4.3,'#293333',office);
  for(let i=0;i<5;i++){const a=i*Math.PI*2/5;beam(new THREE.Vector3(0,.12,4.3),new THREE.Vector3(Math.sin(a)*.7,.12,4.3+Math.cos(a)*.7),.055,'#283332',office);}
  box(1.8,.48,3.8,7.8,.36,1.8,'#777e6d',office);box(.4,1.05,4,8.7,.8,1.8,'#6f7867',office);for(const z of[.5,1.8,3.1])box(1.42,.25,1.15,7.7,.66,z,'#8a8e7c',office);
  box(1.4,.075,2.3,5.85,.5,1.8,'#52432f',office);for(const z of[.9,2.7])box(.08,.5,1.1,5.85,.23,z,'#222c28',office);
  for(const z of[-2,5]){
   box(.65,3.2,2.7,9.1,1.6,z,'#252d28',office);
   for(let j=0;j<4;j++){box(.75,.07,2.8,9.0,.35+j*.85,z,'#977553',office);for(let k=0;k<6;k++)box(.44,.4+k%3*.07,.1,8.95,.6+j*.85,z-.9+k*.24,['#b8b398','#657d75','#a78664'][k%3],office);}
  }
  function plant(x:number,z:number,scale=1){cylinder(.3*scale,.7*scale,x,.35*scale,z,'#575b4b',office);for(let j=0;j<9;j++){const a=j*2.4;const leaf=new THREE.Mesh(new THREE.SphereGeometry(1,8,6),material(j%2?'#354f34':'#496645'));leaf.scale.set(.16*scale,.6*scale,.13*scale);leaf.position.set(x+Math.sin(a)*.35*scale,1.2*scale+(j%3)*.22*scale,z+Math.cos(a)*.35*scale);leaf.rotation.z=Math.sin(a)*.8;office.add(leaf);}}
  plant(-8.5,-4.2,1.8);plant(8.5,-4.2,1.6);
  const boardTex=texture(c=>{c.fillStyle='#152b30';c.fillRect(0,0,1024,640);c.strokeStyle='#335057';for(let i=0;i<24;i++){c.beginPath();c.moveTo(i*44,0);c.lineTo(i*44,640);c.stroke();}for(let i=0;i<16;i++){c.beginPath();c.moveTo(0,i*44);c.lineTo(1024,i*44);c.stroke();}c.fillStyle='#e6e8d8';c.font='bold 46px sans-serif';c.fillText('CAMPUS / PHASE 02',60,90);c.strokeStyle='#9cd6c9';c.lineWidth=4;c.strokeRect(65,145,395,295);c.strokeRect(510,145,440,175);for(let j=0;j<5;j++)c.strokeRect(90+j*72,175,42,200);c.fillStyle='#d8ad6c';c.fillRect(520,360,300,24);c.fillStyle='#b8ccc8';c.font='28px sans-serif';c.fillText('A1  /  COMPUTE HALL',65,500);c.fillText('A2  /  UNDER CONSTRUCTION',65,550);},1024,640);
  const board=plane(4.4,2.75,-9.27,3.05,.2,boardTex,office);board.rotation.y=Math.PI/2;interactive(board,'construction','施工进度与设备布局图');
  // Outdoor campus: operational hall, exposed construction frame, substations, cooling yard.
  box(240,.2,220,0,-.35,-64,'#6b7464');box(90,.07,65,0,-.2,-38,'#a4a395');box(95,.035,8,0,-.13,-11,'#646e6c');
  for(let x=-45;x<48;x+=5)box(2.5,.014,.12,x,-.1,-11,'#d9d3ac');
  box(1.5,.04,64,-39,-.11,-40,'#c5c0ab');box(1.5,.04,64,39,-.11,-40,'#c5c0ab');
  const hallGroup=new THREE.Group();scene.add(hallGroup);const shell:THREE.Mesh[]=[];
  box(23,.35,20,-10,0,-35,'#a4aaa5',hallGroup);
  shell.push(box(23,6,.25,-10,3,-45,'#879794',hallGroup,.4));shell.push(box(.25,6,20,-21.5,3,-35,'#758782',hallGroup,.4));shell.push(box(.25,6,20,1.5,3,-35,'#778c85',hallGroup,.4));
  shell.push(box(23,5.5,.22,-10,3.2,-25,'#859590',hallGroup,.45));
  const hallLight=new THREE.PointLight('#d6eeff',65,34,2);hallLight.position.set(-9.5,5.2,-34);hallGroup.add(hallLight);
  for(const z of[-28,-34,-41]){box(19,.06,.14,-9.5,5.7,z,'#dbeff0',hallGroup);}
  const roof=box(23.7,.25,20.7,-10,6.1,-35,'#adb5ac',hallGroup,.5);shell.push(roof);
  for(let j=0;j<24;j++)shell.push(box(.045,5.5,.065,-21.1+j*.96,3.2,-24.84,'#b8c3b7',hallGroup,.6));
  box(6,.23,.8,-11,4.8,-24.5,'#dddccb',hallGroup);const hallSign=sign('NEXUS  /  A1',6,-11,4.1,-24.82,'#e5e7d4','#445850');
  box(4,3,.13,-10,1.5,-24.8,'#263e37',hallGroup,.7);for(const x of[-10.7,-9.3])box(.04,.7,.08,x,1.5,-24.68,'#c4cabc',hallGroup,.7);
  const components:Record<string,THREE.Group>={};for(const key of['compute','optical','power','storage','cooling']){components[key]=new THREE.Group();scene.add(components[key]);}
  const rackMeshes:THREE.Mesh[]=[];const rackLights:THREE.Mesh[]=[];
  for(let row=0;row<3;row++)for(let col=0;col<8;col++){
   const x=-17.8+col*2.3,z=-29-row*5.4;const rack=box(1.1,2.7,1.7,x,1.55,z,'#253334',components.compute,.55);rackMeshes.push(rack);
   for(let j=0;j<7;j++){box(.96,.21,.06,x,.52+j*.32,z+.88,'#43504d',components.compute,.6);box(.57,.09,.018,x-.09,.52+j*.32,z+.922,'#172624',components.compute);const led=box(.05,.04,.022,x+.38,.53+j*.32,z+.93,'#92e5b1',components.compute);rackLights.push(led);}
   box(.96,.03,1.1,x,3,z,'#b4a2ff',components.compute);
  }
  for(let j=0;j<4;j++){
   const z=-29-j*3.7;box(1.15,2.7,1.5,-20,1.55,z,'#355748',components.storage,.4);
   for(let k=0;k<8;k++)box(.95,.18,.025,-20,.48+k*.3,z+.77,'#75b99a',components.storage,.5);
  }
  for(let j=0;j<3;j++){
   const z=-29-j*5.4;box(.85,2.7,1.2,.1,1.55,z,'#34505d',components.optical,.4);
   for(let k=0;k<6;k++)box(.7,.12,.03,.1,.7+k*.35,z+.63,'#6bb9c9',components.optical);
   box(19,.12,.5,-9,3.5,z,'#52615d',components.optical,.6);
   path([[-20,3.6,z],[-9,3.6,z],[0,3.6,z],[0,1.7,z]],'#52cbe9',.045,components.optical);
   path([[-18,.32,z-1.2],[-9,.32,z-1.2],[2,.32,z-1.2],[4,.32,-41],[9,.32,-41]],'#74b4ff',.095,components.cooling);
   for(let col=0;col<8;col++)path([[-17.8+col*2.3,.32,z-1.2],[-17.8+col*2.3,2.7,z-1.2]],'#5f9acb',.035,components.cooling);
  }
  // East-side power yard and north-side heat exchangers.
  for(let j=0;j<4;j++){
   box(2.8,2.4,3,8+j*4,1.3,-39,'#7892a0',components.cooling,.4);
   for(let k=0;k<2;k++){const fan=cylinder(.65,.06,7.3+j*4+k*1.4,2.55,-39,'#324a51',components.cooling);for(let a=0;a<5;a++){const b=box(.07,.04,1.05,fan.position.x,2.6,-39,'#738c90',components.cooling,.5);b.rotation.y=a*Math.PI/5;}}
  }
  for(let j=0;j<3;j++){box(2.8,2.8,3,28+j*4,1.4,-29,'#b3aa8a',components.power,.5);for(let k=0;k<4;k++)cylinder(.18,.55,27.2+j*4+k*.5,3.08,-29,'#696d62',components.power);box(2.7,.08,.08,28+j*4,1.8,-27.45,'#ffd071',components.power);}
  path([[30,.18,-29],[30,.18,-23],[-9,.18,-23],[-9,.18,-35]],'#ffc266',.1,components.power);
  for(const x of[25,39]){cylinder(.13,8,x,4,-34,'#727c74',components.power);box(6,.12,.12,x,7.4,-34,'#676f66',components.power);}
  path([[25,7.4,-34],[20,6.7,-20],[18,7,-5]],'#8c8b71',.028,components.power);
  sign('POWER / SUBSTATION',5,32,4.5,-27);sign('LIQUID COOLING',6,14,3.4,-36.9);
  const construction=new THREE.Group();scene.add(construction);box(21,.35,17,16,.01,-55,'#b6b4a0',construction);
  for(let x=7;x<=25;x+=4.5)for(let z=-62;z<=-48;z+=7){box(.26,6.6,.26,x,3.4,z,'#7f928a',construction,.6);}
  for(let z=-62;z<=-48;z+=7)box(18.5,.3,.23,16,6.6,z,'#70877d',construction,.6);
  for(let x=7;x<=25;x+=4.5)box(.26,.3,14.5,x,6.6,-55,'#8a9a90',construction,.6);
  const a2Walls=box(21,6,.15,16,3,-63,'#89998b',construction,.4);const a2Roof=box(21.5,.2,17.5,16,6.75,-55,'#a5b1a3',construction,.4);
  for(let j=0;j<6;j++)box(3,.4,1.4,8+j*3,.5,-43,'#b3a38a',construction);
  const craneGroup=new THREE.Group();craneGroup.position.set(25,0,-49);scene.add(craneGroup);
  for(let j=0;j<10;j++){
   for(const x of[-.55,.55])for(const z of[-.55,.55])box(.12,1.8,.12,x,.9+j*1.8,z,'#d6a04c',craneGroup,.45);
   beam(new THREE.Vector3(-.55,j*1.8,-.55),new THREE.Vector3(.55,j*1.8+1.8,-.55),.065,'#e0b362',craneGroup);
   beam(new THREE.Vector3(.55,j*1.8,.55),new THREE.Vector3(-.55,j*1.8+1.8,.55),.065,'#e0b362',craneGroup);
  }
  const arm=new THREE.Group();arm.position.y=18;craneGroup.add(arm);
  for(let j=-5;j<22;j+=2){box(2,.12,.13,j,0,-.5,'#d8a755',arm,.4);box(2,.12,.13,j,0,.5,'#d8a755',arm,.4);box(2,.12,.12,j,1.1,0,'#dfb165',arm,.4);beam(new THREE.Vector3(j-1,0,.5),new THREE.Vector3(j+1,1.1,0),.055,'#d5a65a',arm);beam(new THREE.Vector3(j-1,0,-.5),new THREE.Vector3(j+1,1.1,0),.055,'#d5a65a',arm);}
  box(3,1.3,1.6,-4,.55,0,'#8c8b78',arm);box(1.7,1.4,1.4,1,-.35,0,'#d3aa5e',arm);box(.9,.65,1.43,1.2,-.13,0,'#415c5d',arm);beam(new THREE.Vector3(14,0,0),new THREE.Vector3(14,-12,0),.04,'#3f5149',arm);box(.32,.5,.25,14,-12,0,'#d1a251',arm);
  arm.rotation.y=2.6;
  const farCrane=craneGroup.clone();farCrane.position.set(-34,0,-61);farCrane.scale.setScalar(.7);scene.add(farCrane);
  sign('A2 / UNDER CONSTRUCTION',11,15,2.8,-46.25,'#f6d394','#60604a');
  const truck=new THREE.Group();scene.add(truck);box(4,2,2,-2,1.2,0,'#bdafa0',truck);box(1.6,1.7,2,1,1.05,0,'#c5a157',truck);box(.8,.65,2.03,1.15,1.55,0,'#526e70',truck);for(const x of[-3,-.8,1])for(const z of[-1,1]){const wheel=cylinder(.4,.19,x,.4,z,'#293632',truck);wheel.rotation.x=Math.PI/2;}truck.position.set(-28,0,-12.6);
  const workerPositions=[[-3,-20],[18,-43],[21,-49],[10,-46],[-15,-18]];for(const [x,z] of workerPositions){box(.28,.52,.21,x,.87,z,'#e1aa4b');cylinder(.11,.18,x,1.25,z,'#e6d195');for(const dx of[-.08,.08])box(.085,.5,.09,x+dx,.4,z,'#394d49');}
  // Trees frame the site without hiding physical systems.
  let seed=41;const rand=()=>{seed=(seed*16807)%2147483647;return(seed-1)/2147483646};
  const treeGeo=new THREE.ConeGeometry(1,1,7);const treeMats=['#425c4c','#526b52','#3b5849'].map(c=>material(c));
  for(let j=0;j<100;j++){
   const x=(rand()-.5)*190,z=-78-rand()*70,h=5+rand()*7;const trunk=cylinder(.15,h*.5,x,h*.25,z,'#6c6552');trunk.castShadow=false;
   for(let k=0;k<2;k++){const t=new THREE.Mesh(treeGeo,treeMats[j%3]);t.scale.set(h*.3,h*.7,h*.3);t.position.set(x,h*(.48+k*.18),z);scene.add(t);}
  }
  // A restrained sky gradient renders entirely in the 3D environment.
  const skyGeo=new THREE.SphereGeometry(300,24,16);const skyMat=new THREE.ShaderMaterial({side:THREE.BackSide,depthWrite:false,uniforms:{top:{value:new THREE.Color('#7f9dab')},bottom:{value:new THREE.Color('#ead7b3')}},vertexShader:'varying vec3 vPos; void main(){vPos=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',fragmentShader:'uniform vec3 top;uniform vec3 bottom;varying vec3 vPos;void main(){float h=normalize(vPos).y;gl_FragColor=vec4(mix(bottom,top,smoothstep(-0.05,0.75,h)),1.0);}'});scene.add(new THREE.Mesh(skyGeo,skyMat));

  // 导航标记：像开放世界游戏一样，在每个地点上方显示发光标记；点击或按 E 前往。
  const doorGroup=new THREE.Group();office.add(doorGroup);
  box(1.9,3.1,.12,-6.5,1.55,7.8,'#2b2520',doorGroup,.3);box(1.6,2.85,.1,-6.5,1.43,7.74,'#5a4532',doorGroup);box(.06,.36,.08,-5.95,1.4,7.66,'#d9c7a0',doorGroup,.7);
  type Marker={group:THREE.Group;label:THREE.Sprite;gem:THREE.Mesh;beam:THREE.Mesh;places:Place[];base:number;size:number;near?:boolean};
  const markers:Marker[]=[];
  const beamTex=texture(c=>{const g=c.createLinearGradient(0,0,0,256);g.addColorStop(0,'rgba(255,214,120,0)');g.addColorStop(.5,'rgba(255,214,120,.55)');g.addColorStop(1,'rgba(255,224,150,1)');c.fillStyle=g;c.fillRect(0,0,64,256);},64,256);
  function marker(title:string,sub:string,x:number,y:number,z:number,places:Place[],action:{place?:Place;panel?:Panel},size=1,ground=0){
   const group=new THREE.Group();scene.add(group);
   const tex=texture(c=>{c.clearRect(0,0,640,200);c.fillStyle='rgba(16,30,25,.88)';c.strokeStyle='#f2c063';c.lineWidth=5;c.beginPath();c.roundRect(10,10,620,150,40);c.fill();c.stroke();
    c.fillStyle='#f2c063';c.beginPath();c.moveTo(70,48);c.lineTo(98,85);c.lineTo(70,122);c.lineTo(42,85);c.closePath();c.fill();
    c.fillStyle='#f4f1dc';c.font='600 54px sans-serif';c.textAlign='left';c.fillText(title,126,80);c.fillStyle='#c9d6be';c.font='34px sans-serif';c.fillText(sub,126,132);
    c.fillStyle='rgba(242,192,99,.9)';c.beginPath();c.moveTo(300,160);c.lineTo(340,160);c.lineTo(320,192);c.closePath();c.fill();},640,200);
   const label=new THREE.Sprite(new THREE.SpriteMaterial({map:tex,depthTest:false,depthWrite:false,transparent:true}));label.renderOrder=20;label.center.set(.5,0);label.position.set(x,y,z);group.add(label);
   label.userData={...action,label:title,far:true};interactables.push(label);
   const gem=new THREE.Mesh(new THREE.OctahedronGeometry(.16*size,0),new THREE.MeshBasicMaterial({color:'#ffd27a',transparent:true,opacity:.95,depthTest:false}));gem.renderOrder=19;gem.scale.y=1.5;gem.position.set(x,y-.35*size,z);group.add(gem);
   const h=Math.max(.1,y-.35*size-ground);const beam=new THREE.Mesh(new THREE.CylinderGeometry(.09*size,.09*size,h,10,1,true),new THREE.MeshBasicMaterial({map:beamTex,transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,side:THREE.DoubleSide}));beam.position.set(x,ground+h/2,z);group.add(beam);
   const m={group,label,gem,beam,places,base:y-.35*size,size};markers.push(m);return m;}
  marker('出口 · 去园区','走近按 E，或点击',-6.5,3.35,7.2,['walk','office'],{place:'campus'},.8);
  marker('A1 计算机房','点击进入机房',-10,9.5,-35,['campus'],{place:'hall'},5);
  marker('CEO 办公室','点击回到办公桌',0,8.5,1,['campus'],{place:'office'},5);
  marker('A2 在建机房','点击看施工进度',16,10,-55,['campus'],{panel:'construction'},5);
  marker('变电站 · 电','点击采购配电扩容',32,7.5,-29,['campus'],{panel:'supply'},5);
  marker('液冷区 · 冷','点击采购液冷 CDU',14,6.5,-39,['campus'],{panel:'supply'},5);
  marker('出口 · 回园区','点击或按 E',-10,3.4,-25.4,['hall'],{place:'campus'},.8);
  marker('GPU 机柜','每批 64 张 GPU',-8.6,3.9,-34.4,['hall'],{panel:'supply'},.8,3);
  marker('存储阵列','并行存储 · 存',-20,3.6,-33,['hall'],{panel:'supply'},.8,2.9);
  marker('光交换','高速光互联 · 光',.1,3.6,-34.4,['hall'],{panel:'supply'},.8,2.9);
  const prompt=document.createElement('div');prompt.style.cssText='position:absolute;left:50%;top:58%;transform:translate(-50%,-50%);padding:10px 18px;border-radius:999px;background:rgba(16,30,25,.88);border:1.5px solid #f2c063;color:#f4f1dc;font:500 16px/1.2 sans-serif;pointer-events:none;display:none;z-index:3;letter-spacing:.5px';el.appendChild(prompt);
  const edge=document.createElement('div');edge.style.cssText='position:absolute;padding:8px 14px;border-radius:999px;background:rgba(16,30,25,.85);border:1.5px solid #f2c063;color:#f2c063;font:500 15px/1.2 sans-serif;pointer-events:none;display:none;z-index:3;white-space:nowrap;transform:translate(-50%,-50%)';el.appendChild(edge);
  const exits:Record<string,{x:number;y:number;z:number;text:string}>={walk:{x:-6.5,y:2.2,z:7.6,text:'出口'},hall:{x:-10,y:2,z:-24.9,text:'出口'}};
  const proj=new THREE.Vector3();
  const shown=(o:THREE.Object3D|null)=>{while(o){if(!o.visible)return false;o=o.parent;}return true;};
  const pick=(max:number)=>ray.intersectObjects(interactables,false).find(x=>shown(x.object)&&(x.distance<max||x.object.userData.far))?.object;
  const act=(obj:THREE.Object3D)=>{const d=obj.userData;if(d.place)refs.current.onPlace(d.place);else if(d.panel)refs.current.onOpen(d.panel);};
  const forecastDraw=()=>{
   const tex=screenTextures[2];if(!tex)return;const canvas=tex.image as HTMLCanvasElement,c=canvas.getContext('2d')!,g=refs.current.game;
   const v=forecastView(g),info=methodInfo(g.forecast.method),e=errorStats(v.fit.rows,v.from),alarm=Math.abs(e.ts)>4;
   const past=v.series.slice(-21),fut=Array.from({length:7},(_,k)=>{const h=k+1,f=Math.max(0,v.fit.ahead(v.N-1,h)??0),sd=predictiveSd(v.fit,v.N-1,h,v.from)??0;return {t:g.day+k,f,b:intervalZ(g.forecast.z)*sd};});
   c.fillStyle='#0f2220';c.fillRect(0,0,1024,576);
   c.fillStyle='#d9e3d7';c.font='600 30px sans-serif';c.textAlign='left';c.fillText('NEXUS',44,56);c.fillStyle='#7f9b8f';c.font='500 26px sans-serif';c.textAlign='right';c.fillText('需求预测 · '+info.short,980,58);
   c.textAlign='left';c.fillStyle='#8fa98f';c.font='28px sans-serif';c.fillText('今日预测 · 第 '+g.day+' 天',44,120);
   c.fillStyle='#ffcb6b';c.font='500 84px sans-serif';const today=Math.round(fut[0].f);c.fillText(String(today),44,204);const w=c.measureText(String(today)).width;c.fillStyle='#8fa98f';c.font='30px sans-serif';c.fillText('GPU',58+w,204);
   c.textAlign='right';c.font='28px sans-serif';c.fillStyle='#8fa98f';c.fillText('MAD '+e.mad.toFixed(1)+'  ·  MAPE '+e.mape.toFixed(1)+'%',980,120);
   c.fillStyle=alarm?'#3a3320':'#1d3a2f';c.beginPath();c.roundRect(740,148,240,58,10);c.fill();c.fillStyle=alarm?'#f1cf8c':'#9fd3a8';c.font='500 30px sans-serif';c.fillText((alarm?'⚠ ':'')+'TS '+e.ts.toFixed(1),960,188);
   const all=[...past.map(p=>p.d),...fut.map(p=>p.f+p.b)],yMax=Math.max(...all)*1.12,t0=past[0].t,t1=fut[fut.length-1].t;
   const X=(t:number)=>60+(t-t0)/(t1-t0)*900,Y=(y:number)=>548-y/yMax*300;
   c.strokeStyle='#28403a';c.lineWidth=1;for(let k=0;k<=3;k++){const y=248+k*100;c.beginPath();c.moveTo(60,y);c.lineTo(960,y);c.stroke();}
   c.fillStyle='rgba(255,203,107,0.06)';c.fillRect(X(g.day-.5),240,X(t1)-X(g.day-.5)+10,308);
   c.fillStyle='rgba(255,203,107,0.22)';c.beginPath();fut.forEach((p,i)=>{const fn=i?'lineTo':'moveTo';c[fn](X(p.t),Y(p.f+p.b));});[...fut].reverse().forEach(p=>c.lineTo(X(p.t),Y(Math.max(0,p.f-p.b))));c.closePath();c.fill();
   c.lineJoin='round';c.strokeStyle='#d5dcb2';c.lineWidth=4;c.beginPath();past.forEach((p,i)=>i?c.lineTo(X(p.t),Y(p.d)):c.moveTo(X(p.t),Y(p.d)));c.stroke();
   c.strokeStyle='#ffcb6b';c.lineWidth=4;c.beginPath();c.moveTo(X(past[past.length-1].t),Y(past[past.length-1].d));fut.forEach(p=>c.lineTo(X(p.t),Y(p.f)));c.stroke();
   c.setLineDash([6,8]);c.strokeStyle='#9fb39a';c.lineWidth=2;c.beginPath();c.moveTo(X(g.day-.5),240);c.lineTo(X(g.day-.5),548);c.stroke();c.setLineDash([]);
   c.textAlign='left';c.fillStyle='#b6c8ad';c.font='24px sans-serif';c.fillText('今天',X(g.day-.5)+10,268);
   tex.needsUpdate=true;
  };
  const screenDraw=(index:number)=>{
   if(index===2){forecastDraw();return;}
   const canvas=screenTextures[index].image as HTMLCanvasElement,c=canvas.getContext('2d')!,g=refs.current.game,m=metrics(g),accent=index?'#acd9b2':'#d9bf82';
   c.fillStyle='#102422';c.fillRect(0,0,1024,512);c.fillStyle='#d9e3d7';c.font='600 30px sans-serif';c.fillText('NEXUS',44,52);c.fillStyle='#5f7d72';c.font='18px sans-serif';c.fillText(index?'CUSTOMER OPERATIONS':'SUPPLY CHAIN',670,52);c.fillStyle='#78968a';c.font='22px sans-serif';c.fillText(index?'CONTRACTED COMPUTE':'AVAILABLE CAPITAL',44,119);c.fillStyle=accent;c.font='500 65px sans-serif';c.fillText(index?m.demand.toLocaleString()+' GPU':money(g.cash,true),44,188);
   c.fillStyle='#28403a';c.fillRect(44,218,936,2);c.font='22px sans-serif';
   const names=index?['Orion AI','Helix Research','Frame Studio']:['GPU compute clusters','Optical interconnect','Power distribution'];
   for(let j=0;j<3;j++){c.fillStyle='#a7bdb0';c.fillText(names[j],65,278+j*76);c.fillStyle=j===0?accent:'#6f9480';c.fillText(index?(j===0?'256 GPU':j===1?'512 GPU':'128 GPU'):(j===0?g.gpu+' installed':j===1?'400 Gb/s':g.power+' MW'),690,278+j*76);c.fillStyle='#233d35';c.fillRect(44,302+j*76,936,1);}
   screenTextures[index].needsUpdate=true;
  };
  const keys=new Set<string>();let dragging=false,lastX=0,lastY=0,moved=0,hover:THREE.Object3D|undefined;
  const ray=new THREE.Raycaster(),mouse=new THREE.Vector2();let lastGame:Game|undefined,lastLayer='',lastPlace='office',time=0,frame=0,prev=performance.now(),disposed=false;
  const destination=new THREE.Vector3(),targetQuat=new THREE.Quaternion();let transit=0;
  const presets:Record<Place,{pos:number[];look:number[]}>= {office:{pos:[0,2.55,6.7],look:[0,2,-25]},walk:{pos:[-5,1.9,3],look:[-3,2,-3]},campus:{pos:[45,34,14],look:[-1,0,-35]},hall:{pos:[-9.75,2.2,-26.3],look:[-9.75,1.85,-42]}};
  function selectPlace(p:Place){const v=presets[p];destination.set(...v.pos as [number,number,number]);const dummy=new THREE.PerspectiveCamera();dummy.position.copy(destination);dummy.lookAt(new THREE.Vector3(...v.look as [number,number,number]));targetQuat.copy(dummy.quaternion);transit=1;keys.clear();}
  const pointerdown=(e:PointerEvent)=>{if(refs.current.blocked)return;const bounds=el.getBoundingClientRect();mouse.set((e.clientX-bounds.left)/bounds.width*2-1,-(e.clientY-bounds.top)/bounds.height*2+1);ray.setFromCamera(mouse,camera);hover=pick(14);dragging=true;lastX=e.clientX;lastY=e.clientY;moved=0;renderer.domElement.setPointerCapture(e.pointerId);};
  const pointermove=(e:PointerEvent)=>{if(refs.current.blocked)return;if(dragging){const dx=e.clientX-lastX,dy=e.clientY-lastY;moved+=Math.abs(dx)+Math.abs(dy);camera.rotation.y+=dx*.0024;camera.rotation.x=THREE.MathUtils.clamp(camera.rotation.x+dy*.0024,-1.35,1.1);transit=0;lastX=e.clientX;lastY=e.clientY;}const bounds=el.getBoundingClientRect();mouse.set((e.clientX-bounds.left)/bounds.width*2-1,-(e.clientY-bounds.top)/bounds.height*2+1);ray.setFromCamera(mouse,camera);hover=pick(14);renderer.domElement.style.cursor=dragging?'grabbing':hover?'pointer':'grab';};
  const pointerup=()=>{if(dragging&&moved<7&&hover&&!refs.current.blocked)act(hover);dragging=false;};
  const keydown=(e:KeyboardEvent)=>{if(refs.current.blocked)return;if(['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','KeyE','KeyF'].includes(e.code))e.preventDefault();keys.add(e.code);if(e.repeat)return;if(e.code==='KeyF')refs.current.onPlace(refs.current.place==='office'?'walk':'office');if(e.code==='KeyE'){const r=refs.current;if(r.place==='walk'&&Math.hypot(camera.position.x+6.5,camera.position.z-7.2)<3.6){r.onPlace('campus');return;}if(r.place==='hall'&&Math.hypot(camera.position.x+10,camera.position.z+25.4)<3.2){r.onPlace('campus');return;}ray.setFromCamera(new THREE.Vector2(0,0),camera);const obj=pick(13);if(obj)act(obj);}};
  const keyup=(e:KeyboardEvent)=>keys.delete(e.code);const blur=()=>{keys.clear();dragging=false;};
  const resize=()=>{renderer.setSize(el.clientWidth,el.clientHeight);camera.aspect=el.clientWidth/el.clientHeight;camera.updateProjectionMatrix();};
  const ro=new ResizeObserver(resize);ro.observe(el);renderer.domElement.addEventListener('pointerdown',pointerdown);renderer.domElement.addEventListener('pointermove',pointermove);renderer.domElement.addEventListener('pointerup',pointerup);renderer.domElement.addEventListener('pointercancel',blur);window.addEventListener('keydown',keydown);window.addEventListener('keyup',keyup);window.addEventListener('blur',blur);
  const isBlocked=(x:number,z:number)=>refs.current.place==='walk' && ((x>-3.6&&x<3.6&&z>.1&&z<3.15)||(x>6.6&&z>-.4&&z<4));
  const loop=()=>{
   if(disposed)return;frame=requestAnimationFrame(loop);const now=performance.now(),dt=Math.min((now-prev)/1000,.05);prev=now;time+=dt;const r=refs.current;
   if(r.game!==lastGame){lastGame=r.game;screenDraw(0);screenDraw(1);screenDraw(2);a2Walls.scale.y=Math.max(.1,r.game.progress/100)*6;a2Walls.position.y=a2Walls.scale.y/2;a2Roof.visible=r.game.progress>=100;const installed=Math.min(24,Math.ceil(r.game.gpu/64));rackMeshes.forEach((x,i)=>{x.material=material(i<installed?'#35453f':'#202d2c',.5)});rackLights.forEach((x,i)=>{x.visible=Math.floor(i/7)<installed});}
   if(r.place!==lastPlace){lastPlace=r.place;selectPlace(r.place);}
   if(r.layer!==lastLayer){lastLayer=r.layer;for(const [key,group] of Object.entries(components))group.traverse(o=>{if(o instanceof THREE.Mesh){const mat=o.material as THREE.MeshStandardMaterial;if(!o.userData.ownMaterial){o.material=mat.clone();o.userData.ownMaterial=true;}const m=o.material as THREE.MeshStandardMaterial;m.emissive=new THREE.Color(key===r.layer?CAT_COLORS[key]:'#000000');m.emissiveIntensity=.45;}});}
   const cut=r.place==='campus'&&r.layer!=='all';shell.forEach(x=>{x.visible=!cut});hallSign.visible=!cut;office.visible=r.place!=='hall';
   if(transit>0){camera.position.lerp(destination,1-Math.exp(-dt*4));camera.quaternion.slerp(targetQuat,1-Math.exp(-dt*4));if(camera.position.distanceTo(destination)<.02)transit=0;}
   if(!r.blocked&&!transit){
    if(keys.has('ArrowLeft'))camera.rotation.y+=dt*.9;if(keys.has('ArrowRight'))camera.rotation.y-=dt*.9;if(keys.has('ArrowUp'))camera.rotation.x=Math.min(1.1,camera.rotation.x+dt*.65);if(keys.has('ArrowDown'))camera.rotation.x=Math.max(-1.35,camera.rotation.x-dt*.65);
    if(r.place==='walk'||r.place==='hall'){
     let f=Number(keys.has('KeyW'))-Number(keys.has('KeyS')),s=Number(keys.has('KeyD'))-Number(keys.has('KeyA'));const norm=Math.hypot(f,s)||1;f/=norm;s/=norm;const speed=(keys.has('ShiftLeft')?4.8:2.6)*dt,angle=camera.rotation.y;
     let nx=camera.position.x+(Math.cos(angle)*s-Math.sin(angle)*f)*speed,nz=camera.position.z+(-Math.sin(angle)*s-Math.cos(angle)*f)*speed;
     if(r.place==='walk'){nx=THREE.MathUtils.clamp(nx,-8.6,8.5);nz=THREE.MathUtils.clamp(nz,-4.8,7.3);}else{nx=THREE.MathUtils.clamp(nx,-20.6,.5);nz=THREE.MathUtils.clamp(nz,-44,-22);const hits=(x:number,z:number)=>rackMeshes.some(rack=>Math.abs(x-rack.position.x)<.85&&Math.abs(z-rack.position.z)<1.1);if(hits(nx,nz)){nx=camera.position.x;nz=camera.position.z;}}
     if(!isBlocked(nx,camera.position.z))camera.position.x=nx;if(!isBlocked(camera.position.x,nz))camera.position.z=nz;
     if(f||s)camera.position.y=(r.place==='hall'?2.2:1.9)+Math.sin(time*10)*.022;
    }
   }
   if(!r.blocked){arm.rotation.y=2.6+Math.sin(time*.09)*.14;truck.position.x=-32+(time*.8)%60;}
   for(const m of markers){const on=m.places.includes(r.place);m.group.visible=on;if(!on)continue;const d=camera.position.distanceTo(m.label.position);const k=THREE.MathUtils.clamp(d*.08,.34,11);m.label.scale.set(k*3.2,k,1);const bob=Math.sin(time*2.4+m.base)*.08*m.size;m.gem.position.y=m.base+bob;m.gem.rotation.y=time*1.6;(m.beam.material as THREE.MeshBasicMaterial).opacity=.55+.35*Math.sin(time*3+m.base);(m.label.material as THREE.SpriteMaterial).opacity=d<1.2?.25:1;}
   const ex=exits[r.place];
   if(ex&&!r.blocked){const near=Math.hypot(camera.position.x-ex.x,camera.position.z-ex.z)<3.6;prompt.style.display=near?'block':'none';prompt.textContent=r.place==='walk'?'按 E 出门 · 前往园区':'按 E 离开机房 · 回到园区';
    proj.set(ex.x,ex.y,ex.z).project(camera);const behind=proj.z>1;let sx=proj.x,sy=proj.y;if(behind){sx=-sx;sy=-sy;}
    const off=behind||Math.abs(sx)>.92||Math.abs(sy)>.9;
    if(off&&!near){sx=sx<0?-.42:.42;sy=.12;edge.style.display='block';edge.style.left=((sx+1)/2*100)+'%';edge.style.top=((1-sy)/2*100)+'%';edge.textContent=(sx<0?'◀ ':'')+ex.text+(sx<0?'':' ▶');}else edge.style.display='none';}
   else{prompt.style.display='none';edge.style.display='none';}
   renderer.render(scene,camera);
  };
  const CAT_COLORS:Record<string,string>={optical:'#52cbe9',power:'#ffcb6b',storage:'#74dfa9',compute:'#b4a2ff',cooling:'#74b4ff'};
  loop();refs.current.onReady();
  return()=>{disposed=true;cancelAnimationFrame(frame);ro.disconnect();window.removeEventListener('keydown',keydown);window.removeEventListener('keyup',keyup);window.removeEventListener('blur',blur);renderer.domElement.removeEventListener('pointerdown',pointerdown);renderer.domElement.removeEventListener('pointermove',pointermove);renderer.domElement.removeEventListener('pointerup',pointerup);renderer.domElement.removeEventListener('pointercancel',blur);scene.traverse(o=>{if(o instanceof THREE.Mesh){o.geometry.dispose();for(const m of(Array.isArray(o.material)?o.material:[o.material])){m.map?.dispose();m.dispose();}}});renderer.dispose();renderer.domElement.remove();prompt.remove();edge.remove();};
 },[]);
 return <div className="scene" ref={host}>{error&&<div className="scene-error"><b>无法启动 3D 场景</b><p>{error}</p><p>经营面板仍可使用，下方导航可直接打开采购与客户。</p></div>}</div>;
}
