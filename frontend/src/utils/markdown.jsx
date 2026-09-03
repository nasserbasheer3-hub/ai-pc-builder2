import { Fragment } from 'react';
import { sitePathWithUtm } from './analytics.js';

// Minimal, safe markdown renderer for admin-authored articles.
// Produces React elements only — no dangerouslySetInnerHTML.

function escapeText(s) {
  return String(s);
}

// Is the href pointing back into the ApexCore site itself?
function isSiteLink(href) {
  if (/^(#|\?|mailto:|tel:)/.test(href) || !href.trim()) return false;
  if (href.startsWith('/')) return true;
  try {
    return new URL(href, window.location.origin).host === window.location.host;
  } catch { return false; }
}

// Tag internal links with blog campaign params so clicks from an article into
// product pages stay attributable. Only applied when a campaign is provided
// (i.e. on the public article page, not in the admin editor preview).
function decorateHref(href, campaign) {
  if (!campaign || !isSiteLink(href)) return href;
  return sitePathWithUtm(href, { medium: 'article', campaign, content: 'inline-link' });
}

function parseInline(text, campaign = '') {
  const parts = [];
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index > last) parts.push(<Fragment key={last}>{escapeText(text.slice(last, m.index))}</Fragment>);
    const tok = m[0];
    let node;
    if (tok.startsWith('**')) {
      node = <strong key={m.index}>{parseInline(tok.slice(2, -2), campaign)}</strong>;
    } else if (tok.startsWith('*')) {
      node = <em key={m.index}>{parseInline(tok.slice(1, -1), campaign)}</em>;
    } else if (tok.startsWith('`')) {
      node = <code key={m.index} style={{ background: 'rgba(124,92,255,0.12)', padding: '1px 6px', borderRadius: 6, fontSize: '0.85em' }}>{escapeText(tok.slice(1, -1))}</code>;
    } else {
      const lm = tok.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      const inner = isSiteLink(lm[2]);
      node = (
        <a
          key={m.index}
          href={decorateHref(lm[2], campaign)}
          target={inner ? undefined : '_blank'}
          rel={inner ? undefined : 'noopener noreferrer'}
          style={{ color: 'var(--accent)' }}
        >{lm[1]}</a>
      );
    }
    parts.push(node);
    last = m.index + tok.length;
  }
  if (last < text.length) parts.push(<Fragment key="end">{escapeText(text.slice(last))}</Fragment>);
  return parts;
}

export function renderArticle(content, campaign = '') {
  const lines = String(content || '').split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) { i++; continue; }

    if (/^#{1,3}\s/.test(trimmed)) {
      const level = trimmed.match(/^(#{1,3})/)[1].length;
      const text = trimmed.replace(/^#{1,3}\s/, '');
      const Tag = level === 1 ? 'h2' : level === 2 ? 'h3' : 'h4';
      out.push(<Tag key={i} style={{ margin: '22px 0 8px' }}>{parseInline(text, campaign)}</Tag>);
      i++; continue;
    }

    if (/^---\s*$/.test(trimmed)) {
      out.push(<hr key={i} style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '18px 0' }} />);
      i++; continue;
    }

    if (/^!\[[^\]]*\]\([^)]*\)\s*$/.test(trimmed)) {
      const m = trimmed.match(/^!\[([^\]]*)\]\(([^)]*)\)/);
      const src = m[2];
      out.push(
        <figure key={i} style={{ margin: '18px 0', textAlign: 'center' }}>
          <img
            src={src}
            alt={m[1]}
            loading="lazy"
            style={{ width: '100%', maxWidth: 720, borderRadius: 12, border: '1px solid var(--border)', display: 'block', margin: '0 auto', background: 'rgba(255,255,255,0.04)' }}
          />
          {m[1] ? <figcaption style={{ fontSize: '0.8rem', color: 'var(--text-faint)', marginTop: 8 }}>{m[1]}</figcaption> : null}
        </figure>
      );
      i++; continue;
    }

    if (/^>\s/.test(trimmed)) {
      const block = [];
      while (i < lines.length && /^>\s?/.test(lines[i].trim())) {
        block.push(parseInline(lines[i].trim().replace(/^>\s?/, ''), campaign));
        i++;
      }
      out.push(<blockquote key={i} style={{ borderLeft: '3px solid var(--primary)', padding: '4px 14px', margin: '12px 0', color: 'var(--text-dim)', background: 'rgba(124,92,255,0.07)', borderRadius: 8 }}>{block}</blockquote>);
      continue;
    }

    if (/^[-*]\s/.test(trimmed)) {
      const items = [];
      while (i < lines.length && /^[-*]\s/.test(lines[i].trim())) {
        items.push(<li key={i} style={{ margin: '4px 0' }}>{parseInline(lines[i].trim().replace(/^[-*]\s/, ''), campaign)}</li>);
        i++;
      }
      out.push(<ul key={i} style={{ margin: '8px 0', paddingLeft: 20 }}>{items}</ul>);
      continue;
    }

    if (/^\d+\.\s/.test(trimmed)) {
      const items = [];
      while (i < lines.length && /^\d+\.\s/.test(lines[i].trim())) {
        items.push(<li key={i} style={{ margin: '4px 0' }}>{parseInline(lines[i].trim().replace(/^\d+\.\s/, ''), campaign)}</li>);
        i++;
      }
      out.push(<ol key={i} style={{ margin: '8px 0', paddingLeft: 20 }}>{items}</ol>);
      continue;
    }

    const para = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,3}\s|^[-*]\s|^\d+\.\s|^>\s|^---\s*$|^!\[[^\]]*\]\([^)]*\)\s*$)/.test(lines[i].trim())) {
      para.push(lines[i].trim());
      i++;
    }
    out.push(<p key={i} style={{ margin: '8px 0', lineHeight: 1.7 }}>{parseInline(para.join(' '), campaign)}</p>);
  }
  return out;
}
