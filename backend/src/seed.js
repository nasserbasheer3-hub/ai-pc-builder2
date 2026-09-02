import { db, migrate } from './db.js';
import { config } from './config.js';
import bcrypt from 'bcryptjs';
import { pathToFileURL } from 'node:url';
import { ensureFreePlan, ensureBillingDefaults } from './services/credits.js';
import {
  dataSources, cpus, gpus, motherboards, memoryModules, storageDevices, psus,
  cases, coolers, games, achievements, benchmarks, gameSettings, compatibilityRules,
} from './seed-data.js';

function getOrInsertSource(name) {
  let row = db.prepare('SELECT id FROM data_sources WHERE name = ?').get(name);
  if (!row) {
    const src = dataSources.find((s) => s.name === name);
    row = db.prepare(`
      INSERT INTO data_sources (name, url, category, description, verified, last_verified_at)
      VALUES (@name, @url, @category, @description, @verified, @last_verified_at)
    `).run(src || { name, verified: 0 }).lastInsertRowid;
    return { id: row };
  }
  return row;
}

function seedGames() {
  // Additive: preserve existing game IDs (profiles, user_games, sessions and
  // performance records reference them). Only insert games not present by slug.
  const insertGame = db.prepare(`
    INSERT INTO games (name, slug, genre, publisher, release_year, description, cover_color, enabled)
    VALUES (@name, @slug, @genre, @publisher, @release_year, @description, @cover_color, 1)
  `);
  const gameExists = db.prepare('SELECT id FROM games WHERE slug = ?');
  let added = 0;
  for (const g of games) {
    if (gameExists.get(g.slug)) continue;
    insertGame.run(g);
    added++;
  }
  if (added > 0) console.log(`  games added: ${added}`);

  const gameBySlug = db.prepare('SELECT id FROM games WHERE slug = ?');
  const benchExists = db.prepare(`
    SELECT 1 FROM benchmarks WHERE game_id=? AND gpu_id=? AND cpu_id=? AND resolution=? AND quality=?
  `);
  const insertBs = db.prepare(`
    INSERT INTO benchmarks (game_id, cpu_id, gpu_id, resolution, quality, rt_enabled, upscaling, avg_fps, pct1_low, source_id, benchmark_date, notes, verified)
    VALUES (@game_id, @cpu_id, @gpu_id, @resolution, @quality, 0, 'None', @avg, @low, @source_id, @date, 'Approximate aggregate of public review results; varies by system.', 1)
  `);
  const gpuByName = db.prepare('SELECT id FROM gpus WHERE name = ?');
  const cpuByName = db.prepare('SELECT id FROM cpus WHERE name = ?');
  const srcB = getOrInsertSource('Aggregated public GPU review benchmarks');
  const srcS = getOrInsertSource('Official in-game settings verification');
  let addedBench = 0;
  for (const b of benchmarks) {
    const game = gameBySlug.get(b.gameSlug);
    const gpu = gpuByName.get(b.gpuName);
    const cpu = cpuByName.get(b.cpuName);
    if (!game || !gpu) {
      console.warn('  skip benchmark missing ref:', b.gameSlug, b.gpuName);
      continue;
    }
    const cpuId = cpu ? cpu.id : null;
    if (benchExists.get(game.id, gpu.id, cpuId, b.res, b.quality)) continue;
    insertBs.run({
      game_id: game.id, cpu_id: cpuId, gpu_id: gpu.id,
      resolution: b.res, quality: b.quality, avg: b.avg, low: b.low,
      source_id: srcB.id, date: b.date,
    });
    addedBench++;
  }

  const settingsExists = db.prepare('SELECT 1 FROM game_settings WHERE game_id=? AND settings_key=?');
  const insertGs = db.prepare(`
    INSERT INTO game_settings (game_id, settings_key, description, target_fps, settings_json, source_id, verified)
    VALUES (@game_id, @settings_key, @description, @target_fps, @settings_json, @source_id, 1)
  `);
  let addedSettings = 0;
  for (const gs of gameSettings) {
    const game = gameBySlug.get(gs.gameSlug);
    if (!game) continue;
    if (settingsExists.get(game.id, gs.key)) continue;
    insertGs.run({
      game_id: game.id,
      settings_key: gs.key,
      description: gs.description,
      target_fps: gs.target_fps,
      settings_json: JSON.stringify(gs.settings),
      source_id: srcS.id,
    });
    addedSettings++;
  }
  console.log(`  games: ${games.length}, benchmarks added: ${addedBench}, settings added: ${addedSettings}`);
}

