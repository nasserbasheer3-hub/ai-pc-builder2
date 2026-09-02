import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useI18n } from '../i18n/index.jsx';
import { Badge, useToast } from '../components/ui.jsx';

const SUGGESTIONS = ['chat.s1', 'chat.s2', 'chat.s3', 'chat.s4', 'chat.s5'];

function loadHistory(uid) {
  try {
    const raw = localStorage.getItem(`gpp_chat_${uid}`);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.slice(-40) : [];
  } catch { return []; }
}
function saveHistory(uid, msgs) {
  try { localStorage.setItem(`gpp_chat_${uid}`, JSON.stringify(msgs.slice(-40))); } catch { /* ignore */ }
}

export default function AiChat() {
  const { user } = useAuth();
  const { t } = useI18n();
  const toast = useToast();
  const uid = user?.id || 'anon';
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [chatCost, setChatCost] = useState(null);
  const scrollRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => { if (uid && uid !== 'anon') setMessages(loadHistory(uid)); }, [uid]);
  useEffect(() => { if (uid && uid !== 'anon') saveHistory(uid, messages); }, [uid, messages]);
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, streaming]);
  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => {
    if (uid && uid !== 'anon') api.get('/billing/me').then((d) => setChatCost(d.costs?.chat ?? null)).catch(() => {});
  }, [uid]);

  const send = async (textOverride) => {
    const content = (textOverride ?? input).trim();
    if (!content || busy) return;
    setInput('');
    const next = [...messages, { role: 'user', content }];
    setMessages(next);
    setBusy(true);
    setStreaming(true);
    setMessages([...next, { role: 'assistant', content: '', streaming: true }]);
    try {
      await api.stream('/ai/chat', { messages: [...next] }, (delta) => {
        setMessages((prev) => {
          const copy = prev.slice();
          const last = copy[copy.length - 1];
          if (last && last.role === 'assistant') {
            copy[copy.length - 1] = { ...last, content: last.content + delta, streaming: true };
          }
          return copy;
        });
      });
      setMessages((prev) => {
        const copy = prev.slice();
        if (copy.length) copy[copy.length - 1] = { ...copy[copy.length - 1], streaming: false, done: true };
        return copy;
      });
    } catch (e) {
      const failMsg = e?.code === 'INSUFFICIENT_CREDITS' ? t('pricing.needCredits') : t('common.aiUnavailable');
      setMessages((prev) => {
        const copy = prev.slice();
        if (copy.length && copy[copy.length - 1].role === 'assistant') {
          const last = copy[copy.length - 1];
          copy[copy.length - 1] = { ...last, content: last.content || failMsg, streaming: false, error: !last.content };
        }
        return copy;
      });
      if (!messages[messages.length - 1]?.content) toast.err(failMsg);
    } finally {
      setBusy(false);
      setStreaming(false);
    }
  };

  const reset = () => {
    setMessages([]);
    saveHistory(uid, []);
    inputRef.current?.focus();
  };

  return (
    <div className="page chat-page">
      <div className="page-head">
        <div className="page-title">
          <h1>🤖 {t('chat.title')}</h1>
          <span className="sub">{t('chat.sub')}</span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Badge tone={streaming ? 'info' : 'ok'}>{streaming ? t('common.typing') : t('common.online')}</Badge>
          <button className="btn btn-ghost btn-sm" onClick={reset} disabled={!messages.length}>{t('chat.newChat')}</button>
        </div>
      </div>

      <div className="chat-card">
        <div className="chat-messages" ref={scrollRef}>
          {messages.length === 0 && (
            <div className="chat-empty">
              <div className="chat-bot-avatar">🤖</div>
              <h3>{t('chat.assistantName')}</h3>
              <p>{t('chat.intro')}</p>
              <div className="chat-suggestions">
                {SUGGESTIONS.map((s) => (
                  <button key={s} className="chip" onClick={() => send(t(s))} disabled={busy}>{t(s)}</button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m, i) => (
            <div key={i} className={`msg ${m.role === 'user' ? 'msg-user' : 'msg-bot'}${m.error ? ' msg-error' : ''}`}>
              {m.role === 'assistant' && <div className="msg-avatar">🤖</div>}
              <div className="bubble">
                <div className="bubble-text">
                  {m.content}
                  {m.streaming && <span className="typing" />}
                </div>
                {m.error && <div className="bubble-note">{t('chat.errorNote')}</div>}
              </div>
            </div>
          ))}
        </div>

        <div className="chat-input">
          <input
            ref={inputRef}
            className="input"
            placeholder={t('chat.placeholder')}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') send(); }}
            disabled={busy}
          />
          <button className="btn btn-primary" onClick={() => send()} disabled={busy || !input.trim()}>
            {busy ? '…' : t('chat.send')}
          </button>
          {chatCost != null && <Badge title={t('chat.costPerMessage')}>−{chatCost} {t('common.credits')}</Badge>}
        </div>
      </div>
    </div>
  );
}
