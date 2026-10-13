'use strict';
/** 自定义人数与身份牌的无裁判扑克迷局：纯Node.js，零第三方依赖 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const PORT = Number(process.env.PORT || 3000);
const ROOT = path.join(__dirname,'public');
const rooms = new Map();
// Optional persistent room snapshots. Attach a cloud volume and set DATA_DIR=/data.
const DATA_DIR = process.env.DATA_DIR || '';
const SNAPSHOT_FILE = DATA_DIR ? path.join(DATA_DIR, 'poker-maze-rooms.json') : null;
function saveRooms() {
  if (!SNAPSHOT_FILE) return;
  try {
    fs.mkdirSync(DATA_DIR, {recursive:true});
    const snapshot = [...rooms.values()].map(room => ({...room,
      players:room.players.map(({peer,connected,...player}) => ({...player,connected:false}))}));
    const tmp=SNAPSHOT_FILE+'.tmp';
    fs.writeFileSync(tmp,JSON.stringify({version:1,rooms:snapshot}),{mode:0o600});
    fs.renameSync(tmp,SNAPSHOT_FILE);
  } catch(err) { console.error('Room snapshot could not be saved:',err.message); }
}
function loadRooms() {
  if (!SNAPSHOT_FILE) return;
  try {
    const data = JSON.parse(fs.readFileSync(SNAPSHOT_FILE,'utf8'));
    if (data.version!==1 || !Array.isArray(data.rooms)) throw Error('snapshot schema mismatch');
    for (const room of data.rooms) {
      if (!room || typeof room.code!=='string' || !Array.isArray(room.players)) continue;
      room.players=room.players.map(p=>({...p,connected:false,peer:null}));
      rooms.set(room.code,room);
    }
    console.log(`Loaded ${rooms.size} saved room(s)`);
  } catch(err) {
    if(err.code!=='ENOENT') console.error('Could not restore rooms:',err.message);
  }
}
loadRooms();
const suits = ['heart','spade','joker'];
const labels = {heart:'红桃',spade:'黑桃',joker:'Joker'};
const dirs = {heart:[1,0],spade:[-1,1],joker:[0,-1]};
const lensKeys = new Set(['2,0','-2,2','0,-2','1,1','-1,1','1,-2','-2,1','0,2']);
const publicFiles = {'/':'index.html','/index.html':'index.html','/style.css':'style.css','/client.js':'client.js'};
const roleTypes=['heart','spade','big','little'];
const MIME = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.webp':'image/webp'};
const server = http.createServer((req,res)=>{
  let url;
  try { url=new URL(req.url,'http://localhost'); } catch {res.writeHead(400);res.end();return;}
  if (url.pathname==='/health') {
    res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
    res.end(JSON.stringify({status:'ok'}));return;
  }
  const avatar = /^\/avatars\/(heart|spade|big|little|civilian)\.webp$/.test(url.pathname);
  const name = publicFiles[url.pathname] || (avatar ? url.pathname.slice(1) : null);
  if (!name) {res.writeHead(404);res.end('Not Found');return;}
  const filepath=path.join(ROOT,name);
  fs.readFile(filepath,(err,data)=>{
    if(err){res.writeHead(500);res.end('Unable to read file');return;}
    res.writeHead(200,{'Content-Type':MIME[path.extname(filepath)],'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
    res.end(data);
  });
});

// RFC 6455 text/ping/close frame support, avoids needing npm install.
const livePeers = new Set();
class Peer {
  constructor(socket){
    this.socket=socket;this.buffer=Buffer.alloc(0);this.room=null;this.playerId=null;this.closed=false;
    socket.on('data',d=>this.feed(d));
    socket.on('close',()=>this.disconnect());socket.on('error',()=>this.disconnect());
  }
  send(data){
    if(this.closed||this.socket.destroyed)return;
    const payload=Buffer.from(JSON.stringify(data)); let head;
    if(payload.length<126){head=Buffer.from([0x81,payload.length]);}
    else if(payload.length<65536){head=Buffer.alloc(4);head[0]=0x81;head[1]=126;head.writeUInt16BE(payload.length,2);}
    else{head=Buffer.alloc(10);head[0]=0x81;head[1]=127;head.writeBigUInt64BE(BigInt(payload.length),2);}
    this.socket.write(Buffer.concat([head,payload]));
  }
  control(op, payload=Buffer.alloc(0)){
    if(!this.socket.destroyed)this.socket.write(Buffer.concat([Buffer.from([0x80|op,payload.length]),payload]));
  }
  feed(chunk){
    this.buffer=Buffer.concat([this.buffer,chunk]);
    if(this.buffer.length>300000){this.socket.destroy();return;}
    while(this.buffer.length>=2){
      const b=this.buffer;const opcode=b[0]&15;const fin=(b[0]&128)!==0;
      const masked=(b[1]&128)!==0;let size=b[1]&127;let h=2;
      if(size===126){if(b.length<4)return;size=b.readUInt16BE(2);h=4;}
      else if(size===127){if(b.length<10)return;const big=b.readBigUInt64BE(2);if(big>BigInt(65536)){this.socket.destroy();return;}size=Number(big);h=10;}
      if(!masked||!fin||size>65536){this.socket.destroy();return;}
      if(b.length<h+4+size)return;
      const mask=b.subarray(h,h+4);const payload=Buffer.from(b.subarray(h+4,h+4+size));
      this.buffer=b.subarray(h+4+size);
      for(let i=0;i<payload.length;i++)payload[i]^=mask[i%4];
      if(opcode===8){this.control(8);this.socket.end();return;}
      if(opcode===9){this.control(10,payload);continue;}
      if(opcode===10)continue;
      if(opcode!==1){this.socket.destroy();return;}
      try { handle(this,JSON.parse(payload.toString('utf8'))); }
      catch(err){this.send({type:'error',message:'请求格式不正确'});}
    }
  }
  disconnect(){
    if(this.closed)return;this.closed=true;livePeers.delete(this);
    const room=this.room;const user=getUser(this);
    if(room&&user&&user.peer===this){
      user.connected=false;user.peer=null;
      addLog(room,'system',`${user.name} 暂时离线，可用原设备重新进入`);
      broadcast(room);
    }
  }
}
server.on('upgrade',(req,socket,head)=>{
  const key=req.headers['sec-websocket-key'];
  if(req.url!=='/ws'||req.headers.upgrade?.toLowerCase()!=='websocket'||typeof key!=='string'){
    socket.destroy();return;
  }
  const accept=crypto.createHash('sha1').update(key+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: '+accept+'\r\n\r\n');
  const peer=new Peer(socket);livePeers.add(peer);if(head.length)peer.feed(head);
});
function id(){return crypto.randomBytes(16).toString('hex');}
function code(){let s;do{s=Array.from({length:6},()=> 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[crypto.randomInt(32)]).join('');}while(rooms.has(s));return s;}
function shuffle(a){for(let i=a.length-1;i>0;i--){const j=crypto.randomInt(i+1);[a[i],a[j]]=[a[j],a[i]];}return a;}
function getUser(peer){return peer.room?.players.find(p=>p.id===peer.playerId);}
function requireRoom(peer){const room=peer.room,user=getUser(peer);if(!room||!user)throw Error('请先加入房间');return {room,user};}
function ensure(ok,msg){if(!ok)throw Error(msg);}
function addLog(room,kind,message,extra={}){
  room.log.push({id:++room.logId,kind,message,...extra,ts:Date.now()});
  if(room.log.length>110)room.log.shift();
}
function notify(room,playerId,message){const p=room.players.find(p=>p.id===playerId);p?.peer?.send({type:'private',message});}
function king(room){return room.players[room.kingIndex];}
function nextKing(room){room.kingIndex=(room.kingIndex+1)%room.players.length;}
function roles(room){
  return shuffle(roleTypes.flatMap(role=>Array(room.counts[role]).fill(role)));
}
function validCounts(size,counts){
  return Number.isSafeInteger(size)&&size>=3&&counts&&typeof counts==='object'&&
    roleTypes.every(role=>Number.isSafeInteger(counts[role])&&counts[role]>=(role==='little'?0:1))&&
    roleTypes.reduce((n,role)=>n+counts[role],0)===size;
}
function newDeck(){return shuffle([...Array(10).fill('heart'),...Array(10).fill('spade'),...Array(7).fill('joker')]);}
function draw(room){if(!room.deck.length)room.deck=newDeck();return room.deck.pop();}
function validLens(room){return lensKeys.has(`${room.position.q},${room.position.r}`);}
function progress({q,r}){return {heart:q+r/2,spade:(-q+r)/2,joker:-q/2-r};}
function winner(room){const p=progress(room.position);return suits.find(s=>p[s]>=room.goal)||null;}
function publicState(room,user){
  const blackMates = user.role==='spade' ? room.players.filter(p=>p.role==='spade').map(p=>p.id):[];
  const jokerMates = (user.role==='big'||user.role==='little') ? room.players.filter(p=>p.role==='big'||p.role==='little').map(p=>p.id):[];
  return {
    type:'state', code:room.code, status:room.status, size:room.size, advanced:room.counts.little>0, counts:{...room.counts},
    hostId:room.hostId, phase:room.phase, round:room.round, denyThreshold:Math.ceil(room.players.length/2),
    kingId:room.status==='playing'?king(room).id:null,
    queenId:room.queenId,knightId:room.knightId,
    nomination:room.nomination, voterIds:Object.keys(room.votes),
    noCount:room.status==='playing'?null:0,
    players:room.players.map(p=>({id:p.id,name:p.name,connected:p.connected,usedNo:p.usedNo,phrase:p.phrase,...(room.status==='over'?{revealedRole:p.role}:{})})),
    you:{id:user.id,role:user.role,blackMates,jokerMates,hand:room.hands[user.id]||null,
      chosen:room.choices[user.id]||null,vote:room.votes[user.id]||null,
      knightCards:room.phase==='knightPick'&&room.knightId===user.id?room.knightCards:null,
      privateResult:room.privateResults[user.id]||null},
    position:room.position,goal:room.goal,inspectTargetId:room.inspectTargetId,
    pendingWinner:room.status==='over'?room.winner:null,
    usedConvert:room.usedConvert,played:room.played,
    log:room.log,
  };
}
function broadcast(room){saveRooms();for(const p of room.players)if(p.peer&&!p.peer.closed)p.peer.send(publicState(room,p));}
function advance(room){
  if(room.actions.length){
    const action=room.actions.shift();
    room.phase=action==='convert'?'convert':'inspectSelect';return;
  }
  if(room.nextWinner){
    room.status='over';room.phase='over';room.winner=room.nextWinner;
    addLog(room,'system',`🏆 ${labels[room.winner]}阵营抵达终点！游戏结束，身份全部揭晓。`);
    return;
  }
  room.phase='discuss';addLog(room,'system','进入讨论阶段，可在公屏交流。由本回合国王开启下一轮。');
}
function startRound(room){
  room.round++;
  room.phase='nominate';room.queenId=null;room.knightId=null;room.nomination=null;
  room.votes={};room.choices={};room.hands={};room.knightCards=null;
  room.actions=[];room.inspectTargetId=null;room.nextWinner=null;
  addLog(room,'system',`第 ${room.round} 回合 · ${king(room).name} 担任国王，提名王后与骑士。`);
}
function handle(peer,message){
  try{
    ensure(message&&typeof message==='object','消息异常');
    const type=message.type;
    // Keep active game sessions healthy through cloud reverse proxies.
    if(type==='heartbeat'){peer.send({type:'heartbeat'});return;}
    if(type==='create'){
      ensure(!peer.room,'你已在房间中');
      const room={code:code(),hostId:null,players:[],size:5,counts:{heart:2,spade:2,big:1,little:0},
        status:'lobby',phase:'lobby',round:0,kingIndex:0,queenId:null,knightId:null,
        nomination:null,votes:{},hands:{},choices:{},knightCards:null,deck:[],
        position:{q:0,r:0},goal:5,inspectTargetId:null,actions:[],usedConvert:false,
        nextWinner:null,winner:null,played:null,privateResults:{},log:[],logId:0};
      rooms.set(room.code,room);join(peer,room,message.name,message.phrase);room.hostId=peer.playerId;
      broadcast(room);return;
    }
    if(type==='join'){
      ensure(!peer.room,'你已在房间中');
      const room=rooms.get(String(message.code||'').trim().toUpperCase());ensure(room,'房间不存在');
      join(peer,room,message.name,message.phrase);broadcast(room);return;
    }
    if(type==='rejoin'){
      const room=rooms.get(String(message.code||'').toUpperCase());
      ensure(room,'服务器上的房间已失效，请重新创建');
      const u=room.players.find(p=>p.token===message.token);ensure(u,'身份凭证无效');
      if(u.peer&&u.peer!==peer){u.peer.room=null;u.peer.playerId=null;u.peer.send({type:'error',message:'此玩家已在另一个页面登录'});u.peer.socket.end();}
      peer.room=room;peer.playerId=u.id;u.peer=peer;u.connected=true;
      peer.send({type:'joined',code:room.code,token:u.token});
      broadcast(room);return;
    }
    const {room,user}=requireRoom(peer);
    if(type==='leave'){
      ensure(room.status==='lobby','进行中不能离席；刷新页面可重连');
      room.players=room.players.filter(p=>p.id!==user.id);
      if(room.hostId===user.id)room.hostId=room.players[0]?.id||null;
      peer.room=null;peer.playerId=null;peer.send({type:'left'});
      if(!room.players.length){rooms.delete(room.code);saveRooms();}else broadcast(room);return;
    }
    if(type==='config'){
      ensure(room.status==='lobby'&&user.id===room.hostId,'仅房主在大厅可调整配置');
      const size=Number(message.size);
      const counts=Object.fromEntries(roleTypes.map(role=>[role,Number(message.counts?.[role])]));
      ensure(validCounts(size,counts),'请填写至少3人，且红桃、黑桃、大王各至少1张；身份牌总数必须等于人数');
      ensure(room.players.length<=size,'当前在房人数已超过目标人数');
      room.size=size;room.counts=counts;
      broadcast(room);return;
    }
    if(type==='identity'){
      const name=String(message.name||'').trim().slice(0,14);
      const phrase=String(message.phrase||'').trim().slice(0,36);
      ensure(name.length>=1,'请填写昵称');
      user.name=name;user.phrase=phrase;broadcast(room);return;
    }
    if(type==='start'){
      ensure(user.id===room.hostId&&room.status==='lobby','只有房主能开局');
      ensure(room.players.length===room.size,`需要恰好 ${room.size} 人才能开始`);
      ensure(validCounts(room.size,room.counts),'人数和身份数量不匹配');
      setup(room);broadcast(room);return;
    }
    if(type==='restart'){
      ensure(user.id===room.hostId&&room.status==='over','只有房主可开启新局');
      room.status='lobby';room.phase='lobby';room.winner=null;room.round=0;room.privateResults={};
      for(const p of room.players){p.role=null;p.usedNo=false;}
      addLog(room,'system','房主开启了新的准备大厅。');broadcast(room);return;
    }
    if(type==='chat'){
      const body=String(message.text||'').trim().slice(0,240);
      ensure(body.length>0,'内容为空');
      addLog(room,'chat',body,{senderId:user.id,sender:user.name});broadcast(room);return;
    }
    if(type==='gift'){
      const target=room.players.find(p=>p.id===message.targetId);
      ensure(target&&['flower','egg'].includes(message.gift),'互动对象或礼物无效');
      const flower=message.gift==='flower';
      addLog(room,'gift',`${user.name} 给 ${target.name} ${flower?'送了一束鲜花 💐':'扔了一颗鸡蛋 🥚'}`,
        {senderId:user.id,targetId:target.id,gift:message.gift});broadcast(room);return;
    }
    ensure(room.status==='playing','游戏未开始');
    if(type==='nominate'){
      ensure(room.phase==='nominate'&&king(room).id===user.id,'当前不能提名');
      const queen=room.players.find(p=>p.id===message.queenId);
      const knight=room.players.find(p=>p.id===message.knightId);
      ensure(queen&&knight&&queen.id!==knight.id&&queen.id!==user.id&&knight.id!==user.id,'国王、王后、骑士必须三人不同');
      room.queenId=queen.id;room.knightId=knight.id;room.nomination={queenId:queen.id,knightId:knight.id};
      room.phase='vote';room.votes={};
      addLog(room,'system',`国王提名：王后 ${queen.name}，骑士 ${knight.name}。全员开始匿名表决。`);
      broadcast(room);return;
    }
    if(type==='vote'){
      ensure(room.phase==='vote'&&!room.votes[user.id],'当前无法重复投票');
      ensure(message.choice==='yes'||message.choice==='no','投票无效');
      ensure(message.choice!=='no'||!user.usedNo,'你的唯一否决权已使用');
      room.votes[user.id]=message.choice;
      if(message.choice==='no')user.usedNo=true;
      if(Object.keys(room.votes).length===room.players.length){
        const no=Object.values(room.votes).filter(v=>v==='no').length;
        const threshold=Math.ceil(room.players.length/2);
        addLog(room,'system',`投票完毕：${room.players.length-no} 票通过 / ${no} 票否决，否决门槛 ${threshold} 票。`);
        if(no>=threshold){
          addLog(room,'system','提案被否决；按顺序更换国王，重新提名（不会补充否决权）。');
          nextKing(room);startRound(room);
        }else{
          room.phase='cardPick';
          room.hands[king(room).id]=[draw(room),draw(room)];
          room.hands[room.queenId]=[draw(room),draw(room)];
          addLog(room,'system','提案通过。国王和王后分别抽到两张私密方向牌，请各选一张交给骑士。');
        }
      }
      broadcast(room);return;
    }
    if(type==='chooseCard'){
      ensure(room.phase==='cardPick','当前不是私密选牌阶段');
      ensure(user.id===king(room).id||user.id===room.queenId,'只有国王或王后能选牌');
      ensure(!room.choices[user.id],'你已完成选牌');
      const index=Number(message.index);ensure(index===0||index===1,'请选择一张牌');
      room.choices[user.id]={index,card:room.hands[user.id][index]};
      if(room.choices[king(room).id]&&room.choices[room.queenId]){
        room.knightCards=[room.choices[king(room).id].card,room.choices[room.queenId].card];
        room.phase='knightPick';addLog(room,'system','骑士已收到两张密牌，请二选一。弃牌不会公开。');
      }
      broadcast(room);return;
    }
    if(type==='knightCard'){
      ensure(room.phase==='knightPick'&&user.id===room.knightId,'只有骑士可以出牌');
      const index=Number(message.index);ensure(index===0||index===1,'请选择一张出牌');
      const card=room.knightCards[index];
      const [dq,dr]=dirs[card];room.position={q:room.position.q+dq,r:room.position.r+dr};
      room.played={id:crypto.randomUUID(),card,by:user.name,round:room.round};
      addLog(room,'move',`🃏 骑士 ${user.name} 公开打出【${labels[card]}方向】；棋子移动一格。`,{card,played:room.played.id});
      room.nextWinner=winner(room);
      room.actions=[];
      if(card==='joker'&&!room.usedConvert&&room.players.some(p=>p.role==='big')&&room.players.some(p=>p.role==='heart'||p.role==='spade')){
        room.actions.push('convert');
      }
      if(validLens(room)&&!room.nextWinner){room.actions.push('inspect');}
      room.knightCards=null;room.hands={};room.choices={};
      advance(room);broadcast(room);return;
    }
    if(type==='convert'){
      ensure(room.phase==='convert'&&user.role==='big','只有大王可以进行秘密篡改');
      const target=room.players.find(p=>p.id===message.targetId);
      ensure(target&&(target.role==='heart'||target.role==='spade'),'只能选择尚未成为Joker的其他玩家');
      target.role='little';room.usedConvert=true;
      notify(room,target.id,'🃏 身份已被大王秘密修改！现在你是【小王】，改为Joker阵营。');
      notify(room,user.id,`已把 ${target.name} 改为小王，Joker阵营新增一位队友。`);
      addLog(room,'system','神秘的Joker能力已经发动。一位玩家的阵营可能发生了变化。');
      advance(room);broadcast(room);return;
    }
    if(type==='inspectSelect'){
      ensure(room.phase==='inspectSelect'&&king(room).id===user.id,'只有国王可以发起查验');
      const target=room.players.find(p=>p.id===message.targetId);
      ensure(target&&target.id!==user.id,'需要选择其他玩家进行查验');
      room.inspectTargetId=target.id;room.phase='inspectReply';
      notify(room,target.id,`🔎 国王 ${user.name} 正在查验你：选择一个【不是XX阵营】的结果私密回复（允许撒谎）。`);
      addLog(room,'system','放大镜触发！国王正在进行一次私人查验。');
      broadcast(room);return;
    }
    if(type==='inspectReply'){
      ensure(room.phase==='inspectReply'&&room.inspectTargetId===user.id,'你不是被查验者');
      ensure(suits.includes(message.excluded),'必须排除红桃、黑桃、Joker中的一个阵营');
      const k=king(room);
      room.privateResults[k.id]={targetId:user.id,excluded:message.excluded,round:room.round};
      notify(room,k.id,`🔎 ${user.name} 私聊回复：我【不是${labels[message.excluded]}】。（玩家可撒谎，结果未经过系统验证）`);
      addLog(room,'system','查验结束，结果已私密发送给国王。');
      room.inspectTargetId=null;advance(room);broadcast(room);return;
    }
    if(type==='next'){
      ensure(room.phase==='discuss'&&king(room).id===user.id,'仅本回合国王可结束讨论并继续');
      nextKing(room);startRound(room);broadcast(room);return;
    }
    throw Error('未知操作');
  }catch(err){peer.send({type:'error',message:err.message||'操作失败'});}
}
function join(peer,room,name,phrase){
  ensure(room.status==='lobby','对局已开始，仅原玩家可重连');
  ensure(room.players.length<room.size,'房间人数已满');
  name=String(name||'').trim().slice(0,14);phrase=String(phrase||'').trim().slice(0,36);
  ensure(name.length>=1,'请填写昵称');
  const p={id:id(),token:crypto.randomBytes(24).toString('hex'),name,phrase,role:null,usedNo:false,connected:true,peer};
  room.players.push(p);peer.room=room;peer.playerId=p.id;
  peer.send({type:'joined',code:room.code,token:p.token});
  addLog(room,'system',`${name} 加入房间（${room.players.length}/${room.size}）`);
}
function setup(room){
  room.status='playing';room.position={q:0,r:0};room.goal=5;room.deck=newDeck();
  room.kingIndex=crypto.randomInt(room.players.length);room.usedConvert=room.counts.little>0;
  room.privateResults={};room.winner=null;room.played=null;room.round=0;
  const assigned=roles(room);room.players.forEach((p,i)=>{p.role=assigned[i];p.usedNo=false;});
  addLog(room,'system','🎭 身份已由系统独立加密连接分发。请在【我的身份】中查看，不要透露底牌。');
  if(room.counts.little>0)addLog(room,'system','本局已设置初始小王，Joker篡改能力默认关闭，避免额外扩张。');
  startRound(room);
}
if(require.main===module){
  server.listen(PORT,'0.0.0.0',()=>console.log(`扑克迷局 · online service listening at 0.0.0.0:${PORT}`));
  // Cloud reverse proxies may close idle WebSockets. Browser WebSockets answer ping automatically.
  setInterval(()=>{for(const peer of livePeers){
    if(!peer.closed&&!peer.socket.destroyed)try{peer.control(9);}catch{peer.socket.destroy();}
  }},25000).unref();
  process.on('SIGTERM',()=>{saveRooms();server.close(()=>process.exit(0));setTimeout(()=>process.exit(0),8000).unref();});
  process.on('SIGINT',()=>{saveRooms();server.close(()=>process.exit(0));setTimeout(()=>process.exit(0),8000).unref();});
}

module.exports={server,rooms,validCounts,roles};
