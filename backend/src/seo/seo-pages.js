import { Router } from 'express';
import { db } from '../db.js';
import { estimateFps } from '../engines/fps.js';

// ---------------------------------------------------------------------------
// Server-rendered SEO content hub.
//
// Produces fully server-rendered HTML (crawlable without JavaScript) for:
//   /compare/gpus            - GPU comparison index
//   /compare/cpus            - CPU comparison index
//   /compare/gpu/{a}/{b}     - one GPU vs another GPU
//   /compare/cpu/{a}/{b}     - one CPU vs another CPU
//   /fps                     - which games we have FPS pages for
//   /fps/{game}              - GPUs benchmarked for one game
//   /fps/{game}/{gpu}        - how much FPS a GPU gets in one game
//
// Every page carries unique <title>/meta/canonical, Open Graph tags, JSON-LD
// (WebSite/WebPage/FAQPage/BreadcrumbList) and dense internal links so the
// tool pages, hub pages and blog cross-link each other. All numbers come from
// the live catalog and the same FPS engine the public API uses.
// ---------------------------------------------------------------------------

const router = Router();

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function slugify(s) {
  return String(s || '').toLowerCase().normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

const RESOLUTIONS = ['1080p', '1440p', '4K'];
const QUALITIES = ['High', 'Ultra'];
const RESO_LABEL = { '1080p': '1080p (Full HD)', '1440p': '1440p (QHD)', '4K': '4K (UHD)' };
const FPS_LEVEL_TEXT = {
  excellent: 'a very smooth experience, well above 60 FPS',
  great: 'a great experience, comfortably above 60 FPS',
  good: 'a good experience around 60 FPS',
  playable: 'playable at around 60 FPS with some drops',
  low: 'below ideal - expect drops and a lower frame rate',
  unplayable: 'not recommended at this setting',
};

let cache = { at: 0, gpus: null, cpus: null, games: null };
const CACHE_TTL = 120000;

function loadCatalog() {
  const now = Date.now();
  if (cache.at && now - cache.at < CACHE_TTL) return cache;
  cache = {
    at: now,
    gpus: db.prepare('SELECT * FROM gpus WHERE enabled = 1 ORDER BY performance_index DESC, name ASC').all(),
    cpus: db.prepare('SELECT * FROM cpus WHERE enabled = 1 ORDER BY performance_index DESC, name ASC').all(),
    games: db.prepare('SELECT * FROM games WHERE enabled = 1 ORDER BY name ASC').all(),
  };
  return cache;
}

function partBySlug(parts, slug) {
  return parts.find((p) => slugify(p.name) === slug) || null;
}

function slugCache() {
  const c = loadCatalog();
  const map = new Map();
  for (const p of [...c.gpus, ...c.cpus]) map.set(p.id, slugify(p.name));
  return map;
}

// Smallest id-to-slug memo kept fresh enough for internal cross links.
function slugFor(parts, id) {
  const p = parts.find((x) => Number(x.id) === Number(id));
  return p ? slugify(p.name) : '';
}

function titleOf(parts, id) {
  const p = parts.find((x) => Number(x.id) === Number(id));
  return p ? p.name : '';
}

function benchmarkGpuIdsForGame(gameId) {
  return db.prepare('SELECT DISTINCT gpu_id FROM benchmarks WHERE game_id = ?').all(gameId).map((r) => Number(r.gpu_id));
}

function latestArticles(limit = 3) {
  return db.prepare(`SELECT slug, title FROM articles WHERE status='published' ORDER BY published_at DESC LIMIT ?`).all(limit);
}

// ---------------------------------------------------------------------------
// Shared page shell + meta builders
// ---------------------------------------------------------------------------

function originOf(req) {
  const proto = req.get('x-forwarded-proto') || req.protocol || 'http';
  return `${proto}://${req.get('host')}`;
}

function pageHead({ origin, title, description, canonical, jsonLd = [], ogType = 'website' }) {
  const schemas = [
    { '@context': 'https://schema.org', '@type': 'WebSite', name: 'ApexCore', url: origin, potentialAction: { '@type': 'SearchAction', target: `${origin}/?q={search_term_string}`, 'query-input': 'required name=search_term_string' } },
    ...jsonLd,
  ];
  const ld = schemas.map((s) => `<script type="application/ld+json">${JSON.stringify(s).replace(/</g, '\\u003c')}</script>`).join('\n');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(canonical)}">
<meta property="og:type" content="${esc(ogType)}">
<meta property="og:site_name" content="ApexCore">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(canonical)}">
<meta property="og:image" content="${esc(origin)}/og/seo.svg?t=${encodeURIComponent(title.slice(0, 60))}">
<meta name="robots" content="index,follow">
${ld}
</head>
<body style="margin:0;background:#0b0b13;color:#e6e6f0;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;line-height:1.6">
<main style="max-width:900px;margin:0 auto;padding:28px 20px 60px">`;
}

function pageFoot({ origin }) {
  const arts = latestArticles(3);
  const articleLinks = arts.map((a) => `<li><a style="color:#9aa0ff;text-decoration:none" href="${origin}/blog/${esc(a.slug)}">${esc(a.title)}</a></li>`).join('');
  return `
