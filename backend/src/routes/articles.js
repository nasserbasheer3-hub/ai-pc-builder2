import { Router } from 'express';
import { db } from '../db.js';
import { ok } from '../utils/helpers.js';

const router = Router();

const PUBLIC_COLS = 'id, slug, title, excerpt, tags, cover_color, author_name, published_at, updated_at';

// GET /api/articles?page=1&q=&tag=
router.get('/', (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const per = 12;
  const q = (req.query.q || '').trim();
  const tag = (req.query.tag || '').trim();
  const where = ['status = ?'];
  const params = ['published'];
  if (q) { where.push('(title LIKE ? OR excerpt LIKE ? OR content LIKE ?)'); const like = `%${q}%`; params.push(like, like, like); }
  if (tag) { where.push('tags LIKE ?'); params.push(`%"${tag}"%`); }
  const total = db.prepare(`SELECT COUNT(*) c FROM articles WHERE ${where.join(' AND ')}`).get(...params).c;
  const articles = db.prepare(`
    SELECT ${PUBLIC_COLS} FROM articles
    WHERE ${where.join(' AND ')}
    ORDER BY published_at DESC LIMIT ? OFFSET ?
  `).all(...params, per, (page - 1) * per);
  ok(res, { articles: articles.map((a) => ({ ...a, tags: safeTags(a.tags) })), total, page, per, hasMore: page * per < total });
});

// GET /api/articles/:slug
router.get('/:slug', (req, res) => {
  const a = db.prepare(`SELECT ${PUBLIC_COLS}, content FROM articles WHERE slug = ? AND status = 'published'`).get(req.params.slug);
  if (!a) return ok(res, { article: null });
  const tags = safeTags(a.tags);
  const related = db.prepare(`
    SELECT ${PUBLIC_COLS} FROM articles
    WHERE status = 'published' AND id != ? AND tags LIKE ?
    ORDER BY published_at DESC LIMIT 3
  `).all(a.id, tags.length ? `%"${tags[0]}"%` : '%');
  ok(res, { article: { ...a, tags }, related });
});

function safeTags(raw) {
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((x) => typeof x === 'string').slice(0, 8) : [];
  } catch {
    return [];
  }
}

export default router;
