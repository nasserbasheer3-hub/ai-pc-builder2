import { Router } from 'express';
import { db } from '../db.js';

const router = Router();

function originOf(req) {
  const proto = req.get('x-forwarded-proto') || req.protocol || 'http';
  return `${proto}://${req.get('host')}`;
}

function escapeXml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function publishedArticles() {
  return db.prepare("SELECT slug, title, excerpt, content, tags, author_name, published_at FROM articles WHERE status='published' ORDER BY published_at DESC").all();
}

// GET /robots.txt
router.get('/robots.txt', (req, res) => {
  const base = originOf(req);
  res.type('text/plain');
  res.send(`User-agent: *\nAllow: /\n\nSitemap: ${base}/sitemap.xml\n`);
});

// GET /sitemap.xml
router.get('/sitemap.xml', (req, res) => {
  const base = originOf(req);
  const staticUrls = [
    { loc: '/', pri: '1.0' },
    { loc: '/blog', pri: '0.9' },
    { loc: '/signup', pri: '0.8' },
    { loc: '/login', pri: '0.5' },
    { loc: '/pc/hardware', pri: '0.9' },
    { loc: '/pc/compare', pri: '0.9' },
    { loc: '/pc/fps', pri: '0.8' },
    { loc: '/pc/compatibility', pri: '0.8' },
    { loc: '/pc/builder', pri: '0.8' },
    { loc: '/pc/upgrade', pri: '0.8' },
    { loc: '/pc/settings', pri: '0.7' },
    { loc: '/about', pri: '0.4' },
    { loc: '/contact', pri: '0.4' },
    { loc: '/privacy', pri: '0.2' },
    { loc: '/terms', pri: '0.2' },
  ];
  const articles = publishedArticles();
  const urls = [
    ...staticUrls.map((u) => `<url><loc>${base}${u.loc}</loc><changefreq>weekly</changefreq><priority>${u.pri}</priority></url>`),
    ...articles.map((a) => `<url><loc>${base}/blog/${escapeXml(a.slug)}</loc><lastmod>${escapeXml(String(a.published_at).slice(0, 10))}</lastmod><changefreq>monthly</changefreq><priority>0.7</priority></url>`),
  ].join('');
  res.type('application/xml');
  res.send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`);
});

// GET /rss.xml
router.get('/rss.xml', (req, res) => {
  const base = originOf(req);
  const articles = publishedArticles();
  const items = articles.slice(0, 20).map((a) => {
    const link = `${base}/blog/${escapeXml(a.slug)}`;
    const desc = escapeXml(a.excerpt || a.content.slice(0, 300));
    return `<item><title>${escapeXml(a.title)}</title><link>${link}</link><guid isPermaLink="true">${link}</guid><description>${desc}</description><author>${escapeXml(a.author_name)}</author><pubDate>${new Date(a.published_at).toUTCString()}</pubDate></item>`;
  }).join('');
  res.type('application/rss+xml');
  res.send(`<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0"><channel><title>LevelCore Blog</title><link>${base}/blog</link><description>Gaming performance guides, PC building tips and verified hardware analysis.</description>${items}</channel></rss>`);
});

// GET /og-image.svg — branded Open Graph image (1200x630)
router.get('/og-image.svg', (req, res) => {
  res.type('image/svg+xml');
  res.set('Cache-Control', 'public, max-age=86400');
  res.send(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#09090f"/>
      <stop offset="0.55" stop-color="#151126"/>
      <stop offset="1" stop-color="#241a45"/>
    </linearGradient>
    <linearGradient id="acc" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#7c5cff"/>
      <stop offset="1" stop-color="#22d3ee"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <circle cx="1050" cy="120" r="260" fill="#7c5cff" opacity="0.18"/>
  <circle cx="140" cy="560" r="220" fill="#22d3ee" opacity="0.12"/>
  <rect x="90" y="235" width="76" height="76" rx="16" fill="url(#acc)"/>
  <text x="128" y="290" font-family="monospace" font-size="52" font-weight="bold" fill="#09090f" text-anchor="middle">&gt;_</text>
  <text x="90" y="352" font-family="Arial, Helvetica, sans-serif" font-size="72" font-weight="bold" fill="#ffffff">LevelCore</text>
  <text x="90" y="404" font-family="Arial, Helvetica, sans-serif" font-size="30" fill="#a3a3c2">Track · Analyze · Improve your gaming performance</text>
  <rect x="90" y="452" width="300" height="6" rx="3" fill="url(#acc)"/>
</svg>`);
});

export default router;
