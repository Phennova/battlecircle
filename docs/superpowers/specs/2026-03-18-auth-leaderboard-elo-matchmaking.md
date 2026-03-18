# Auth, Leaderboard, Elo & Matchmaking — Design Specification

> Complete player identity, persistent stats, competitive rating, and skill-based matchmaking

## Overview

Six phases that build on each other. Each phase produces testable, working functionality before moving to the next. All phases use the existing Supabase Postgres database with the `players`, `matches`, and `match_results` tables already created.

---

## Phase 1: Wire Auth to Gameplay

**Goal:** Your Supabase display name appears in-game instead of a random bot name. Server knows which Supabase user each socket belongs to.

**Test:** Sign in, join a game. Your display name (from sign up) shows above your circle and in the kill feed.

### Task 1.1: Pass auth identity through socket connection

The client already sends `token` and `username` in the Socket.IO handshake auth. The server needs to:
- Read `socket.handshake.auth.username` when a player joins
- Store it on the socket object
- Pass it to `GameRoom.addPlayer()` so the player's name is set from auth instead of `generateName()`

**Files:** `server/index.js`, `server/GameRoom.js`

### Task 1.2: Use auth display name in GameRoom

When `addPlayer()` is called:
- If `socket.authUsername` exists, use it as the player's name
- If not (guest/unauthenticated), fall back to `generateName()` as before
- Store `socket.authToken` on the player object for later use in stat recording

**Files:** `server/GameRoom.js`

### Task 1.3: Store Supabase user ID on player

The server needs to verify the JWT token and extract the user ID:
- On socket connection, if `authToken` is provided, call `supabase.auth.getUser(token)` to get the UUID
- Store `player.supabaseId` on the Player object
- This ID links the in-game player to their database record

**Files:** `server/index.js`, `server/Player.js`

### Task 1.4: Ensure player profile exists in database

When a verified user connects:
- Check if a row exists in `players` table for their UUID
- If not (first time after sign up on a different device, or profile creation failed), create it
- This is a safety net — the sign up flow already creates the profile

**Files:** `server/supabase.js`

---

## Phase 2: Record Match Results

**Goal:** When a game ends, all human players' results are saved to the database. Stats accumulate across games.

**Test:** Play a game, check Supabase dashboard — `matches` table has a new row, `match_results` has entries per player, `players` table stats have incremented.

### Task 2.1: Collect match data on game end

When `_checkWin()` triggers game over:
- Record match duration (`Date.now() - gameStartTime`)
- For each human player (not bots), collect: placement, kills, deaths, damage dealt, team, won/lost
- Bots are excluded from database recording (they have no `supabaseId`)

**Files:** `server/GameRoom.js`

### Task 2.2: Track deaths per player

Currently `Player` tracks kills but not deaths. Add a `deaths` counter:
- Increment `player.deaths` in `_handleKill()` for the victim
- Include in the match result data

**Files:** `server/Player.js`, `server/GameRoom.js`

### Task 2.3: Send match data to Supabase

After collecting results, call `recordMatch()` from `server/supabase.js`:
- Insert one row into `matches` table (mode, duration)
- Insert one row per human player into `match_results` (linked to match ID and player ID)
- Call the `update_player_stats` RPC to atomically update aggregate stats

This should be async and non-blocking — don't delay the game over screen while writing to DB.

**Files:** `server/GameRoom.js`, `server/supabase.js`

### Task 2.4: Handle recording failures gracefully

If Supabase is unreachable or writes fail:
- Log the error server-side
- Don't crash the game or show errors to players
- Optionally queue failed writes for retry (stretch goal)

**Files:** `server/supabase.js`

---

## Phase 3: Leaderboard Page

**Goal:** Players can view a global leaderboard showing top players ranked by rating, kills, or win rate.

**Test:** Click "Leaderboard" in sidebar. See a table of players ranked by rating with their stats.

### Task 3.1: Leaderboard API endpoint

Create a server endpoint (or use Supabase directly from client) to fetch leaderboard data:
- Overall leaderboard (sorted by rating)
- Kills leaderboard (sorted by total kills)
- Both use the views already created in the database (`leaderboard_overall`, `leaderboard_kills`)

