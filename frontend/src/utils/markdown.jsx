import { Fragment } from 'react';

// Minimal, safe markdown renderer for admin-authored articles.
// Produces React elements only — no dangerouslySetInnerHTML.

function escapeText(s) {
  return String(s);
}

function parseInline(text) {
  const parts = [];
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index > last) parts.push(<Fragment key={last}>{escapeText(text.slice(last, m.index))}</Fragment>);
    const tok = m[0];
    let node;
    if (tok.startsWith('**')) {
      node = <strong key={m.index}>{parseInline(tok.slice(2, -2))}</strong>;
    } else if (tok.startsWith('*')) {
      node = <em key={m.index}>{parseInline(tok.slice(1, -1))}</em>;
    } else if (tok.startsWith('`')) {
      node = <code key={m.index} style={{ background: 'rgba(124,92,255,0.12)', padding: '1px 6px', borderRadius: 6, fontSize: '0.85em' }}>{escapeText(tok.slice(1, -1))}</code>;
    } else {
      const lm = tok.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      node = <a key={m.index} href={lm[2]} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)' }}>{lm[1]}</a>;
    }
    parts.push(node);
    last = m.index + tok.length;
  }
  if (last < text.length) parts.push(<Fragment key="end">{escapeText(text.slice(last))}</Fragment>);
  return parts;
}

export function renderArticle(content) {
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
      out.push(<Tag key={i} style={{ margin: '22px 0 8px' }}>{parseInline(text)}</Tag>);
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
        block.push(parseInline(lines[i].trim().replace(/^>\s?/, '')));
        i++;
      }
      out.push(<blockquote key={i} style={{ borderLeft: '3px solid var(--primary)', padding: '4px 14px', margin: '12px 0', color: 'var(--text-dim)', background: 'rgba(124,92,255,0.07)', borderRadius: 8 }}>{block}</blockquote>);
      continue;
    }

    if (/^[-*]\s/.test(trimmed)) {
      const items = [];
      while (i < lines.length && /^[-*]\s/.test(lines[i].trim())) {
        items.push(<li key={i} style={{ margin: '4px 0' }}>{parseInline(lines[i].trim().replace(/^[-*]\s/, ''))}</li>);
        i++;
      }
      out.push(<ul key={i} style={{ margin: '8px 0', paddingLeft: 20 }}>{items}</ul>);
      continue;
    }

    if (/^\d+\.\s/.test(trimmed)) {
      const items = [];
      while (i < lines.length && /^\d+\.\s/.test(lines[i].trim())) {
        items.push(<li key={i} style={{ margin: '4px 0' }}>{parseInline(lines[i].trim().replace(/^\d+\.\s/, ''))}</li>);
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
    out.push(<p key={i} style={{ margin: '8px 0', lineHeight: 1.7 }}>{parseInline(para.join(' '))}</p>);
  }
  return out;
}
