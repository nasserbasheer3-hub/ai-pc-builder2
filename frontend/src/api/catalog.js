import { api } from './client';

const cache = new Map();

export async function getGames(force = false) {
  if (!cache.has('games') || force) {
    const { games } = await api.get('/games');
    cache.set('games', games);
  }
  return cache.get('games');
}

export async function getHardwareCategory(category, force = false) {
  const key = `hw:${category}`;
  if (!cache.has(key) || force) {
    const data = await api.get(`/hardware?category=${category}`);
    cache.set(key, data.items);
  }
  return cache.get(key);
}

export async function getHardwareCategories(force = false) {
  if (!cache.has('hwcats') || force) {
    const data = await api.get('/hardware');
    cache.set('hwcats', data.categories);
  }
  return cache.get('hwcats');
}

export function invalidateHardware() {
  for (const k of [...cache.keys()]) if (k.startsWith('hw:')) cache.delete(k);
  cache.delete('hwcats');
}

export async function loadAllHardware() {
  const cats = ['cpus', 'gpus', 'motherboards', 'ram', 'storage', 'psus', 'cases', 'coolers'];
  const out = {};
  await Promise.all(cats.map(async (c) => {
    out[c] = await getHardwareCategory(c);
  }));
  return out;
}
