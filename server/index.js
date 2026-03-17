import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { GameRoom } from './GameRoom.js';
import { generateMap } from './mapGenerator.js';
import { GAME_MODES } from '../shared/gameModes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);

app.use('/shared', express.static(join(__dirname, '..', 'shared')));
app.use(express.static(join(__dirname, '..', 'public')));

// Room management — one waiting room per mode
const rooms = new Map(); // roomId -> GameRoom
const waitingRooms = new Map(); // modeId -> roomId

function getOrCreateRoom(modeId) {
  const mode = GAME_MODES[modeId];
  if (!mode) return null;

  // Check for existing waiting room for this mode
  const existingId = waitingRooms.get(modeId);
  if (existingId) {
    const room = rooms.get(existingId);
    if (room && !room.isFull && room.state === 'WAITING') {
      return room;
    }
    // Room is full or started, clear it
    waitingRooms.delete(modeId);
  }

  const id = `${modeId}_${Date.now()}`;
  const mapData = generateMap(modeId);
  console.log(`[${modeId}] New room ${id}: ${mapData.buildings.length} buildings`);
  const room = new GameRoom(id, mapData, io, modeId);
  rooms.set(id, room);
  waitingRooms.set(modeId, id);
  return room;
}

function cleanupRooms() {
  rooms.forEach((room, id) => {
    if (room.isEmpty && room.state !== 'WAITING') {
      rooms.delete(id);
      // Clear waiting room ref if it points to this room
      waitingRooms.forEach((roomId, modeId) => {
        if (roomId === id) waitingRooms.delete(modeId);
      });
    }
  });
}

io.on('connection', (socket) => {
  console.log(`Player connected: ${socket.id}`);

  socket.on('joinMode', (modeId) => {
    if (!GAME_MODES[modeId]) {
      socket.emit('error', { message: 'Invalid game mode' });
      return;
    }

    const room = getOrCreateRoom(modeId);
    if (!room) {
      socket.emit('error', { message: 'Could not create room' });
      return;
    }

    room.addPlayer(socket);
  });

  socket.on('disconnect', () => {
    console.log(`Player disconnected: ${socket.id}`);
    cleanupRooms();
  });
});

const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';
httpServer.listen(PORT, HOST, () => {
  console.log(`BattleCircle server running on http://${HOST}:${PORT}`);
});
