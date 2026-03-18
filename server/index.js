import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { GameRoom } from './GameRoom.js';
import { generateMap } from './mapGenerator.js';
import { GAME_MODES } from '../shared/gameModes.js';
import { verifyToken, getOrCreatePlayer } from './supabase.js';
import { Matchmaker } from './matchmaking.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);

app.use('/shared', express.static(join(__dirname, '..', 'shared')));
app.use(express.static(join(__dirname, '..', 'public')));

// Room management
const rooms = new Map(); // roomId -> GameRoom
const waitingRooms = new Map(); // modeId -> roomId (for arcade only now)
const matchmaker = new Matchmaker(io, rooms);

// Arcade modes still use direct room join (no matchmaking)
function getOrCreateArcadeRoom(modeId) {
  const mode = GAME_MODES[modeId];
  if (!mode || !mode.arcade) return null;

  const existingId = waitingRooms.get(modeId);
  if (existingId) {
    const room = rooms.get(existingId);
    if (room && !room.isFull && room.state === 'WAITING') {
      return room;
    }
    waitingRooms.delete(modeId);
  }

  const id = `${modeId}_${Date.now()}`;
  const mapData = generateMap(modeId);
  console.log(`[${modeId}] New arcade room ${id}: ${mapData.buildings.length} buildings`);
  const room = new GameRoom(id, mapData, io, modeId);
  rooms.set(id, room);
  waitingRooms.set(modeId, id);
  return room;
}

function cleanupRooms() {
  rooms.forEach((room, id) => {
    if (room.isEmpty && room.state !== 'WAITING') {
      rooms.delete(id);
      waitingRooms.forEach((roomId, modeId) => {
        if (roomId === id) waitingRooms.delete(modeId);
      });
    }
  });
}

io.on('connection', async (socket) => {
  const authToken = socket.handshake.auth?.token;
  const authUsername = socket.handshake.auth?.username;
  socket.authToken = authToken;
  socket.authUsername = authUsername;
  socket.supabaseId = null;

  // Verify JWT and get Supabase user ID
  if (authToken) {
    try {
      const user = await verifyToken(authToken);
      if (user) {
        socket.supabaseId = user.id;
        await getOrCreatePlayer(user.id, authUsername || user.email?.split('@')[0] || 'Player');
      }
    } catch (e) {
      console.error('Auth verification error:', e.message);
    }
  }

  console.log(`Player connected: ${socket.id} (${authUsername || 'guest'}) supabaseId:${socket.supabaseId || 'none'}`);

  // Matchmaking queue (for competitive modes)
  socket.on('joinQueue', async (modeId) => {
    if (!GAME_MODES[modeId]) {
      socket.emit('queueError', { message: 'Invalid game mode' });
      return;
    }

    const mode = GAME_MODES[modeId];

    // Arcade modes bypass queue
    if (mode.arcade) {
      const room = getOrCreateArcadeRoom(modeId);
      if (!room) {
        socket.emit('error', { message: 'Could not create room' });
        return;
      }
      room.addPlayer(socket);
      return;
    }

    await matchmaker.addToQueue(socket, modeId);
  });

  // Legacy direct join (still works for arcade)
  socket.on('joinMode', (modeId) => {
    if (!GAME_MODES[modeId]) {
      socket.emit('error', { message: 'Invalid game mode' });
      return;
    }

    const mode = GAME_MODES[modeId];

    if (mode.arcade) {
      const room = getOrCreateArcadeRoom(modeId);
      if (!room) {
        socket.emit('error', { message: 'Could not create room' });
        return;
      }
      room.addPlayer(socket);
    } else {
      // Redirect non-arcade to queue
      matchmaker.addToQueue(socket, modeId);
    }
  });

  socket.on('leaveQueue', () => {
    matchmaker.removeFromQueue(socket.id);
    socket.emit('queueLeft');
  });

  socket.on('disconnect', () => {
    console.log(`Player disconnected: ${socket.id}`);
    matchmaker.removeFromQueue(socket.id);

    // Check if player was in a countdown room (dodge detection)
    rooms.forEach(room => {
      if (room.state === 'COUNTDOWN' && room.players.has(socket.id)) {
        matchmaker.recordDodge(socket.id);
      }
    });

    cleanupRooms();
  });
});

const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';
httpServer.listen(PORT, HOST, () => {
  console.log(`BattleCircle server running on http://${HOST}:${PORT}`);
});