<footer style="margin-top:52px;padding-top:22px;border-top:1px solid #26263a;color:#8b8ba3;font-size:13px">
<p>ApexCore estimates gaming performance from a verified hardware and benchmark catalog, then explains what it means. All figures on this page are estimates, not guarantees.</p>
${articleLinks ? `<p><b>Latest guides</b></p><ul>${articleLinks}</ul>` : ''}
<p><a style="color:#9aa0ff;text-decoration:none" href="${origin}/pc/hardware">Browse all hardware</a> &middot; <a style="color:#9aa0ff;text-decoration:none" href="${origin}/pc/compare">Interactive compare tool</a> &middot; <a style="color:#9aa0ff;text-decoration:none" href="${origin}/blog">Blog</a> &middot; <a style="color:#9aa0ff;text-decoration:none" href="${origin}/pricing">Plans &amp; pricing</a></p>
</footer>
</main>
</body>
</html>`;
}

function headerBand({ origin, kicker, title, subtitle }) {
  return `
<header style="margin-bottom:28px">
<div style="color:#9aa0ff;font-size:13px;letter-spacing:1px;text-transform:uppercase">${esc(kicker)}</div>
<h1 style="font-size:30px;line-height:1.25;margin:8px 0 6px">${esc(title)}</h1>
${subtitle ? `<p style="color:#a8a8c4">${subtitle}</p>` : ''}
<p style="font-size:13px"><a style="color:#9aa0ff;text-decoration:none" href="${origin}/">ApexCore home</a></p>
</header>`;
}

function section(title) {
  return `<h2 style="font-size:21px;margin:30px 0 10px">${esc(title)}</h2>`;
}

function table(headers, rows) {
  const th = headers.map((h) => `<th style="text-align:left;padding:8px 10px;border-bottom:2px solid #2c2c44;font-size:13px">${esc(h)}</th>`).join('');
  const trs = rows.map((r) => `<tr>${r.map((c) => `<td style="padding:8px 10px;border-bottom:1px solid #232338;font-size:14px">${c}</td>`).join('')}</tr>`).join('');
  return `<div style="overflow-x:auto"><table style="border-collapse:collapse;width:100%;min-width:520px;background:#12121e">${th ? `<thead><tr>${th}</tr></thead>` : ''}<tbody>${trs}</tbody></table></div>`;
}

function card(a) {
  return `<a href="${esc(a.href)}" style="display:inline-block;margin:0 8px 8px 0;padding:8px 14px;background:#1b1b2e;color:#e6e6f0;text-decoration:none;border-radius:8px;border:1px solid #2c2c44;font-size:14px">${esc(a.label)}</a>`;
}

function faqJsonLd(items) {
  return { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: items.map((i) => ({ '@type': 'Question', name: i.q, acceptedAnswer: { '@type': 'Answer', text: i.a } })) };
}

// ---------------------------------------------------------------------------
// Enumerators (used by /sitemap.xml and the hub pages)
// ---------------------------------------------------------------------------

function gpuPairs() {
  const c = loadCatalog();
  const gpus = c.gpus;
  const pairs = [];
  for (let i = 0; i < Math.min(26, gpus.length); i++) {
    if (gpus[i + 1]) pairs.push([gpus[i], gpus[i + 1]]);
    if (gpus[i + 2]) pairs.push([gpus[i], gpus[i + 2]]);
  }
  return pairs;
}

function cpuPairs() {
  const c = loadCatalog();
  const cpus = c.cpus;
  const pairs = [];
  for (let i = 0; i < Math.min(22, cpus.length); i++) {
    if (cpus[i + 1]) pairs.push([cpus[i], cpus[i + 1]]);
  }
  return pairs;
}

function gamesForFps() {
  const c = loadCatalog();
  const popular = c.gpus.slice(0, 14);
  const out = [];
  for (const g of c.games) {
    const anchors = benchmarkGpuIdsForGame(g.id);
    const seen = new Set();
    const gpus = [];
    for (const p of popular) {
      if (seen.has(p.id)) continue;
      seen.add(p.id);
      gpus.push(p);
      if (gpus.length >= 12) break;
    }
    for (const gid of anchors) {
      if (seen.has(gid) || gpus.length >= 14) continue;
      const p = c.gpus.find((x) => Number(x.id) === Number(gid));
      if (!p) continue;
      seen.add(gid);
      gpus.push(p);
    }
    out.push({ game: g, gpus });
  }
  return out;
}

// Stable list of {loc, changefreq, priority} for every generated page.
export function seoSitemapEntries() {
  const out = [];
  out.push({ loc: '/compare/gpus', changefreq: 'weekly', pri: '0.7' });
  out.push({ loc: '/compare/cpus', changefreq: 'weekly', pri: '0.7' });
  out.push({ loc: '/fps', changefreq: 'weekly', pri: '0.7' });
  for (const [a, b] of gpuPairs()) out.push({ loc: `/compare/gpu/${slugify(a.name)}/${slugify(b.name)}`, changefreq: 'weekly', pri: '0.7' });
  for (const [a, b] of cpuPairs()) out.push({ loc: `/compare/cpu/${slugify(a.name)}/${slugify(b.name)}`, changefreq: 'weekly', pri: '0.7' });
  for (const { game, gpus } of gamesForFps()) {
    out.push({ loc: `/fps/${game.slug}`, changefreq: 'weekly', pri: '0.7' });
    for (const g of gpus) out.push({ loc: `/fps/${game.slug}/${slugify(g.name)}`, changefreq: 'weekly', pri: '0.6' });
  }
  return out;
}

// ---------------------------------------------------------------------------
// GPU / CPU comparison pages
// ---------------------------------------------------------------------------

function renderNotFound({ origin, what }) {
  return pageHead({
    origin,
    title: `Not found - ApexCore`,
    description: `The ${what || 'page'} you are looking for does not exist.`,
    canonical: `${origin}/`,
  }) + `<p>The ${esc(what || 'page')} you are looking for does not exist.</p><p><a style="color:#9aa0ff;text-decoration:none" href="${origin}/">Back to ApexCore</a></p>` + pageFoot({ origin });
}

function compareMeta({ origin, parts, a, b, kind }) {
  const noun = kind === 'cpu' ? 'CPU' : 'GPU';
  const title = `${a.name} vs ${b.name}: which ${noun} is better?`;
  const better = a.performance_index > b.performance_index ? a : b;
  const worse = better === a ? b : a;
  const delta = worse.performance_index ? Math.round(((better.performance_index - worse.performance_index) / worse.performance_index) * 100) : 0;
  const description = `${a.name} vs ${b.name} compared on gaming performance, specs, price and efficiency. ${better.name} is about ${delta}% faster in our ${noun} performance index.`;
  return { title, description, better, worse, delta };
}

function compareFpsCells(gpuId, gameIds) {
  const out = [];
  const c = loadCatalog();
  const refCpu = c.cpus[0] || null; // fastest enabled reference CPU -> GPU ceiling
  for (const gid of gameIds) {
    const game = db.prepare('SELECT id, name, slug FROM games WHERE id = ? AND enabled = 1').get(gid);
    if (!game) continue;
    const res = estimateFps({
      gameId: game.id, gpuId, cpuId: refCpu ? refCpu.id : null,
      resolution: '1080p', quality: 'High', rtEnabled: false, upscaling: 'None',
    });
    if (res && res.avgFps != null) out.push({ game, avgFps: res.avgFps, status: res.status });
  }
  return out;
}

function gamesSharedByGpus(gpuA, gpuB) {
  const a = new Set(benchmarkGpuIdsForGame(-1)); // unused
  void a;
  const rows = db.prepare(`
    SELECT b.game_id, g.name, g.slug, COUNT(*) n
    FROM benchmarks b JOIN games g ON g.id = b.game_id
    WHERE b.gpu_id IN (?, ?) AND g.enabled = 1
    GROUP BY b.game_id
    ORDER BY n DESC, g.name ASC
  `).all(gpuA.id, gpuB.id);
  return rows.map((r) => ({ id: r.game_id, name: r.name, slug: r.slug }));
}

function renderGpuCompare(req, res, slugA, slugB) {
  const origin = originOf(req);
  const c = loadCatalog();
  const a = partBySlug(c.gpus, slugA);
  const b = partBySlug(c.gpus, slugB);
  if (!a || !b) {
    res.status(404).type('html').send(renderNotFound({ origin, what: 'GPU comparison' }));
    return;
  }
  const { title, description, better, worse, delta } = compareMeta({ origin, parts: c.gpus, a, b, kind: 'gpu' });
  const specs = (label, av, bv) => [label, String(av ?? '-'), String(bv ?? '-')];
  const rows = [
    specs('Performance index', a.performance_index, b.performance_index),
    specs('VRAM', a.vram_gb ? `${a.vram_gb} GB` : null, b.vram_gb ? `${b.vram_gb} GB` : null),
    specs('TDP', a.tdp_watts ? `${a.tdp_watts} W` : null, b.tdp_watts ? `${b.tdp_watts} W` : null),
    specs('PCIe', a.pcie_version, b.pcie_version),
    specs('Release year', a.release_year, b.release_year),
    specs('Price (EUR)', a.price_eur ? `${a.price_eur} EUR` : null, b.price_eur ? `${b.price_eur} EUR` : null),
    specs('Upscaling', Array.isArray(a.supports_upscaling) ? a.supports_upscaling.join(', ') : a.supports_upscaling, Array.isArray(b.supports_upscaling) ? b.supports_upscaling.join(', ') : b.supports_upscaling),
  ].map(([k, av, bv]) => [k, av, bv]);
  const gameRows = gamesSharedByGpus(a, b);
  const shared = gameRows.slice(0, 4);
  const sharedCells = shared.length
    ? table(['Game', `${a.name} (1080p High)`, `${b.name} (1080p High)`], shared.map((g) => {
        const fa = compareFpsCells(a.id, [g.id]);
        const fb = compareFpsCells(b.id, [g.id]);
        const cell = (arr) => (arr.length && arr[0].avgFps != null ? `${arr[0].avgFps} FPS` : 'no data');
        return [`<a style="color:#9aa0ff;text-decoration:none" href="${origin}/fps/${g.slug}/${slugify(a.name)}">${esc(g.name)}</a>`, cell(fa), cell(fb)];
      }))
    : '';
  const relatedPairs = gpuPairs().slice(0, 8).map(([x, y]) => card({ href: `${origin}/compare/gpu/${slugify(x.name)}/${slugify(y.name)}`, label: `${x.name} vs ${y.name}` }));
  const qa = [
    { q: `Is the ${better.name} better than the ${worse.name}?`, a: `Based on our verified performance index the ${better.name} is about ${delta}% faster than the ${worse.name}, but real frame rates also depend on the rest of your PC and the game.` },
    { q: `Should I buy the ${a.name} or the ${b.name}?`, a: `Pick the ${better.name} if you want the highest frame rates. If power draw and price matter more, check the table above and the interactive compare tool.` },
  ];
  const html = pageHead({
    origin, title, description,
    canonical: `${origin}/compare/gpu/${slugify(a.name)}/${slugify(b.name)}`,
    ogType: 'website',
    jsonLd: [
      { '@context': 'https://schema.org', '@type': 'Product', name: title, description, brand: { '@type': 'Brand', name: 'ApexCore' }, offers: { '@type': 'AggregateOffer', priceCurrency: 'EUR', lowPrice: Math.min(a.price_eur || 0, b.price_eur || 0) || undefined } },
      faqJsonLd(qa),
      { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [{ '@type': 'ListItem', position: 1, name: 'Home', item: origin }, { '@type': 'ListItem', position: 2, name: 'GPU comparisons', item: `${origin}/compare/gpus` }, { '@type': 'ListItem', position: 3, name: `${a.name} vs ${b.name}` }] },
    ],
  }) + headerBand({
    origin, kicker: 'GPU comparison',
    title,
    subtitle: `Which graphics card gives you more gaming performance? ${esc(better.name)} leads our performance index by roughly ${delta}%. Estimates from ApexCore's verified benchmark catalog.`,
  }) + section('Specifications side by side') + table(['Spec', esc(a.name), esc(b.name)], rows)
    + (sharedCells ? section(`Estimated FPS in shared games (1080p High)`) + sharedCells : '')
    + section('Who wins?')
    + `<p>For pure gaming performance the <b>${esc(better.name)}</b> is the stronger card in ApexCore's index (${better.performance_index} vs ${worse.performance_index}). On paper it is about <b>${delta}%</b> faster. ${a.tdp_watts && b.tdp_watts ? `The ${better === a ? a.name : b.name} also ${better.tdp_watts <= worse.tdp_watts ? 'draws less power' : 'draws more power'} (${better.tdp_watts}W vs ${worse.tdp_watts}W).` : ''} Frame rates always depend on the game, resolution and the rest of your build - check the interactive tool for your exact parts.</p>`
    + `<p><a style="color:#9aa0ff;text-decoration:none" href="${origin}/pc/compare?category=gpus&a=${a.id}&b=${b.id}">Try ${esc(a.name)} vs ${esc(b.name)} in the interactive compare tool</a></p>`
    + section('More GPU comparisons') + `<p>${relatedPairs.join('')}</p>`
    + pageFoot({ origin });
  res.type('html').set('Cache-Control', 'public, max-age=900').send(html);
}

