/**
 * Matchmaking queue system.
 * Players queue for a mode and get matched with others of similar rating.
 * After 90 seconds, remaining slots are filled with bots.
 */

import { GameRoom } from './GameRoom.js';
import { generateMap } from './mapGenerator.js';
import { GAME_MODES } from '../shared/gameModes.js';
import { getPlayerProfile } from './supabase.js';

const QUEUE_TICK_MS = 2000;       // Process queues every 2s
const BOT_BACKFILL_MS = 90000;    // 90 seconds before bot backfill
const INITIAL_RANGE = 150;        // Starting rating range ±150
const RANGE_EXPAND_PER_SEC = 50 / 15; // Expand ~50 per 15 seconds
const DODGE_COOLDOWN_MS = 30000;  // 30s cooldown for queue dodging

export class Matchmaker {
  constructor(io, rooms) {
    this.io = io;
    this.rooms = rooms;           // shared Map<roomId, GameRoom>
    this.queues = new Map();      // modeId -> QueueEntry[]
    this.dodgePenalties = new Map(); // socketId -> penalty expiry timestamp

    // Start processing loop
    this.interval = setInterval(() => this._processQueues(), QUEUE_TICK_MS);
  }

  /**
   * Add a player to the matchmaking queue.
   * @returns {boolean} true if queued, false if rejected
   */
  async addToQueue(socket, modeId) {
    const mode = GAME_MODES[modeId];
    if (!mode) {
      socket.emit('queueError', { message: 'Invalid game mode' });
      return false;
    }

    // Arcade modes bypass queue entirely
    if (mode.arcade) {
      socket.emit('queueError', { message: 'Arcade modes do not use matchmaking' });
      return false;
    }

    // Check dodge penalty
    const penalty = this.dodgePenalties.get(socket.id);
    if (penalty && Date.now() < penalty) {
      const remaining = Math.ceil((penalty - Date.now()) / 1000);
      socket.emit('queueError', { message: `Queue cooldown: ${remaining}s remaining` });
      return false;
    }

    // Remove from any existing queue
    this.removeFromQueue(socket.id);

    // Fetch player rating
    let rating = 1500, rd = 350;
    if (socket.supabaseId) {
      const profile = await getPlayerProfile(socket.supabaseId);
      if (profile) {
        rating = profile.rating || 1500;
        rd = profile.rating_deviation || 350;
      }
    }

    const entry = {
      socket,
      modeId,
      rating,
      rd,
      joinedAt: Date.now()
    };

    if (!this.queues.has(modeId)) {
      this.queues.set(modeId, []);
    }
    this.queues.get(modeId).push(entry);

    // Notify player they're in queue
    socket.emit('queueJoined', {
      modeId,
      position: this.queues.get(modeId).length,
      ratingRange: INITIAL_RANGE
    });

    this._broadcastQueueStatus(modeId);
    return true;
  }

  /**
   * Remove a player from all queues.
   */
  removeFromQueue(socketId) {
    this.queues.forEach((entries, modeId) => {
      const idx = entries.findIndex(e => e.socket.id === socketId);
      if (idx !== -1) {
        entries.splice(idx, 1);
        this._broadcastQueueStatus(modeId);
      }
    });
  }

  /**
   * Record a queue dodge (player disconnected during countdown).
   */
  recordDodge(socketId) {
    this.dodgePenalties.set(socketId, Date.now() + DODGE_COOLDOWN_MS);
    // Clean old penalties periodically
    if (this.dodgePenalties.size > 1000) {
      const now = Date.now();
      this.dodgePenalties.forEach((expiry, id) => {
        if (now > expiry) this.dodgePenalties.delete(id);
      });
    }
  }

