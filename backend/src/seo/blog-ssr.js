import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from '../db.js';

// Light server-rendering for the blog so article and listing URLs return real,
// crawlable HTML with per-page title/meta/OG/JSON-LD instead of the SPA shell.
// Content is authored by admins as a small safe markdown subset - the same
// subset frontend/src/utils/markdown.jsx renders - so the SSR output matches
// what logged-in visitors see in the app.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_DIST = path.resolve(__dirname, '..', '..', '..', 'frontend', 'dist');

const router = Router();

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function originOf(req) {
  const proto = req.get('x-forwarded-proto') || req.protocol || 'http';
  return `${proto}://${req.get('host')}`;
}

function isoUtc(sqliteDate) {
  if (!sqliteDate) return null;
  return String(sqliteDate).replace(' ', 'T') + 'Z';
}

function published() {
  return db.prepare("SELECT slug, title, excerpt, content, tags, author_name, published_at FROM articles WHERE status='published' ORDER BY published_at DESC").all();
}

// Small inline-markdown -> HTML renderer (bold/italic/code/links).
const RE_INLINE = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;

function isSiteLink(href, host) {
  if (!href.trim() || /^(#|\?|mailto:|tel:)/.test(href)) return false;
  if (href.startsWith('/')) return true;
  try { return new URL(href).host === host; } catch { return false; }
}

function decorateUtm(href, host, campaign) {
  try {
    const url = new URL(href.startsWith('/') ? `https://${host}${href}` : href);
    if (!url.searchParams.get('utm_source')) url.searchParams.set('utm_source', 'blog');
    if (!url.searchParams.get('utm_medium')) url.searchParams.set('utm_medium', 'article');
    if (campaign && !url.searchParams.get('utm_campaign')) url.searchParams.set('utm_campaign', campaign);
    if (!url.searchParams.get('utm_content')) url.searchParams.set('utm_content', 'inline-link');
    return url.pathname + url.search + (url.hash || '');
  } catch { return href; }
}

function inlineMd(text, ctx) {
  let out = '';
  let last = 0;
  for (const m of String(text || '').matchAll(RE_INLINE)) {
    if (m.index > last) out += esc(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith('**')) out += `<strong>${inlineMd(tok.slice(2, -2), ctx)}</strong>`;
    else if (tok.startsWith('*')) out += `<em>${inlineMd(tok.slice(1, -1), ctx)}</em>`;
    else if (tok.startsWith('`')) out += `<code style="background:rgba(124,92,255,0.12);padding:1px 6px;border-radius:6px;font-size:0.85em">${esc(tok.slice(1, -1))}</code>`;
    else {
      const lm = tok.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (lm) {
        const raw = lm[2];
        const inner = isSiteLink(raw, ctx.host);
        const href = inner ? decorateUtm(raw, ctx.host, ctx.campaign) : raw;
        out += `<a href="${esc(href)}"${inner ? '' : ' target="_blank" rel="noopener noreferrer"'} style="color:#9aa0ff">${esc(lm[1])}</a>`;
      } else out += esc(tok);
    }
    last = m.index + tok.length;
  }
  if (last < text.length) out += esc(text.slice(last));
  return out;
}

function renderMdToHtml(content, ctx) {
  const lines = String(content || '').split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const t = line.trim();
    if (!t) { i++; continue; }

    if (/^#{1,3}\s/.test(t)) {
      const level = t.match(/^(#{1,3})/)[1].length;
      const text = t.replace(/^#{1,3}\s/, '');
      const tag = level === 1 ? 'h2' : level === 2 ? 'h3' : 'h4';
      out.push(`<${tag} style="margin:22px 0 8px;line-height:1.4">${inlineMd(text, ctx)}</${tag}>`);
      i++; continue;
    }

    if (/^---\s*$/.test(t)) { out.push('<hr style="border:none;border-top:1px solid #2c2c44;margin:18px 0">'); i++; continue; }

    if (/^!\[[^\]]*\]\([^)]*\)\s*$/.test(t)) {
      const m = t.match(/^!\[([^\]]*)\]\(([^)]*)\)/);
      const src = m[2].startsWith('/') ? `${ctx.origin}${m[2]}` : m[2];
      out.push(`<figure style="margin:18px 0;text-align:center"><img src="${esc(src)}" alt="${esc(m[1])}" loading="lazy" style="width:100%;max-width:720;border-radius:12px;border:1px solid #2c2c44;display:block;margin:0 auto;background:rgba(255,255,255,0.04)">${m[1] ? `<figcaption style="font-size:12px;color:#8b8ba3;margin-top:8px">${esc(m[1])}</figcaption>` : ''}</figure>`);
      i++; continue;
    }

    if (/^>\s/.test(t)) {
      const block = [];
      while (i < lines.length && /^>\s?/.test(lines[i].trim())) {
        block.push(`<p style="margin:0 0 6px">${inlineMd(lines[i].trim().replace(/^>\s?/, ''), ctx)}</p>`);
        i++;
      }
      out.push(`<blockquote style="border-left:3px solid #7c5cff;padding:4px 14px;margin:12px 0;color:#c9c9e0;background:rgba(124,92,255,0.07);border-radius:8px">${block.join('')}</blockquote>`);
      continue;
    }

    if (/^[-*]\s/.test(t)) {
      const items = [];
      while (i < lines.length && /^[-*]\s/.test(lines[i].trim())) {
        items.push(`<li style="margin:4px 0">${inlineMd(lines[i].trim().replace(/^[-*]\s/, ''), ctx)}</li>`);
        i++;
      }
      out.push(`<ul style="margin:8px 0;padding-left:20px">${items.join('')}</ul>`);
      continue;
    }

    if (/^\d+\.\s/.test(t)) {
      const items = [];
      while (i < lines.length && /^\d+\.\s/.test(lines[i].trim())) {
        items.push(`<li style="margin:4px 0">${inlineMd(lines[i].trim().replace(/^\d+\.\s/, ''), ctx)}</li>`);
        i++;
      }
      out.push(`<ol style="margin:8px 0;padding-left:20px">${items.join('')}</ol>`);
      continue;
    }

    const para = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,3}\s|[-*]\s|\d+\.\s|>\s|---\s*$|!\[[^\]]*\]\([^)]*\)\s*$)/.test(lines[i].trim())) {
      para.push(lines[i].trim());
      i++;
    }
    out.push(`<p style="margin:8px 0;line-height:1.7">${inlineMd(para.join(' '), ctx)}</p>`);
  }
  return out.join('\n');
}

