import Database from 'better-sqlite3';
import { config } from './config.js';

export const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export function run(sql, ...params) {
  return db.prepare(sql).run(...params);
}
export function get(sql, ...params) {
  return db.prepare(sql).get(...params);
}
export function all(sql, ...params) {
  return db.prepare(sql).all(...params);
}

export function migrate() {
  db.transaction(() => {
    db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',        -- active | suspended
      email_verified INTEGER NOT NULL DEFAULT 0,
      last_login_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS profiles (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      display_name TEXT,
      avatar TEXT,
      bio TEXT,
      rank TEXT,
      gaming_goals TEXT,
      main_game_id INTEGER REFERENCES games(id) ON DELETE SET NULL,
      cpu_id INTEGER REFERENCES cpus(id) ON DELETE SET NULL,
      gpu_id INTEGER REFERENCES gpus(id) ON DELETE SET NULL,
      ram_id INTEGER REFERENCES memory_modules(id) ON DELETE SET NULL,
      storage_id INTEGER REFERENCES storage(id) ON DELETE SET NULL,
      monitor_resolution TEXT,
      refresh_rate INTEGER,
      performance_preference TEXT,                   -- quality | balanced | performance
      language TEXT DEFAULT 'en',
      currency TEXT DEFAULT 'USD',
      privacy_winrate INTEGER NOT NULL DEFAULT 1,    -- allow friends to see
      privacy_kd INTEGER NOT NULL DEFAULT 1,
      privacy_gametime INTEGER NOT NULL DEFAULT 1,
      privacy_compare INTEGER NOT NULL DEFAULT 1,    -- allow comparison
      notifications_enabled INTEGER NOT NULL DEFAULT 1,
      onboarded INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS games (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      genre TEXT,
      publisher TEXT,
      release_year INTEGER,
      description TEXT,
      cover_color TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      source_id INTEGER REFERENCES data_sources(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS user_games (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
      is_main INTEGER NOT NULL DEFAULT 0,
      rank TEXT,
      hours REAL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, game_id)
    );

    CREATE TABLE IF NOT EXISTS gaming_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      game_id INTEGER REFERENCES games(id) ON DELETE SET NULL,
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      ended_at TEXT,
      duration_minutes INTEGER,
      note TEXT,
      status TEXT NOT NULL DEFAULT 'active',          -- active | ended
      performance_summary TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON gaming_sessions(user_id, started_at);
    CREATE INDEX IF NOT EXISTS idx_sessions_active ON gaming_sessions(user_id, status);

    CREATE TABLE IF NOT EXISTS performance_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      session_id INTEGER REFERENCES gaming_sessions(id) ON DELETE SET NULL,
      game_id INTEGER REFERENCES games(id) ON DELETE SET NULL,
      record_date TEXT NOT NULL,                      -- YYYY-MM-DD
      wins INTEGER NOT NULL DEFAULT 0,
      losses INTEGER NOT NULL DEFAULT 0,
      kills INTEGER NOT NULL DEFAULT 0,
      deaths INTEGER NOT NULL DEFAULT 0,
      assists INTEGER NOT NULL DEFAULT 0,
      matches INTEGER NOT NULL DEFAULT 0,
      hours REAL,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, record_date, game_id)
    );
    CREATE INDEX IF NOT EXISTS idx_perf_user ON performance_records(user_id, record_date);

    CREATE TABLE IF NOT EXISTS friends (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      friend_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, friend_id)
    );

    CREATE TABLE IF NOT EXISTS friend_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      receiver_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'pending',          -- pending | accepted | declined
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      responded_at TEXT
    );

    CREATE TABLE IF NOT EXISTS achievements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      icon TEXT,
      tier TEXT NOT NULL DEFAULT 'bronze',             -- bronze | silver | gold | diamond
      criteria_json TEXT
    );

    CREATE TABLE IF NOT EXISTS user_achievements (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      achievement_id INTEGER NOT NULL REFERENCES achievements(id) ON DELETE CASCADE,
      earned_at TEXT NOT NULL DEFAULT (datetime('now')),
      progress REAL DEFAULT 0,
      PRIMARY KEY (user_id, achievement_id)
    );

    CREATE TABLE IF NOT EXISTS streaks (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      current_streak INTEGER NOT NULL DEFAULT 0,
      best_streak INTEGER NOT NULL DEFAULT 0,
      last_activity_date TEXT,
      best_end_date TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS weekly_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      week_start TEXT NOT NULL,
      week_end TEXT NOT NULL,
      metrics_json TEXT NOT NULL,
      comparison_json TEXT,
      engine_summary TEXT,
      ai_summary TEXT,
      status TEXT NOT NULL DEFAULT 'ready',
      generated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, week_start)
    );
    CREATE INDEX IF NOT EXISTS idx_weekly_user ON weekly_reports(user_id, week_start);

    -- Hardware ---------------------------------------------------------
    CREATE TABLE IF NOT EXISTS cpus (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      brand TEXT,
      socket TEXT,
      cores INTEGER,
      threads INTEGER,
      base_clock_ghz REAL,
      boost_clock_ghz REAL,
      tdp_watts INTEGER,
      performance_index REAL,
      integrated_graphics TEXT,
      price_usd REAL, price_eur REAL, price_gbp REAL,
      price_date TEXT,
      release_year INTEGER,
      notes TEXT,
      source_id INTEGER REFERENCES data_sources(id) ON DELETE SET NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_cpus_enabled ON cpus(enabled);

    CREATE TABLE IF NOT EXISTS gpus (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      brand TEXT,
      chipset TEXT,
      vram_gb INTEGER,
      length_mm INTEGER,
      slot_width INTEGER,
      power_connectors TEXT,
      tdp_watts INTEGER,
      performance_index REAL,
      pcie_version TEXT,
      supports_upscaling TEXT,                        -- json array
      price_usd REAL, price_eur REAL, price_gbp REAL,
      price_date TEXT,
      release_year INTEGER,
      notes TEXT,
      source_id INTEGER REFERENCES data_sources(id) ON DELETE SET NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_gpus_enabled ON gpus(enabled);

    CREATE TABLE IF NOT EXISTS motherboards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      brand TEXT,
      socket TEXT,
      chipset TEXT,
      ram_type TEXT,                                  -- DDR4 | DDR5
      ram_slots INTEGER,
      max_ram_gb INTEGER,
      max_ram_speed_mhz INTEGER,
      form_factor TEXT,                               -- ATX | microATX | mini-ITX ...
      m2_slots INTEGER,
      pcie_version TEXT,
      bios_notes TEXT,
      price_usd REAL, price_eur REAL, price_gbp REAL,
      price_date TEXT,
      release_year INTEGER,
      source_id INTEGER REFERENCES data_sources(id) ON DELETE SET NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_mb_enabled ON motherboards(enabled);

    CREATE TABLE IF NOT EXISTS memory_modules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      brand TEXT,
      type TEXT,                                      -- DDR4 | DDR5
      capacity_gb INTEGER,
      speed_mhz INTEGER,
      modules INTEGER NOT NULL DEFAULT 2,
      price_usd REAL, price_eur REAL, price_gbp REAL,
      price_date TEXT,
      source_id INTEGER REFERENCES data_sources(id) ON DELETE SET NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_ram_enabled ON memory_modules(enabled);

    CREATE TABLE IF NOT EXISTS storage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      brand TEXT,
      interface TEXT,                                 -- NVMe PCIe 4.0 | SATA III ...
      form_factor TEXT,                               -- M.2 2280 | 2.5"
      capacity_gb INTEGER,
      read_mbps INTEGER,
      price_usd REAL, price_eur REAL, price_gbp REAL,
      price_date TEXT,
      source_id INTEGER REFERENCES data_sources(id) ON DELETE SET NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_storage_enabled ON storage(enabled);

    CREATE TABLE IF NOT EXISTS psus (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      brand TEXT,
      wattage INTEGER,
      efficiency_rating TEXT,
      modular TEXT,
      pcie_connectors_8pin INTEGER,
      eps_connectors INTEGER,
      has_12vhpwr INTEGER NOT NULL DEFAULT 0,
      price_usd REAL, price_eur REAL, price_gbp REAL,
      price_date TEXT,
      source_id INTEGER REFERENCES data_sources(id) ON DELETE SET NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_psu_enabled ON psus(enabled);

    CREATE TABLE IF NOT EXISTS cases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      brand TEXT,
      form_factors TEXT,                              -- json array supported
      max_gpu_length_mm INTEGER,
      max_cooler_height_mm INTEGER,
      radiator_support TEXT,                          -- json
      price_usd REAL, price_eur REAL, price_gbp REAL,
      price_date TEXT,
      source_id INTEGER REFERENCES data_sources(id) ON DELETE SET NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_cases_enabled ON cases(enabled);

    CREATE TABLE IF NOT EXISTS coolers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      brand TEXT,
      type TEXT,                                      -- air | liquid
      socket_support TEXT,                            -- json array
      height_mm INTEGER,
      radiator_size_mm INTEGER,
      price_usd REAL, price_eur REAL, price_gbp REAL,
      price_date TEXT,
      source_id INTEGER REFERENCES data_sources(id) ON DELETE SET NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_coolers_enabled ON coolers(enabled);

    -- Compatibility ----------------------------------------------------
    CREATE TABLE IF NOT EXISTS compatibility_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      rule_type TEXT NOT NULL,                        -- cpu_socket | ram_type | motherboard_case | psu_wattage | cooler_socket | storage_interface | pcie_version
      subject TEXT NOT NULL,                          -- e.g. socket name or a category
      allowed_values TEXT NOT NULL,                   -- json array of compatible values
      severity TEXT NOT NULL DEFAULT 'error',         -- error | warn | info
      note TEXT,
      source_id INTEGER REFERENCES data_sources(id) ON DELETE SET NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Benchmarks -------------------------------------------------------
    CREATE TABLE IF NOT EXISTS benchmarks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
      cpu_id INTEGER REFERENCES cpus(id) ON DELETE CASCADE,
      gpu_id INTEGER NOT NULL REFERENCES gpus(id) ON DELETE CASCADE,
      resolution TEXT NOT NULL,
      quality TEXT NOT NULL,                          -- Low | Medium | High | Ultra
      rt_enabled INTEGER NOT NULL DEFAULT 0,
      upscaling TEXT,                                 -- None | DLSS | FSR | XeSS
      avg_fps REAL NOT NULL,
      pct1_low REAL,
      source_id INTEGER REFERENCES data_sources(id) ON DELETE SET NULL,
      benchmark_date TEXT,
      notes TEXT,
      verified INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(game_id, cpu_id, gpu_id, resolution, quality, rt_enabled, upscaling)
    );
    CREATE INDEX IF NOT EXISTS idx_bench_game ON benchmarks(game_id, gpu_id);

    -- Game settings (verified recommended in-game settings) -----------
    CREATE TABLE IF NOT EXISTS game_settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
      settings_key TEXT NOT NULL,                     -- label e.g. 'competitive' | 'balanced' | 'quality'
      description TEXT,
      target_fps INTEGER,
      settings_json TEXT NOT NULL,                    -- { "setting_name": "value", ... }
      notes TEXT,
      source_id INTEGER REFERENCES data_sources(id) ON DELETE SET NULL,
      verified INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(game_id, settings_key)
    );

    -- PC builds --------------------------------------------------------
    CREATE TABLE IF NOT EXISTS pc_builds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      budget REAL,
      currency TEXT,
      games TEXT,                                     -- json
      resolution TEXT,
      target_fps INTEGER,
      config_json TEXT NOT NULL,                      -- selected parts
      total_price REAL,
      expected_fps TEXT,                              -- json
      engine_reasoning TEXT,
      ai_summary TEXT,
      status TEXT NOT NULL DEFAULT 'draft',           -- draft | saved
      name TEXT,                                      -- user-facing PC name (My PC profile)
      category TEXT NOT NULL DEFAULT 'gaming',        -- gaming | work | future | other
      share_slug TEXT,                                -- public shareable link token
      is_active INTEGER NOT NULL DEFAULT 0            -- the user's active ("main") PC
    );

    -- Personal upgrade history -------------------------------------------
    CREATE TABLE IF NOT EXISTS upgrade_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      pc_id INTEGER REFERENCES pc_builds(id) ON DELETE SET NULL,
      part_type TEXT NOT NULL,                        -- cpu | gpu | ram | storage | motherboard | psu | case | cooler
      from_part_id INTEGER,
      to_part_id INTEGER,
      from_part_name TEXT,
      to_part_name TEXT,
      note TEXT,
      upgraded_at TEXT NOT NULL,                      -- user-entered date (YYYY-MM-DD)
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_upgrades_user ON upgrade_history(user_id, upgraded_at DESC);

    -- Part wishlist ------------------------------------------------------
    CREATE TABLE IF NOT EXISTS wishlist (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      part_type TEXT NOT NULL,                        -- cpu | gpu | ram | storage | motherboard | psu | case | cooler
      part_id INTEGER NOT NULL,
      note TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, part_type, part_id)
    );
    CREATE INDEX IF NOT EXISTS idx_wishlist_user ON wishlist(user_id, created_at DESC);

    -- AI requests ------------------------------------------------------
    CREATE TABLE IF NOT EXISTS ai_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      feature TEXT,
      model TEXT,
      prompt_tokens INTEGER DEFAULT 0,
      completion_tokens INTEGER DEFAULT 0,
      duration_ms INTEGER DEFAULT 0,
      success INTEGER DEFAULT 0,
      error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS ai_plans (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      focus TEXT,
      plan_text TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS user_steam (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      steam_id TEXT NOT NULL,
      profile_name TEXT,
      avatar_hash TEXT,
      profile_url TEXT,
      is_public INTEGER NOT NULL DEFAULT 0,
      imported_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_sync_at TEXT
    );

    CREATE TABLE IF NOT EXISTS steam_library (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      appid INTEGER NOT NULL,
      name TEXT NOT NULL,
      playtime_forever_minutes INTEGER NOT NULL DEFAULT 0,
      playtime_2weeks_minutes INTEGER NOT NULL DEFAULT 0,
      last_played_at TEXT,
      icon_url TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, appid)
    );
    CREATE INDEX IF NOT EXISTS idx_steam_library_user ON steam_library(user_id, playtime_forever_minutes DESC);

    -- Data sources -----------------------------------------------------
    CREATE TABLE IF NOT EXISTS data_sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      url TEXT,
      category TEXT,
      description TEXT,
      verified INTEGER NOT NULL DEFAULT 1,
      last_verified_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Admin ------------------------------------------------------------
    CREATE TABLE IF NOT EXISTS admin_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'admin',             -- admin | superadmin
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      admin_user_id INTEGER REFERENCES admin_users(id) ON DELETE SET NULL,
      action TEXT NOT NULL,
      target_type TEXT,
      target_id INTEGER,
      details TEXT,
      ip TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS admin_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Auth tokens ------------------------------------------------------
    CREATE TABLE IF NOT EXISTS auth_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL,
      purpose TEXT NOT NULL,                          -- email_verify | password_reset
      expires_at TEXT NOT NULL,
      used INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_tokens_hash ON auth_tokens(token_hash);

    CREATE TABLE IF NOT EXISTS outbox (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      to_email TEXT NOT NULL,
      subject TEXT NOT NULL,
      body TEXT NOT NULL,
      link TEXT,
      purpose TEXT,
      sent INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS articles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      excerpt TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL DEFAULT '',
      cover_color TEXT,
      tags TEXT NOT NULL DEFAULT '[]',               -- json array
      author_name TEXT NOT NULL DEFAULT 'ApexCore',
      status TEXT NOT NULL DEFAULT 'draft',          -- draft | published
      published_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_articles_status ON articles(status, published_at DESC);

    CREATE TABLE IF NOT EXISTS contact_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      message TEXT NOT NULL,
      ip TEXT,
      is_read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_contact_read ON contact_messages(is_read, created_at DESC);

    CREATE TABLE IF NOT EXISTS plans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      tagline TEXT NOT NULL DEFAULT '',
      price_sek INTEGER NOT NULL DEFAULT 0,
      monthly_credits INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_free INTEGER NOT NULL DEFAULT 0,
      is_featured INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      features_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS credit_wallets (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      balance INTEGER NOT NULL DEFAULT 0,
      lifetime_granted INTEGER NOT NULL DEFAULT 0,
      lifetime_spent INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS credit_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      delta INTEGER NOT NULL,
      balance_after INTEGER NOT NULL,
      reason TEXT NOT NULL,
      feature TEXT,
      ref_type TEXT,
      ref_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_ledger_user ON credit_ledger(user_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      plan_id INTEGER NOT NULL REFERENCES plans(id),
      status TEXT NOT NULL DEFAULT 'active',
      payment_method TEXT,
      payment_ref TEXT,
      current_period_start TEXT,
      current_period_end TEXT,
      cancelled_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_subs_user ON subscriptions(user_id, status);

    CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      subscription_id INTEGER REFERENCES subscriptions(id) ON DELETE SET NULL,
      plan_id INTEGER REFERENCES plans(id),
      amount_sek INTEGER NOT NULL,
      currency TEXT NOT NULL DEFAULT 'SEK',
      method TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      provider_ref TEXT,
      error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      paid_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_payments_user ON payments(user_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS offers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT UNIQUE,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      discount_type TEXT NOT NULL DEFAULT 'percent',
      discount_value INTEGER NOT NULL DEFAULT 0,
      plan_id INTEGER REFERENCES plans(id) ON DELETE SET NULL,
      starts_at TEXT,
      ends_at TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      max_redemptions INTEGER,
      times_redeemed INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS refunds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      payment_id INTEGER NOT NULL REFERENCES payments(id),
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      amount_sek INTEGER NOT NULL,
      reason TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      provider_ref TEXT,
      admin_note TEXT,
      requested_at TEXT NOT NULL DEFAULT (datetime('now')),
      processed_at TEXT,
      processed_by INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_refunds_user ON refunds(user_id, requested_at DESC);

    CREATE TABLE IF NOT EXISTS payouts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      amount_sek INTEGER NOT NULL,
      currency TEXT NOT NULL DEFAULT 'SEK',
      status TEXT NOT NULL DEFAULT 'pending',
      destination TEXT,
      note TEXT,
      provider_ref TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at TEXT,
      created_by INTEGER
    );

    CREATE TABLE IF NOT EXISTS referrals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      referrer_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      referee_user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      code TEXT NOT NULL,
      signup_granted INTEGER NOT NULL DEFAULT 0,
      subscription_granted INTEGER NOT NULL DEFAULT 0,
      subscription_skipped INTEGER NOT NULL DEFAULT 0,
      discount_applied INTEGER NOT NULL DEFAULT 0,
      ip TEXT,
      device_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals(referrer_user_id, created_at);

    CREATE TABLE IF NOT EXISTS user_devices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      device_id TEXT,
      ip TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_devices_device ON user_devices(device_id);
    CREATE INDEX IF NOT EXISTS idx_devices_ip ON user_devices(ip);

    -- Official system requirements per game ----------------------------
    -- Stores the publisher's official minimum / recommended hardware for
    -- each game (CPU, GPU, VRAM, RAM, storage, OS) plus the source URL.
    CREATE TABLE IF NOT EXISTS game_requirements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
      min_cpu TEXT,
      rec_cpu TEXT,
      min_gpu TEXT,
      rec_gpu TEXT,
      min_vram_gb INTEGER,
      rec_vram_gb INTEGER,
      min_ram_gb INTEGER,
      rec_ram_gb INTEGER,
      min_storage_gb INTEGER,
      rec_storage_gb INTEGER,
      min_os TEXT,
      rec_os TEXT,
      source_url TEXT,
      notes TEXT,
      verified INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(game_id)
    );
    CREATE INDEX IF NOT EXISTS idx_game_req_game ON game_requirements(game_id);

    -- Community benchmark results (user-submitted, admin-moderated pool) -
    -- Kept separate from the staff-verified benchmark anchors. A
    -- submission stays user-reported until an admin approves it, and an
    -- approved row is NEVER fed into the fps engine automatically: an
    -- admin must explicitly "promote" it into the benchmarks anchors first.
    CREATE TABLE IF NOT EXISTS community_benchmarks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
      cpu_id INTEGER REFERENCES cpus(id) ON DELETE SET NULL,
      gpu_id INTEGER NOT NULL REFERENCES gpus(id) ON DELETE CASCADE,
      resolution TEXT NOT NULL,                       -- 1080p | 1440p | 4K
      quality TEXT NOT NULL,                          -- Low | Medium | High | Ultra | Epic
      rt_enabled INTEGER NOT NULL DEFAULT 0,
      upscaling TEXT,                                 -- None | DLSS | FSR | XeSS
      avg_fps REAL NOT NULL,
      pct1_low REAL,
      fps_method TEXT NOT NULL,                       -- ingame_benchmark | overlay_counter | manual_counter
      driver_version TEXT,
      notes TEXT,
      agreed_measured INTEGER NOT NULL DEFAULT 0,     -- honesty checkbox: "I ran this myself"
      status TEXT NOT NULL DEFAULT 'pending',         -- pending | approved | hidden | rejected
      review_note TEXT,
      reviewed_by INTEGER REFERENCES admin_users(id) ON DELETE SET NULL,
      reviewed_at TEXT,
      promoted INTEGER NOT NULL DEFAULT 0,
      promoted_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_cbench_user ON community_benchmarks(user_id, status);
    CREATE INDEX IF NOT EXISTS idx_cbench_status ON community_benchmarks(status, game_id);
    CREATE INDEX IF NOT EXISTS idx_cbench_pool ON community_benchmarks(status, resolution, quality);
    `);

    // --- Additive migrations for existing databases ---
    const wrCols = db.prepare('PRAGMA table_info(weekly_reports)').all().map((c) => c.name);
    if (!wrCols.includes('comparison_json')) {
      db.exec('ALTER TABLE weekly_reports ADD COLUMN comparison_json TEXT');
    }
    const payCols = db.prepare('PRAGMA table_info(payments)').all().map((c) => c.name);
    if (!payCols.includes('offer_id')) db.exec('ALTER TABLE payments ADD COLUMN offer_id INTEGER');
    if (!payCols.includes('original_amount_sek')) db.exec('ALTER TABLE payments ADD COLUMN original_amount_sek INTEGER');
    if (!payCols.includes('checkout_session_id')) db.exec('ALTER TABLE payments ADD COLUMN checkout_session_id TEXT');
    const profCols = db.prepare('PRAGMA table_info(profiles)').all().map((c) => c.name);
    if (!profCols.includes('referral_code')) db.exec('ALTER TABLE profiles ADD COLUMN referral_code TEXT');
    if (!profCols.includes('is_public')) db.exec('ALTER TABLE profiles ADD COLUMN is_public INTEGER NOT NULL DEFAULT 0');
    if (!profCols.includes('profile_slug')) db.exec('ALTER TABLE profiles ADD COLUMN profile_slug TEXT');
    const pcCols = db.prepare('PRAGMA table_info(pc_builds)').all().map((c) => c.name);
    if (!pcCols.includes('name')) db.exec('ALTER TABLE pc_builds ADD COLUMN name TEXT');
    if (!pcCols.includes('category')) db.exec("ALTER TABLE pc_builds ADD COLUMN category TEXT NOT NULL DEFAULT 'gaming'");
    if (!pcCols.includes('share_slug')) db.exec('ALTER TABLE pc_builds ADD COLUMN share_slug TEXT');
    if (!pcCols.includes('is_active')) db.exec('ALTER TABLE pc_builds ADD COLUMN is_active INTEGER NOT NULL DEFAULT 0');
    const userCols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
    if (!userCols.includes('utm_source')) db.exec('ALTER TABLE users ADD COLUMN utm_source TEXT');
    if (!userCols.includes('utm_medium')) db.exec('ALTER TABLE users ADD COLUMN utm_medium TEXT');
    if (!userCols.includes('utm_campaign')) db.exec('ALTER TABLE users ADD COLUMN utm_campaign TEXT');
    if (!userCols.includes('utm_term')) db.exec('ALTER TABLE users ADD COLUMN utm_term TEXT');
    const payCols2 = db.prepare('PRAGMA table_info(payments)').all().map((c) => c.name);
    if (!payCols2.includes('referral_id')) db.exec('ALTER TABLE payments ADD COLUMN referral_id INTEGER');
    if (!payCols2.includes('referral_discount')) db.exec('ALTER TABLE payments ADD COLUMN referral_discount INTEGER NOT NULL DEFAULT 0');

    // --- Recurring subscription support (Stripe Subscriptions) --------------
    const subCols = db.prepare('PRAGMA table_info(subscriptions)').all().map((c) => c.name);
    if (!subCols.includes('stripe_subscription_id')) {
      db.exec('ALTER TABLE subscriptions ADD COLUMN stripe_subscription_id TEXT');
      db.exec('CREATE INDEX IF NOT EXISTS idx_subs_stripe ON subscriptions(stripe_subscription_id)');
    }
    if (!subCols.includes('billing_interval')) {
      db.exec("ALTER TABLE subscriptions ADD COLUMN billing_interval TEXT NOT NULL DEFAULT 'month'");
    }
    const payCols3 = db.prepare('PRAGMA table_info(payments)').all().map((c) => c.name);
    if (!payCols3.includes('provider_charge_ref')) db.exec('ALTER TABLE payments ADD COLUMN provider_charge_ref TEXT');
    if (!payCols3.includes('renewal_granted')) db.exec('ALTER TABLE payments ADD COLUMN renewal_granted INTEGER NOT NULL DEFAULT 0');
    if (!payCols3.includes('referral_rewarded')) db.exec('ALTER TABLE payments ADD COLUMN referral_rewarded INTEGER NOT NULL DEFAULT 0');

    // Cache of Stripe recurring Prices we have created per plan/amount so a
    // plan is only ever mirrored into Stripe once per price point.
    db.exec(`
      CREATE TABLE IF NOT EXISTS stripe_prices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        plan_id INTEGER NOT NULL REFERENCES plans(id),
        billing_interval TEXT NOT NULL DEFAULT 'month',
        currency TEXT NOT NULL DEFAULT 'SEK',
        amount_sek INTEGER NOT NULL,
        stripe_price_id TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(plan_id, billing_interval, currency, amount_sek)
      );
    `);
  })();
}

export function now() {
  return new Date().toISOString();
}