  /**
   * Process all queues — find matches or bot-backfill.
   */
  _processQueues() {
    const now = Date.now();

    this.queues.forEach((entries, modeId) => {
      if (entries.length === 0) return;

      const mode = GAME_MODES[modeId];
      if (!mode) return;

      // Try to form a match from players within rating range
      const match = this._tryFormMatch(entries, mode, now);

      if (match) {
        this._createMatch(match, modeId, mode, false);
        return;
      }

      // Check for bot backfill — oldest player waited 90s+
      const oldest = entries.reduce((min, e) => e.joinedAt < min ? e.joinedAt : min, Infinity);
      if (now - oldest >= BOT_BACKFILL_MS && entries.length >= 1) {
        // Take all waiting players for this mode
        const players = entries.splice(0, Math.min(entries.length, mode.maxPlayers));
        this._createMatch(players, modeId, mode, true);
      }
    });
  }

  /**
   * Try to form a full match from queued players within rating range.
   */
  _tryFormMatch(entries, mode, now) {
    if (entries.length < mode.minPlayers) return null;

    // Sort by rating
    const sorted = [...entries].sort((a, b) => a.rating - b.rating);

    // For each player, calculate their expanded rating range
    for (let i = 0; i < sorted.length; i++) {
      const anchor = sorted[i];
      const waitSec = (now - anchor.joinedAt) / 1000;
      const range = INITIAL_RANGE + waitSec * RANGE_EXPAND_PER_SEC;

      // Find all players within this anchor's range
      const compatible = sorted.filter(e =>
        Math.abs(e.rating - anchor.rating) <= range
      );

      if (compatible.length >= mode.minPlayers) {
        // Take up to maxPlayers, preferring closest ratings
        const group = compatible
          .sort((a, b) => Math.abs(a.rating - anchor.rating) - Math.abs(b.rating - anchor.rating))
          .slice(0, mode.maxPlayers);

        if (group.length >= mode.minPlayers) {
          // Remove matched players from queue
          for (const player of group) {
            const idx = entries.findIndex(e => e.socket.id === player.socket.id);
            if (idx !== -1) entries.splice(idx, 1);
          }
          return group;
        }
      }
    }

    return null;
  }

  /**
   * Create a game room from matched players.
   */
  _createMatch(players, modeId, mode, hasBots) {
    const roomId = `${modeId}_${Date.now()}`;
    const mapData = generateMap(modeId);
    const botCount = hasBots ? mode.maxPlayers - players.length : 0;

    console.log(`[Matchmaker] Created ${roomId}: ${players.length} humans, ${botCount} bots, hasBots=${hasBots}`);

    const room = new GameRoom(roomId, mapData, this.io, modeId);
    room.matchmade = true;
    room.hasBotBackfill = hasBots;
    this.rooms.set(roomId, room);

    // Notify all matched players
    for (const entry of players) {
      entry.socket.emit('matchFound', {
        roomId,
        modeId,
        playerCount: players.length,
        hasBots
      });
      room.addPlayer(entry.socket);
    }

    // If bot backfill, add bots to fill
    if (hasBots && botCount > 0) {
      room._pendingBotBackfill = botCount;
    }

    // Auto-ready all players and start countdown after a brief delay
    setTimeout(() => {
      room.players.forEach(p => { p.ready = true; });
      room._checkAllReady();
    }, 1500);
  }

  /**
   * Broadcast queue status to all players in a queue.
   */
  _broadcastQueueStatus(modeId) {
    const entries = this.queues.get(modeId);
    if (!entries) return;

    const now = Date.now();
    for (const entry of entries) {
      const waitSec = (now - entry.joinedAt) / 1000;
      const range = Math.round(INITIAL_RANGE + waitSec * RANGE_EXPAND_PER_SEC);

      entry.socket.emit('queueStatus', {
        modeId,
        playersInQueue: entries.length,
        waitTime: Math.round(waitSec),
        ratingRange: range,
        estimatedWait: entries.length >= GAME_MODES[modeId]?.minPlayers
          ? 'Match found soon...'
          : `Searching (${Math.round(BOT_BACKFILL_MS / 1000 - waitSec)}s until bot fill)`
      });
    }
  }

  destroy() {
    clearInterval(this.interval);
  }
}
