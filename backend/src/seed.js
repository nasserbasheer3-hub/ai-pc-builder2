import { db, migrate } from './db.js';
import { config } from './config.js';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
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
    payment_demo: '0',
    payment_methods: 'card',
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

// Starter blog articles. Seeded only when the articles table is completely
// empty, so admin-authored content is never overwritten. Topics and wording are
// honest editorial - no invented benchmarks, prices or test results.
const STARTER_ARTICLES = [
  {
    slug: 'verified-hardware-catalog',
    title: 'Why LevelCore Only Lists Verified Hardware Data',
    excerpt: 'Every component in our catalog comes with a documented source. Here is how we keep hardware data honest.',
    cover_color: '#7c5cff',
    tags: ['Hardware', 'Data', 'LevelCore'],
    content: `# Why we publish only verified data

A PC parts catalog is only as good as the numbers behind it. Wrong clock speeds, guessed power draws or invented price ranges quietly break every tool that depends on them - from the FPS calculator to the compatibility checks.

## Where the data comes from

Each component we list is checked against a named source:

- **GPU specifications** - cross-checked with the TechPowerUp GPU database and official product pages.
- **CPU specifications** - verified against manufacturer spec sheets and reference tables.
- **RAM and other parts** - matched to the vendor's own listing.

## What "verified" means for you

Because entries carry a source and, where relevant, a release year, you can always trace a number back to something you can open yourself.

> We prefer a smaller, accurate catalog over a large one with guessed values.

## Prices we stand behind

Prices are shown when we have a real reference for them. If a component has no reliable current price, we show it without one instead of inventing a figure. You will never see a made-up number pretending to be a market price.

## How to report an error

Found a specification that looks wrong? Use the contact form - we review every report and correct the catalog when the evidence checks out.`,
  },
  {
    slug: 'how-to-use-the-fps-calculator',
    title: 'How to Use the FPS Calculator Correctly',
    excerpt: 'Get realistic frame-rate estimates by choosing the right GPU, CPU, game and settings - and learn what the numbers really mean.',
    cover_color: '#22d3ee',
    tags: ['FPS', 'Calculator', 'Guide'],
    content: `# How to use the FPS calculator correctly

The FPS calculator estimates how many frames per second a given CPU and GPU combination can produce in a specific game. It is a guide for planning, not a guarantee of your exact results.

## Step by step

1. Pick the game you want to run.
2. Pick the GPU you own or plan to buy.
3. Pick the CPU (optional but recommended - it matters in many titles).
4. Choose your target resolution, quality preset and upscaling mode.
5. Run the estimate and read the confidence grade.

## How the estimate works

Every component in the catalog carries a **relative performance index**. The engine combines the GPU and CPU indexes, applies the workload profile of the chosen game and quality level, and scales the result to the target resolution.

Upscaling options such as DLSS, FSR or XeSS are applied only when both the game and the GPU support them - we do not assume support that does not exist.

## Why your real FPS can differ

Several things change real-world results:

- Background software and thermal behaviour on your specific machine.
- Driver versions and game patches that alter performance.
- Whether the game is CPU-heavy or GPU-heavy at your chosen settings.

## Trust the confidence grade

When the calculator has strong source data for a GPU and game, it reports **high confidence**. When a game is unusual or a GPU is very new, confidence drops - treat the result as an approximation.

Use the result as a sanity check when choosing a GPU or upgrading, not as a lab measurement.`,
  },
  {
    slug: 'cpu-or-gpu-budget-priority',
    title: 'CPU or GPU: Where Should Your Gaming Budget Go?',
    excerpt: 'The oldest question in PC building - and the answer depends on your resolution, refresh rate and the games you play.',
    cover_color: '#6366f1',
    tags: ['PC Builder', 'Budget', 'Buying Guide'],
    content: `# CPU or GPU: where should your gaming budget go?

Almost every build question starts the same way: "should I spend more on the CPU or the GPU?" The honest answer is that it depends on the games you play and the resolution you play at.

## The general rule

- At **1080p with a high refresh-rate monitor**, the CPU matters more. Competitive shooters and esports titles are often CPU-limited at low quality settings and high frame rates.
- At **1440p and 4K**, the GPU dominates. The graphics card does most of the heavy lifting, and a mid-range CPU is usually enough.
- For **single-player AAA games**, the GPU is typically the bottleneck once the CPU meets a reasonable floor.

## Signs your CPU is holding you back

- Frame rates that barely change when you lower the resolution.
- Frequent frame-time stutters even when average FPS looks fine.
- Very high CPU usage in games that should be light.

## A practical starting point

Match the GPU to your monitor first, because that is where visual quality comes from. Then spend enough on the CPU to avoid leaving performance on the table at your target frame rate.

> Use the FPS calculator for the specific games you play - it will show you whether your CPU or your GPU is the limiting part for your own library.

## The LevelCore builder can help

Set a budget and the games you care about, and the builder will find a balanced configuration instead of a lopsided one.`,
  },
  {
    slug: 'what-is-a-cpu-bottleneck',
    title: 'What Is a CPU Bottleneck and Should You Worry?',
    excerpt: 'A clear, calm explanation of CPU and GPU limits - and why a "bottleneck" is normal, not a flaw.',
    cover_color: '#0ea5e9',
    tags: ['Bottleneck', 'CPU', 'GPU'],
    content: `# What is a CPU bottleneck and should you worry?

Every computer has a bottleneck. One part finishes its work before another, so the slower part decides how fast the whole system goes. That is not a design flaw - it is how computers work.

## CPU-bound vs GPU-bound

- A system is **GPU-bound** when the graphics card is the limiting part. This is what most gamers want: the GPU runs near 100 percent and the CPU has headroom.
- A system is **CPU-bound** when the processor cannot feed the GPU fast enough. Lowering the resolution does not help, because the CPU still has to do the same amount of game logic work.

## How to tell which one you have

1. Play a scene at your normal settings and watch GPU usage.
2. Lower the resolution dramatically.
3. If FPS stays about the same, the CPU is the limit. If FPS jumps, the GPU was the limit.

## When it actually matters

A mild CPU limit in one or two games is rarely a reason to upgrade. A severe, constant CPU limit across the games you actually play is a different story.

## The LevelCore bottleneck tool

Open the bottleneck checker, choose your CPU and GPU, and it will compare their relative performance indexes and show where the balance sits - with the same honest caveats as the FPS calculator.`,
  },
  {
    slug: 'connect-your-steam-library',
    title: 'How to Connect Your Steam Library to LevelCore',
    excerpt: 'Import your owned games and playtime so your FPS estimates and performance reports are built on the games you really play.',
    cover_color: '#a78bfa',
    tags: ['Steam', 'Import', 'Guide'],
    content: `# How to connect your Steam library

LevelCore can read which games you own on Steam and how long you have played them. That makes performance tools far more useful, because they target the games you actually play.

## Before you start

Connecting works through the Steam Web API. The site owner enables the connection from the admin panel - when it is enabled you will see the Steam section on the LevelCore Steam page.

## How to find your Steam ID

- Open your Steam profile in a browser.
- Your custom URL looks like **steamcommunity.com/id/yourname** - you can use the name part.
- A numeric profile ID also works (for example **76561198000000000**).

## Connect and sync

1. Go to the Steam page inside LevelCore.
2. Enter your Steam ID or custom URL.
3. Click connect - Steam is not asked for your password; only the public profile data is read.
4. Use sync to refresh your library later.

## What happens next

The import reads your owned games and playtime. LevelCore then matches those games to entries in the verified game catalog so the FPS calculator and performance reports can use them.

> If a game is not yet in our verified catalog, it will not get a made-up estimate - it simply stays unmatched until real data exists.`,
  },
  {
    slug: 'understanding-plans-and-credits',
    title: 'LevelCore Plans: How Subscriptions and Credits Work',
    excerpt: 'Everything you need to know about monthly plans, wallet credits and what happens to your subscription at the end of the month.',
    cover_color: '#10b981',
    tags: ['Pricing', 'Billing', 'Plans'],
    content: `# LevelCore plans: subscriptions and credits explained

LevelCore offers a free account plus optional paid plans for heavier use. Subscriptions are managed with recurring monthly billing through Stripe.

## Free vs paid

- The free account includes core tools such as the hardware catalog, FPS calculator, builder, compatibility checks and community benchmarks.
- Paid plans add more monthly credits for AI-powered features, advanced reports and larger per-month usage.

## Credits, not unlimited AI

AI features consume credits because each request calls a real external model. When you use an AI feature, the relevant service is invoked and credits are deducted for the work actually done. If a service fails or cannot be reached, you are not charged for it.

## Billing details

- Subscriptions renew automatically every month and can be cancelled at any time from the pricing page.
- Payment is handled by Stripe; LevelCore never stores your card number.
- Plan changes and refunds go through the billing dashboard.

## Need to change or cancel?

Use the plan management buttons on the pricing page. You keep access until the end of the billing period you have already paid for.`,
  },
];

