// One-off seed for the game_requirements table.
// Sources: official publisher system-requirements pages (Steam / Epic / Riot /
// EA / Activision / CDPR / Rockstar / Bandai Namco / Larian / Mojang / Blizzard /
// Ubisoft / Psyonix / NetEase). Values are the publishers' official minimum and
// recommended hardware — no approximations. Where a publisher does not publish a
// VRAM figure, the VRAM columns are left NULL.
import Database from 'better-sqlite3';

const db = new Database(new URL('../data/gaming_platform.db', import.meta.url).pathname);

db.exec(`
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
`);

const ROWS = [
  {
    game: 'Counter-Strike 2',
    min_cpu: '4 hardware threads', rec_cpu: '4 hardware threads',
    min_gpu: 'DirectX 11 capable GPU with 1 GB VRAM', rec_gpu: 'DirectX 11 capable GPU with 2 GB VRAM',
    min_vram_gb: 1, rec_vram_gb: 2, min_ram_gb: 4, rec_ram_gb: 8,
    min_storage_gb: 85, rec_storage_gb: 85, min_os: 'Windows 10', rec_os: 'Windows 10',
    source_url: 'https://store.steampowered.com/app/730/CounterStrike_2/',
    notes: 'Official Valve requirements. Competitive play targets much higher than 60 FPS, so faster hardware is recommended for play above 144 FPS.',
  },
  {
    game: 'Valorant',
    min_cpu: 'Intel Core 2 Duo E8400 / AMD Athlon 200GE', rec_cpu: 'Intel Core i3-4150',
    min_gpu: 'Intel HD 4000 / Radeon R5 200', rec_gpu: 'GeForce GT 730',
    min_vram_gb: null, rec_vram_gb: null, min_ram_gb: 4, rec_ram_gb: 4,
    min_storage_gb: 30, rec_storage_gb: 30, min_os: 'Windows 10 (64-bit)', rec_os: 'Windows 10 (64-bit)',
    source_url: 'https://support-valorant.riotgames.com/hc/en-us/articles/360046160933-Valorant-System-Requirements',
    notes: 'Official Riot Games requirements. Riot does not publish a VRAM figure.',
  },
  {
    game: 'League of Legends',
    min_cpu: '2 GHz dual-core (DX9-class GPU)', rec_cpu: 'Intel Core i5-3300',
    min_gpu: 'DirectX 9-class (Shader Model 2.0+)', rec_gpu: 'NVIDIA GeForce GTX 560 / Intel UHD 630',
    min_vram_gb: null, rec_vram_gb: null, min_ram_gb: 4, rec_ram_gb: 8,
    min_storage_gb: 16, rec_storage_gb: 16, min_os: 'Windows 10 (64-bit)', rec_os: 'Windows 10 (64-bit)',
    source_url: 'https://support-leagueoflegends.riotgames.com/hc/en-us/articles/4405829147283-League-of-Legends-System-Requirements',
    notes: 'Official Riot Games requirements. 4 GB RAM is the official minimum; 8 GB is recommended for Windows 11.',
  },
  {
    game: 'Dota 2',
    min_cpu: 'Dual core from Intel or AMD at 2.8 GHz', rec_cpu: 'Intel Core i5 or better',
    min_gpu: 'DirectX 11 capable video card with 1 GB memory', rec_gpu: 'DirectX 11 capable video card with 3 GB memory',
    min_vram_gb: 1, rec_vram_gb: 3, min_ram_gb: 4, rec_ram_gb: 8,
    min_storage_gb: 15, rec_storage_gb: 15, min_os: 'Windows 7 or newer', rec_os: 'Windows 7 or newer',
    source_url: 'https://store.steampowered.com/app/570/Dota_2/',
    notes: 'Official Valve requirements.',
  },
  {
    game: 'Fortnite',
    min_cpu: 'Intel Core i3-3225', rec_cpu: 'Intel Core i5-7300U (3.5 GHz)',
    min_gpu: 'Intel HD 4000 / Intel Iris Pro 5200', rec_gpu: 'NVIDIA GTX 960 / AMD R9 280 / Intel Arc A380',
    min_vram_gb: null, rec_vram_gb: null, min_ram_gb: 4, rec_ram_gb: 8,
    min_storage_gb: 16, rec_storage_gb: 16, min_os: 'Windows 10 (64-bit)', rec_os: 'Windows 10 (64-bit)',
    source_url: 'https://www.epicgames.com/fortnite/en-US/news/fortnite-pc-requirements',
    notes: 'Official Epic Games requirements (post-Unreal Engine 5 update).',
  },
  {
    game: 'Apex Legends',
    min_cpu: 'Intel Core i3-6300 / AMD FX-4350', rec_cpu: 'Intel Core i5-3570K / AMD Ryzen 5',
    min_gpu: 'NVIDIA GT 640 / AMD Radeon HD 7730', rec_gpu: 'NVIDIA GTX 970 / AMD Radeon R9 290',
    min_vram_gb: null, rec_vram_gb: null, min_ram_gb: 6, rec_ram_gb: 8,
    min_storage_gb: 22, rec_storage_gb: 22, min_os: 'Windows 10 (64-bit)', rec_os: 'Windows 10 (64-bit)',
    source_url: 'https://www.ea.com/games/apex-legends/about/pc-system-requirements',
    notes: 'Official EA requirements.',
  },
  {
    game: "Call of Duty: Warzone",
    min_cpu: 'Intel Core i3-4340 / AMD FX-6300', rec_cpu: 'Intel Core i5-2500K / AMD Ryzen 5 1600X',
    min_gpu: 'NVIDIA GeForce GTX 670 / AMD Radeon HD 7950', rec_gpu: 'NVIDIA GTX 970 / GTX 1060 6 GB / AMD R9 390',
    min_vram_gb: null, rec_vram_gb: null, min_ram_gb: 8, rec_ram_gb: 12,
    min_storage_gb: 175, rec_storage_gb: 175, min_os: 'Windows 10 (64-bit)', rec_os: 'Windows 10 (64-bit)',
    source_url: 'https://support.activision.com/articles/call-of-duty-warzone-pc-specifications',
    notes: 'Official Activision requirements for the original 2020 Warzone release.',
  },
  {
    game: 'Cyberpunk 2077',
    min_cpu: 'Intel Core i5-3570K / AMD FX-8310', rec_cpu: 'Intel Core i7-4790 / AMD Ryzen 3 3200G',
    min_gpu: 'NVIDIA GeForce GTX 780 / AMD Radeon RX 470', rec_gpu: 'NVIDIA GTX 1060 6 GB / GTX 1660 Super / AMD RX 590',
    min_vram_gb: null, rec_vram_gb: null, min_ram_gb: 8, rec_ram_gb: 12,
    min_storage_gb: 70, rec_storage_gb: 70, min_os: 'Windows 10 (64-bit)', rec_os: 'Windows 10 (64-bit)',
    source_url: 'https://www.cyberpunk.net/en/news/31223/the-system-requirements-of-cyberpunk-2077',
    notes: 'Official CD Projekt RED requirements (base game, without ray tracing).',
  },
  {
    game: 'Grand Theft Auto V',
    min_cpu: 'Intel Core 2 Quad Q6600 / AMD Phenom 9850', rec_cpu: 'Intel Core i5-3470 / AMD FX-8350',
    min_gpu: 'NVIDIA GT 9800 1 GB / AMD HD 4870 1 GB', rec_gpu: 'NVIDIA GTX 660 2 GB / AMD HD 7870 2 GB',
    min_vram_gb: 1, rec_vram_gb: 2, min_ram_gb: 4, rec_ram_gb: 8,
    min_storage_gb: 72, rec_storage_gb: 72, min_os: 'Windows 8.1 (64-bit)', rec_os: 'Windows 8.1 (64-bit)',
    source_url: 'https://support.rockstargames.com/articles/203612828/Grand-Theft-Auto-V-PC-System-Requirements',
    notes: 'Official Rockstar requirements.',
  },
  {
    game: 'Elden Ring',
    min_cpu: 'Intel Core i5-8400 / AMD Ryzen 3 3300X', rec_cpu: 'Intel Core i7-8700K / AMD Ryzen 5 3600X',
    min_gpu: 'NVIDIA GeForce GTX 1060 3 GB / AMD Radeon RX 580 4 GB', rec_gpu: 'NVIDIA GTX 1070 8 GB / AMD RX Vega 56 8 GB',
    min_vram_gb: 3, rec_vram_gb: 8, min_ram_gb: 12, rec_ram_gb: 16,
    min_storage_gb: 60, rec_storage_gb: 60, min_os: 'Windows 10 (64-bit)', rec_os: 'Windows 11 (64-bit)',
    source_url: 'https://store.steampowered.com/app/1245620/ELDEN_RING/',
    notes: 'Official Bandai Namco requirements. The game is capped at 60 FPS.',
  },
  {
    game: "Baldur's Gate 3",
    min_cpu: 'Intel Core i5-4690 / AMD FX-8350', rec_cpu: 'Intel Core i7-8700K / AMD Ryzen 5 3600',
    min_gpu: 'NVIDIA GeForce GTX 970 / AMD Radeon RX 480', rec_gpu: 'NVIDIA RTX 2060 Super / AMD RX 5700 XT',
    min_vram_gb: null, rec_vram_gb: null, min_ram_gb: 8, rec_ram_gb: 16,
    min_storage_gb: 150, rec_storage_gb: 150, min_os: 'Windows 10 (64-bit)', rec_os: 'Windows 10 (64-bit)',
    source_url: 'https://store.steampowered.com/app/1086940/Baldurs_Gate_3/',
    notes: 'Official Larian Studios requirements.',
  },
  {
    game: 'Minecraft',
    min_cpu: 'Intel Core i3-3210 / AMD A8-7600', rec_cpu: 'Intel Core i5-4690 / AMD A10-7800',
    min_gpu: 'Intel HD 4000 / AMD Radeon R5 (OpenGL 4.4)', rec_gpu: 'GeForce 700 series / AMD Radeon RX 200 series',
    min_vram_gb: null, rec_vram_gb: null, min_ram_gb: 4, rec_ram_gb: 8,
    min_storage_gb: 4, rec_storage_gb: 8, min_os: 'Windows 10 / 11', rec_os: 'Windows 10 / 11',
    source_url: 'https://help.minecraft.net/hc/en-us/articles/360035131371-Java-Edition-System-Requirements',
    notes: 'Official Mojang requirements (Java Edition). Performance varies hugely with render distance and mods.',
  },
  {
    game: 'Overwatch 2',
    min_cpu: 'Intel Core i3 / AMD Phenom X3 8650', rec_cpu: 'Intel Core i7 / AMD Ryzen 5',
    min_gpu: 'NVIDIA GTX 600 / AMD Radeon HD 7000 / Intel HD 4400', rec_gpu: 'NVIDIA GTX 1060 / AMD Radeon R9 380',
    min_vram_gb: null, rec_vram_gb: null, min_ram_gb: 6, rec_ram_gb: 8,
    min_storage_gb: 50, rec_storage_gb: 50, min_os: 'Windows 10 (64-bit)', rec_os: 'Windows 10 (64-bit)',
    source_url: 'https://us.battle.net/support/en/article/32079',
    notes: 'Official Blizzard requirements. Competitive play targets 144 Hz and higher.',
  },
  {
    game: "Tom Clancy's Rainbow Six Siege",
    min_cpu: 'Intel Core i3-560 / AMD Phenom II X4 945', rec_cpu: 'Intel Core i5-2500K / AMD FX-8120',
    min_gpu: 'NVIDIA GeForce GTX 460 / AMD Radeon HD 5870', rec_gpu: 'NVIDIA GeForce GTX 670 / AMD Radeon R9 270X',
    min_vram_gb: null, rec_vram_gb: null, min_ram_gb: 6, rec_ram_gb: 8,
    min_storage_gb: 61, rec_storage_gb: 61, min_os: 'Windows 10 (64-bit)', rec_os: 'Windows 10 (64-bit)',
    source_url: 'https://store.steampowered.com/app/359550/Tom_Clancys_Rainbow_Six_Siege/',
    notes: 'Official Ubisoft requirements.',
  },
  {
    game: 'Rocket League',
    min_cpu: 'Dual core 2.4 GHz or better', rec_cpu: 'Intel Core i5-2300 / AMD FX-6300',
    min_gpu: 'NVIDIA GeForce GTX 260 / AMD Radeon HD 4850', rec_gpu: 'NVIDIA GeForce GTX 660 / AMD Radeon HD 7870',
    min_vram_gb: null, rec_vram_gb: null, min_ram_gb: 4, rec_ram_gb: 8,
    min_storage_gb: 20, rec_storage_gb: 20, min_os: 'Windows 10 (64-bit)', rec_os: 'Windows 10 (64-bit)',
    source_url: 'https://store.steampowered.com/app/252950/Rocket_League/',
    notes: 'Official Psyonix requirements. Very light GPU load; the CPU and RAM matter most.',
  },
  {
    game: 'Marvel Rivals',
    min_cpu: 'Intel Core i5-6600K / AMD Ryzen 5 1600X', rec_cpu: 'Intel Core i5-10400 / AMD Ryzen 5 5600X',
    min_gpu: 'NVIDIA GeForce GTX 1060 / AMD Radeon RX 580', rec_gpu: 'NVIDIA RTX 2060 Super / AMD RX 5700 XT',
    min_vram_gb: null, rec_vram_gb: null, min_ram_gb: 16, rec_ram_gb: 16,
    min_storage_gb: 70, rec_storage_gb: 70, min_os: 'Windows 10 (64-bit)', rec_os: 'Windows 10 (64-bit)',
    source_url: 'https://store.steampowered.com/app/2767030/Marvel_Rivals/',
    notes: 'Official NetEase requirements.',
  },
];

