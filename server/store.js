const NO_PERSIST = process.env.NO_PERSIST === '1';

let supabase = null;
try {
  const { createClient } = require('@supabase/supabase-js');
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (url && key && !NO_PERSIST) {
    supabase = createClient(url, key);
  }
} catch (e) {
  console.warn('  Supabase nicht geladen:', e.message);
}

function available() {
  return !!supabase;
}

async function getPlayer(uid) {
  if (!supabase) return null;
  const { data: player, error } = await supabase
    .from('players').select('*').eq('id', uid).single();
  if (error || !player) return null;

  const { data: upgrades } = await supabase
    .from('player_upgrades').select('upgrade_id').eq('player_id', uid);

  return {
    uid: player.id,
    name: player.name,
    stars: player.stars,
    matches: player.matches,
    wins: player.wins,
    kills: player.kills,
    deaths: player.deaths,
    best: player.best,
    damagePoints: player.damage_points,
    upgrades: (upgrades || []).map(u => u.upgrade_id),
    created_at: player.created_at
  };
}

async function savePlayer(uid, data) {
  if (!supabase) return null;
  const { data: player, error } = await supabase
    .from('players').upsert({
      id: uid,
      name: data.name || 'Player',
      stars: data.stars || 0,
      matches: data.matches || 0,
      wins: data.wins || 0,
      kills: data.kills || 0,
      deaths: data.deaths || 0,
      best: data.best || 0,
      damage_points: data.damagePoints || 500000,
      updated_at: new Date().toISOString()
    }, { onConflict: 'id' })
    .select().single();

  if (error) return null;
  return {
    uid: player.id,
    name: player.name,
    stars: player.stars,
    matches: player.matches,
    wins: player.wins,
    kills: player.kills,
    deaths: player.deaths,
    best: player.best,
    damagePoints: player.damage_points,
    upgrades: data.upgrades || []
  };
}

async function addUpgrade(uid, upgradeId) {
  if (!supabase) return false;
  const { error } = await supabase
    .from('player_upgrades').insert({ player_id: uid, upgrade_id: upgradeId });
  return !error;
}

async function setDamagePoints(uid, dp) {
  if (!supabase) return;
  await supabase.from('players').update({
    damage_points: dp,
    updated_at: new Date().toISOString()
  }).eq('id', uid);
}

async function saveMatch(mode, playerCount, results, duration) {
  if (!supabase) return null;
  const { data: match, error } = await supabase
    .from('match_history').insert({
      mode,
      player_count: playerCount,
      duration_seconds: duration || 0,
      winner_ids: results.winnerIds || [],
      played_at: new Date().toISOString()
    }).select().single();
  if (error || !match) return null;

  if (results.participants) {
    const parts = results.participants.map(p => ({
      match_id: match.id,
      player_id: p.uid,
      kills: p.kills || 0,
      deaths: p.deaths || 0,
      damage: p.damage || 0,
      waves_survived: p.waves || 0,
      dp_earned: p.dpEarned || 0
    }));
    await supabase.from('match_participants').insert(parts);
  }
  return match.id;
}

async function getLeaderboard(limit, mode) {
  if (!supabase) return [];
  let q = supabase.from('players').select('*')
    .order('stars', { ascending: false })
    .limit(limit || 100);
  const { data } = await q;
  return (data || []).map((p, i) => ({
    rank: i + 1,
    uid: p.id,
    name: p.name,
    stars: p.stars,
    matches: p.matches,
    wins: p.wins,
    kills: p.kills,
    deaths: p.deaths,
    best: p.best
  }));
}

module.exports = {
  available, getPlayer, savePlayer, addUpgrade,
  setDamagePoints, saveMatch, getLeaderboard
};
