import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);

const mapData = JSON.parse(readFileSync(join(__dirname, 'map.json'), 'utf-8'));

app.use('/shared', express.static(join(__dirname, '..', 'shared')));
app.use(express.static(join(__dirname, '..', 'public')));

app.get('/api/map', (req, res) => res.json(mapData));

io.on('connection', (socket) => {
  console.log(`Player connected: ${socket.id}`);
  socket.on('disconnect', () => {
    console.log(`Player disconnected: ${socket.id}`);
  });
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`BattleCircle server running on http://localhost:${PORT}`);
});
