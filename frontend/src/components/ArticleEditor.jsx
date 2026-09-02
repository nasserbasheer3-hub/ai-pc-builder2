import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n/index.jsx';
import { useToast } from './ui.jsx';

let uidCounter = 0;
const uid = () => `b${Date.now().toString(36)}${(uidCounter++).toString(36)}`;

function contentToBlocks(md) {
  const lines = String(md || '').split('\n');
  const blocks = [];
  let text = [];
  for (const line of lines) {
    const m = line.trim().match(/^!\[([^\]]*)\]\(([^)\s]+)\)\s*$/);
    if (m) {
      if (text.length) { blocks.push({ id: uid(), type: 'text', text: text.join('\n') }); text = []; }
      blocks.push({ id: uid(), type: 'image', url: m[2], alt: m[1] || '' });
    } else {
      text.push(line);
    }
  }
  if (text.length) blocks.push({ id: uid(), type: 'text', text: text.join('\n') });
  return blocks;
}

function blocksToContent(blocks) {
  return blocks.map((b) => (b.type === 'image' ? `![${b.alt || ''}](${b.url})` : b.text)).join('\n\n');
}

const ADMIN_KEY = 'gpp_admin_token';

export default function ArticleEditor({ value, onChange }) {
  const { t } = useI18n();
  const toast = useToast();
  const [blocks, setBlocks] = useState(() => contentToBlocks(value));
  const [busy, setBusy] = useState(false);
  const dragIdx = useRef(null);
  const fileRef = useRef(null);

  useEffect(() => { onChange(blocksToContent(blocks)); }, [blocks]);

  const move = (from, to) => {
    if (to < 0 || to >= blocks.length || from === to) return;
    setBlocks((prev) => {
      const next = [...prev];
      const [b] = next.splice(from, 1);
      next.splice(to, 0, b);
      return next;
    });
  };

  const update = (id, patch) => setBlocks((prev) => prev.map((b) => (b.id === id ? { ...b, ...patch } : b)));

  const upload = async (file) => {
    if (!file) return;
    if (!/^image\//.test(file.type)) return toast.err(t('admin.imageType'));
    if (file.size > 5 * 1024 * 1024) return toast.err(t('admin.imageTooLarge'));
    const fd = new FormData();
    fd.append('image', file);
    setBusy(true);
    try {
      const res = await fetch('/api/admin/uploads', {
        method: 'POST',
        headers: { Authorization: `Bearer ${localStorage.getItem(ADMIN_KEY)}` },
        body: fd,
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) throw new Error(json?.message || 'Upload failed.');
      setBlocks((prev) => [...prev, { id: uid(), type: 'image', url: json.data.url, alt: '' }]);
      toast.ok(t('admin.imageUploaded'));
    } catch (e) {
      toast.err(e.message);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const onDropFile = (e, idx) => {
    e.preventDefault();
    const file = e.dataTransfer.files && e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) upload(file);
  };

  return (
    <div>
      <div
        className="editor-blocks"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => onDropFile(e)}
        style={{ display: 'flex', flexDirection: 'column', gap: 10 }}
      >
        {blocks.map((b, i) => (
          <div
            key={b.id}
            draggable
            onDragStart={(e) => { dragIdx.current = i; e.dataTransfer.effectAllowed = 'move'; }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); if (dragIdx.current != null) { move(dragIdx.current, i); dragIdx.current = null; } }}
            style={{ display: 'flex', gap: 10, alignItems: 'flex-start', background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border)', borderRadius: 10, padding: 10, cursor: 'grab' }}
          >
            <span className="editor-drag" title={t('admin.dragToMove')} style={{ cursor: 'grab', opacity: 0.5, userSelect: 'none', marginTop: b.type === 'image' ? 40 : 8 }}>⠿</span>
            {b.type === 'text' ? (
              <textarea
                className="input"
                rows={Math.min(12, Math.max(3, b.text.split('\n').length + 1))}
                value={b.text}
                onChange={(e) => update(b.id, { text: e.target.value })}
                style={{ flex: 1, resize: 'vertical' }}
              />
            ) : (
              <div style={{ flex: 1, display: 'flex', gap: 10, alignItems: 'center' }}>
                <img src={b.url} alt={b.alt} style={{ width: 110, height: 70, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--border)' }} />
                <div style={{ flex: 1 }}>
                  <input className="input" value={b.alt} placeholder={t('admin.imageAlt')} onChange={(e) => update(b.id, { alt: e.target.value })} />
                  <div style={{ marginTop: 6, fontSize: '0.72rem', color: 'var(--text-faint)', wordBreak: 'break-all' }}>{b.url}</div>
                </div>
                <button className="btn btn-danger btn-sm" title={t('admin.removeImage')} onClick={() => setBlocks((prev) => prev.filter((x) => x.id !== b.id))}>✕</button>
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="pill-row" style={{ marginTop: 10 }}>
        <button className="btn btn-ghost btn-sm" onClick={() => fileRef.current?.click()} disabled={busy}>
          {busy ? t('admin.uploading') : `⬆ ${t('admin.uploadImage')}`}
        </button>
        <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => upload(e.target.files && e.target.files[0])} />
        <span style={{ fontSize: '0.72rem', color: 'var(--text-faint)', marginLeft: 4 }}>{t('admin.imageDragHint')}</span>
      </div>
    </div>
  );
}