function renderCpuCompare(req, res, slugA, slugB) {
  const origin = originOf(req);
  const c = loadCatalog();
  const a = partBySlug(c.cpus, slugA);
  const b = partBySlug(c.cpus, slugB);
  if (!a || !b) {
    res.status(404).type('html').send(renderNotFound({ origin, what: 'CPU comparison' }));
    return;
  }
  const { title, description, better, worse, delta } = compareMeta({ origin, parts: c.cpus, a, b, kind: 'cpu' });
  const rows = [
    ['Performance index', a.performance_index, b.performance_index],
    ['Cores / threads', a.cores && a.threads ? `${a.cores} / ${a.threads}` : null, b.cores && b.threads ? `${b.cores} / ${b.threads}` : null],
    ['Base clock', a.base_clock_ghz ? `${a.base_clock_ghz} GHz` : null, b.base_clock_ghz ? `${b.base_clock_ghz} GHz` : null],
    ['Boost clock', a.boost_clock_ghz ? `${a.boost_clock_ghz} GHz` : null, b.boost_clock_ghz ? `${b.boost_clock_ghz} GHz` : null],
    ['Socket', a.socket, b.socket],
    ['TDP', a.tdp_watts ? `${a.tdp_watts} W` : null, b.tdp_watts ? `${b.tdp_watts} W` : null],
    ['Integrated graphics', a.integrated_graphics || 'No', b.integrated_graphics || 'No'],
    ['Price (EUR)', a.price_eur ? `${a.price_eur} EUR` : null, b.price_eur ? `${b.price_eur} EUR` : null],
  ].map(([k, av, bv]) => [k, av, bv]);
  const qa = [
    { q: `Is the ${better.name} better than the ${worse.name}?`, a: `In our CPU performance index the ${better.name} scores about ${delta}% higher than the ${worse.name}, which matters most for high-refresh gaming and CPU-heavy titles.` },
    { q: `Is the ${a.name} or the ${b.name} better for gaming?`, a: `The ${better.name} generally delivers higher frame rates, but a balanced GPU pairing matters more. Use the interactive bottleneck tool to check your exact combo.` },
  ];
  const related = cpuPairs().slice(0, 8).map(([x, y]) => card({ href: `${origin}/compare/cpu/${slugify(x.name)}/${slugify(y.name)}`, label: `${x.name} vs ${y.name}` }));
  const html = pageHead({
    origin, title, description,
    canonical: `${origin}/compare/cpu/${slugify(a.name)}/${slugify(b.name)}`,
    jsonLd: [faqJsonLd(qa), { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [{ '@type': 'ListItem', position: 1, name: 'Home', item: origin }, { '@type': 'ListItem', position: 2, name: 'CPU comparisons', item: `${origin}/compare/cpus` }, { '@type': 'ListItem', position: 3, name: `${a.name} vs ${b.name}` }] }],
  }) + headerBand({
    origin, kicker: 'CPU comparison',
    title,
    subtitle: `Which processor is stronger for gaming? ${esc(better.name)} leads by about ${delta}% in ApexCore's CPU performance index.`,
  }) + section('Specifications side by side') + table(['Spec', esc(a.name), esc(b.name)], rows)
    + section('Who wins?')
    + `<p>For gaming and productivity the <b>${esc(better.name)}</b> is the stronger CPU (${better.performance_index} vs ${worse.performance_index} in our index, about <b>${delta}%</b> faster). The actual frames you get also depend heavily on your graphics card - a strong CPU cannot fix a weak GPU.</p>`
    + `<p><a style="color:#9aa0ff;text-decoration:none" href="${origin}/pc/bottleneck">Check if your CPU or GPU is the bottleneck</a></p>`
    + section('More CPU comparisons') + `<p>${related.join('')}</p>`
    + pageFoot({ origin });
  res.type('html').set('Cache-Control', 'public, max-age=900').send(html);
}

