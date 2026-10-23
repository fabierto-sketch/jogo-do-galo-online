const socket = io();
const $ = id => document.getElementById(id);
const lobby = $('lobby'), game = $('game');
let currentCode = null, myMark = null, myId = null, currentRoom = null;
let localStream = null, peerConnection = null, makingOffer = false;
let pendingCandidates = [];

const iceServers = [{ urls: 'stun:stun.l.google.com:19302' }];
function showError(message) { $('lobbyError').textContent = message || ''; }
function playerName() { return $('playerName').value.trim() || 'Jogador'; }
function enterGame(result) {
  currentCode = result.code;
  myMark = result.mark;
  myId = socket.id;
  lobby.classList.add('hidden');
  game.classList.remove('hidden');
  $('roomCodeLabel').textContent = currentCode;
  $('chatMessages').innerHTML = '';
  (result.room.chat || []).forEach(addChatMessage);
  renderRoom(result.room);
  const url = new URL(location.href);
  url.searchParams.set('sala', currentCode);
  history.replaceState({}, '', url);
}
function addChatMessage(item) {
  const row = document.createElement('div'); row.className = 'chat-message';
  const name = document.createElement('strong'); name.textContent = item.name || 'Jogador';
  const message = document.createElement('div'); message.textContent = item.message || '';
  row.append(name, message); $('chatMessages').append(row);
  $('chatMessages').scrollTop = $('chatMessages').scrollHeight;
}
function renderRoom(room) {
  currentRoom = room;
  $('players').innerHTML = '';
  room.players.forEach(p => {
    const pill = document.createElement('div'); pill.className = 'player-pill';
    const mark = document.createElement('strong'); mark.textContent = p.mark;
    pill.append(mark, document.createTextNode(' ' + p.name + (p.id === socket.id ? ' (tu)' : '')));
    $('players').append(pill);
  });
  const status = $('status');
  if (room.status === 'waiting') status.textContent = 'À espera do segundo jogador… Envia o convite!';
  else if (room.status === 'playing') {
    const whose = room.players.find(p => p.mark === room.turn);
    status.textContent = (whose?.id === socket.id ? 'É a tua vez!' : `Vez de ${whose?.name || room.turn}`) + ` (${room.turn})`;
  } else if (room.winner === 'draw') status.textContent = 'Empate! Mais uma partida?';
  else {
    const winner = room.players.find(p => p.mark === room.winner);
    status.textContent = winner ? `${winner.name} ganhou! 🎉` : 'Fim do jogo!';
  }
  document.querySelectorAll('.cell').forEach((cell, i) => {
    const mark = room.board[i];
    cell.textContent = mark || '';
    cell.dataset.mark = mark || '';
    const mineTurn = room.players.find(p => p.id === socket.id)?.mark === room.turn;
    cell.disabled = room.status !== 'playing' || !mineTurn || !!mark;
  });
}
$('createForm').addEventListener('submit', e => {
  e.preventDefault(); showError('');
  socket.emit('create-room', { password: $('adminPassword').value, name: playerName() }, result => {
    if (!result?.ok) return showError(result?.error || 'Não foi possível criar a sala.');
    enterGame(result);
  });
});
function join(code) {
  showError('');
  socket.emit('join-room', { code, name: playerName() }, result => {
    if (!result?.ok) return showError(result?.error || 'Não foi possível entrar.');
    enterGame(result);
  });
}
$('joinForm').addEventListener('submit', e => { e.preventDefault(); join($('roomCode').value.trim().toUpperCase()); });
document.querySelectorAll('.cell').forEach(cell => cell.addEventListener('click', () => {
  if (currentCode) socket.emit('play-cell', { code: currentCode, index: Number(cell.dataset.index) });
}));
$('newGameBtn').addEventListener('click', () => currentCode && socket.emit('new-game', { code: currentCode }));
$('shareBtn').addEventListener('click', async () => {
  const url = new URL(location.href); url.searchParams.set('sala', currentCode);
  const message = `Vem jogar Jogo do Galo comigo! Sala ${currentCode}: ${url.toString()}`;
  if (navigator.share) {
    try { await navigator.share({ title: 'Jogo do Galo', text: message, url: url.toString() }); } catch {}
  } else if (navigator.clipboard?.writeText) {
    try { await navigator.clipboard.writeText(message); $('shareBtn').textContent = 'Convite copiado!'; } catch { prompt('Copia este convite:', message); }
  } else prompt('Copia este convite:', message);
});
$('leaveBtn').addEventListener('click', () => {
  stopCall(); location.href = location.pathname;
});
$('chatForm').addEventListener('submit', e => {
  e.preventDefault();
  const input = $('chatInput'), message = input.value.trim();
  if (!message || !currentCode) return;
  socket.emit('chat-message', { code: currentCode, message }); input.value = ''; input.focus();
});
socket.on('room-state', renderRoom);
socket.on('chat-message', addChatMessage);
socket.on('peer-left', () => {
  $('callStatus').textContent = 'A outra pessoa saiu da sala.';
  closePeerConnection();
});