**Files:** `server/index.js` (if server-proxied) or `public/main.js` (if client-direct)

### Task 3.2: Leaderboard UI — table rendering

Render the leaderboard in `#page-leaderboard`:
- Table with columns: Rank, Name, Rating, Wins, Kills, K/D, Games
- Your own row highlighted with accent border
- Tab buttons to switch between "Overall" and "Kills" views
- Loading state while fetching

**Files:** `public/main.js`

### Task 3.3: Leaderboard styling

Match the tactical-tech theme:
- Orbitron headers, Rajdhani body text
- Dark panel background with accent top border
- Left-border highlight on player's own row
- Alternating row backgrounds for readability
- Top 3 get gold/silver/bronze accent

**Files:** `public/index.html` (CSS), `public/main.js`

### Task 3.4: Auto-refresh

Leaderboard data refreshes:
- On page switch to leaderboard tab
- Not on a timer (to avoid unnecessary API calls)
- Show "Last updated: X seconds ago" timestamp

**Files:** `public/main.js`

---

## Phase 4: Profile Page

**Goal:** Players can view their own detailed stats, match history, and per-mode breakdowns.

**Test:** Click "Profile" in sidebar. See your full stats, per-mode win rates, and recent match history.

### Task 4.1: Profile data fetching

Fetch from Supabase:
- Player record (all stats, rating, per-mode stats)
- Last 20 match results (joined with match data for mode/duration)

**Files:** `public/main.js`, `server/supabase.js`

### Task 4.2: Profile header

Top section showing:
- Display name (large, Orbitron)
- Rating with rank tier badge (Bronze/Silver/Gold/Platinum/Diamond based on rating thresholds)
- Account creation date
- Total playtime (sum of match durations)

Rating tier thresholds:
- Bronze: < 1200
- Silver: 1200-1499
- Gold: 1500-1799
- Platinum: 1800-2099
- Diamond: 2100+

**Files:** `public/main.js`

### Task 4.3: Stats grid

Grid of stat cards:
- Total Kills, Total Deaths, K/D Ratio
- Total Wins, Total Games, Win Rate %
- Highest Kill Game, Total Damage Dealt
- Per-mode breakdown: BR (wins/games), TDM (wins/games), CTF (wins/games), Arcade (games)

**Files:** `public/main.js`

### Task 4.4: Match history list

Scrollable list of recent matches:
- Each entry: mode, result (WIN/LOSS), kills, deaths, damage, date
- Color-coded: green for wins, red for losses
- Click to expand for more details (stretch goal)

**Files:** `public/main.js`

---

## Phase 5: Elo/Rating Updates

**Goal:** Player ratings update after each match using Glicko-2 algorithm. Rating changes are visible immediately.

**Test:** Play a game, win. Rating goes up. Lose, rating goes down. Amount depends on opponent strength.

### Task 5.1: Implement Glicko-2 calculation

Create `server/glicko2.js` with the Glicko-2 algorithm:
- Input: player's current rating, rating deviation (RD), volatility, and match outcomes against opponents
- Output: new rating, new RD, new volatility
- Standard Glicko-2 parameters: τ = 0.5, initial rating = 1500, initial RD = 350

**Files:** `server/glicko2.js` (new)

### Task 5.2: Calculate ratings on match end

After a match ends, before recording to Supabase:
- For each human player, calculate new rating based on:
  - Battle Royale: each pair of players counts as a match (winner beat loser)
  - TDM: winning team beat losing team (each player on winning team vs each on losing)
  - CTF: same as TDM
- Store `rating_before` and `rating_after` in `match_results`

**Files:** `server/GameRoom.js`, `server/glicko2.js`

### Task 5.3: Update ratings in database

After calculation:
- Update each player's `rating`, `rating_deviation`, and `rating_volatility` in `players` table
- This happens alongside the stat recording in Phase 2

**Files:** `server/supabase.js`

### Task 5.4: Show rating change on game over screen

End screen shows:
- Previous rating → New rating (with +/- delta)
- Color: green for gain, red for loss
- Rank tier badge if tier changed

**Files:** `public/main.js`

### Task 5.5: Refresh sidebar after match