const PUBLISH_DATES = [
  '2026-08-30T10:00:00Z', '2026-08-27T12:00:00Z', '2026-08-22T09:00:00Z',
  '2026-08-18T15:00:00Z', '2026-08-14T11:00:00Z', '2026-08-10T09:00:00Z',
];

function seedStarterArticles() {
  const existing = db.prepare('SELECT COUNT(*) c FROM articles').get().c;
  if (existing > 0) {
    console.log('  starter articles skipped (articles table not empty)');
    return;
  }
  const ins = db.prepare(
    `INSERT OR IGNORE INTO articles
      (slug, title, excerpt, content, cover_color, tags, author_name, status, published_at)
     VALUES (?, ?, ?, ?, ?, ?, 'LevelCore', 'published', ?)`
  );
  let n = 0;
  for (let i = 0; i < STARTER_ARTICLES.length; i++) {
    const a = STARTER_ARTICLES[i];
    const r = ins.run(a.slug, a.title, a.excerpt, a.content, a.cover_color, JSON.stringify(a.tags), PUBLISH_DATES[i] || new Date().toISOString());
    if (r.changes) n++;
  }
  console.log(`  starter articles added: ${n}`);
}

export function seed({ demo = true, admin = true } = {}) {
  console.log('Seeding database...');
  migrate();
  db.transaction(() => {
    seedHardware();
    seedGames();
    seedRules();
    seedAchievements();
    if (admin) seedAdmin();
    seedAdminSettings();
    ensureBillingDefaults();
    seedStarterArticles();
    if (demo) seedDemoUsers();
  })();
  console.log(`Seed complete. (demo=${demo}, admin=${admin})`);
}