function seedHardware() {
  const srcHwGpu = getOrInsertSource('TechPowerUp GPU Database & Relative Performance');
  const srcHwCpu = getOrInsertSource('TechPowerUp CPU Database');
  const srcMfg = getOrInsertSource('Manufacturer specification sheets');
  const srcPrice = getOrInsertSource('Aggregate street price tracking');

  const insertCpu = db.prepare(`
    INSERT INTO cpus (name, brand, socket, cores, threads, base_clock_ghz, boost_clock_ghz, tdp_watts, performance_index, integrated_graphics, price_usd, price_eur, price_gbp, price_date, release_year, notes, source_id, enabled)
    VALUES (@name, @brand, @socket, @cores, @threads, @base_clock_ghz, @boost_clock_ghz, @tdp_watts, @performance_index, @integrated_graphics, @price_usd, @price_eur, @price_gbp, '2025-06-15', @release_year, @notes, @src, 1)
  `);
  const insertGpu = db.prepare(`
    INSERT INTO gpus (name, brand, chipset, vram_gb, length_mm, slot_width, power_connectors, tdp_watts, performance_index, pcie_version, supports_upscaling, price_usd, price_eur, price_gbp, price_date, release_year, notes, source_id, enabled)
    VALUES (@name, @brand, @chipset, @vram_gb, @length_mm, @slot_width, @power_connectors, @tdp_watts, @performance_index, @pcie_version, @supports_upscaling, @price_usd, @price_eur, @price_gbp, '2025-06-15', @release_year, @notes, @src, 1)
  `);
  const insertMb = db.prepare(`
    INSERT INTO motherboards (name, brand, socket, chipset, ram_type, ram_slots, max_ram_gb, max_ram_speed_mhz, form_factor, m2_slots, pcie_version, bios_notes, price_usd, price_eur, price_gbp, price_date, release_year, source_id, enabled)
    VALUES (@name, @brand, @socket, @chipset, @ram_type, @ram_slots, @max_ram_gb, @max_ram_speed_mhz, @form_factor, @m2_slots, @pcie_version, @bios_notes, @price_usd, @price_eur, @price_gbp, '2025-06-15', @release_year, @src, 1)
  `);
  const insertRam = db.prepare(`
    INSERT INTO memory_modules (name, brand, type, capacity_gb, speed_mhz, modules, price_usd, price_eur, price_gbp, price_date, source_id, enabled)
    VALUES (@name, @brand, @type, @capacity_gb, @speed_mhz, @modules, @price_usd, @price_eur, @price_gbp, '2025-06-15', @src, 1)
  `);
  const insertSto = db.prepare(`
    INSERT INTO storage (name, brand, interface, form_factor, capacity_gb, read_mbps, price_usd, price_eur, price_gbp, price_date, source_id, enabled)
    VALUES (@name, @brand, @interface, @form_factor, @capacity_gb, @read_mbps, @price_usd, @price_eur, @price_gbp, '2025-06-15', @src, 1)
  `);
  const insertPsu = db.prepare(`
    INSERT INTO psus (name, brand, wattage, efficiency_rating, modular, pcie_connectors_8pin, eps_connectors, has_12vhpwr, price_usd, price_eur, price_gbp, price_date, source_id, enabled)
    VALUES (@name, @brand, @wattage, @efficiency_rating, @modular, @pcie_connectors_8pin, @eps_connectors, @has_12vhpwr, @price_usd, @price_eur, @price_gbp, '2025-06-15', @src, 1)
  `);
  const insertCase = db.prepare(`
    INSERT INTO cases (name, brand, form_factors, max_gpu_length_mm, max_cooler_height_mm, radiator_support, price_usd, price_eur, price_gbp, price_date, source_id, enabled)
    VALUES (@name, @brand, @form_factors, @max_gpu_length_mm, @max_cooler_height_mm, @radiator_support, @price_usd, @price_eur, @price_gbp, '2025-06-15', @src, 1)
  `);
  const insertCooler = db.prepare(`
    INSERT INTO coolers (name, brand, type, socket_support, height_mm, radiator_size_mm, price_usd, price_eur, price_gbp, price_date, source_id, enabled)
    VALUES (@name, @brand, @type, @socket_support, @height_mm, @radiator_size_mm, @price_usd, @price_eur, @price_gbp, '2025-06-15', @src, 1)
  `);

  // Idempotent: insert only products that are not already present (by name).
  // This preserves existing IDs (profiles/pc_builds reference them) and lets
  // re-running the seed add new catalog items without duplicating.
  const existsByName = (table) => (name) => !!db.prepare(`SELECT 1 FROM ${table} WHERE name = ?`).get(name);
  const notExisting = (table) => (item) => !existsByName(table)(item.name);
  const runMany = (table, stmt) => (items) => {
    let added = 0;
    for (const item of items.filter(notExisting(table))) {
      stmt.run(item);
      added++;
    }
    return added;
  };
  const addCpu = runMany('cpus', insertCpu);
  const addGpu = runMany('gpus', insertGpu);
  const addMb = runMany('motherboards', insertMb);
  const addRam = runMany('memory_modules', insertRam);
  const addSto = runMany('storage', insertSto);
  const addPsu = runMany('psus', insertPsu);
  const addCase = runMany('cases', insertCase);
  const addCooler = runMany('coolers', insertCooler);

  let total = 0;
  total += addCpu(cpus.map((c) => ({ ...c, src: srcHwCpu.id })));
  total += addGpu(gpus.map((g) => ({ ...g, src: srcHwGpu.id, power_connectors: JSON.stringify(g.power_connectors), supports_upscaling: JSON.stringify(g.supports_upscaling) })));
  total += addMb(motherboards.map((m) => ({ ...m, src: srcMfg.id })));
  total += addRam(memoryModules.map((r) => ({ ...r, src: srcMfg.id })));
  total += addSto(storageDevices.map((s) => ({ ...s, src: srcMfg.id })));
  total += addPsu(psus.map((p) => ({ ...p, src: srcMfg.id })));
  total += addCase(cases.map((c) => ({ ...c, src: srcMfg.id, form_factors: JSON.stringify(c.form_factors), radiator_support: JSON.stringify(c.radiator_support) })));
  total += addCooler(coolers.map((c) => ({ ...c, src: srcMfg.id, socket_support: JSON.stringify(c.socket_support) })));
  console.log(`  hardware seeded: ${total} new rows added`);

  // LGA1851 (Intel Core Ultra 200S) uses the same mounting hole pattern as
  // LGA1700, so coolers that already support LGA1700 are upgraded to also list
  // LGA1851. Applies to pre-existing rows too (reseeding is additive by name).
  const addLga1851 = db.prepare('UPDATE coolers SET socket_support = ? WHERE id = ?');
  let migrated = 0;
  for (const c of db.prepare('SELECT id, socket_support FROM coolers').all()) {
    let sup = [];
    try { sup = JSON.parse(c.socket_support); } catch { /* keep empty */ }
    if (sup.includes('LGA1700') && !sup.includes('LGA1851')) {
      sup.push('LGA1851');
      addLga1851.run(JSON.stringify(sup), c.id);
      migrated++;
    }
  }
  if (migrated > 0) console.log(`  coolers upgraded to list LGA1851: ${migrated}`);
}

