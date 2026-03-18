/**
 * Supabase client for server-side operations.
 * Handles auth verification and stat updates.
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://tzsqedjxlytvkoxyoepe.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR6c3FlZGp4bHl0dmtveHlvZXBlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM4MTU3OTIsImV4cCI6MjA4OTM5MTc5Mn0.B9ynes5NLZn9Zkcvwl5okZxH4_Qg_Nn_k-OqTEmSNd0';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/**
 * Verify a user's JWT token and return their user ID.
 */
export async function verifyToken(token) {
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return null;
  return data.user;
}

/**
 * Create or get a player profile.
 */
export async function getOrCreatePlayer(userId, username) {
  const { data: existing } = await supabase
    .from('players')
    .select('*')
    .eq('id', userId)
    .single();

  if (existing) return existing;

  const { data, error } = await supabase
    .from('players')
    .insert({ id: userId, username })
    .select()
    .single();

  if (error) {
    console.error('Error creating player:', error.message);
    return null;
  }
  return data;
}

/**
 * Record a match and update player stats.
 */
export async function recordMatch(mode, durationMs, playerResults) {
  // Create match record
  const { data: match, error: matchErr } = await supabase
    .from('matches')
    .insert({ mode, duration_ms: durationMs })
    .select()
    .single();

  if (matchErr) {
    console.error('Error creating match:', matchErr.message);
    return;
  }

  // Record each player's results
  for (const result of playerResults) {
    if (!result.playerId) continue; // skip bots

    // Insert match result
    await supabase.from('match_results').insert({
      match_id: match.id,
      player_id: result.playerId,
      placement: result.placement,
      kills: result.kills,
      deaths: result.deaths,
      damage_dealt: result.damageDealt,
      team: result.team,
      won: result.won,
      rating_before: result.ratingBefore,
      rating_after: result.ratingAfter
    });

    // Update aggregate stats
    await supabase.rpc('update_player_stats', {
      p_id: result.playerId,
      p_kills: result.kills,
      p_deaths: result.deaths,
      p_damage: result.damageDealt,
      p_won: result.won,
      p_mode: mode,
      p_highest_kills: result.kills
    });
  }
}

/**
 * Get leaderboard data.
 */
export async function getLeaderboard(type = 'overall', limit = 50) {
  const view = type === 'kills' ? 'leaderboard_kills' : 'leaderboard_overall';
  const { data, error } = await supabase
    .from(view)
    .select('*')
    .limit(limit);

  if (error) {
    console.error('Leaderboard error:', error.message);
    return [];
  }
  return data;
}

/**
 * Update player rating after a match.
 */
export async function updateRating(playerId, newRating, newDeviation, newVolatility) {
  await supabase
    .from('players')
    .update({
      rating: newRating,
      rating_deviation: newDeviation,
      rating_volatility: newVolatility
    })
    .eq('id', playerId);
}

/**
 * Get player profile with stats.
 */
export async function getPlayerProfile(playerId) {
  const { data } = await supabase
    .from('players')
    .select('*')
    .eq('id', playerId)
    .single();
  return data;
}
