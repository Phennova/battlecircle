import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync } from 'fs';
import { GameRoom } from './GameRoom.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);

const mapData = JSON.parse(readFileSync(join(__dirname, 'map.json'), 'utf-8'));

app.use('/shared', express.static(join(__dirname, '..', 'shared')));
app.use(express.static(join(__dirname, '..', 'public')));

app.get('/api/map', (req, res) => res.json(mapData));

// Room management
let currentRoom = null;
const rooms = new Map();

function getOrCreateRoom() {
  if (currentRoom && !currentRoom.isFull && currentRoom.state === 'WAITING') {
    return currentRoom;
  }
  const id = `room_${Date.now()}`;
  const room = new GameRoom(id, mapData, io);
  rooms.set(id, room);
  currentRoom = room;
  return room;
}

io.on('connection', (socket) => {
  console.log(`Player connected: ${socket.id}`);
  const room = getOrCreateRoom();
  room.addPlayer(socket);

  socket.on('disconnect', () => {
    console.log(`Player disconnected: ${socket.id}`);
    rooms.forEach((r, id) => {
      if (r.isEmpty) rooms.delete(id);
    });
    if (currentRoom && currentRoom.isEmpty) currentRoom = null;
  });
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`BattleCircle server running on http://localhost:${PORT}`);
});
