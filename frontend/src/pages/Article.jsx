import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api/client.js';
import { useI18n } from '../i18n/index.jsx';
import { useSeo } from '../hooks/useSeo.js';
import { renderArticle } from '../utils/markdown.jsx';

export default function ArticlePage() {
  const { slug } = useParams();
  const { t } = useI18n();
  const [article, setArticle] = useState(null);
  const [related, setRelated] = useState([]);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    setArticle(null); setMissing(false);
    api.get(`/articles/${slug}`)
      .then((d) => {
        if (!d.article) { setMissing(true); return; }
        setArticle(d.article);
        setRelated(d.related || []);
      })
      .catch(() => setMissing(true));
  }, [slug]);

  useSeo({
    title: article ? `${article.title} — ApexCore` : t('blog.title'),
    description: article?.excerpt || article?.title || t('blog.sub'),
    image: article ? (String(article.content || '').match(/!\[[^\]]*\]\(([^)]+)\)/)?.[1] || undefined) : undefined,
    jsonLd: article ? [{
      '@context': 'https://schema.org',
      '@type': 'Article',
      headline: article.title,
      description: article.excerpt || article.title,
      datePublished: article.published_at,
      dateModified: article.updated_at,
      author: { '@type': 'Person', name: article.author_name },
      publisher: { '@type': 'Organization', name: 'ApexCore' },
      mainEntityOfPage: `${window.location.origin}/blog/${article.slug}`,
    }, {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Blog', item: `${window.location.origin}/blog` },
        { '@type': 'ListItem', position: 2, name: article.title, item: `${window.location.origin}/blog/${article.slug}` },
      ],
    }] : null,
  }, [article, slug]);

  if (missing) {
    return (
      <div className="page" style={{ maxWidth: 760, margin: '0 auto', padding: '60px 22px', textAlign: 'center' }}>
        <h1>{t('article.notFound')}</h1>
        <p style={{ color: 'var(--text-dim)', margin: '12px 0 20px' }}>{t('article.notFoundSub')}</p>
        <Link to="/blog" className="btn btn-ghost">{t('blog.backToBlog')}</Link>
      </div>
    );
  }

  if (!article) {
    return <div className="page" style={{ maxWidth: 760, margin: '0 auto', padding: '40px 22px' }}><div className="card" style={{ padding: 24 }}>{t('common.loading')}</div></div>;
  }

  return (
    <div className="page" style={{ maxWidth: 820, margin: '0 auto', padding: '0 22px' }}>
      <div className="bg-fx" /><div className="bg-grid" />
      <Link to="/blog" style={{ display: 'inline-block', margin: '26px 0 8px', color: 'var(--accent)', fontSize: '0.85rem', textDecoration: 'none' }}>← {t('blog.backToBlog')}</Link>
      <div style={{ height: 4, borderRadius: 4, background: 'var(--primary-grad)', margin: '6px 0 18px' }} />
      <div className="pill-row" style={{ marginBottom: 12 }}>
        {(article.tags || []).map((tg) => <span key={tg} className="badge badge-primary">{tg}</span>)}
      </div>
      <h1 style={{ fontSize: '1.8rem', lineHeight: 1.25, margin: '0 0 12px' }}>{article.title}</h1>
      <p style={{ color: 'var(--text-dim)', fontSize: '0.85rem' }}>
        {t('article.by')} {article.author_name} · {t('article.published')} {String(article.published_at).slice(0, 10)}
      </p>
      {article.excerpt && (
        <div className="card" style={{ padding: '14px 18px', margin: '18px 0', background: 'rgba(124,92,255,0.06)', borderColor: 'rgba(124,92,255,0.3)' }}>
          <p style={{ margin: 0, fontSize: '0.95rem', lineHeight: 1.6 }}>{article.excerpt}</p>
        </div>
      )}
      <article style={{ fontSize: '0.98rem' }}>{renderArticle(article.content)}</article>

      {related.length > 0 && (
        <>
          <h2 style={{ margin: '40px 0 14px', fontSize: '1.15rem' }}>{t('article.related')}</h2>
          <div className="feature-grid">
            {related.map((r) => (
              <Link key={r.id} to={`/blog/${r.slug}`} style={{ textDecoration: 'none' }}>
                <div className="card hover" style={{ padding: 18, height: '100%' }}>
                  <h4 style={{ margin: '0 0 6px', fontSize: '0.95rem' }}>{r.title}</h4>
                  <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-dim)' }}>{String(r.published_at).slice(0, 10)}</p>
                </div>
              </Link>
            ))}
          </div>
        </>
      )}
      <div style={{ height: 60 }} />
    </div>
  );
}
