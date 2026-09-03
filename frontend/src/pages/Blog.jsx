import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';
import { useI18n } from '../i18n/index.jsx';
import { useSeo } from '../hooks/useSeo.js';
import { track, sitePathWithUtm } from '../utils/analytics.js';

export default function Blog() {
  const { t } = useI18n();
  const [articles, setArticles] = useState(null);
  const [q, setQ] = useState('');
  const [tag, setTag] = useState('');
  const [total, setTotal] = useState(0);

  useSeo({
    title: t('blog.title'),
    description: t('blog.sub'),
    jsonLd: [{
      '@context': 'https://schema.org',
      '@type': 'Blog',
      name: 'ApexCore Blog',
      description: t('blog.sub'),
    }].concat(articles && articles.length ? [{
      '@context': 'https://schema.org',
      '@type': 'ItemList',
      itemListElement: articles.map((a, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        url: `${window.location.origin}/blog/${a.slug}`,
        name: a.title,
      })),
    }] : []),
  });

  useEffect(() => {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (tag) params.set('tag', tag);
    api.get(`/articles?${params}`)
      .then((d) => { setArticles(d.articles); setTotal(d.total); })
      .catch(() => setArticles([]));
  }, [q, tag]);

  const allTags = articles ? [...new Set(articles.flatMap((a) => a.tags))].slice(0, 12) : [];

  return (
    <div className="page" style={{ maxWidth: 980, margin: '0 auto', padding: '0 22px' }}>
      <div className="bg-fx" /><div className="bg-grid" />
      <div style={{ padding: '34px 0 6px' }}>
        <div className="kicker">{t('blog.kicker')}</div>
        <h1>{t('blog.title')}</h1>
        <p style={{ color: 'var(--text-dim)', maxWidth: 640 }}>{t('blog.sub')}</p>
      </div>

      <div className="card" style={{ margin: '6px 0 22px', padding: '16px 18px', borderColor: 'rgba(34,211,238,0.35)', background: 'linear-gradient(90deg, rgba(124,92,255,0.10), rgba(34,211,238,0.06))', display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 260px' }}>
          <strong style={{ fontSize: '0.95rem' }}>{t('blog.ctaTitle')}</strong>
          <div style={{ fontSize: '0.82rem', color: 'var(--text-dim)', marginTop: 3 }}>{t('blog.ctaSub')}</div>
        </div>
        <Link
          to={sitePathWithUtm('/pc', { medium: 'listing', content: 'top-cta' })}
          className="btn btn-primary"
          onClick={() => track('cta_click', { cta: 'blog_tools', item_name: 'pc_hub' })}
        >{t('blog.ctaGo')}</Link>
      </div>

      <div className="pill-row" style={{ margin: '16px 0 22px', gap: 8 }}>
        <input
          className="input"
          style={{ flex: 1, minWidth: 200, maxWidth: 420 }}
          placeholder={t('blog.searchPlaceholder')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        {allTags.map((tg) => (
          <button key={tg} className={`chip${tag === tg ? ' chip-on' : ''}`} onClick={() => setTag(tag === tg ? '' : tg)}>{tg}</button>
        ))}
      </div>

      {articles === null && <div className="card" style={{ padding: 24 }}>{t('common.loading')}</div>}
      {articles !== null && articles.length === 0 && (
        <div className="card" style={{ padding: 26, textAlign: 'center' }}>{t('blog.empty')}</div>
      )}

      <div className="feature-grid">
        {articles?.map((a) => (
          <Link key={a.id} to={`/blog/${a.slug}`} style={{ textDecoration: 'none' }}>
            <div className="card hover" style={{ padding: 20, height: '100%', display: 'flex', flexDirection: 'column' }}>
              <div style={{ height: 4, borderRadius: 4, background: 'var(--primary-grad)', marginBottom: 12 }} />
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
                {(a.tags || []).slice(0, 3).map((tg) => <span key={tg} className="badge badge-primary" style={{ fontSize: '0.68rem' }}>{tg}</span>)}
              </div>
              <h3 style={{ margin: '0 0 8px', fontSize: '1.05rem', lineHeight: 1.3 }}>{a.title}</h3>
              <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-dim)', flex: 1 }}>{a.excerpt || a.title}</p>
              <div style={{ marginTop: 12, fontSize: '0.75rem', color: 'var(--text-faint)' }}>
                {t('blog.by')} {a.author_name} · {String(a.published_at).slice(0, 10)}
              </div>
            </div>
          </Link>
        ))}
      </div>

      {articles !== null && articles.length > 0 && (
        <p style={{ marginTop: 20, textAlign: 'center', color: 'var(--text-dim)', fontSize: '0.82rem' }}>
          {total} {t('blog.articles')}
        </p>
      )}
    </div>
  );
}
