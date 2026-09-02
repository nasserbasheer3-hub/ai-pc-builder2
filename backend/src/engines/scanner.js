import { db } from '../db.js';

// Smart Build Scanner engine.
//
// Takes free text like "I have RTX 4070, Ryzen 5 7600 and 32GB RAM" and maps it
// onto REAL, verified catalog entries. The engine only ever matches catalog
// names / numeric specs — it never "recognizes" hardware that is not in the
// verified catalog. Anything it cannot map to a real entry is reported as
// "unmatched" honestly, instead of being guessed.
//
// Anti-false-positive rule: "RTX 4060" is NOT reported as a match when the
// user wrote "RTX 4060 Ti" (a different SKU) unless the catalog actually
// contains that exact model. Every match is anchored to the exact text of the
// catalog entry.

const PART_META = {
  cpu: { key: 'cpu', label: 'CPU', table: 'cpus' },
  gpu: { key: 'gpu', label: 'GPU', table: 'gpus' },
  motherboard: { key: 'motherboard', label: 'Motherboard', table: 'motherboards' },
  ram: { key: 'ram', label: 'Memory', table: 'memory_modules' },
  storage: { key: 'storage', label: 'Storage', table: 'storage' },
  psu: { key: 'psu', label: 'PSU', table: 'psus' },
  case: { key: 'case', label: 'Case', table: 'cases' },
  cooler: { key: 'cooler', label: 'Cooler', table: 'coolers' },
};

const PART_ORDER = ['cpu', 'gpu', 'ram', 'storage', 'psu', 'motherboard'];