When returning to the home screen after a match:
- Re-fetch player stats from Supabase
- Update sidebar rating display
- Update stats bar on play page

**Files:** `public/main.js`

---

## Phase 6: Matchmaking

**Goal:** Players queue for a mode and get matched with others of similar rating. If not enough players found within 60 seconds, bots fill the remaining slots.

**Test:** Two players queue for Battle Royale. They get placed in the same room. After 60 seconds with only 1 player, bots fill the remaining slots.

### Task 6.1: Queue system on server

Replace direct room joining with a queue:
- Player emits `joinQueue { modeId }` instead of `joinMode`
- Server maintains a queue per mode: `Map<modeId, QueueEntry[]>`
- Each `QueueEntry` has: `socket`, `rating`, `joinedAt`

**Files:** `server/index.js`, `server/matchmaking.js` (new)

### Task 6.2: Queue matching logic

Every 2 seconds, process each queue:
- Sort by rating
- Try to form a group of `minPlayers` to `maxPlayers` within a rating range
- Rating range starts at ±100, expands by ±50 every 10 seconds of waiting
- When a valid group is found, create a room, add all players, start countdown

For team modes:
- Balance teams by rating (alternating pick: highest rated to team A, next to team B, etc.)

**Files:** `server/matchmaking.js`

### Task 6.3: Bot backfill after 60 seconds

If a queue has been waiting 60+ seconds and has at least 1 player:
- Create a room with the waiting players
- Fill remaining slots with bots
- Start the game

**Files:** `server/matchmaking.js`

### Task 6.4: Queue UI on client

When player clicks a mode:
- Instead of going to a lobby, show "Searching for match..." with a timer
- Show estimated wait time and current queue size
- Cancel button to leave queue
- When matched, transition to the lobby/countdown as before

**Files:** `public/main.js`, `public/index.html`

### Task 6.5: Show rating range in queue

Display to the player:
- "Searching: ±100 rating" (expands over time)
- Number of players in queue
- Elapsed time

**Files:** `public/main.js`

### Task 6.6: Private rooms (stretch goal)

Allow creating private rooms with invite codes:
- Host creates a private room, gets a 6-character code
- Other players enter the code to join
- Bypasses matchmaking entirely
- No rating changes in private rooms

**Files:** `server/index.js`, `public/main.js`

---

## Implementation Order

Each phase is fully independent and testable:

```
Phase 1 (auth → gameplay)     → Test: name shows in game
Phase 2 (record results)      → Test: check Supabase tables after match
Phase 3 (leaderboard page)    → Test: see ranked players in UI
Phase 4 (profile page)        → Test: see your detailed stats
Phase 5 (Elo rating)          → Test: rating changes after match
Phase 6 (matchmaking)         → Test: queue, get matched, bot backfill
```

Phases 1-2 are required before 3-5 (need data in the database).
Phase 6 is independent but benefits from Phase 5 (rating-based matching).

---

## Database Schema (Already Created)

```sql
players: id, username, rating, rating_deviation, rating_volatility,
         total_kills, total_deaths, total_wins, total_games,
         total_damage_dealt, highest_kill_game,
         br_wins, br_games, tdm_wins, tdm_games,
         ctf_wins, ctf_games, arcade_games

matches: id, mode, started_at, duration_ms, map_seed

match_results: id, match_id, player_id, placement, kills, deaths,
               damage_dealt, team, won, rating_before, rating_after

Views: leaderboard_overall (by rating), leaderboard_kills (by K/D)
RPC: update_player_stats (atomic stat increment)
```

## Files Affected Per Phase

| Phase | New Files | Modified Files |
|---|---|---|
| 1 | — | `server/index.js`, `server/GameRoom.js`, `server/Player.js` |
| 2 | — | `server/GameRoom.js`, `server/Player.js`, `server/supabase.js` |
| 3 | — | `public/main.js`, `public/index.html` |
| 4 | — | `public/main.js` |
| 5 | `server/glicko2.js` | `server/GameRoom.js`, `server/supabase.js`, `public/main.js` |
| 6 | `server/matchmaking.js` | `server/index.js`, `public/main.js`, `public/index.html` |
