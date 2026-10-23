const express = require('express');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (_req, res) => res.json({ ok: true }));

const rooms = new Map();
const makeCode = () => crypto.randomBytes(3).toString('hex').toUpperCase();
const publicRoom = room => ({
  code: room.code,
  players: room.players.map(p => ({ id: p.id, name: p.name, mark: p.mark })),
  board: room.board,
  turn: room.turn,
  status: room.status,
  winner: room.winner,
  chat: room.chat.slice(-50)
});
const winLines = [
  [0,1,2],[3,4,5],[6,7,8],
  [0,3,6],[1,4,7],[2,5,8],
  [0,4,8],[2,4,6]
];
function checkWinner(board) {
  for (const line of winLines) {
    const [a,b,c] = line;
    if (board[a] && board[a] === board[b] && board[a] === board[c]) return board[a];
  }
  return board.every(Boolean) ? 'draw' : null;
}
function emitRoom(room) { io.to(room.code).emit('room-state', publicRoom(room)); }

io.on('connection', socket => {
  socket.on('create-room', ({ password, name }, callback = () => {}) => {
    if (!ADMIN_PASSWORD) return callback({ ok: false, error: 'O administrador ainda não configurou ADMIN_PASSWORD no Render.' });
    if (typeof password !== 'string' || password !== ADMIN_PASSWORD) return callback({ ok: false, error: 'Palavra-passe incorreta.' });
    let code;
    do { code = makeCode(); } while (rooms.has(code));
    const room = {
      code, ownerId: socket.id, players: [],
      board: Array(9).fill(null), turn: 'X', status: 'waiting', winner: null, chat: []
    };
    rooms.set(code, room);
    joinRoom(socket, room, name, callback);
  });

  socket.on('join-room', ({ code, name }, callback = () => {}) => {
    const room = rooms.get(String(code || '').trim().toUpperCase());
    if (!room) return callback({ ok: false, error: 'A sala não existe ou já foi encerrada.' });
    if (!room.players.some(p => p.id === socket.id) && room.players.length >= 2)
      return callback({ ok: false, error: 'Esta sala já tem dois jogadores.' });
    joinRoom(socket, room, name, callback);
  });

  socket.on('play-cell', ({ code, index }) => {
    const room = rooms.get(String(code || '').toUpperCase());
    if (!room || !Number.isInteger(index) || index < 0 || index > 8) return;
    const player = room.players.find(p => p.id === socket.id);
    if (!player || room.status !== 'playing' || player.mark !== room.turn || room.board[index]) return;
    room.board[index] = player.mark;
    const result = checkWinner(room.board);
    if (result) {
      room.status = 'finished';
      room.winner = result;
    } else {
      room.turn = room.turn === 'X' ? 'O' : 'X';
    }
    emitRoom(room);
  });

  socket.on('new-game', ({ code }) => {
    const room = rooms.get(String(code || '').toUpperCase());
    if (!room || !room.players.some(p => p.id === socket.id)) return;
    room.board = Array(9).fill(null);
    room.turn = 'X';
    room.winner = null;
    room.status = room.players.length === 2 ? 'playing' : 'waiting';
    emitRoom(room);
  });

  socket.on('chat-message', ({ code, message }) => {
    const room = rooms.get(String(code || '').toUpperCase());
    const player = room && room.players.find(p => p.id === socket.id);
    if (!room || !player || typeof message !== 'string') return;
    const clean = message.trim().slice(0, 500);
    if (!clean) return;
    room.chat.push({ name: player.name, message: clean, time: new Date().toISOString() });
    if (room.chat.length > 100) room.chat.shift();
    io.to(room.code).emit('chat-message', room.chat[room.chat.length - 1]);
  });

  // WebRTC signalling: only relay messages to the other participant in the same room.
  for (const eventName of ['rtc-offer', 'rtc-answer', 'rtc-ice']) {
    socket.on(eventName, ({ code, data }) => {
      const room = rooms.get(String(code || '').toUpperCase());
      if (!room || !room.players.some(p => p.id === socket.id)) return;
      socket.to(room.code).emit(eventName, { from: socket.id, data });
    });
  }

  socket.on('disconnect', () => {
    for (const room of rooms.values()) {
      const idx = room.players.findIndex(p => p.id === socket.id);
      if (idx === -1) continue;
      room.players.splice(idx, 1);
      if (room.players.length === 0) {
        rooms.delete(room.code);
      } else {
        room.status = 'waiting';
        room.winner = null;
        emitRoom(room);
        io.to(room.code).emit('peer-left');
      }
    }
  });
});

function joinRoom(socket, room, name, callback) {
  let player = room.players.find(p => p.id === socket.id);
  if (!player) {
    const mark = room.players.length === 0 ? 'X' : 'O';
    player = { id: socket.id, name: String(name || 'Jogador').trim().slice(0, 24) || 'Jogador', mark };
    room.players.push(player);
  }
  socket.join(room.code);
  if (room.players.length === 2) room.status = 'playing';
  else room.status = 'waiting';
  emitRoom(room);
  callback({ ok: true, code: room.code, mark: player.mark, room: publicRoom(room) });
}

server.listen(PORT, '0.0.0.0', () => console.log(`Jogo do Galo ativo na porta ${PORT}`));