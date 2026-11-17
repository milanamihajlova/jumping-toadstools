'use strict';
const express=require('express');
const http=require('http');
const path=require('path');
const {Server}=require('socket.io');
const crypto=require('crypto');
const app=express(), server=http.createServer(app), io=new Server(server);
app.use(express.static(__dirname));
app.get('/',(req,res)=>res.sendFile(path.join(__dirname,'index.html')));
const rooms=new Map();
const TRACK=30, ROUND_MS=20000, MAX_ROUNDS=18;
const COLORS=['red','blue','gold','violet','mint'];
const ACTIONS=['safe','leap','spell','rest'];
const clean=x=>String(x??'').trim().replace(/[<>]/g,'').slice(0,24);
const random=(min,max)=>crypto.randomInt(min,max+1);
const code=()=>crypto.randomBytes(3).toString('hex').toUpperCase();
const active=r=>[...r.players.values()].filter(p=>!p.finished);
function publicState(r){return {code:r.code,host:r.host,status:r.status,round:r.round,deadline:r.deadline,track:TRACK,players:[...r.players.values()].map(p=>({id:p.id,name:p.name,color:p.color,pos:p.pos,energy:p.energy,shield:p.shield,slow:p.slow,finished:p.finished,rank:p.rank,submitted:!!p.choice})),log:r.log.slice(-14),lastMoves:r.lastMoves};}
function send(r){io.to(r.code).emit('state',publicState(r));}
function tell(cb,error){if(typeof cb==='function')cb(error?{error}:{ok:true});}
function joinRoom(s,r,name,color){s.join(r.code);s.data.room=r.code;r.players.set(s.id,{id:s.id,name,color:COLORS.includes(color)?color:'red',pos:0,energy:5,shield:0,slow:0,finished:false,rank:null,choice:null});send(r);}
function leave(s){const r=rooms.get(s.data.room);if(!r)return;r.players.delete(s.id);s.leave(r.code);s.data.room=null;if(r.host===s.id)r.host=r.players.keys().next().value??null;if(!r.players.size){clearTimeout(r.timer);rooms.delete(r.code);}else{send(r);if(r.status==='running'&&active(r).every(p=>p.choice))finishRound(r);}}
function beginRound(r){r.deadline=Date.now()+ROUND_MS;send(r);r.timer=setTimeout(()=>finishRound(r),ROUND_MS);}
function finishRound(r){if(r.status!=='running')return;clearTimeout(r.timer);r.timer=null;const players=active(r),moves=[],events=[];
// Every action is resolved on the server, not trusted from a browser.
for(const p of players){const choice=p.choice||{action:'safe'};let steps=0,description='';const from=p.pos;const energyBefore=p.energy;
switch(choice.action){case 'leap':if(p.energy>=2){p.energy-=2;const die=random(1,6);steps=die>=3?die+1:0;description=steps?'⚡ Большой прыжок':'💥 Неудачный прыжок';}else{steps=random(1,3);description='🌿 Недостаточно энергии: осторожный прыжок';}break;
case 'spell':if(p.energy>=1){p.energy--;steps=random(1,2);description='🪄 Магическая выходка';}else{steps=random(1,3);description='🌿 Недостаточно энергии: осторожный прыжок';}break;
case 'rest':steps=1;p.energy=Math.min(5,p.energy+2);description='🍃 Передышка';break;
default:steps=random(1,3);description='🌿 Осторожный прыжок';break;}
if(p.slow){steps=Math.max(0,steps-2);p.slow=0;description+=' · замедление';}
let event=null;if(random(1,100)<=30){const type=random(1,4);if(type===1){event='🌱 Волшебное удобрение: +2 клетки';steps+=2;}else if(type===2){if(p.shield){p.shield=0;event='🛡️ Щит спас от Дьявольских силков';}else{steps=Math.max(0,steps-2);event='🌿 Дьявольские силки: −2 клетки';}}else if(type===3){p.energy=Math.min(5,p.energy+1);event='✨ Золотой росток: +1 энергия';}else{event='💨 Попутный ветер: +1 клетка';steps+=1;}}
p.pos=Math.min(TRACK,p.pos+steps);moves.push({id:p.id,name:p.name,from,to:p.pos,steps:p.pos-from,energyBefore,energy:p.energy,description,event,spell:null});if(event)events.push(`${p.name}: ${event}`);
}
// Spells are applied after movement. Target is chosen by the player; invalid target is a random rival.
for(const p of players){const choice=p.choice||{action:'safe'};if(choice.action!=='spell'||!moves.find(m=>m.id===p.id)?.description.startsWith('🪄'))continue;
const rivals=players.filter(x=>x.id!==p.id&&!x.finished);const target=rivals.find(x=>x.id===choice.target)|| (rivals.length?rivals[random(0,rivals.length-1)]:null);const roll=random(1,4);let result='';
if(roll===1){p.shield=1;result=`🛡️ Протего: ${p.name} получает щит`;}else if(roll===2){p.pos=Math.min(TRACK,p.pos+2);result=`✨ Локомотор: ${p.name} +2 клетки`;}else if(target){if(roll===3){if(target.shield){target.shield=0;result=`🛡️ ${target.name} отражает Импедименту`;}else{target.slow=1;result=`🌀 Импедимента: ${target.name} замедлен на следующий раунд`;}}else{if(target.shield){target.shield=0;result=`🛡️ ${target.name} отражает Конфундус`;}else{const delta=Math.min(2,target.pos);target.pos-=delta;result=`💫 Конфундус: ${target.name} −${delta} клетки`;}}}else{p.energy=Math.min(5,p.energy+1);result=`✨ Без соперников: ${p.name} +1 энергия`;}
moves.find(m=>m.id===p.id).spell=result;events.push(result);
}
for(const m of moves){const p=r.players.get(m.id);m.to=p.pos;m.steps=p.pos-m.from;m.energy=p.energy;m.shield=p.shield;}
const finishers=players.filter(p=>p.pos>=TRACK).sort((a,b)=>{const ma=moves.find(m=>m.id===a.id),mb=moves.find(m=>m.id===b.id);return (mb?.steps||0)-(ma?.steps||0)||a.name.localeCompare(b.name);});
for(const p of finishers){p.finished=true;p.rank=1+[...r.players.values()].filter(x=>x.finished&&x!==p).length;}
r.lastMoves=moves;r.log.push(`Раунд ${r.round}: ${moves.map(m=>`${m.name} ${m.steps>=0?'+':''}${m.steps}`).join(' · ')}`,...events);if(r.log.length>80)r.log=r.log.slice(-80);
for(const p of players)p.choice=null;
if(active(r).length===0||r.round>=MAX_ROUNDS){r.status='finished';r.deadline=null;const sorted=[...r.players.values()].sort((a,b)=>b.pos-a.pos||(a.rank??999)-(b.rank??999)||a.name.localeCompare(b.name));sorted.forEach((p,i)=>p.rank=i+1);send(r);return;}
r.round++;beginRound(r);
}
io.on('connection',s=>{
s.on('create',({name,color}={},cb)=>{const n=clean(name);if(!n)return tell(cb,'Введите имя поганки');leave(s);let c=code();while(rooms.has(c))c=code();const r={code:c,host:s.id,status:'lobby',round:0,deadline:null,players:new Map(),log:[],lastMoves:[],timer:null};rooms.set(c,r);joinRoom(s,r,n,color);tell(cb);});
s.on('join',({code:c,name,color}={},cb)=>{const r=rooms.get(String(c||'').trim().toUpperCase()),n=clean(name);if(!r)return tell(cb,'Комната не найдена');if(r.status!=='lobby')return tell(cb,'Гонка уже началась');if(!n)return tell(cb,'Введите имя поганки');if(r.players.size>=24)return tell(cb,'Максимум 24 участника');if([...r.players.values()].some(p=>p.name.toLowerCase()===n.toLowerCase()))return tell(cb,'Имя уже занято');leave(s);joinRoom(s,r,n,color);tell(cb);});
s.on('start',(_,cb)=>{const r=rooms.get(s.data.room);if(!r||r.host!==s.id)return tell(cb,'Только ведущий может начать');if(r.status!=='lobby')return tell(cb,'Гонка уже идёт');if(r.players.size<2)return tell(cb,'Нужно хотя бы 2 игрока');r.status='running';r.round=1;r.log.push('🏁 Гонка началась!');beginRound(r);tell(cb);});
s.on('move',({action,target}={},cb)=>{const r=rooms.get(s.data.room),p=r?.players.get(s.id);if(!r||r.status!=='running'||!p||p.finished)return tell(cb,'Сейчас нельзя сделать ход');if(p.choice)return tell(cb,'Ход уже выбран');if(!ACTIONS.includes(action))return tell(cb,'Неизвестное действие');if(action==='leap'&&p.energy<2)return tell(cb,'Для большого прыжка нужно 2 энергии');if(action==='spell'&&p.energy<1)return tell(cb,'Для заклинания нужна 1 энергия');p.choice={action,target:String(target||'').slice(0,100)};tell(cb);send(r);if(active(r).every(x=>x.choice))finishRound(r);});
s.on('restart',(_,cb)=>{const r=rooms.get(s.data.room);if(!r||r.host!==s.id)return tell(cb,'Только ведущий может перезапустить');clearTimeout(r.timer);r.status='lobby';r.round=0;r.deadline=null;r.log=[];r.lastMoves=[];for(const p of r.players.values())Object.assign(p,{pos:0,energy:5,shield:0,slow:0,finished:false,rank:null,choice:null});send(r);tell(cb);});
s.on('disconnect',()=>leave(s));
});
server.listen(process.env.PORT||3000,()=>console.log('Magic Chaos game running on port '+(process.env.PORT||3000)));
