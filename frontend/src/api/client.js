const TOKEN_KEY = 'gpp_token';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(t) {
  if (t) localStorage.setItem(TOKEN_KEY, t);
  else localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function request(method, path, body) {
  const headers = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`/api${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* non-json */ }
  if (!res.ok || !json?.ok) {
    const msg = json?.message || (res.status === 401 ? 'Session expired. Please sign in again.' : 'Request failed. Please try again.');
    const err = new ApiError(res.status, json?.code || 'ERROR', msg);
    if (res.status === 401 && (json?.code === 'AUTH_INVALID' || json?.code === 'AUTH_REQUIRED')) {
      setToken(null);
    }
    throw err;
  }
  return json.data;
}

export const api = {
  get: (path) => request('GET', path),
  post: (path, body) => request('POST', path, body ?? {}),
  patch: (path, body) => request('PATCH', path, body ?? {}),
  put: (path, body) => request('PUT', path, body ?? {}),
  del: (path) => request('DELETE', path),
  raw: (method, path, body) => request(method, path, body ?? {}),

  /**
   * Streaming SSE request. Calls onDelta(content) as chunks arrive.
   * Resolves with { done: true } or rejects with ApiError carrying the
   * server's error message (e.g. the honest AI-unavailable message).
   */
  async stream(path, body, onDelta) {
    const headers = { 'Content-Type': 'application/json' };
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(`/api${path}`, { method: 'POST', headers, body: JSON.stringify(body ?? {}) });
    if (!res.ok || !res.body) {
      let msg = 'Request failed. Please try again.';
      try { const j = await res.json(); msg = j?.message || msg; } catch { /* ignore */ }
      throw new ApiError(res.status, 'STREAM_ERROR', msg);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === '[DONE]') continue;
        let evt;
        try { evt = JSON.parse(payload); } catch { continue; }
        if (evt.type === 'delta' && evt.content) onDelta(evt.content);
        else if (evt.type === 'error') throw new ApiError(502, evt.code || 'AI_ERROR', evt.message);
        else if (evt.type === 'done') { /* stream complete */ }
      }
    }
    return { done: true };
  },
};