function seedRules() {
  // Additive seeding: preserve admin edits (create/delete/disable). Only insert
  // a seed rule when its (rule_type, subject) pair is not already present.
  const ins = db.prepare(`
    INSERT INTO compatibility_rules (rule_type, subject, allowed_values, severity, note)
    VALUES (@rule_type, @subject, @allowed_values, @severity, @note)
  `);
  const find = db.prepare('SELECT id FROM compatibility_rules WHERE rule_type = ? AND subject = ?');
  let added = 0;
  for (const r of compatibilityRules) {
    if (find.get(r.rule_type, r.subject)) continue;
    ins.run({ ...r, allowed_values: JSON.stringify(r.allowed_values) });
    added++;
  }
  // One-time migration: pre-refactor seeds used 'PCIe 4.0' as the pcie_version
  // subject; it is superseded by 'info'. Remove the stale row if still present.
  db.prepare("DELETE FROM compatibility_rules WHERE rule_type = 'pcie_version' AND subject = 'PCIe 4.0'").run();
  console.log(`  compatibility rules: ${compatibilityRules.length} defined, ${added} added`);
}

function seedAchievements() {
  const exists = db.prepare('SELECT COUNT(*) c FROM achievements').get();
  if (exists.c > 0) return;
  const ins = db.prepare(`
    INSERT INTO achievements (code, name, description, icon, tier)
    VALUES (@code, @name, @description, @icon, @tier)
  `);
  for (const a of achievements) ins.run(a);
  console.log(`  achievements: ${achievements.length}`);
}

