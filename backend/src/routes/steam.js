import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { ok, fail } from '../utils/helpers.js';
import {
  steamEnabled, steamApiKey, parseSteamId,
  getPlayerSummaries, getOwnedGames, getRecentlyPlayedGames,
  matchCatalogGame, SteamServiceError,
} from '../utils/steam.js';

const router = Router();
router.use(requireAuth);

const STEAM_DISABLED_MSG = 'Steam integration is not configured yet. An administrator needs to set a Steam Web API key.';
const COOLDOWN_MS = 60 * 1000;

function libraryRow(userId) {
  const link = db.prepare('SELECT * FROM user_steam WHERE user_id=?').get(userId);
  if (!link) return { link: null, items: [] };
  const items = db.prepare('SELECT * FROM steam_library WHERE user_id=? ORDER BY playtime_forever_minutes DESC').all(userId);
  const mapped = items.map((g) => {
    const cat = matchCatalogGame(g.name);
    let inUserGames = false;
    if (cat) {
      inUserGames = Boolean(db.prepare('SELECT id FROM user_games WHERE user_id=? AND game_id=?').get(userId, cat.id));
    }
    return {
      appid: g.appid,
      name: g.name,
      playtimeForeverMinutes: g.playtime_forever_minutes,
      playtime2WeeksMinutes: g.playtime_2weeks_minutes,
      lastPlayedAt: g.last_played_at,
      iconUrl: g.icon_url,
      matchedCatalog: cat ? { id: cat.id, name: cat.name } : null,
      inUserGames,
    };
  });
  return { link, items: mapped };
}

// GET /api/steam/status
router.get('/status', (req, res) => {
  const link = db.prepare('SELECT * FROM user_steam WHERE user_id=?').get(req.user.id);
  const count = link ? db.prepare('SELECT COUNT(*) c FROM steam_library WHERE user_id=?').get(req.user.id).c : 0;
  ok(res, {
    enabled: steamEnabled(),
    linked: Boolean(link),
    profile: link
      ? {
          steamId: link.steam_id,
          profileName: link.profile_name,
          isPublic: Boolean(link.is_public),
          importedAt: link.imported_at,
          lastSyncAt: link.last_sync_at,
        }
      : null,
    libraryCount: count,
  });
});

// POST /api/steam/link  { steamId }
router.post('/link', async (req, res) => {
  if (!steamEnabled()) return fail(res, 409, 'STEAM_DISABLED', STEAM_DISABLED_MSG);
  const steamId = parseSteamId(req.body?.steamId);
  if (!steamId) return fail(res, 422, 'VALIDATION', 'Enter a valid SteamID64 (17 digits) or profile URL.');

  let profile;
  let owned;
  try {
    profile = await getPlayerSummaries(steamId);
    owned = await getOwnedGames(steamId);
  } catch (e) {
    if (e instanceof SteamServiceError) return fail(res, e.code === 'STEAM_BAD_KEY' ? 503 : 422, e.code, e.message);
    return fail(res, 503, 'STEAM_UNAVAILABLE', 'Steam service is temporarily unavailable. Please try again later.');
  }

  db.prepare(`
    INSERT INTO user_steam (user_id, steam_id, profile_name, avatar_hash, profile_url, is_public, imported_at, last_sync_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    ON CONFLICT(user_id) DO UPDATE SET
      steam_id=excluded.steam_id, profile_name=excluded.profile_name,
      avatar_hash=excluded.avatar_hash, profile_url=excluded.profile_url,
      is_public=excluded.is_public, imported_at=excluded.imported_at, last_sync_at=excluded.last_sync_at
  `).run(req.user.id, profile.steamId, profile.profileName, profile.avatarHash, profile.profileUrl, profile.isPublic ? 1 : 0);

  db.prepare('DELETE FROM steam_library WHERE user_id=?').run(req.user.id);
  const upsert = db.prepare(`
    INSERT INTO steam_library (user_id, appid, name, playtime_forever_minutes, playtime_2weeks_minutes, last_played_at, icon_url)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const tx = db.transaction((games) => {
    for (const g of games) upsert.run(req.user.id, g.appid, g.name, g.playtimeForeverMinutes, g.playtime2WeeksMinutes, g.lastPlayedAt, g.iconUrl);
  });
  tx(owned.games);

  ok(res, {
    linked: true,
    profile: { steamId: profile.steamId, profileName: profile.profileName, isPublic: profile.isPublic },
    imported: owned.games.length,
    note: profile.isPublic ? null : 'Your profile appears private — no game details could be imported. Make your profile public and sync again.',
  });
});

// POST /api/steam/sync
router.post('/sync', async (req, res) => {
  if (!steamEnabled()) return fail(res, 409, 'STEAM_DISABLED', STEAM_DISABLED_MSG);
  const link = db.prepare('SELECT * FROM user_steam WHERE user_id=?').get(req.user.id);
  if (!link) return fail(res, 404, 'NOT_FOUND', 'Link your Steam account first.');

  if (link.last_sync_at) {
    const last = new Date(link.last_sync_at.replace(' ', 'T') + 'Z').getTime();
    if (!Number.isNaN(last) && Date.now() - last < COOLDOWN_MS) {
      return fail(res, 429, 'COOLDOWN', 'You can sync again in a moment. Steam limits how often libraries can refresh.');
    }
  }

  let owned;
  let recent;
  try {
    [owned, recent] = await Promise.all([getOwnedGames(link.steam_id), getRecentlyPlayedGames(link.steam_id)]);
  } catch (e) {
    if (e instanceof SteamServiceError) return fail(res, e.code === 'STEAM_BAD_KEY' ? 503 : 422, e.code, e.message);
    return fail(res, 503, 'STEAM_UNAVAILABLE', 'Steam service is temporarily unavailable. Please try again later.');
  }

  const recentMap = new Map(recent.map((r) => [r.appid, r.playtime2WeeksMinutes]));
  const upsert = db.prepare(`
    INSERT INTO steam_library (user_id, appid, name, playtime_forever_minutes, playtime_2weeks_minutes, last_played_at, icon_url)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, appid) DO UPDATE SET
      name=excluded.name,
      playtime_forever_minutes=excluded.playtime_forever_minutes,
      playtime_2weeks_minutes=excluded.playtime_2weeks_minutes,
      last_played_at=excluded.last_played_at,
      icon_url=excluded.icon_url
  `);
  const tx = db.transaction((games) => {
    for (const g of games) {
      const twoWeeks = g.playtime2WeeksMinutes || recentMap.get(g.appid) || 0;
      upsert.run(req.user.id, g.appid, g.name, g.playtimeForeverMinutes, twoWeeks, g.lastPlayedAt, g.iconUrl);
    }
  });
  tx(owned.games);

  db.prepare('UPDATE user_steam SET last_sync_at=datetime(\'now\'), is_public=? WHERE user_id=?').run(1, req.user.id);
  ok(res, { synced: true, imported: owned.games.length });
});

// POST /api/steam/unlink
router.post('/unlink', (req, res) => {
  db.prepare('DELETE FROM steam_library WHERE user_id=?').run(req.user.id);
  db.prepare('DELETE FROM user_steam WHERE user_id=?').run(req.user.id);
  ok(res, { unlinked: true });
});

// GET /api/steam/library
router.get('/library', (req, res) => {
  const { link, items } = libraryRow(req.user.id);
  const matched = items.filter((i) => i.matchedCatalog).length;
  ok(res, { linked: Boolean(link), items, matched, total: items.length });
});

export default router;
