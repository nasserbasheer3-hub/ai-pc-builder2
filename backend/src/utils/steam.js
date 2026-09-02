import { config } from '../config.js';
import { db } from '../db.js';

export class SteamServiceError extends Error {
  constructor(message, code = 'STEAM_UNAVAILABLE') {
    super(message);
    this.name = 'SteamServiceError';
    this.code = code;
  }
}

const STEAM_UNAVAILABLE = 'Steam service is temporarily unavailable. Please try again later.';

export function steamApiKey() {
  const row = db.prepare("SELECT value FROM admin_settings WHERE key='steam_api_key'").get();
  if (row && row.value && row.value !== '' && row.value !== '0') return row.value;
  return config.steam.apiKey;
}

export function steamEnabled() {
  const row = db.prepare("SELECT value FROM admin_settings WHERE key='steam_enabled'").get();
  if (row && row.value === '0') return false;
  return Boolean(steamApiKey());
}

export function parseSteamId(input) {
  if (!input) return null;
  const s = String(input).trim();
  if (/^\d{17}$/.test(s)) return s;
  const m = s.match(/steamcommunity\.com\/profiles\/(\d{17})/);
  return m ? m[1] : null;
}

export function normalizeName(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '').trim();
}

export function matchCatalogGame(name) {
  const n = normalizeName(name);
  if (!n) return null;
  const games = db.prepare('SELECT id, name FROM games WHERE enabled=1').all();
  return games.find((g) => normalizeName(g.name) === n) || null;
}

async function steamFetch(path, params = {}) {
  const key = steamApiKey();
  const base = config.steam.baseUrl.replace(/\/$/, '');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  let res;
  try {
    res = await fetch(`${base}${path}?${new URLSearchParams({ key, ...params })}`, { signal: controller.signal });
  } catch {
    clearTimeout(timer);
    throw new SteamServiceError(STEAM_UNAVAILABLE);
  }
  clearTimeout(timer);

  if (res.status === 401 || res.status === 403) {
    const body = await res.text().catch(() => '');
    if (/private/i.test(body)) {
      throw new SteamServiceError('This Steam profile is private. Make your profile and game details public, then sync again.', 'STEAM_PRIVATE');
    }
    throw new SteamServiceError('Steam rejected the request. Check that the Steam Web API key is valid.', 'STEAM_BAD_KEY');
  }
  if (!res.ok) throw new SteamServiceError(STEAM_UNAVAILABLE);
  return res.json();
}

export async function getPlayerSummaries(steamId) {
  const data = await steamFetch('/ISteamUser/GetPlayerSummaries/v2/', { steamids: steamId });
  const p = data?.response?.players?.[0];
  if (!p) throw new SteamServiceError('No Steam profile found for this ID.', 'STEAM_NO_PROFILE');
  return {
    steamId: p.steamid,
    profileName: p.personaname || null,
    avatarHash: p.avatarhash || null,
    profileUrl: p.profileurl || null,
    isPublic: p.communityvisibilitystate === 3,
  };
}

export async function getOwnedGames(steamId) {
  const data = await steamFetch('/IPlayerService/GetOwnedGames/v1/', {
    steamid: steamId,
    include_appinfo: 'true',
    include_played_free_games: 'true',
  });
  const response = data?.response;
  if (!response || response.game_count == null) {
    throw new SteamServiceError('No games returned. Your profile may be private — make your game details public and try again.', 'STEAM_PRIVATE');
  }
  const games = response.games || [];
  return {
    count: response.game_count,
    games: games.map((g) => ({
      appid: g.appid,
      name: g.name || `Steam App ${g.appid}`,
      playtimeForeverMinutes: g.playtime_forever || 0,
      playtime2WeeksMinutes: g.playtime_2weeks || 0,
      lastPlayedAt: g.rtime_last_played ? new Date(g.rtime_last_played * 1000).toISOString() : null,
      iconUrl: g.img_icon_url
        ? `https://media.steampowered.com/steamcommunity/public/images/apps/${g.appid}/${g.img_icon_url}.jpg`
        : null,
    })),
  };
}

export async function getRecentlyPlayedGames(steamId) {
  const data = await steamFetch('/IPlayerService/GetRecentlyPlayedGames/v1/', { steamid: steamId });
  const games = data?.response?.games || [];
  return games.map((g) => ({ appid: g.appid, playtime2WeeksMinutes: g.playtime_2weeks || 0 }));
}
