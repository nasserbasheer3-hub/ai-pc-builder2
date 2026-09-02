import { config } from '../config.js';
import { db } from '../db.js';
import { spendCredits, refundCredits, InsufficientCreditsError } from '../services/credits.js';

export class AIServiceError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AIServiceError';
  }
}

export function aiEnabled() {
  const setting = db.prepare("SELECT value FROM admin_settings WHERE key = 'ai_enabled'").get();
  if (setting && setting.value === '0') return false;
  return Boolean(config.ai.apiKey);
}

export function getSetting(key, fallback = '') {
  const row = db.prepare('SELECT value FROM admin_settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

/**
 * Call the configured AI API. The API key lives only in the backend env.
 * Throws AIServiceError when unavailable so callers can show the honest
 * "AI service is temporarily unavailable" state.
 */
export async function aiComplete({ feature, system, user, user_id = null }) {
  if (!config.ai.apiKey) {
    throw new AIServiceError('AI service is not configured. Set USER_LLM_API_KEY in the backend environment.');
  }
  const enabled = getSetting('ai_enabled', '1');
  if (enabled === '0') {
    throw new AIServiceError('AI service is disabled by an administrator.');
  }
  if (user_id) spendCredits(user_id, feature);
  const temperature = Number(getSetting('ai_temperature', '0.6'));
  const maxTokens = Number(getSetting('ai_max_tokens', '900'));
  const started = Date.now();
  let success = false;
  let promptTokens = 0;
  let completionTokens = 0;
  let error = null;
  let content = '';
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 45000);
    const res = await fetch(`${config.ai.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.ai.apiKey}`,
      },
      body: JSON.stringify({
        model: config.ai.model,
        messages: [
          ...(system ? [{ role: 'system', content: system }] : []),
          { role: 'user', content: user },
        ],
        temperature,
        max_tokens: maxTokens,
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      error = `AI API responded with ${res.status}`;
      throw new AIServiceError('AI service is temporarily unavailable. Please try again later.');
    }
    const json = await res.json();
    content = json.choices?.[0]?.message?.content || '';
    promptTokens = json.usage?.prompt_tokens || 0;
    completionTokens = json.usage?.completion_tokens || 0;
    success = true;
  } catch (e) {
    if (e instanceof InsufficientCreditsError) throw e;
    if (user_id) {
      try { refundCredits(user_id, feature); } catch { /* refund must not mask the error */ }
    }
    if (e instanceof AIServiceError) throw e;
    error = e.message || 'network error';
    throw new AIServiceError('AI service is temporarily unavailable. Please try again later.');
  } finally {
    try {
      db.prepare(`
        INSERT INTO ai_requests (user_id, feature, model, prompt_tokens, completion_tokens, duration_ms, success, error)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(user_id, feature, config.ai.model, promptTokens, completionTokens, Date.now() - started, success ? 1 : 0, error);
    } catch { /* logging must not break the request */ }
  }
  return { content, model: config.ai.model };
}

/**
 * Streaming chat completion. Yields `{ token, done }` objects as text arrives.
 * Throws AIServiceError on failure so callers surface the honest unavailable state.
 */
export async function* aiStream({ system, user, user_id = null, maxTokens = 1400, feature = 'chat' }) {
  if (!config.ai.apiKey) {
    throw new AIServiceError('AI service is not configured. Set USER_LLM_API_KEY in the backend environment.');
  }
  const enabled = getSetting('ai_enabled', '1');
  if (enabled === '0') {
    throw new AIServiceError('AI service is disabled by an administrator.');
  }
  if (user_id) spendCredits(user_id, feature);
  const temperature = Number(getSetting('ai_temperature', '0.6'));
  const started = Date.now();
  let success = false;
  let content = '';
  let error = null;
  let promptTokens = 0;
  let completionTokens = 0;
  const controller = new AbortController();
  try {
    const res = await fetch(`${config.ai.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.ai.apiKey}`,
      },
      body: JSON.stringify({
        model: config.ai.model,
        messages: [
          ...(system ? [{ role: 'system', content: system }] : []),
          { role: 'user', content: user },
        ],
        temperature,
        max_tokens: maxTokens,
        stream: true,
      }),
      signal: controller.signal,
    });
    if (!res.ok || !res.body) {
      error = `AI API responded with ${res.status}`;
      throw new AIServiceError('AI service is temporarily unavailable. Please try again later.');
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
        if (payload === '[DONE]') { success = true; continue; }
        try {
          const json = JSON.parse(payload);
          const delta = json.choices?.[0]?.delta?.content || '';
          if (delta) {
            content += delta;
            promptTokens = json.usage?.prompt_tokens || promptTokens;
            completionTokens = json.usage?.completion_tokens || completionTokens;
            yield { token: delta, done: false };
          }
        } catch { /* skip malformed chunk */ }
      }
    }
    success = true;
  } catch (e) {
    if (e instanceof InsufficientCreditsError) throw e;
    if (user_id) {
      try { refundCredits(user_id, feature); } catch { /* refund must not mask the error */ }
    }
    if (e instanceof AIServiceError) throw e;
    error = e.message || 'network error';
    throw new AIServiceError('AI service is temporarily unavailable. Please try again later.');
  } finally {
    clearTimeout(0);
    try {
      db.prepare(`
        INSERT INTO ai_requests (user_id, feature, model, prompt_tokens, completion_tokens, duration_ms, success, error)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(user_id, feature, config.ai.model, promptTokens, completionTokens, Date.now() - started, success ? 1 : 0, error);
    } catch { /* logging must not break the request */ }
  }
}