// Auto-seed on boot: fills a fresh/empty database with the verified catalog
// so a new deployment works immediately. Idempotent - safe to run every start.
// Returns true when the database was seeded from scratch (empty before boot).
export function seedIfEmpty({ demo = false, admin = false } = {}) {
  const count = db.prepare('SELECT COUNT(*) c FROM gpus').get().c;
  if (count > 0) {
    console.log('[seed] catalog already populated - skipping auto-seed');
    return false;
  }
  console.log('[seed] empty database detected - auto-seeding catalog');
  seed({ demo, admin });
  return true;
}

// Additive catalog sync: run on every boot against an existing database so that
// newly added verified items from the built-in catalog (seed-data.js) reach
// production on deploy. Insert-only by name - never overwrites admin edits,
// disables rows, or duplicates. Cheap (<1s) and safe to run every start.
export function syncCatalog() {
  console.log('[seed] syncing built-in catalog (additive) ...');
  db.transaction(() => {
    seedHardware();
    seedRules();
    seedStarterArticles();
  })();
  console.log('[seed] catalog sync complete');
}

// Create the admin account on boot when the operator explicitly provided an
// ADMIN_PASSWORD. Never auto-creates a default-password admin in production.
export function ensureAdmin() {
  seedAdmin();
}

// First-run admin bootstrap: when NO admin account exists and the operator did
// not set ADMIN_PASSWORD, print a fresh one-time setup token to the server logs
// on every boot. The token (24h, hashed in the DB) is used at /admin/setup to
// choose the admin email + password through the browser - no env editing needed.
// Returning the raw token here lets index.js log it; only its SHA-256 is stored.
export function issueAdminSetupToken() {
  if (process.env.ADMIN_PASSWORD) return null;
  const count = db.prepare('SELECT COUNT(*) c FROM admin_users').get().c;
  if (count > 0) return null;
  const raw = crypto.randomBytes(18).toString('hex');
  const hash = crypto.createHash('sha256').update(raw).digest('hex');
  const expiry = Date.now() + 24 * 3600 * 1000;
  db.prepare(`INSERT INTO admin_settings (key, value) VALUES ('admin_setup_token', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
    .run(`v1:${hash}:${expiry}`);
  return raw;
}

export function adminSetupTokenInfo() {
  const row = db.prepare("SELECT value FROM admin_settings WHERE key = 'admin_setup_token'").get();
  if (!row || !row.value) return { active: false };
  const [, , exp] = String(row.value).split(':');
  return { active: !!(exp && Date.now() < Number(exp)) };
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  seed();
}
