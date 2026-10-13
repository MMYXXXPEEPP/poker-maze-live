(() => {
  'use strict';
  const $ = s => document.querySelector(s);
  const rolePortrait=role=>`/avatars/${['heart','spade','big','little'].includes(role)?role:'civilian'}.webp`;
  const portrait=(role,cl='')=>`<img class="${cl}" src="${rolePortrait(role)}" alt="扑克牌人物">`;
  const presetRoles={five:{size:5,counts:{heart:2,spade:2,big:1,little:0}},six:{size:6,counts:{heart:3,spade:2,big:1,little:0}},advanced:{size:6,counts:{heart:2,spade:2,big:1,little:1}}};
  const roleNames={heart:'♥ 红桃好人',spade:'♠ 黑桃卧底',big:'★ 大王 Joker',little:'☆ 小王 Joker'};
  const suitNames={heart:'红桃',spade:'黑桃',joker:'Joker'};
  const suits={heart:{icon:'♥',label:'红桃',color:'#ff718a'},spade:{icon:'♠',label:'黑桃',color:'#80a3ff'},joker:{icon:'★',label:'JOKER',color:'#ffd586'}};
  const phaseNames={lobby:'等待玩家',nominate:'提名阶段',vote:'匿名投票',cardPick:'密牌选择',knightPick:'骑士出牌',convert:'秘密篡改',inspectSelect:'放大镜查验',inspectReply:'查验回复',discuss:'公屏讨论',over:'游戏结束'};
  const apiKey='poker_maze_session_v1';
  const invitedCode=(new URLSearchParams(location.search).get('room')||'').trim().toUpperCase();
  const hasInvite=/^[A-Z0-9]{6}$/.test(invitedCode);
  let joinedThisConnection=false;
  function activeInvite(){return hasInvite ? invitedCode : $('#roomInput').value.trim().toUpperCase();}
  function showInviteLanding(){
    if(!hasInvite) return;
    document.body.classList.add('invite-mode');
    $('#inviteBanner').classList.remove('hidden');
    $('#inviteCode').textContent=invitedCode;
    $('#roomInput').value=invitedCode;
    $('#joinBtn').textContent='加入 '+invitedCode+' 房间 →';
    $('#nickname').setAttribute('autocomplete','nickname');
    $('#nickname').setAttribute('enterkeyhint','go');
  }
  function autoJoinSavedNickname(){
    if(!hasInvite||joinedThisConnection||state||!connected)return;
    const name=(localStorage.getItem('mazeNickname')||'').trim();
    if(!name)return;
    joinedThisConnection=true;
    send('join',{name,phrase:'',code:invitedCode});
  }
  function updateRoomUrl(code){
    const u=new URL(location.href);
    u.searchParams.set('room',code);
    history.replaceState(null,'',u.pathname+u.search+u.hash);
  }
  function roomLink(){
    const u=new URL(location.href);
    u.searchParams.set('room',state.code);
    u.hash='';return u.href;
  }
  let ws, state=null, connected=false, lastMove=null, lastGift=0, scrollLogId=0, previousPos=null, toastTimer;
  let boardReady=false;
  let pendingCardSend=false;
  const escapeHTML=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function toast(message){const el=$('#toast');el.textContent=message;el.classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('visible'),3500);}
  function send(type,values={}){if(!connected){toast('尚未连接服务器');return;}ws.send(JSON.stringify({type,...values}));}
  function connect(){
    const proto=location.protocol==='https:'?'wss':'ws';
    ws=new WebSocket(`${proto}://${location.host}/ws`);
    ws.addEventListener('open',()=>{
      connected=true;$('#connection').classList.remove('off');$('#connection').textContent='● 实时在线';
      joinedThisConnection=false;
      const saved=sessionStorage.getItem(apiKey);
      if(saved){
        try{
          const s=JSON.parse(saved);
          if(!hasInvite||s.code===invitedCode){
            joinedThisConnection=true;send('rejoin',{code:s.code,token:s.token});
          }else{
            // 另一个邀请链接不能强行带回旧房间。
            sessionStorage.removeItem(apiKey);autoJoinSavedNickname();
          }
        }catch{sessionStorage.removeItem(apiKey);autoJoinSavedNickname();}
      }else autoJoinSavedNickname();
    });
    ws.addEventListener('message',e=>{
      let m;try{m=JSON.parse(e.data);}catch{return;}
      if(m.type==='joined'){
        sessionStorage.setItem(apiKey,JSON.stringify({code:m.code,token:m.token}));
        updateRoomUrl(m.code);
        return;
      }
      if(m.type==='left'){
        state=null;sessionStorage.removeItem(apiKey);boardReady=false;
        $('#game').classList.add('hidden');$('#landing').classList.remove('hidden');
        const u=new URL(location.href);u.searchParams.delete('room');history.replaceState(null,'',u.pathname+u.search+u.hash);
        document.body.classList.remove('invite-mode');$('#inviteBanner').classList.add('hidden');
        $('#roomInput').value='';$('#joinBtn').textContent='加入房间 →';
        return;
      }
      if(m.type==='error'){
        toast(m.message);
        joinedThisConnection=false;
        $('#joinBtn').disabled=false;
        if(m.message.includes('房间已失效')||m.message.includes('凭证无效')){sessionStorage.removeItem(apiKey);state=null;$('#game').classList.add('hidden');$('#landing').classList.remove('hidden');}
        return;
      }
      if(m.type==='private'){toast(m.message);return;}
      if(m.type==='heartbeat')return;
      if(m.type==='state'){state=m;render(m);}
    });
    ws.addEventListener('close',()=>{
      connected=false;joinedThisConnection=false;$('#connection').textContent='● 离线重连中';$('#connection').classList.add('off');
      setTimeout(connect,2200);
    });
    ws.addEventListener('error',()=>{});
  }
  function render(s){
    $('#landing').classList.add('hidden');$('#game').classList.remove('hidden');
    $('#roomCode').textContent=s.code;
    $('#phaseBadge').textContent=phaseNames[s.phase]||s.phase;
    $('#playerCount').textContent=`${s.players.length} / ${s.size}`;
    $('#roundStatus').textContent=s.status==='lobby'?`待开局 · ${s.size}人${s.counts.little?'含小王':''}模式`:
       s.status==='over'?'最终对局 · 阵营结算完毕':`第 ${s.round} 回合 · ${s.size}人${s.counts.little?'含小王':''}模式`;
    $('#turnNumber').textContent=`ROUND ${String(s.round).padStart(2,'0')}`;
    $('#leaveBtn').style.display=s.status==='lobby'?'':'none';
    renderRoster(s);renderIdentity(s);renderLobby(s);renderActions(s);renderBoard(s);renderChat(s);
  }
  function player(s,id){return s.players.find(p=>p.id===id);}
  function pname(s,id){return player(s,id)?.name||'未知玩家';}
  function roleColor(role){return role==='heart'?'#ff718a':role==='spade'?'#80a3ff':'#ffd586';}
  function renderRoster(s){
    $('#roster').innerHTML=s.players.map((p,i)=>{
      const badges=[];
      if(s.kingId===p.id)badges.push('<span class="pbadge king">♛ 国王</span>');
      if(s.queenId===p.id)badges.push('<span class="pbadge queen">♕ 王后</span>');
      if(s.knightId===p.id)badges.push('<span class="pbadge knight">⚔ 骑士</span>');
      const known=s.status==='over'?p.revealedRole:(p.id===s.you.id?s.you.role:(s.you.blackMates.includes(p.id)?'spade':s.you.jokerMates.includes(p.id)?'jokerAlly':null));
      const roleTag=known?`<span class="player-meta" style="color:${roleColor(known)}">${escapeHTML(known==='jokerAlly'?'★ Joker队友':roleNames[known]||known)}</span>`:'';
      return `<div class="player ${p.id===s.you.id?'me':''} ${p.connected?'':'offline'}">
         <div class="avatar ${s.kingId===p.id?'avatar-king':''}">${portrait('civilian')}${s.kingId===p.id?'<span class="king-crown">♛</span>':''}</div><div class="player-main"><span class="player-name">${escapeHTML(p.name)} ${p.id===s.you.id?'(我)':''}</span>
         <span class="player-meta">${p.connected?'● 在线':'○ 离线'} · ${p.usedNo?'否决已用':'否决可用'}</span>${roleTag}</div>
         <div class="player-badges">${badges.join('')}</div></div>`;
    }).join('');
  }
  function renderIdentity(s){
    const own=s.you.role;let desc='尚未分配身份。开局后仅你本人和被允许知晓的队友可看到相关信息。';
    if(own==='heart')desc='目标：让共享棋子抵达红桃终点。你不知道谁是队友，谨慎观察投票和方向牌。';
    if(own==='spade')desc=`目标：让共享棋子抵达黑桃终点。黑桃队友：${s.you.blackMates.filter(id=>id!==s.you.id).map(id=>escapeHTML(pname(s,id))).join('、')||'无'}。`;
    if(own==='big')desc=`目标：让棋子抵达Joker终点。${s.usedConvert?'本局已有小王或篡改已使用。':'打出Joker牌时，大王可抢先秘密转化一名平民或卧底。'}`;
    if(own==='little')desc=`你的归属：Joker阵营。目标为Joker终点；Joker盟友：${s.you.jokerMates.filter(id=>id!==s.you.id).map(id=>escapeHTML(pname(s,id))).join('、')||'未公开'}。`;
    const title=s.status==='over'?'对局已结束：你的身份':own?'仅自己可见 · 我的底牌':'我的身份 · 尚未发牌';
    $('#identityCard').innerHTML=`<div class="identity-label">${title} <button type="button" class="tinybtn" data-action="editIdentity" style="float:right;padding:3px 7px">✎</button></div>
      <div class="identity-portrait-row"><div class="identity-face">${portrait(own||'civilian')}</div><div><div class="identity-value ${own||''}">${own?roleNames[own]:'🔒 等待发牌'}</div>
      <div class="identity-desc">${desc}</div></div></div>`;
  }
  function countSummary(counts){
    return `♥ 红桃 ${counts.heart} · ♠ 黑桃 ${counts.spade} · ★ 大王 ${counts.big} · ☆ 小王 ${counts.little}`;
  }
  function renderLobby(s){
    if(s.status!=='lobby'){$('#lobbySettings').innerHTML='';return;}
    const host=s.hostId===s.you.id;
    $('#lobbySettings').innerHTML=`<div class="settings-title">${host?'⚙ 房主 · 自定义玩家人数与身份牌':'等待房主配置人数与身份牌'}</div>
      ${host?`<div class="preset-row"><button class="tinybtn" data-action="presetFive">5人推荐</button><button class="tinybtn" data-action="presetSix">6人推荐</button><button class="tinybtn" data-action="presetAdvanced">6人进阶</button></div>
      <div class="custom-settings"><label class="setting-label">本局人数（不限上限）<input id="sizeInput" type="number" min="3" step="1" value="${s.size}"></label>
      <div class="setting-grid"><label>♥ 红桃平民<input class="role-number" id="countHeart" type="number" min="1" step="1" value="${s.counts.heart}"></label>
      <label>♠ 黑桃卧底<input class="role-number" id="countSpade" type="number" min="1" step="1" value="${s.counts.spade}"></label>
      <label>★ 大王 Joker<input class="role-number" id="countBig" type="number" min="1" step="1" value="${s.counts.big}"></label>
      <label>☆ 小王 Joker<input class="role-number" id="countLittle" type="number" min="0" step="1" value="${s.counts.little}"></label></div>
      <div id="configValidation" class="count-validation">身份牌合计 ${s.size} / ${s.size}</div>
      <button class="tinybtn" data-action="recommend">↻ 根据人数智能分配</button>
      <button class="secondary host-action" data-action="applySettings">保存房间配置</button></div>`:''}
      <div class="neutral-box" style="margin-top:11px">当前入座 ${s.players.length} / ${s.size}<br>${countSummary(s.counts)}<br>人数与身份牌数可由房主在开局前自由配置</div>
      ${host?`<button class="primary host-action" data-action="start" ${s.players.length===s.size?'':'disabled'}>🎭 ${s.players.length===s.size?'开始游戏':'等待玩家到齐'}</button>`:''}`;
    if(host)updateValidation();
  }
  function readConfig(){
    return {size:Number($('#sizeInput')?.value),counts:{heart:Number($('#countHeart')?.value),spade:Number($('#countSpade')?.value),big:Number($('#countBig')?.value),little:Number($('#countLittle')?.value)}};
  }
  function updateValidation(){
    if(!$('#configValidation'))return;
    const {size,counts}=readConfig();const total=Object.values(counts).reduce((a,b)=>a+b,0);
    const valid=Number.isSafeInteger(size)&&size>=3&&Object.entries(counts).every(([role,n])=>Number.isSafeInteger(n)&&n>=(role==='little'?0:1))&&total===size;
    $('#configValidation').textContent=valid?`✓ 配置正确：${total}/${size} 张身份牌`:`⚠ 当前 ${total} 张 / ${size} 人，红桃、黑桃、大王各至少1张`;$('#configValidation').classList.toggle('invalid',!valid);
    return valid;
  }
  function applyPreset(template){
    const {size,counts}=template;$('#sizeInput').value=size;
    $('#countHeart').value=counts.heart;$('#countSpade').value=counts.spade;
    $('#countBig').value=counts.big;$('#countLittle').value=counts.little;updateValidation();
  }
  function suggestCounts(){
    const n=Number($('#sizeInput')?.value);if(!Number.isSafeInteger(n)||n<3){toast('至少3名玩家');return;}
    const spade=Math.max(1,Math.floor((n-1)*0.4));
    applyPreset({size:n,counts:{heart:n-1-spade,spade,big:1,little:0}});
  }
  function panel(emoji,title,description){return `<div class="action-hero"><div class="action-emoji">${emoji}</div><div class="action-heading">${title}</div><div class="action-tip">${description}</div></div>`;}
  function wait(title,description){return panel('⌛',title,description)+'<div class="neutral-box">正在等待其他玩家完成操作<br>你可以在下方公屏讨论或者互动。</div>';}
  function opt(s,exclude){return s.players.filter(p=>!exclude.includes(p.id)).map(p=>`<option value="${p.id}">${escapeHTML(p.name)}</option>`).join('');}
  function cards(data,kind){return `<div class="card-scene"><div class="deck-stack" aria-hidden="true"><span></span><span></span><span></span></div><div class="card-choices">${data.map((card,i)=>{
    const a=suits[card];return `<button class="direction-card ${card}" data-card="${card}" data-action="${kind}" data-index="${i}" style="animation-delay:${i*130}ms"><span class="card-flip"><span class="card-face card-back">✦</span><span class="card-face card-front"><small>${kind==='knightCard'?(i?'王后交牌':'国王交牌'):'秘密方向牌'}</small><div class="card-sign">${a.icon}</div><div class="card-label">${a.label}</div></span></span></button>`;
  }).join('')}</div></div>`;}
  function renderActions(s){
    const me=s.you.id,own=s.you.role,king=s.kingId===me,queen=s.queenId===me,knight=s.knightId===me;
    let html='';
    if(s.status==='lobby')html=panel('🃏','开局准备中','人数到齐后房主开始，系统自动发放隐藏身份。所有玩家必须在各自浏览器进入同一房间。')+`<div class="neutral-box">你的位置：第 ${s.players.findIndex(p=>p.id===me)+1} 席<br>等待队友加入……</div>`;
    else if(s.status==='over'){
      const won=s.pendingWinner;
      const winners=s.players.filter(p=>p.revealedRole===won||(won==='joker'&&['big','little'].includes(p.revealedRole)));
      const names=winners.map(p=>escapeHTML(p.name)).join('、');
      html=panel('🏆',`${suitNames[won]}阵营获胜！`,`获胜阵营成员：${names||'无'}`)+`<div class="neutral-box">所有玩家的最终身份已公开。<br> ${s.you.id===s.hostId?'房主可开始下一局。':'等待房主开始下一局。'}</div>`+(me===s.hostId?'<button class="primary host-action" data-action="restart">↻ 返回大厅 · 再来一局</button>':'');
    }else if(s.phase==='nominate'){
      html=king?panel('👑','国王，请组建队伍','选择一位王后和一位骑士。三人必须不同。提名后全员匿名表决。')+
       `<div class="action-block"><label>王后<select id="queenPick">${opt(s,[me])}</select></label><label>骑士<select id="knightPick">${opt(s,[me])}</select></label><button class="primary" data-action="nominate">发布提名 · 开始投票</button></div>`:
       wait('等待国王提名',`本回合国王：${escapeHTML(pname(s,s.kingId))}。王后与骑士将在提名后公布。`);
    }else if(s.phase==='vote'){
      html=panel('🗳️','全员匿名投票',`国王：${escapeHTML(pname(s,s.kingId))}，王后：${escapeHTML(pname(s,s.queenId))}，骑士：${escapeHTML(pname(s,s.knightId))}。全员投完才公布总票数。`);
      html+=`<div class="turn-fact">当前已投 ${s.voterIds.length} / ${s.players.length} 票 · ${s.you.vote?'你已投票':'你的票尚未提交'}</div>`;
      html+=s.you.vote?'<div class="neutral-box">你的投票已提交，等待其他人……</div>':
       `<div class="vote-actions"><button data-action="voteYes" class="approve">✓ 通过</button><button data-action="voteNo" class="reject" ${player(s,me).usedNo?'disabled':''}>✕ 否决</button></div><div class="selection-help">每人整局仅一次否决权；达到 ${s.denyThreshold} 张否决票（半数向上取整）即否决成功。</div>`;
    }else if(s.phase==='cardPick'){
      const official=king||queen;
      if(!official)html=wait('密牌抽取中','国王与王后各自私密抽到2张牌，选择1张交给骑士。');
      else if(s.you.chosen)html=wait('已将牌交给骑士','你的交牌只有你本人和骑士知道，另一名选牌者无法查看。');
      else html=panel(king?'👑':'♕',king?'国王私密选牌':'王后私密选牌','你获得两张随机方向牌。点击其中一张秘密交给骑士；另外一张直接作废。')+cards(s.you.hand||[],'chooseCard');
    }else if(s.phase==='knightPick'){
      html=knight?panel('⚔️','骑士，请决定方向','以下两张分别由国王和王后交给你。选择一张在公屏公开打出，另一张保密弃掉。')+cards(s.you.knightCards||[],'knightCard'):
       wait('骑士正在决策',`${escapeHTML(pname(s,s.knightId))} 已收到两张方向牌。骑士只会公布打出的那一张。`);
    }else if(s.phase==='convert'){
      html=own==='big'?panel('🃏','大王 · 秘密篡改','Joker牌已打出！请选择一位当前红桃/黑桃玩家，将其秘密改成小王，加入Joker阵营。此能力整局只可用一次。')+
       `<div class="action-block"><label>篡改目标<select id="targetConvert">${opt(s,[me,...s.you.jokerMates])}</select></label><button class="primary" data-action="convert">确认篡改身份</button></div>`:
       wait('Joker之力正在发动','可能有一位玩家的身份将悄悄改变。只有大王与被选者知情。');
    }else if(s.phase==='inspectSelect'){
      html=king?panel('🔎','放大镜查验','你踩到放大镜格。指定一名其他玩家，被查验者私密回复“我不是某阵营”。注意：对方可以撒谎。')+
       `<div class="action-block"><label>查验目标<select id="inspectTarget">${opt(s,[me])}</select></label><button class="primary" data-action="inspectSelect">秘密发起查验</button></div>`:
       wait('放大镜已触发','国王正在选择一个查验对象。');
    }else if(s.phase==='inspectReply'){
      html=s.inspectTargetId===me?panel('🕵️','国王正在查验你','你只能排除一个阵营，但可以说真话或假话。结果仅发送给国王。')+
       `<div class="action-block"><label>秘密回复<select id="excluded"><option value="heart">我不是红桃</option><option value="spade">我不是黑桃</option><option value="joker">我不是Joker</option></select></label><button class="primary" data-action="inspectReply">私密发送回复</button></div>`:
       wait('查验正在进行','被查验者正在私密回复，公屏不会显示查验内容。');
    }else if(s.phase==='discuss'){
      html=panel('💬','自由讨论时间','这一回合已结算。根据投票、移动与言行讨论身份；下一任国王将按座位顺序产生。')+
       (king?'<button class="primary host-action" data-action="next">▶ 结束讨论 · 开启下一轮</button>':`<div class="neutral-box">等待本轮国王 ${escapeHTML(pname(s,s.kingId))} 开启下一轮。</div>`);
    }
    if(s.you.privateResult)html+=`<div class="turn-fact" style="margin-top:16px">🔎 私密查验：${escapeHTML(pname(s,s.you.privateResult.targetId))} 说“我不是${suitNames[s.you.privateResult.excluded]}”。（可能撒谎）</div>`;
    $('#phaseAction').innerHTML=html;
  }
  // 三方向六角格：♥(+1,0)，♠(-1,+1)，Joker(0,-1)
  const SZ=34,CX=380,CY=320,RADIUS=7;
  const pos=({q,r})=>({x:CX+SZ*(q+r/2),y:CY+SZ*Math.sqrt(3)/2*r});
  const lens=new Set(['2,0','-2,2','0,-2','1,1','-1,1','1,-2','-2,1','0,2']);
  const dirs={heart:[1,0],spade:[-1,1],joker:[0,-1]};
  function progress({q,r}){return {heart:q+r/2,spade:(-q+r)/2,joker:-q/2-r};}
  function setupBoard(s){
    const bg=[];
    for(let q=-RADIUS;q<=RADIUS;q++)for(let r=-RADIUS;r<=RADIUS;r++){
      if(Math.max(Math.abs(q),Math.abs(r),Math.abs(q+r))>RADIUS)continue;
      const p=pos({q,r}),onRoute=q===0&&r<=0||r===0&&q>=0||q===-r&&r>=0;
      const isLens=lens.has(`${q},${r}`);
      const route=q===0&&r<0?'joker':r===0&&q>0?'heart':q===-r&&r>0?'spade':null;
      const fill=isLens?'#695935':onRoute?route==='heart'?'#502d49':route==='spade'?'#293d64':'#4a3d56':'#222840';
      bg.push(`<circle cx="${p.x}" cy="${p.y}" r="15.5" fill="${fill}" stroke="${isLens?'#e6b868':'#4b5075'}" stroke-opacity="${isLens?'.9':'.4'}" stroke-width="${isLens?'1.6':'.8'}"/>`);
      if(isLens)bg.push(`<text x="${p.x}" y="${p.y+4}" text-anchor="middle" font-size="15">⌕</text>`);
    }
    // 3个方向视觉指引 + 终点位置
    const tracks=[];
    for(const k of Object.keys(dirs)){
      const [dq,dr]=dirs[k],p0=pos({q:0,r:0}),p1=pos({q:dq*5,r:dr*5});
      tracks.push(`<line x1="${p0.x}" y1="${p0.y}" x2="${p1.x}" y2="${p1.y}" stroke="${suits[k].color}" stroke-width="4" stroke-dasharray="5 15" stroke-opacity=".6"/>`);
      tracks.push(`<circle cx="${p1.x}" cy="${p1.y}" r="26" fill="${suits[k].color}" fill-opacity=".12" stroke="${suits[k].color}" stroke-width="3"/>`);
      tracks.push(`<text x="${p1.x}" y="${p1.y+7}" font-size="23" text-anchor="middle" fill="${suits[k].color}" font-weight="900">${suits[k].icon}</text>`);
      let textX=p1.x,textY=p1.y+45;
      if(k==='heart'){textX=p1.x+1;textY=p1.y-38;}
      if(k==='spade'){textY=p1.y+48;}
      if(k==='joker'){textY=p1.y-39;}
      tracks.push(`<text x="${textX}" y="${textY}" font-size="13" fill="${suits[k].color}" font-weight="900" text-anchor="middle">${suits[k].label}终点</text>`);
    }
    const start=pos({q:0,r:0});
    $('#board').innerHTML=`<defs><filter id="glow"><feGaussianBlur stdDeviation="7"/></filter><radialGradient id="startGrad"><stop stop-color="#ece8ff"/><stop offset="1" stop-color="#8f7efa"/></radialGradient></defs>
      <circle cx="${CX}" cy="${CY}" r="245" fill="none" stroke="#4b4168" stroke-opacity=".16" stroke-width="2"/>
      ${bg.join('')}${tracks.join('')}<circle cx="${start.x}" cy="${start.y}" r="22" fill="#c3b1ff" fill-opacity=".35" stroke="#b6aaff"/>
      <g id="pawnGroup"><circle id="pawnGlow" cx="${start.x}" cy="${start.y}" r="28" fill="#a78bfa" opacity=".47" filter="url(#glow)"/>
      <circle id="pawnCirc" cx="${start.x}" cy="${start.y}" r="18" fill="url(#startGrad)" stroke="#fff" stroke-width="3"/>
      <text id="pawnText" x="${start.x}" y="${start.y+7}" font-size="23" fill="#241a57" text-anchor="middle">♟</text></g>`;
    previousPos={q:0,r:0};boardReady=true;
  }
  function showMoveBadge(card){
    const layer=$('#effectLayer'); if(!layer)return;
    const badge=document.createElement('div');
    badge.className=`move-badge ${card}`;
    badge.innerHTML=`<div class="move-badge-sign">${suits[card].icon}</div><div class="move-badge-label">${suits[card].label}方向</div>`;
    layer.append(badge);
    setTimeout(()=>badge.remove(),1000);
  }
  function boardPulse(point,card){
    const board=$('#board'); if(!board)return;
    const ns='http://www.w3.org/2000/svg';
    const ring=document.createElementNS(ns,'circle');
    ring.setAttribute('cx',point.x); ring.setAttribute('cy',point.y); ring.setAttribute('r',18);
    ring.setAttribute('fill','none'); ring.setAttribute('stroke',suits[card].color); ring.setAttribute('stroke-width','4');
    ring.setAttribute('class','board-pulse');
    board.append(ring);
    setTimeout(()=>ring.remove(),720);
  }
  function boardTrail(from,to,card){
    const board=$('#board'); if(!board)return;
    const ns='http://www.w3.org/2000/svg';
    const line=document.createElementNS(ns,'line');
    line.setAttribute('x1',from.x); line.setAttribute('y1',from.y); line.setAttribute('x2',to.x); line.setAttribute('y2',to.y);
    line.setAttribute('stroke',suits[card].color); line.setAttribute('stroke-width','8');
    line.setAttribute('stroke-linecap','round'); line.setAttribute('class','board-trail');
    board.append(line);
    setTimeout(()=>line.remove(),560);
  }
  function animatePawn(next,card){
    const from=pos(previousPos||{q:0,r:0}),to=pos(next);
    if(previousPos&&previousPos.q===next.q&&previousPos.r===next.r)return;
    if(card){showMoveBadge(card);boardTrail(from,to,card);}
    const dur=760,start=performance.now();
    function tick(now){
      const t=Math.min((now-start)/dur,1),ease=t<.5?4*t*t*t:1-Math.pow(-2*t+2,3)/2;
      const lift=Math.sin(Math.PI*t)*16;
      const x=from.x+(to.x-from.x)*ease,y=from.y+(to.y-from.y)*ease-lift;
      const pulse=1+Math.sin(Math.PI*t)*0.12;
      const circ=$('#pawnCirc'),glow=$('#pawnGlow'),text=$('#pawnText');
      if(glow){glow.setAttribute('cx',x);glow.setAttribute('cy',y);glow.setAttribute('r',28*pulse);glow.setAttribute('opacity',0.42+Math.sin(Math.PI*t)*0.18);}
      if(circ){circ.setAttribute('cx',x);circ.setAttribute('cy',y);circ.setAttribute('r',18*pulse);}
      if(text){text.setAttribute('x',x);text.setAttribute('y',y+7);text.setAttribute('font-size',23+Math.sin(Math.PI*t)*3.5);}
      if(t<1)requestAnimationFrame(tick);
      else if(card) boardPulse(to,card);
    }
    requestAnimationFrame(tick);previousPos={...next};
  }
  function renderBoard(s){
    if(!boardReady)setupBoard(s);
    const isNewPlay=s.played?.id!==lastMove&&s.played?.id;
    animatePawn(s.position,isNewPlay?s.played.card:null);
    const p=progress(s.position);
    $('#progressRow').innerHTML=Object.keys(suits).map(k=>{
      const val=Math.min(100,Math.max(0,100*p[k]/s.goal));
      return `<div class="progress ${k} ${isNewPlay&&s.played.card===k?'progress-hot':''}"><div class="progress-top"><span>${suits[k].icon} ${suits[k].label}</span><span>${Number(p[k].toFixed(1))}/${s.goal}</span></div><div class="progress-track"><div class="progress-fill" style="width:${val}%"></div></div></div>`;
    }).join('');
    if(isNewPlay){
      lastMove=s.played.id;
      if(s.phase!=='over')toast(`骑士公开打出：${suits[s.played.card].icon} ${suitNames[s.played.card]}方向`);
    }
  }
  function renderChat(s){
    const el=$('#chatList'),atBottom=el.scrollHeight-el.scrollTop-el.clientHeight<70;
    const latest=s.log[s.log.length-1]?.id||0;
    if(latest!==scrollLogId){
      el.innerHTML=s.log.map(e=>{
        const time=new Date(e.ts).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',hour12:false});
        const sender=e.sender?`<span class="sender">${escapeHTML(e.sender)}:</span>`:'';
        return `<div class="chat-entry ${e.kind}"><span class="time">${time}</span>${sender}${escapeHTML(e.message)}</div>`;
      }).join('');
      if(atBottom||scrollLogId===0)el.scrollTop=el.scrollHeight;
      const giftEvents=s.log.filter(e=>e.kind==='gift');
      const gift=giftEvents[giftEvents.length-1];
      if(gift&&gift.id>lastGift){lastGift=gift.id;floatingGift(gift.gift);}
      scrollLogId=latest;
    }
    const sel=$('#giftTarget'),value=sel.value;
    const choices=s.players.filter(p=>p.id!==s.you.id);
    const options=choices.map(p=>`<option value="${p.id}">${escapeHTML(p.name)}</option>`).join('');
    if(sel.innerHTML!==options){sel.innerHTML=options;if(choices.some(p=>p.id===value))sel.value=value;}
  }
  function floatingGift(which){
    const layer=$('#effectLayer');const g=document.createElement('div');g.className='floating-gift';g.textContent=which==='flower'?'💐':'🥚';
    g.style.left=`${32+Math.random()*33}%`;layer.append(g);setTimeout(()=>g.remove(),1300);
  }
  function getIdentity(){const name=$('#nickname').value.trim();
    const phrase=$('#phrase').value.trim();if(!name){toast('请先输入昵称');return null;}localStorage.setItem('mazeNickname',name);return {name,phrase};}
  $('#createBtn').addEventListener('click',()=>{const u=getIdentity();if(u)send('create',u);});
  $('#joinBtn').addEventListener('click',()=>{
    const u=getIdentity();if(!u)return;
    const code=activeInvite();
    if(!/^[A-Z0-9]{6}$/.test(code)){toast('请输入有效的 6 位房间码');return;}
    joinedThisConnection=true;send('join',{...u,code});
  });
  $('#nickname').addEventListener('keydown',e=>{
    if(e.key==='Enter'&&hasInvite){e.preventDefault();$('#joinBtn').click();}
  });
  $('#backToHome').addEventListener('click',()=>{
    const u=new URL(location.href);u.searchParams.delete('room');location.assign(u.pathname+u.search+u.hash);
  });
  $('#roomInput').addEventListener('keydown',e=>{if(e.key==='Enter')$('#joinBtn').click();});
  function openShareDialog(){
    if(!state)return;
    $('#shareRoomCode').textContent=state.code;
    $('#shareLink').value=roomLink();
    const dialog=$('#shareDialog');
    if(typeof dialog.showModal==='function')dialog.showModal();
    else {const url=roomLink();window.prompt('复制邀请链接并发给朋友',url);}
  }
  async function copyText(value){
    try{
      if(navigator.clipboard?.writeText){await navigator.clipboard.writeText(value);toast('邀请链接已复制');return;}
    }catch{}
    const el=$('#shareLink');
    el.focus();el.select();el.setSelectionRange(0,el.value.length);
    try{if(document.execCommand('copy')){toast('邀请链接已复制');return;}}catch{}
    toast('请长按下方链接，选择复制');
  }
  $('#copyBtn').addEventListener('click',openShareDialog);
  $('#shareCopyBtn').addEventListener('click',()=>copyText($('#shareLink').value));
  $('#shareNativeBtn').addEventListener('click',async()=>{
    if(navigator.share){
      try{await navigator.share({title:'扑克迷局 · 游戏邀请',text:`加入我的扑克迷局房间 ${state.code}`,url:roomLink()});return;}
      catch(err){if(err.name==='AbortError')return;}
    }
    copyText(roomLink());
  });
  $('#closeShare').addEventListener('click',()=>$('#shareDialog').close());
  $('#shareDialog').addEventListener('click',e=>{if(e.target.id==='shareDialog')e.target.close();});
  $('#leaveBtn').addEventListener('click',()=>{if(confirm('离开本次准备房间？'))send('leave');});
  $('#rulesBtn').addEventListener('click',()=>$('#rulesDialog').showModal());
  $('#closeRules').addEventListener('click',()=>$('#rulesDialog').close());
  $('#rulesDialog').addEventListener('click',e=>{if(e.target.id==='rulesDialog')e.target.close();});
  $('#chatForm').addEventListener('submit',e=>{e.preventDefault();const el=$('#chatText');if(el.value.trim()){send('chat',{text:el.value});el.value='';}});
  $('#quickPhrase').addEventListener('click',()=>{if(!state)return;const phrase=player(state,state.you.id)?.phrase;if(!phrase)return toast('点“我的身份”中的 ✎，先设置互动台词');send('chat',{text:phrase});});
  $('#flowerBtn').addEventListener('click',()=>{if($('#giftTarget').value)send('gift',{gift:'flower',targetId:$('#giftTarget').value});});
  $('#eggBtn').addEventListener('click',()=>{if($('#giftTarget').value)send('gift',{gift:'egg',targetId:$('#giftTarget').value});});
  document.addEventListener('click',e=>{
    const el=e.target.closest('[data-action]');if(!el||!state)return;
    const act=el.dataset.action;
    switch(act){
      case 'applySettings':if(updateValidation())send('config',readConfig());else toast('人数与身份牌数还不匹配');break;
      case 'presetFive':applyPreset(presetRoles.five);break;
      case 'presetSix':applyPreset(presetRoles.six);break;
      case 'presetAdvanced':applyPreset(presetRoles.advanced);break;
      case 'recommend':suggestCounts();break;
      case 'start':send('start');break;
      case 'restart':send('restart');lastMove=null;boardReady=false;previousPos=null;break;
      case 'nominate':send('nominate',{queenId:$('#queenPick').value,knightId:$('#knightPick').value});break;
      case 'voteYes':send('vote',{choice:'yes'});break;
      case 'voteNo':send('vote',{choice:'no'});break;
      case 'chooseCard':
      case 'knightCard':{
        if(pendingCardSend)break;
        pendingCardSend=true;
        const wrap=el.closest('.card-choices');
        if(wrap){
          wrap.classList.add('locked');
          wrap.querySelectorAll('.direction-card').forEach(btn=>btn.disabled=true);
        }
        el.classList.add('card-selected');
        const action=act;
        const index=Number(el.dataset.index);
        setTimeout(()=>{send(action,{index});pendingCardSend=false;},460);
        break;
      }
      case 'convert':send('convert',{targetId:$('#targetConvert').value});break;
      case 'inspectSelect':send('inspectSelect',{targetId:$('#inspectTarget').value});break;
      case 'inspectReply':send('inspectReply',{excluded:$('#excluded').value});break;
      case 'next':send('next');break;
      case 'editIdentity':{
        const n=prompt('修改昵称（最多14字）',pname(state,state.you.id));
        if(n===null)return;
        const p=prompt('修改个性台词（最多36字）',player(state,state.you.id)?.phrase||'');
        if(p!==null&&n.trim())send('identity',{name:n,phrase:p});
        break;
      }
    }
  });
  $('#lobbySettings').addEventListener('input',e=>{if(e.target.matches('input[type=number]'))updateValidation();});
  showInviteLanding();
  $('#nickname').value=localStorage.getItem('mazeNickname')||'';
  // Periodic client messages allow active rooms to remain responsive on
  // free cloud plans that sleep only when no HTTP/WebSocket traffic arrives.
  setInterval(()=>{if(connected&&state&&ws?.readyState===WebSocket.OPEN)send('heartbeat');},60000);
  connect();
})();
