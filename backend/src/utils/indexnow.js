// IndexNow (Bing, Yandex, Seznam, Naver) submission helper.
// The public key file is served at https://<host>/<INDEXNOW_KEY>.txt so search
// engines can verify ownership before accepting pings.

export const INDEXNOW_KEY = 'e4c9f27b1a8346d5b09c2e7f4a8d1b63';

function cleanHost(host) {
  if (!host) return null;
  const h = String(host).replace(/^https?:\/\//, '').replace(/:\d+$/, '').toLowerCase();
  if (!h || h.startsWith('localhost') || h === '127.0.0.1' || /^[\d.:]+$/.test(h)) return null;
  return h;
}

// Fire-and-forget ping. Never throws: a failed ping must not break publishing.
export async function pingIndexNow({ host, urls }) {
  const h = cleanHost(host);
  if (!h || !Array.isArray(urls) || !urls.length) return;
  const urlList = urls.slice(0, 100).map((u) => (u.startsWith('http') ? u : `https://${h}${u.startsWith('/') ? u : `/${u}`}`));
  try {
    await fetch('https://api.indexnow.org/indexnow', {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ host: h, key: INDEXNOW_KEY, keyLocation: `https://${h}/${INDEXNOW_KEY}.txt`, urlList }),
    });
  } catch (e) {
    console.error('[indexnow] ping failed:', e.message);
  }
}