// WebRTC peer-to-peer video/audio with Socket.IO used only for signalling.
function createPeerConnection() {
  closePeerConnection();
  peerConnection = new RTCPeerConnection({ iceServers });
  if (localStream) localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));
  peerConnection.ontrack = event => {
    $('remoteVideo').srcObject = event.streams[0];
    $('callStatus').textContent = 'Chamada ligada.';
  };
  peerConnection.onicecandidate = event => {
    if (event.candidate && currentCode) socket.emit('rtc-ice', { code: currentCode, data: event.candidate });
  };
  peerConnection.onconnectionstatechange = () => {
    if (peerConnection && ['failed', 'disconnected', 'closed'].includes(peerConnection.connectionState))
      $('callStatus').textContent = 'A ligação caiu ou foi interrompida. Tenta ativar a chamada novamente.';
  };
  return peerConnection;
}
async function ensureMedia() {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('A câmara/microfone precisam de um navegador compatível e de HTTPS.');
  if (!localStream) {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    $('localVideo').srcObject = localStream;
  }
}
$('startCallBtn').addEventListener('click', async () => {
  if (!currentCode) return;
  try {
    await ensureMedia();
    $('callStatus').textContent = 'Câmara e microfone ativos. A procurar a outra pessoa…';
    const pc = createPeerConnection();
    if (currentRoom?.players.length === 2) {
      const other = currentRoom.players.find(p => p.id !== socket.id);
      // Deterministic offerer avoids both peers making offers simultaneously.
      if (socket.id.localeCompare(other?.id || '') < 0) {
        makingOffer = true;
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socket.emit('rtc-offer', { code: currentCode, data: pc.localDescription });
        makingOffer = false;
      }
    }
  } catch (err) {
    $('callStatus').textContent = err.message || 'Não foi possível ativar a câmara/microfone.';
  }
});
socket.on('rtc-offer', async ({ data }) => {
  try {
    await ensureMedia();
    const pc = peerConnection || createPeerConnection();
    await pc.setRemoteDescription(new RTCSessionDescription(data));
    for (const candidate of pendingCandidates) await pc.addIceCandidate(candidate);
    pendingCandidates = [];
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit('rtc-answer', { code: currentCode, data: pc.localDescription });
    $('callStatus').textContent = 'A ligar à outra pessoa…';
  } catch (err) { $('callStatus').textContent = 'Não foi possível estabelecer a chamada: ' + err.message; }
});
socket.on('rtc-answer', async ({ data }) => {
  try {
    if (peerConnection && !peerConnection.currentRemoteDescription) {
      await peerConnection.setRemoteDescription(new RTCSessionDescription(data));
      for (const candidate of pendingCandidates) await peerConnection.addIceCandidate(candidate);
      pendingCandidates = [];
    }
  } catch (err) { $('callStatus').textContent = 'Falha ao ligar a chamada: ' + err.message; }
});
socket.on('rtc-ice', async ({ data }) => {
  try {
    const candidate = new RTCIceCandidate(data);
    if (peerConnection?.remoteDescription) await peerConnection.addIceCandidate(candidate);
    else pendingCandidates.push(candidate);
  } catch {}
});
function closePeerConnection() {
  if (peerConnection) { peerConnection.ontrack = null; peerConnection.close(); peerConnection = null; }
  $('remoteVideo').srcObject = null;
  pendingCandidates = [];
}
function stopCall() {
  closePeerConnection();
  if (localStream) { localStream.getTracks().forEach(track => track.stop()); localStream = null; }
  $('localVideo').srcObject = null;
  $('callStatus').textContent = 'A chamada foi desligada.';
}
$('stopCallBtn').addEventListener('click', stopCall);
const inviteCode = new URLSearchParams(location.search).get('sala');
if (inviteCode) { $('roomCode').value = inviteCode; }