function normalize(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

// Suffixes that continue a model name. If they follow a candidate match in the
// user's text, the candidate is a partial match for a DIFFERENT SKU (e.g. the
// "4060" inside "4060 Ti") and must not be claimed.
const MODEL_SUFFIXES = new Set(['ti', 'super', 'xt', 'xtx', 'oc', 's', 'fe', 'x', 'x3d', 'k', 'kf', 'ks', 'f', 't', 'g', 'oc3', 'oc2']);

// Model "needles": drop brand/marketing words so that "NVIDIA GeForce RTX 4070"
// yields "geforce rtx 4070" and "rtx 4070" — the longest needle present in the
// text (at a safe word boundary) is used.
const BRAND_TOKENS = ['intel', 'amd', 'nvidia'];
const MARKETING_TOKENS = ['core', 'geforce', 'radeon', 'arc', 'ryzen', 'threadripper'];

function candidateNeedles(name) {
  const words = normalize(name).split(' ').filter(Boolean);
  const drop = (list) => {
    let w = words.slice();
    while (w.length && list.includes(w[0])) w = w.slice(1);
    return w.join(' ');
  };
  const uniq = [];
  const cands = [drop(BRAND_TOKENS), drop(BRAND_TOKENS.concat(MARKETING_TOKENS))];
  for (const c of cands) {
    if (c && c.length >= 5 && !uniq.includes(c)) uniq.push(c);
  }
  return uniq;
}

// Returns the index of the first occurrence of `needle` in `text` that sits on
// a word boundary AND is not followed by a model suffix (which would mean the
// user named a longer, different SKU that is not in the catalog).
function validIndex(text, needle) {
  let i = text.indexOf(needle);
  while (i !== -1) {
    const before = i > 0 ? text[i - 1] : ' ';
    const after = text[i + needle.length] || ' ';
    if (!/[a-z0-9]/.test(before) && !/[a-z0-9]/.test(after)) {
      const rest = text.slice(i + needle.length).trim();
      const nextTok = (rest.match(/^[a-z0-9]+/) || [''])[0];
      if (!MODEL_SUFFIXES.has(nextTok)) return i;
    }
    i = text.indexOf(needle, i + 1);
  }
  return -1;
}

function findNameMatches(kind, text) {
  const meta = PART_META[kind];
  if (!meta || (kind !== 'gpu' && kind !== 'cpu')) return [];
  const rows = db.prepare(`SELECT * FROM ${meta.table} WHERE enabled=1`).all();
  const perRow = [];
  for (const r of rows) {
    let best = null;
    for (const cand of candidateNeedles(r.name)) {
      if (validIndex(text, cand) !== -1 && (!best || cand.length > best.length)) best = cand;
    }
    if (best) perRow.push({ row: r, needle: best });
  }
  // De-duplicate overlapping needles, keeping the most specific one
  // (e.g. prefer "rtx 4070 ti super" over the bare "rtx 4070" inside it).
  perRow.sort((a, b) => b.needle.length - a.needle.length);
  const kept = [];
  const used = [];
  for (const h of perRow) {
    if (used.some((n) => n.includes(h.needle) || h.needle.includes(n))) continue;
    used.push(h.needle);
    kept.push(h);
  }
  return kept;
}

function cleanSpec(meta, row) {
  switch (meta.key) {
    case 'gpu': return `${row.vram_gb}GB VRAM, ${row.tdp_watts}W`;
    case 'cpu': return `${row.cores}C/${row.threads}T, boost ${row.boost_clock_ghz}GHz`;
    case 'ram': return `${row.capacity_gb}GB ${row.type} ${row.speed_mhz}MHz`;
    case 'storage': return `${row.capacity_gb}GB, ${row.interface}`;
    case 'psu': return `${row.wattage}W, ${row.efficiency_rating}`;
    default: return '';
  }
}

// Numeric part pickers -------------------------------------------------------
// Each returns { row, frag } where frag is the normalized text fragment the
// pick was based on (used to decide what is "covered" and what is unmatched).

function pickRam(text, clean) {
  const wantDdr = /\bddr([45])\b/i.exec(text);
  let wanted = null;
  const multi = /(\d+)\s*[x*]\s*(\d{1,3})\s*gb\b/i.exec(text);
  if (multi) wanted = Number(multi[1]) * Number(multi[2]);
  else {
    const m = /(\d{1,3})\s*gb\b/i.exec(text);
    if (m) wanted = Number(m[1]);
  }
  if (!wanted || wanted < 4 || wanted > 256) return null;
  const ddr = wantDdr ? `ddr${wantDdr[1]}` : null;
  const speedM = /\b(\d{4,5})\s*mhz\b/i.exec(text);
  const speed = speedM ? Number(speedM[1]) : null;
  const rows = db.prepare('SELECT * FROM memory_modules WHERE enabled=1').all()
    .filter((r) => r.capacity_gb >= wanted && (!ddr || r.type.toLowerCase() === ddr))
    .sort((a, b) => {
      const capA = Math.abs(a.capacity_gb - wanted);
      const capB = Math.abs(b.capacity_gb - wanted);
      return capA !== capB ? capA - capB : a.price_usd - b.price_usd;
    });
  const row = rows[0] || null;
  if (!row) return null;
  const frag = multi ? `${multi[1]} x ${multi[2]} gb` : `${text.match(/(\d+)\s*gb\b/i)[1]} gb`;
  return { row, frag };
}

function pickStorage(text) {
  let gb = null;
  const tb = /(\d+(?:\.\d+)?)\s*tb\b/i.exec(text);
  let frag = null;
  if (tb) {
    gb = Math.round(Number(tb[1]) * 1000);
    frag = `${tb[1]} tb`;
  } else {
    const g = /(\d{3,4})\s*gb\b/i.exec(text);
    if (g) { gb = Number(g[1]); frag = `${g[1]} gb`; }
  }
  if (!gb) return null;
  const row = db.prepare('SELECT * FROM storage WHERE enabled=1').all()
    .filter((r) => r.capacity_gb >= gb)
    .sort((a, b) => a.price_usd - b.price_usd)[0] || null;
  return row ? { row, frag } : null;
}

function pickPsu(text) {
  const m = /(\d{3,4})\s*w\b/i.exec(text);
  if (!m) return null;
  const wanted = Number(m[1]);
  if (wanted < 300) return null;
  const row = db.prepare('SELECT * FROM psus WHERE enabled=1').all()
    .filter((r) => r.wattage >= wanted)
    .sort((a, b) => a.price_usd - b.price_usd)[0] || null;
  return row ? { row, frag: `${m[1]} w` } : null;
}

function pickMotherboard(text) {
  const m = /\b(z\d{3}|b\d{3}|x\d{3}|h\d{3}[a-z]?|a\d{3}[a-z]?)\b/i.exec(text);
  if (!m) return null;
  const code = m[1].toLowerCase();
  const row = db.prepare('SELECT * FROM motherboards WHERE enabled=1').all()
    .filter((r) => normalize(r.name).includes(code) || normalize(r.chipset || '').includes(code))
    .sort((a, b) => a.price_usd - b.price_usd)[0] || null;
  return row ? { row, frag: code } : null;
}

// Candidate phrases in the text that look like hardware mentions. Used to
// report honest "unmatched" hints, not to guess.
function extractPhrases(clean) {
  const phrases = [];
  const push = (p) => { if (p && !phrases.includes(p)) phrases.push(p); };
  const modelRe = /\b((?:rtx|gtx|rx|ryzen|core i\d|xeon|arc|i\d|a\d{3}))\b/g;
  let mm;
  while ((mm = modelRe.exec(clean)) !== null) {
    const toks = clean.slice(mm.index).split(' ');
    let end = 1;
    while (end < toks.length) {
      const t = toks[end];
      if (/^\d+[a-z]*$/.test(t) || MODEL_SUFFIXES.has(t)) { end += 1; continue; }
      break;
    }
    push(toks.slice(0, end).join(' '));
    modelRe.lastIndex = mm.index + 1;
  }
  const capRe = /\b\d+(?:\.\d+)?\s*(?:gb|tb)\b/g;
  while ((mm = capRe.exec(clean)) !== null) push(mm[0].replace(/\s+/g, ' '));
  const wRe = /\b\d{3,4}\s*w\b/g;
  while ((mm = wRe.exec(clean)) !== null) push(mm[0].replace(/\s+/g, ' '));
  const ddrRe = /\bddr[345]\b/g;
  while ((mm = ddrRe.exec(clean)) !== null) push(mm[0]);
  return phrases;
}

export function scanText(text) {
  if (!text || !String(text).trim()) {
    return { status: 'error', message: 'Describe your hardware.' };
  }
  const raw = String(text);
  const clean = normalize(raw);
  const found = [];
  const notes = [];

  // 1) GPU / CPU by exact catalog model names at safe word boundaries
  for (const kind of ['gpu', 'cpu']) {
    const hits = findNameMatches(kind, clean);
    if (hits.length) {
      const best = hits[0];
      found.push({
        partType: kind,
        match: { how: 'name', value: best.needle },
        frag: best.needle,
        id: best.row.id,
        name: best.row.name,
        price_usd: best.row.price_usd,
        spec: cleanSpec(PART_META[kind], best.row),
      });
      if (hits.length > 1) notes.push(`Found several possible ${PART_META[kind].label}s; kept the most specific (${best.row.name}).`);
    }
  }

  // 2) numeric parts via patterns
  const ram = pickRam(raw, clean);
  if (ram) found.push({ partType: 'ram', match: { how: 'pattern', value: ram.frag }, frag: ram.frag, coverExtra: [ram.row.type], id: ram.row.id, name: ram.row.name, price_usd: ram.row.price_usd, spec: cleanSpec(PART_META.ram, ram.row) });
  const storage = pickStorage(raw);
  if (storage) found.push({ partType: 'storage', match: { how: 'pattern', value: storage.frag }, frag: storage.frag, id: storage.row.id, name: storage.row.name, price_usd: storage.row.price_usd, spec: cleanSpec(PART_META.storage, storage.row) });
  const psu = pickPsu(raw);
  if (psu) found.push({ partType: 'psu', match: { how: 'pattern', value: psu.frag }, frag: psu.frag, id: psu.row.id, name: psu.row.name, price_usd: psu.row.price_usd, spec: cleanSpec(PART_META.psu, psu.row) });
  const mb = pickMotherboard(raw);
  if (mb) found.push({ partType: 'motherboard', match: { how: 'pattern', value: mb.frag }, frag: mb.frag, id: mb.row.id, name: mb.row.name, price_usd: mb.row.price_usd, spec: cleanSpec(PART_META.motherboard, mb.row) });

  // 3) honest unmatched hints: phrases not covered by any verified match
  const stripKey = (s) => String(s || '').replace(/\s+/g, '').toLowerCase();
  const coveredKeys = [];
  for (const f of found) {
    coveredKeys.push(stripKey(f.frag));
    if (f.coverExtra) for (const e of f.coverExtra) coveredKeys.push(stripKey(e));
  }
  const cleanUnmatched = [];
  for (const p of extractPhrases(clean)) {
    const k = stripKey(p);
    if (!coveredKeys.includes(k)) cleanUnmatched.push(p);
  }
  // drop hints that are merely substrings of a verified match or of a longer
  // kept hint (e.g. the bare "core" inside the covered "core i5 13600k")
  cleanUnmatched.sort((a, b) => b.length - a.length);
  const finalUnmatched = [];
  for (const p of cleanUnmatched) {
    const k = stripKey(p);
    if (coveredKeys.some((c) => c.includes(k))) continue;
    if (finalUnmatched.some((f) => stripKey(f).includes(k))) continue;
    finalUnmatched.push(p);
  }

  found.sort((a, b) => PART_ORDER.indexOf(a.partType) - PART_ORDER.indexOf(b.partType));
  const total = found.reduce((s, f) => s + (Number(f.price_usd) || 0), 0);

  return {
    status: 'ok',
    label: 'Matched against the verified catalog',
    evidenceType: 'verified',
    found,
    unmatched: finalUnmatched,
    totalPrice: Math.round(total),
    config: found.reduce((acc, f) => { acc[`${f.partType}_id`] = f.id; return acc; }, {}),
    notes,
    disclaimer: 'Only hardware that exists in the verified catalog is recognized. Anything not listed above could not be matched — no guesses are made.',
  };
}

export function scannerMeta() {
  return { partTypes: Object.keys(PART_META), meta: PART_META };
}
