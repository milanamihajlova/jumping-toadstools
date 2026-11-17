const express=require('express');
const http=require('http');
const {Server}=require('socket.io');
const crypto=require('crypto');
const app=express(),server=http.createServer(app),io=new Server(server);
app.use(express.static(__dirname));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});
const rooms=new Map();
const TRACK=30, ROUND_MS=16000;
const clean=s=>String(s||'').trim().slice(0,24).replace(/[<>]/g,'');
const code=()=>crypto.randomBytes(3).toString('hex').toUpperCase();
function view(r){return {code:r.code,status:r.status,host:r.host,round:r.round,deadline:r.deadline,track:TRACK,players:[...r.players.values()].map(p=>({id:p.id,name:p.name,color:p.color,pos:p.pos,finished:p.finished,rank:p.rank,submitted:!!p.choice})),log:r.log.slice(-8)}}
function send(r){io.to(r.code).emit('state',view(r))}
function notice(s,msg){s.emit('notice',msg)}
function finishRound(r){if(r.status!=='running')return;clearTimeout(r.timer);r.timer=null;const moves=[];for(const p of r.players.values()){if(p.finished)continue;const die=1+Math.floor(Math.random()*6);const tactic=p.choice||'steady';let steps=tactic==='safe'?Math.max(3,die):tactic==='risky'?(die>=4?die+3:1):die;const from=p.pos;p.pos=Math.min(TRACK,p.pos+steps);p.choice=null;moves.push({p,from,steps});}const winners=moves.filter(m=>m.p.pos===TRACK).sort((a,b)=>b.steps-a.steps);for(const m of winners){m.p.finished=true;m.p.rank=1+[...r.players.values()].filter(p=>p.finished&&p!==m.p).length;}r.log.push('Раунд '+r.round+': '+moves.map(m=>m.p.name+' +'+m.steps).join(' · '));if([...r.players.values()].every(p=>p.finished)||r.round>=20){r.status='finished';let rank=1;for(const p of [...r.players.values()].sort((a,b)=>b.pos-a.pos||a.rank-b.rank)){p.rank=rank++;}r.deadline=null;send(r);return;}r.round++;r.deadline=Date.now()+ROUND_MS;send(r);r.timer=setTimeout(()=>finishRound(r),ROUND_MS)}
function remove(s){const c=s.data.room;if(!c)return;const r=rooms.get(c);if(!r)return;const p=r.players.get(s.id);r.players.delete(s.id);s.leave(c);s.data.room=null;if(r.host===s.id){r.host=r.players.keys().next().value||null;}if(!r.players.size){clearTimeout(r.timer);rooms.delete(c)}else{if(r.status==='running'&&[...r.players.values()].every(x=>x.choice||x.finished))finishRound(r);else send(r)}}
io.on('connection',s=>{
s.on('create',({name,color}={},cb)=>{remove(s);const n=clean(name);if(!n)return cb?.({error:'Введите имя'});let c=code();while(rooms.has(c))c=code();const r={code:c,host:s.id,status:'lobby',round:0,deadline:null,players:new Map(),log:[],timer:null};rooms.set(c,r);join(r,n,color);cb?.({ok:true,code:c});});
function join(r,name,color){s.join(r.code);s.data.room=r.code;r.players.set(s.id,{id:s.id,name,color:['red','blue','gold','violet','mint'].includes(color)?color:'red',pos:0,choice:null,finished:false,rank:null});send(r)}
s.on('join',({code:c,name,color}={},cb)=>{remove(s);const r=rooms.get(String(c||'').toUpperCase().trim()),n=clean(name);if(!r)return cb?.({error:'Комната не найдена'});if(r.status!=='lobby')return cb?.({error:'Гонка уже началась'});if(r.players.size>=24)return cb?.({error:'Комната заполнена (24 игрока)'});if(!n)return cb?.({error:'Введите имя'});if([...r.players.values()].some(p=>p.name.toLowerCase()===n.toLowerCase()))return cb?.({error:'Это имя уже занято'});join(r,n,color);cb?.({ok:true});});
s.on('start',(_,cb)=>{const r=rooms.get(s.data.room);if(!r||r.host!==s.id)return cb?.({error:'Только ведущий может начать'});if(r.status!=='lobby')return cb?.({error:'Гонка уже началась'});if(r.players.size<2)return cb?.({error:'Нужно минимум 2 игрока'});r.status='running';r.round=1;r.deadline=Date.now()+ROUND_MS;r.log.push('Гонка началась!');send(r);r.timer=setTimeout(()=>finishRound(r),ROUND_MS);cb?.({ok:true});});
s.on('move',({tactic}={},cb)=>{const r=rooms.get(s.data.room),p=r?.players.get(s.id);if(!r||r.status!=='running'||!p||p.finished)return cb?.({error:'Сейчас нельзя прыгнуть'});if(p.choice)return cb?.({error:'Ход уже выбран'});if(!['safe','steady','risky'].includes(tactic))return cb?.({error:'Неверная тактика'});p.choice=tactic;send(r);cb?.({ok:true});if([...r.players.values()].every(x=>x.choice||x.finished))finishRound(r);});
s.on('restart',(_,cb)=>{const r=rooms.get(s.data.room);if(!r||r.host!==s.id)return cb?.({error:'Только ведущий'});clearTimeout(r.timer);r.status='lobby';r.round=0;r.deadline=null;r.log=[];for(const p of r.players.values())Object.assign(p,{pos:0,choice:null,finished:false,rank:null});send(r);cb?.({ok:true});});
s.on('disconnect',()=>remove(s));
});
server.listen(process.env.PORT||3000,()=>console.log('Game running on port '+(process.env.PORT||3000)));
