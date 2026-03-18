/**
 * Glicko-2 Rating System
 * Reference: http://www.glicko.net/glicko/glicko2.pdf
 */

const TAU = 0.5; // system constant (constrains volatility change)
const EPSILON = 0.000001; // convergence tolerance
const GLICKO2_SCALE = 173.7178; // conversion factor between Glicko and Glicko-2

// Convert Glicko rating to Glicko-2 scale
function toGlicko2(rating) {
  return (rating - 1500) / GLICKO2_SCALE;
}

// Convert Glicko-2 rating back to Glicko scale
function fromGlicko2(mu) {
  return mu * GLICKO2_SCALE + 1500;
}

// Convert RD to Glicko-2 scale
function rdToGlicko2(rd) {
  return rd / GLICKO2_SCALE;
}

// Convert Glicko-2 phi back to RD
function rdFromGlicko2(phi) {
  return phi * GLICKO2_SCALE;
}

function g(phi) {
  return 1 / Math.sqrt(1 + 3 * phi * phi / (Math.PI * Math.PI));
}

function E(mu, muj, phij) {
  return 1 / (1 + Math.exp(-g(phij) * (mu - muj)));
}

/**
 * Calculate new Glicko-2 rating for a player after a set of matches.
 *
 * @param {number} rating - Current rating (Glicko scale, e.g. 1500)
 * @param {number} rd - Current rating deviation (e.g. 350)
 * @param {number} vol - Current volatility (e.g. 0.06)
 * @param {Array} opponents - Array of { rating, rd, score }
 *   score: 1 = win, 0 = loss, 0.5 = draw
 * @returns {{ rating: number, rd: number, vol: number }}
 */
export function calculateGlicko2(rating, rd, vol, opponents) {
  // Step 1: Convert to Glicko-2 scale
  const mu = toGlicko2(rating);
  const phi = rdToGlicko2(rd);

  // If no opponents, just increase RD (Step 6 for unrated period)
  if (!opponents || opponents.length === 0) {
    const phiStar = Math.sqrt(phi * phi + vol * vol);
    return {
      rating,
      rd: Math.min(rdFromGlicko2(phiStar), 350),
      vol
    };
  }

  // Step 2: Compute v (estimated variance)
  let v = 0;
  for (const opp of opponents) {
    const muj = toGlicko2(opp.rating);
    const phij = rdToGlicko2(opp.rd);
    const gPhij = g(phij);
    const eMu = E(mu, muj, phij);
    v += gPhij * gPhij * eMu * (1 - eMu);
  }
  v = 1 / v;

  // Step 3: Compute delta
  let deltaSum = 0;
  for (const opp of opponents) {
    const muj = toGlicko2(opp.rating);
    const phij = rdToGlicko2(opp.rd);
    deltaSum += g(phij) * (opp.score - E(mu, muj, phij));
  }
  const delta = v * deltaSum;

  // Step 4: Determine new volatility (Illinois algorithm)
  const a = Math.log(vol * vol);
  const phiSq = phi * phi;
  const deltaSq = delta * delta;

  function f(x) {
    const ex = Math.exp(x);
    const num1 = ex * (deltaSq - phiSq - v - ex);
    const den1 = 2 * (phiSq + v + ex) * (phiSq + v + ex);
    return num1 / den1 - (x - a) / (TAU * TAU);
  }

  let A = a;
  let B;
  if (deltaSq > phiSq + v) {
    B = Math.log(deltaSq - phiSq - v);
  } else {
    let k = 1;
    while (f(a - k * TAU) < 0) k++;
    B = a - k * TAU;
  }

  let fA = f(A);
  let fB = f(B);

  // Illinois algorithm iteration
  let iter = 0;
  while (Math.abs(B - A) > EPSILON && iter < 100) {
    const C = A + (A - B) * fA / (fB - fA);
    const fC = f(C);
    if (fC * fB <= 0) {
      A = B;
      fA = fB;
    } else {
      fA = fA / 2;
    }
    B = C;
    fB = fC;
    iter++;
  }

  const newVol = Math.exp(B / 2);

  // Step 5: Update rating deviation
  const phiStar = Math.sqrt(phiSq + newVol * newVol);

  // Step 6: Update rating and RD
  const newPhi = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);
  const newMu = mu + newPhi * newPhi * deltaSum;

  return {
    rating: Math.round(fromGlicko2(newMu)),
    rd: Math.min(Math.round(rdFromGlicko2(newPhi) * 100) / 100, 350),
    vol: Math.round(newVol * 1000000) / 1000000
  };
}

/**
 * Calculate ratings for all human players after a Battle Royale match.
 * Each pair of players is treated as a match (higher placement = win).
 *
 * @param {Array} players - Array of { supabaseId, placement, rating, rd, vol }
 * @returns {Map<string, { rating, rd, vol }>} - Map of supabaseId -> new ratings
 */
export function calculateBRRatings(players) {
  const results = new Map();

  for (const player of players) {
    const opponents = players
      .filter(p => p.supabaseId !== player.supabaseId)
      .map(opp => ({
        rating: opp.rating,
        rd: opp.rd,
        score: player.placement < opp.placement ? 1 : // better placement = win
               player.placement > opp.placement ? 0 : 0.5 // same = draw
      }));

    const newRating = calculateGlicko2(player.rating, player.rd, player.vol, opponents);
    results.set(player.supabaseId, newRating);
  }

  return results;
}

/**
 * Calculate ratings for all human players after a team match (TDM/CTF).
 * Each player on the winning team "beat" each player on the losing team.
 *
 * @param {Array} players - Array of { supabaseId, won, rating, rd, vol }
 * @returns {Map<string, { rating, rd, vol }>} - Map of supabaseId -> new ratings
 */
export function calculateTeamRatings(players) {
  const results = new Map();

  for (const player of players) {
    const opponents = players
      .filter(p => p.supabaseId !== player.supabaseId && p.won !== player.won)
      .map(opp => ({
        rating: opp.rating,
        rd: opp.rd,
        score: player.won ? 1 : 0
      }));

    if (opponents.length === 0) {
      // No opponents on other team with supabaseId — no rating change
      results.set(player.supabaseId, {
        rating: player.rating,
        rd: player.rd,
        vol: player.vol
      });
      continue;
    }

    const newRating = calculateGlicko2(player.rating, player.rd, player.vol, opponents);
    results.set(player.supabaseId, newRating);
  }

  return results;
}