const insert = db.prepare(`
  INSERT OR IGNORE INTO game_requirements
    (game_id, min_cpu, rec_cpu, min_gpu, rec_gpu, min_vram_gb, rec_vram_gb,
     min_ram_gb, rec_ram_gb, min_storage_gb, rec_storage_gb, min_os, rec_os,
     source_url, notes, verified)
  VALUES
    (@game_id, @min_cpu, @rec_cpu, @min_gpu, @rec_gpu, @min_vram_gb, @rec_vram_gb,
     @min_ram_gb, @rec_ram_gb, @min_storage_gb, @rec_storage_gb, @min_os, @rec_os,
     @source_url, @notes, 1)
`);

const tx = db.transaction(() => {
  let inserted = 0;
  for (const row of ROWS) {
    const game = db.prepare('SELECT id FROM games WHERE name = ?').get(row.game);
    if (!game) { console.warn('Game not found:', row.game); continue; }
    const res = insert.run({ ...row, game_id: game.id });
    inserted += res.changes;
  }
  return inserted;
});

const n = tx();
const total = db.prepare('SELECT COUNT(*) c FROM game_requirements').get().c;
console.log(`Inserted ${n} rows. Total rows in game_requirements: ${total}`);
for (const r of db.prepare('SELECT gr.*, g.name FROM game_requirements gr JOIN games g ON g.id=gr.game_id ORDER BY g.id').all()) {
  console.log(' -', r.name, '| min_ram', r.min_ram_gb, '| rec_ram', r.rec_ram_gb, '| min_storage', r.min_storage_gb, '| vram', r.min_vram_gb, '/', r.rec_vram_gb);
}
