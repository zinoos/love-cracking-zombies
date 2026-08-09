-- Player profiles (keyed by Firebase UID)
CREATE TABLE players (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT 'Player',
  stars INT NOT NULL DEFAULT 0,
  matches INT NOT NULL DEFAULT 0,
  wins INT NOT NULL DEFAULT 0,
  kills INT NOT NULL DEFAULT 0,
  deaths INT NOT NULL DEFAULT 0,
  best INT NOT NULL DEFAULT 0,
  damage_points INT NOT NULL DEFAULT 500000,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Purchased skill tree upgrades
CREATE TABLE player_upgrades (
  player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  upgrade_id TEXT NOT NULL,
  purchased_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (player_id, upgrade_id)
);

-- Match history (co-op + PvP)
CREATE TABLE match_history (
  id BIGSERIAL PRIMARY KEY,
  mode TEXT NOT NULL,
  player_count INT NOT NULL,
  winner_ids TEXT[] DEFAULT '{}',
  duration_seconds INT NOT NULL DEFAULT 0,
  played_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Per-player match stats
CREATE TABLE match_participants (
  match_id BIGINT NOT NULL REFERENCES match_history(id) ON DELETE CASCADE,
  player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  kills INT NOT NULL DEFAULT 0,
  deaths INT NOT NULL DEFAULT 0,
  damage INT NOT NULL DEFAULT 0,
  waves_survived INT NOT NULL DEFAULT 0,
  dp_earned INT NOT NULL DEFAULT 0,
  PRIMARY KEY (match_id, player_id)
);

-- RLS: players can only read their own profile
ALTER TABLE players ENABLE ROW LEVEL SECURITY;
CREATE POLICY players_self ON players
  FOR ALL USING (auth.uid()::text = id);

ALTER TABLE player_upgrades ENABLE ROW LEVEL SECURITY;
CREATE POLICY upgrades_self ON player_upgrades
  FOR ALL USING (auth.uid()::text = player_id);

ALTER TABLE match_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY matches_read_all ON match_history
  FOR SELECT USING (true);

ALTER TABLE match_participants ENABLE ROW LEVEL SECURITY;
CREATE POLICY participants_read_all ON match_participants
  FOR SELECT USING (true);