// ---------------------------------------------------------------------------
// FPS-in-game pages
// ---------------------------------------------------------------------------

function fpsRow(game, gpu, refCpu, resolution, quality) {
  const r = estimateFps({
    gameId: game.id, gpuId: gpu.id, cpuId: refCpu ? refCpu.id : null,
    resolution, quality, rtEnabled: false, upscaling: 'None',
  });
  if (!r || r.avgFps == null) return { resolution, quality, fps: null, status: (r && r.status) || 'unavailable' };
  return { resolution, quality, fps: r.avgFps, level: r.level, status: r.status };
}

function renderFpsGame(req, res, gameSlug, gpuSlug) {
  const origin = originOf(req);
  const c = loadCatalog();
  const game = c.games.find((g) => g.slug === gameSlug);
  const gpu = partBySlug(c.gpus, gpuSlug);
  if (!game) {
    res.status(404).type('html').send(renderNotFound({ origin, what: 'game page' }));
    return;
  }
  const refCpu = c.cpus[0] || null;
  const title = gpu ? `How much FPS does the ${gpu.name} get in ${game.name}?` : `${game.name}: FPS and performance by graphics card`;
  const description = gpu
    ? `Estimated FPS for the ${gpu.name} in ${game.name} at 1080p, 1440p and 4K. ApexCore estimates from verified ${game.name} benchmarks.`
    : `Which graphics card can run ${game.name}? Estimated FPS for the most popular GPUs at 1080p, 1440p and 4K from ApexCore's verified benchmark catalog.`;
  if (!gpu) {
    // Hub page for one game across its benchmarked GPUs.
    const chosen = benchmarkGpuIdsForGame(game.id);
    const popular = c.gpus.filter((g) => chosen.includes(Number(g.id)) || c.gpus.indexOf(g) < 14).slice(0, 16);
    const cards = popular.map((g) => card({ href: `${origin}/fps/${game.slug}/${slugify(g.name)}`, label: `${g.name} in ${game.name}` }));
    const html = pageHead({
      origin, title, description,
      canonical: `${origin}/fps/${game.slug}`,
      jsonLd: [{ '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [{ '@type': 'ListItem', position: 1, name: 'Home', item: origin }, { '@type': 'ListItem', position: 2, name: 'Game FPS pages', item: `${origin}/fps` }, { '@type': 'ListItem', position: 3, name: game.name }] }],
    }) + headerBand({ origin, kicker: 'Game performance', title, subtitle: `Estimated frame rates for ${esc(game.name)} with the most common graphics cards, at 1080p, 1440p and 4K.` })
      + (game.description ? `<p>${esc(game.description)}</p>` : '')
      + section('FPS by graphics card') + `<p>${cards.join('')}</p>`
      + `<p><a style="color:#9aa0ff;text-decoration:none" href="${origin}/pc/gamecheck">Use the interactive "Can I run this game?" checker</a></p>`
      + pageFoot({ origin });
    res.type('html').set('Cache-Control', 'public, max-age=900').send(html);
    return;
  }

  const cells = [];
  for (const quality of QUALITIES) {
    for (const resolution of RESOLUTIONS) {
      cells.push(fpsRow(game, gpu, refCpu, resolution, quality));
    }
  }
  const heads = ['Resolution / quality', ...QUALITIES.map((q) => `${q}`)];
  const rows = RESOLUTIONS.map((res) => [RESO_LABEL[res], ...QUALITIES.map((q) => {
    const cell = cells.find((x) => x.resolution === res && x.quality === q);
    if (!cell || cell.fps == null) return 'no data';
    return `<b>${cell.fps} FPS</b>${FPS_LEVEL_TEXT[cell.level] ? `<br><span style="font-size:12px;color:#8b8ba3">${esc(FPS_LEVEL_TEXT[cell.level])}</span>` : ''}`;
  })]);
  const best = cells.filter((x) => x.fps != null).sort((a, b) => b.fps - a.fps)[0];
  const summary = best
    ? `In ${esc(game.name)} the ${esc(gpu.name)} is estimated to deliver about <b>${best.fps} FPS</b> at ${best.quality.toLowerCase()} ${best.resolution === '4K' ? '4K' : best.resolution}${best.resolution !== '1080p' ? '' : ''} on our reference system. Drop the resolution or quality for higher frame rates, or enable upscaling (DLSS/FSR) to boost performance.`
    : `ApexCore does not have enough verified ${esc(game.name)} data for the ${esc(gpu.name)} yet. Frame rates are estimated only where a benchmark anchor exists.`;
  const otherGames = c.games.filter((g) => g.id !== game.id).slice(0, 6).map((g) => card({ href: `${origin}/fps/${g.slug}`, label: `${g.name} FPS` }));
  const reqs = db.prepare('SELECT * FROM game_requirements WHERE game_id = ?').get(game.id);
  const relatedPairs = gpuPairs().filter(([x, y]) => x.id === gpu.id || y.id === gpu.id).slice(0, 3).map(([x, y]) => card({ href: `${origin}/compare/gpu/${slugify(x.name)}/${slugify(y.name)}`, label: `${x.name} vs ${y.name}` }));
  const qa = [
    { q: `Can the ${gpu.name} run ${game.name}?`, a: `ApexCore estimates ${best ? `around ${best.fps} FPS at ${best.resolution} ${best.quality.toLowerCase()}` : `that the ${gpu.name} can run ${game.name}, but no verified anchor exists yet`}. See the table for each resolution.` },
    { q: `What FPS does the ${gpu.name} get in ${game.name} at 1080p?`, a: best ? `Expect about ${best.fps} FPS at ${best.quality.toLowerCase()} ${best.resolution}. Real results vary with your CPU and settings.` : 'No verified data yet for this combination.' },
  ];
  const html = pageHead({
    origin, title, description,
    canonical: `${origin}/fps/${game.slug}/${slugify(gpu.name)}`,
    jsonLd: [faqJsonLd(qa), { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [{ '@type': 'ListItem', position: 1, name: 'Home', item: origin }, { '@type': 'ListItem', position: 2, name: 'Game FPS pages', item: `${origin}/fps` }, { '@type': 'ListItem', position: 3, name: game.name, item: `${origin}/fps/${game.slug}` }, { '@type': 'ListItem', position: 4, name: gpu.name }] }],
  }) + headerBand({
    origin, kicker: `${esc(game.name)} performance`,
    title,
    subtitle: `Estimated frame rate of the ${esc(gpu.name)} in ${esc(game.name)}. ${refCpu ? `Measured against a ${esc(refCpu.name)} reference CPU so the GPU is the limit.` : ''}`,
  })
    + section('Estimated FPS by resolution and quality') + table(heads, rows)
    + section('What does this mean?') + `<p>${summary}</p>`
    + (reqs ? section('Official system requirements') + `<ul>${['min_gpu', 'rec_gpu'].map((k) => reqs[k] ? `<li><b>${k === 'min_gpu' ? 'Minimum GPU' : 'Recommended GPU'}:</b> ${esc(reqs[k])}</li>` : '').join('')}${reqs.min_vram_gb ? `<li><b>Minimum VRAM:</b> ${reqs.min_vram_gb} GB</li>` : ''}${reqs.rec_vram_gb ? `<li><b>Recommended VRAM:</b> ${reqs.rec_vram_gb} GB</li>` : ''}</ul>` : '')
    + section('Compare this GPU') + `<p>${relatedPairs.join('') || 'No nearby comparisons yet.'}</p>`
    + section('Other games') + `<p>${otherGames.join('')}</p>`
    + `<p><a style="color:#9aa0ff;text-decoration:none" href="${origin}/pc/fps">Open the interactive FPS calculator</a></p>`
    + pageFoot({ origin });
  res.type('html').set('Cache-Control', 'public, max-age=900').send(html);
}

// ---------------------------------------------------------------------------
// Hub index pages
// ---------------------------------------------------------------------------

function renderFpsHub(req, res) {
  const origin = originOf(req);
  const c = loadCatalog();
  const cards = c.games.map((g) => card({ href: `${origin}/fps/${g.slug}`, label: `${g.name} FPS` }));
  const html = pageHead({
    origin, title: 'Game FPS benchmarks and estimates - ApexCore', description: 'Estimated FPS for the most popular games and graphics cards at 1080p, 1440p and 4K, from ApexCore\'s verified benchmark catalog.',
    canonical: `${origin}/fps`,
  }) + headerBand({ origin, kicker: 'FPS hub', title: 'Game FPS benchmarks and estimates', subtitle: 'Pick a game to see which graphics cards can run it and at what frame rate.' })
    + section('Games') + `<p>${cards.join('')}</p>`
    + `<p><a style="color:#9aa0ff;text-decoration:none" href="${origin}/pc/fps">Interactive FPS calculator</a></p>`
    + pageFoot({ origin });
  res.type('html').set('Cache-Control', 'public, max-age=900').send(html);
}

function renderGpuHub(req, res) {
  const origin = originOf(req);
  const cards = gpuPairs().slice(0, 40).map(([a, b]) => card({ href: `${origin}/compare/gpu/${slugify(a.name)}/${slugify(b.name)}`, label: `${a.name} vs ${b.name}` }));
  const html = pageHead({
    origin, title: 'GPU comparisons - which graphics card is better?', description: 'Side-by-side GPU comparisons: specs, performance index and estimated FPS. Find out which graphics card is better for your gaming build.',
    canonical: `${origin}/compare/gpus`,
  }) + headerBand({ origin, kicker: 'Hardware comparisons', title: 'GPU comparisons', subtitle: 'The most useful graphics card match-ups, ranked by performance index.' })
    + `<p>${cards.join('')}</p>`
    + `<p><a style="color:#9aa0ff;text-decoration:none" href="${origin}/pc/compare?category=gpus">Interactive GPU compare tool</a></p>`
    + pageFoot({ origin });
  res.type('html').set('Cache-Control', 'public, max-age=900').send(html);
}

function renderCpuHub(req, res) {
  const origin = originOf(req);
  const cards = cpuPairs().map(([a, b]) => card({ href: `${origin}/compare/cpu/${slugify(a.name)}/${slugify(b.name)}`, label: `${a.name} vs ${b.name}` }));
  const html = pageHead({
    origin, title: 'CPU comparisons - which processor is better?', description: 'Side-by-side CPU comparisons: cores, clocks, performance index. Find out which processor is better for gaming and productivity.',
    canonical: `${origin}/compare/cpus`,
  }) + headerBand({ origin, kicker: 'Hardware comparisons', title: 'CPU comparisons', subtitle: 'Processor match-ups ordered by our performance index.' })
    + `<p>${cards.join('')}</p>`
    + `<p><a style="color:#9aa0ff;text-decoration:none" href="${origin}/pc/compare?category=cpus">Interactive CPU compare tool</a></p>`
    + pageFoot({ origin });
  res.type('html').set('Cache-Control', 'public, max-age=900').send(html);
}

// ---------------------------------------------------------------------------
// Dynamic branded OG image (SVG - raster conversion needs a canvas lib)
// ---------------------------------------------------------------------------

router.get('/og/seo.svg', (req, res) => {
  const t = String(req.query.t || 'ApexCore').slice(0, 60);
  res.type('image/svg+xml');
  res.set('Cache-Control', 'public, max-age=86400');
  res.send(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#09090f"/><stop offset="0.55" stop-color="#151126"/><stop offset="1" stop-color="#241a45"/>
    </linearGradient>
    <linearGradient id="acc" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7c5cff"/><stop offset="1" stop-color="#22d3ee"/></linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <circle cx="1050" cy="120" r="260" fill="#7c5cff" opacity="0.18"/>
  <circle cx="140" cy="560" r="220" fill="#22d3ee" opacity="0.12"/>
  <text x="90" y="300" font-family="Arial, Helvetica, sans-serif" font-size="46" font-weight="bold" fill="#ffffff">${esc(t)}</text>
  <text x="90" y="360" font-family="Arial, Helvetica, sans-serif" font-size="30" fill="#a3a3c2">ApexCore - verified gaming performance data</text>
  <rect x="90" y="404" width="300" height="6" rx="3" fill="url(#acc)"/>
</svg>`);
});

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

router.get('/compare/gpus', renderGpuHub);
router.get('/compare/cpus', renderCpuHub);
router.get('/compare/gpu/:a/:b', (req, res) => renderGpuCompare(req, res, String(req.params.a).toLowerCase(), String(req.params.b).toLowerCase()));
router.get('/compare/cpu/:a/:b', (req, res) => renderCpuCompare(req, res, String(req.params.a).toLowerCase(), String(req.params.b).toLowerCase()));
router.get('/fps', renderFpsHub);
router.get('/fps/:game', (req, res) => renderFpsGame(req, res, String(req.params.game).toLowerCase()));
router.get('/fps/:game/:gpu', (req, res) => renderFpsGame(req, res, String(req.params.game).toLowerCase(), String(req.params.gpu).toLowerCase()));

export default router;