function metaDescription(article) {
  if (article.excerpt) return article.excerpt.slice(0, 200);
  const plain = String(article.content || '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[#*`>_\-]/g, '').replace(/\s+/g, ' ').trim();
  return plain.slice(0, 200);
}

function head({ origin, title, description, canonical, ogImage, jsonLd = [] }) {
  const schemas = [
    { '@context': 'https://schema.org', '@type': 'WebSite', name: 'ApexCore', url: origin },
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
<meta property="og:type" content="article">
<meta property="og:site_name" content="ApexCore">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(canonical)}">
<meta property="og:image" content="${esc(ogImage)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:type" content="image/png">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${esc(ogImage)}">
<meta name="robots" content="index,follow">
${ld}
</head>
<body style="margin:0;background:#0b0b13;color:#e6e6f0;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;line-height:1.6">
<main style="max-width:820px;margin:0 auto;padding:28px 20px 60px">`;
}

function foot({ origin, articleSlug }) {
  const ctx = { host: '', campaign: articleSlug || '' };
  const latest = db.prepare("SELECT slug, title FROM articles WHERE status='published' AND slug != ? ORDER BY published_at DESC LIMIT 3").all(articleSlug || '');
  const links = latest.map((a) => `<li><a style="color:#9aa0ff;text-decoration:none" href="${origin}/blog/${esc(a.slug)}">${esc(a.title)}</a></li>`).join('');
  void ctx;
  return `
<footer style="margin-top:52px;padding-top:22px;border-top:1px solid #26263a;color:#8b8ba3;font-size:13px">
${links ? `<p><b>Latest guides</b></p><ul>${links}</ul>` : ''}
<p><a style="color:#9aa0ff;text-decoration:none" href="${origin}/blog">All articles</a> &middot; <a style="color:#9aa0ff;text-decoration:none" href="${origin}/pc/compare">Compare tool</a> &middot; <a style="color:#9aa0ff;text-decoration:none" href="${origin}/compare/gpus">GPU comparisons</a> &middot; <a style="color:#9aa0ff;text-decoration:none" href="${origin}/fps">Game FPS pages</a> &middot; <a style="color:#9aa0ff;text-decoration:none" href="${origin}/pricing">Plans &amp; pricing</a></p>
</footer>
</main>
</body>
</html>`;
}

function ogImageFor(origin, slug) {
  const local = path.join(FRONTEND_DIST, 'og', 'blog', `${slug}.png`);
  const rel = fs.existsSync(local) ? `/og/blog/${slug}.png` : '/og/article.png';
  return `${origin}${rel}`;
}

// GET /blog - crawlable listing of published articles.
router.get('/blog', (req, res) => {
  const origin = originOf(req);
  const articles = published();
  const title = 'ApexCore Blog - PC gaming performance guides';
  const description = 'Guides on FPS, CPU and GPU bottlenecks, verified hardware and PC building - written from ApexCore\'s verified performance data.';
  const cards = articles.map((a) => `
    <article style="background:#12121e;border:1px solid #2c2c44;border-radius:12px;padding:16px 18px;margin:0 0 14px">
      <h2 style="margin:0 0 6px;font-size:19px;line-height:1.35"><a style="color:#e6e6f0;text-decoration:none" href="${origin}/blog/${esc(a.slug)}">${esc(a.title)}</a></h2>
      <p style="margin:0 0 8px;color:#a8a8c4;font-size:14px">${esc(metaDescription(a))}</p>
      <p style="margin:0;font-size:12px;color:#8b8ba3">${esc(a.author_name || 'ApexCore')} &middot; ${esc(String(a.published_at).slice(0, 10))}</p>
    </article>`).join('');
  const html = head({
    origin, title, description,
    canonical: `${origin}/blog`,
    ogImage: `${origin}/og/article.png`,
    jsonLd: [{ '@context': 'https://schema.org', '@type': 'Blog', name: 'ApexCore Blog', url: `${origin}/blog`, description }],
  }) + `
<header style="margin-bottom:24px">
<div style="color:#9aa0ff;font-size:13px;letter-spacing:1px;text-transform:uppercase">Blog</div>
<h1 style="font-size:30px;margin:8px 0 6px">${esc(title)}</h1>
<p style="color:#a8a8c4">${esc(description)}</p>
<p style="font-size:13px"><a style="color:#9aa0ff;text-decoration:none" href="${origin}/">ApexCore home</a></p>
</header>${cards}` + foot({ origin });
  res.type('html').set('Cache-Control', 'public, max-age=900').send(html);
});

// GET /blog/:slug - fully rendered article page with Article JSON-LD.
router.get('/blog/:slug', (req, res) => {
  const slug = String(req.params.slug);
  const origin = originOf(req);
  const host = new URL(origin).host;
  const a = db.prepare("SELECT slug, title, excerpt, content, tags, author_name, published_at FROM articles WHERE slug = ? AND status = 'published'").get(slug);
  if (!a) {
    res.status(404).type('html').send(head({
      origin, title: 'Article not found - ApexCore', description: 'The article you are looking for does not exist.',
      canonical: `${origin}/blog`, ogImage: `${origin}/og/article.png`,
    }) + `<p>The article you are looking for does not exist.</p><p><a style="color:#9aa0ff;text-decoration:none" href="${origin}/blog">Back to the blog</a></p>` + foot({ origin }));
    return;
  }
  const title = `${a.title} - ApexCore Blog`;
  const description = metaDescription(a);
  const bodyHtml = renderMdToHtml(a.content, { host, origin, campaign: a.slug });
  const words = String(a.content || '').split(/\s+/).filter(Boolean).length;
  const readMins = Math.max(1, Math.round(words / 200));
  const ogImage = ogImageFor(origin, a.slug);
  const publishedIso = isoUtc(a.published_at) || new Date().toISOString();
  const jsonLd = [
    { '@context': 'https://schema.org', '@type': 'Article', headline: a.title, description, image: ogImage, datePublished: publishedIso, author: { '@type': 'Person', name: a.author_name || 'ApexCore' }, publisher: { '@type': 'Organization', name: 'ApexCore', url: origin } },
    { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [{ '@type': 'ListItem', position: 1, name: 'Home', item: origin }, { '@type': 'ListItem', position: 2, name: 'Blog', item: `${origin}/blog` }, { '@type': 'ListItem', position: 3, name: a.title }] },
  ];
  const html = head({ origin, title, description, canonical: `${origin}/blog/${a.slug}`, ogImage, jsonLd }) + `
<header style="margin-bottom:20px">
<div style="color:#9aa0ff;font-size:13px;letter-spacing:1px;text-transform:uppercase">ApexCore Blog</div>
<h1 style="font-size:30px;line-height:1.25;margin:8px 0 8px">${esc(a.title)}</h1>
<p style="margin:0;color:#8b8ba3;font-size:13px">By ${esc(a.author_name || 'ApexCore')} &middot; ${esc(String(a.published_at).slice(0, 10))} &middot; ${readMins} min read</p>
<p style="font-size:13px"><a style="color:#9aa0ff;text-decoration:none" href="${origin}/">ApexCore home</a> &middot; <a style="color:#9aa0ff;text-decoration:none" href="${origin}/blog">All articles</a></p>
</header>
<article style="font-size:15.5px">${bodyHtml}</article>
<div style="margin-top:28px;padding:18px;background:#12121e;border:1px solid #2c2c44;border-radius:12px">
<p style="margin:0 0 10px;color:#e6e6f0"><b>Try it on your own PC</b></p>
<p style="margin:0;color:#a8a8c4;font-size:14px">Check real numbers for your hardware - free tools for <a style="color:#9aa0ff;text-decoration:none" href="${origin}/pc/compare?utm_source=blog&utm_medium=article&utm_campaign=${encodeURIComponent(a.slug)}&utm_content=cta-compare">comparing parts</a>, <a style="color:#9aa0ff;text-decoration:none" href="${origin}/pc/fps?utm_source=blog&utm_medium=article&utm_campaign=${encodeURIComponent(a.slug)}&utm_content=cta-fps">estimating FPS</a> and <a style="color:#9aa0ff;text-decoration:none" href="${origin}/pc/gamecheck?utm_source=blog&utm_medium=article&utm_campaign=${encodeURIComponent(a.slug)}&utm_content=cta-gamecheck">checking a game</a>.</p>
</div>` + foot({ origin, articleSlug: a.slug });
  res.type('html').set('Cache-Control', 'public, max-age=900').send(html);
});

export default router;