function seedAdmin() {
  const exists = db.prepare('SELECT id FROM admin_users WHERE email = ?').get(config.admin.email);
  if (!exists) {
    const hash = bcrypt.hashSync(config.admin.password, 10);
    db.prepare('INSERT INTO admin_users (email, password_hash, role, status) VALUES (?, ?, ?, ?)')
      .run(config.admin.email, hash, 'superadmin', 'active');
    console.log(`  admin created: ${config.admin.email}`);
  } else {
    console.log('  admin already exists');
  }
}

function seedAdminSettings() {
  const defaults = {
    ai_enabled: JSON.stringify(config.ai.apiKey ? 1 : 0),
    ai_model: config.ai.model,
    ai_temperature: '0.6',
    ai_max_tokens: '900',
    ai_advice_prompt: [
      'You are a professional gaming performance coach. Analyze the provided player data.',
      'Give concise personalized advice: strengths, weaknesses, practice suggestions, performance trends and gaming habits.',
      'Never invent numbers. Clearly label information as Verified data, User-provided data, Estimate or Recommendation.',
    ].join('\n'),
    ai_weekly_prompt: [
      'You are a professional gaming performance analyst. Produce a weekly report from the provided metrics.',
      'Cover: gaming time, sessions, performance trends, win-rate changes, strengths, weaknesses, improvement areas.',
      'Compare with the previous week when data exists. Never invent metrics not present in the data.',
    ].join('\n'),
    ai_builder_prompt: [
      'You are a PC building expert. Explain the recommended components for the given build.',
      'Explain each part choice relative to budget, target games, resolution and target FPS.',
      'Use only the facts provided by the compatibility and performance engines. Never invent specifications.',
    ].join('\n'),
  };
  const upsert = db.prepare('INSERT INTO admin_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
  for (const [k, v] of Object.entries(defaults)) upsert.run(k, v);

  const billingDefaults = {
    free_signup_credits: '25',
    credit_cost_chat: '2',
    credit_cost_advice: '3',
    credit_cost_weekly_report: '8',
    credit_cost_session_coach: '5',
    credit_cost_game_coach: '5',
    credit_cost_plan: '10',
    credit_cost_ai_builder_prompt: '4',
    credit_cost_default: '3',
    payment_demo: '1',
    swish_number: '123 456 78 90',
    payment_methods: 'card,swish,klarna',
  };
  const insertIgnore = db.prepare('INSERT INTO admin_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING');
  for (const [k, v] of Object.entries(billingDefaults)) insertIgnore.run(k, v);
}

function seedPlans() {
  ensureBillingDefaults();
}

function seedDemoUsers() {
  const exists = db.prepare('SELECT id FROM users WHERE email = ?').get('player@demo.local');
  if (exists) { console.log('  demo users already exist'); return; }

  const mkUser = db.prepare(`
    INSERT INTO users (username, email, password_hash, email_verified, created_at) VALUES (?, ?, ?, 1, datetime('now', ?))
  `);
  const mkProfile = db.prepare(`
    INSERT INTO profiles (user_id, display_name, rank, bio, gaming_goals, cpu_id, gpu_id, ram_id, storage_id, monitor_resolution, refresh_rate, performance_preference, language, currency, onboarded, main_game_id)
    VALUES (@user_id, @display_name, @rank, @bio, @gaming_goals, @cpu_id, @gpu_id, @ram_id, @storage_id, @monitor_resolution, @refresh_rate, @performance_preference, 'en', @currency, 1, @main_game_id)
  `);
  const hash = bcrypt.hashSync('Demo12345!', 10);

  const cs2 = db.prepare('SELECT id FROM games WHERE slug = ?').get('counter-strike-2');
  const valorant = db.prepare('SELECT id FROM games WHERE slug = ?').get('valorant');
  const apex = db.prepare('SELECT id FROM games WHERE slug = ?').get('apex-legends');
  const cp2077 = db.prepare('SELECT id FROM games WHERE slug = ?').get('cyberpunk-2077');
  const cpuId = db.prepare('SELECT id FROM cpus WHERE name LIKE ?').get('%7800X3D%').id;
  const gpuId = db.prepare('SELECT id FROM gpus WHERE name LIKE ?').get('%4070 Super%').id;
  const ramId = db.prepare('SELECT id FROM memory_modules WHERE name LIKE ?').get('%Trident Z5 Neo%').id;
  const stoId = db.prepare('SELECT id FROM storage WHERE name LIKE ?').get('%990 Pro 2TB%').id;

  const mkUserGames = db.prepare('INSERT INTO user_games (user_id, game_id, is_main, rank, hours) VALUES (?, ?, ?, ?, ?)');
  const mkSession = db.prepare(`
    INSERT INTO gaming_sessions (user_id, game_id, started_at, ended_at, duration_minutes, note, status)
    VALUES (?, ?, ?, ?, ?, ?, 'ended')
  `);
  const mkPerf = db.prepare(`
    INSERT INTO performance_records (user_id, session_id, game_id, record_date, wins, losses, kills, deaths, assists, matches, hours)
    VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const mkStreak = db.prepare('INSERT INTO streaks (user_id, current_streak, best_streak, last_activity_date, best_end_date) VALUES (?, ?, ?, ?, ?)');

  const users = [
    { username: 'nova', email: 'player@demo.local', display: 'Nova', currency: 'USD', rank: 'Gold II' },
    { username: 'raze', email: 'raze@demo.local', display: 'Raze', currency: 'EUR', rank: 'Platinum I' },
    { username: 'volt', email: 'volt@demo.local', display: 'Volt', currency: 'USD', rank: 'Silver III' },
  ];
  const userIds = {};
  for (const u of users) {
    const uid = mkUser.run(u.username, u.email, hash, `-${users.indexOf(u) * 3} days`).lastInsertRowid;
    userIds[u.username] = uid;
    mkProfile.run({
      user_id: uid, display_name: u.display, rank: u.rank,
      bio: 'Competitive player focused on consistency.',
      gaming_goals: 'Reach Immortal by end of season, maintain 55%+ win rate.',
      cpu_id: cpuId, gpu_id: gpuId, ram_id: ramId, storage_id: stoId,
      monitor_resolution: '1440p', refresh_rate: 240,
      performance_preference: 'performance', currency: u.currency, main_game_id: cs2.id,
    });
    mkUserGames.run(uid, cs2.id, 1, u.rank, 320);
    mkUserGames.run(uid, valorant.id, 0, null, 140);
    mkUserGames.run(uid, apex.id, 0, null, 60);
    if (u.username === 'nova') mkUserGames.run(uid, cp2077.id, 0, null, 80);
  }

  // nova: sessions + performance for last 10 days (streak of 7)
  const nova = userIds.nova;
  for (let d = 9; d >= 0; d--) {
    const date = new Date(Date.now() - d * 86400000);
    const dayStart = `${date.toISOString().slice(0, 10)}T18:30:00Z`;
    const mins = 45 + Math.floor(Math.random() * 75);
    const session = mkSession.run(nova, cs2.id, dayStart, new Date(new Date(dayStart).getTime() + mins * 60000).toISOString(), mins, d % 2 ? 'Focused aim practice.' : 'Ranked grind.').lastInsertRowid;
    const w = 2 + (d % 3);
    const l = 4 - (d % 3) - (d % 2 ? 1 : 0);
    const kills = 14 + Math.floor(Math.random() * 14);
    const deaths = Math.max(8, kills - 5 - Math.floor(Math.random() * 6));
    mkPerf.run(nova, cs2.id, date.toISOString().slice(0, 10), w, l, kills, deaths, 5, w + l, 1.4);
  }
  mkStreak.run(nova, 7, 7, new Date().toISOString().slice(0, 10), new Date().toISOString().slice(0, 10));
  // raze/volt a few days of data
  for (const [u, days] of [['raze', 5], ['volt', 3]]) {
    const uid = userIds[u];
    for (let d = days - 1; d >= 0; d--) {
      const date = new Date(Date.now() - d * 86400000);
      const mins = 40 + Math.floor(Math.random() * 60);
      mkSession.run(uid, cs2.id, `${date.toISOString().slice(0, 10)}T19:00:00Z`, new Date(new Date(`${date.toISOString().slice(0, 10)}T19:00:00Z`).getTime() + mins * 60000).toISOString(), mins, null);
      const w = 1 + (d % 3);
      const l = 3 - (d % 3);
      mkPerf.run(uid, cs2.id, date.toISOString().slice(0, 10), w, l, 10 + d * 2, 9 + d, 4, w + l, 1);
    }
  }
  for (const uid of Object.values(userIds)) ensureFreePlan(uid);
  console.log('  demo users created: player@demo.local / Demo12345! (+ raze, volt)');
}

export function seed() {
  console.log('Seeding database...');
  migrate();
  db.transaction(() => {
    seedHardware();
    seedGames();
    seedRules();
    seedAchievements();
    seedAdmin();
    seedAdminSettings();
    ensureBillingDefaults();
    seedDemoUsers();
  })();
  console.log('Seed complete.');
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  seed();
}
