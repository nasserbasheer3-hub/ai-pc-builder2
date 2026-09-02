import { db } from '../db.js';

const CAT = {
  cpu: 'cpus', gpu: 'gpus', motherboard: 'motherboards', ram: 'memory_modules',
  storage: 'storage', psu: 'psus', case: 'cases', cooler: 'coolers',
};

function fetchParts(ids) {
  const out = {};
  for (const [key, table] of Object.entries(CAT)) {
    const id = ids[key] ?? ids[`${key}_id`];
    if (id) {
      const row = db.prepare(`SELECT * FROM ${table} WHERE id = ? AND enabled = 1`).get(id);
      if (!row) throw new Error(`${key} not found`);
      out[key] = row;
    }
  }
  return out;
}

function parse(v) {
  if (Array.isArray(v)) return v;
  if (!v) return [];
  try { return JSON.parse(v); } catch { return []; }
}

function severityOf(rule, fallback) {
  return ['error', 'warn', 'info'].includes(rule?.severity) ? rule.severity : fallback;
}

// Evaluators are keyed by rule_type. Each receives the selected parts and the
// enabled rule rows of that type. It returns either null (not applicable) or a
// check object { category, status, message, evidence }. When no rule subject
// matches the selected hardware, it returns an honest "unverified" info check.
const RULE_EVALUATORS = {
  cpu_socket(parts, rows) {
    if (!parts.cpu || !parts.motherboard) return null;
    const rule = rows.find((r) => r.subject === parts.cpu.socket);
    if (!rule) return { category: 'cpu', status: 'info', message: `No compatibility rule exists for the ${parts.cpu.socket} CPU socket — compatibility unverified.`, evidence: { cpuSocket: parts.cpu.socket } };
    const allowed = parse(rule.allowed_values);
    if (!allowed.includes(parts.motherboard.socket)) {
      return { category: 'cpu', status: severityOf(rule, 'error'), message: rule.note || `${parts.cpu.socket} CPU requires a motherboard with one of: ${allowed.join(', ')}.`, evidence: { cpuSocket: parts.cpu.socket, mbSocket: parts.motherboard.socket } };
    }
    return { category: 'cpu', status: 'ok', message: `CPU socket ${parts.cpu.socket} matches the motherboard.`, evidence: { socket: parts.cpu.socket } };
  },

  ram_type(parts, rows) {
    if (!parts.ram || !parts.motherboard) return null;
    const rule = rows.find((r) => r.subject === parts.ram.type);
    if (!rule) return { category: 'ram', status: 'info', message: `No compatibility rule exists for ${parts.ram.type} RAM — compatibility unverified.`, evidence: { ramType: parts.ram.type } };
    const allowed = parse(rule.allowed_values);
    if (!allowed.includes(parts.motherboard.ram_type)) {
      return { category: 'ram', status: severityOf(rule, 'error'), message: rule.note || `${parts.ram.type} RAM is not compatible with a ${parts.motherboard.ram_type} motherboard.`, evidence: { ramType: parts.ram.type, mbType: parts.motherboard.ram_type } };
    }
    return { category: 'ram', status: 'ok', message: `${parts.ram.type} memory matches the motherboard.`, evidence: { ramType: parts.ram.type } };
  },

  motherboard_case(parts, rows) {
    if (!parts.motherboard || !parts.case) return null;
    const rule = rows.find((r) => r.subject === parts.motherboard.form_factor);
    if (!rule) return { category: 'case', status: 'info', message: `No compatibility rule exists for the ${parts.motherboard.form_factor} form factor — compatibility unverified.`, evidence: { mbFormFactor: parts.motherboard.form_factor } };
    const supported = parse(parts.case.form_factors);
    const allowed = parse(rule.allowed_values);
    if (!allowed.some((a) => supported.includes(a))) {
      return { category: 'case', status: severityOf(rule, 'error'), message: rule.note || `${parts.motherboard.form_factor} motherboard does not fit in this case (supports ${supported.join(', ')}).`, evidence: { mbFormFactor: parts.motherboard.form_factor, caseFormFactors: supported } };
    }
    return { category: 'case', status: 'ok', message: `${parts.motherboard.form_factor} motherboard fits in the case.`, evidence: { mbFormFactor: parts.motherboard.form_factor } };
  },

  cooler_socket(parts, rows) {
    if (!parts.cooler || !parts.cpu) return null;
    const rule = rows.find((r) => r.subject === parts.cpu.socket);
    if (!rule) return { category: 'cooler', status: 'info', message: `No compatibility rule exists for the ${parts.cpu.socket} socket — cooler compatibility unverified.`, evidence: { socket: parts.cpu.socket } };
    const supported = parse(parts.cooler.socket_support);
    if (!supported.includes(parts.cpu.socket)) {
      return { category: 'cooler', status: severityOf(rule, 'error'), message: rule.note || `Cooler does not support the ${parts.cpu.socket} socket.`, evidence: { socket: parts.cpu.socket } };
    }
    return { category: 'cooler', status: 'ok', message: `Cooler supports ${parts.cpu.socket}.`, evidence: { socket: parts.cpu.socket } };
  },

  storage_interface(parts, rows) {
    if (!parts.storage || !parts.motherboard) return null;
    const rule = rows.find((r) => r.subject === 'NVMe');
    if (parts.storage.interface.includes('NVMe')) {
      const slots = parts.motherboard.m2_slots || 0;
      if (slots < 1) {
        return { category: 'storage', status: 'error', message: 'NVMe drive requires an M.2 slot, which this motherboard does not have.', evidence: { interface: parts.storage.interface, m2Slots: slots } };
      }
      if (slots === 1) {
        return { category: 'storage', status: 'warn', message: rule?.note || 'The motherboard has a single M.2 slot and it will be occupied by this drive.', evidence: { m2Slots: slots } };
      }
      return { category: 'storage', status: 'ok', message: `M.2 NVMe slot available (${slots} total).`, evidence: { m2Slots: slots } };
    }
    return { category: 'storage', status: 'info', message: `${parts.storage.interface} drive connects via SATA — check for available SATA ports.`, evidence: { interface: parts.storage.interface } };
  },

  psu_wattage(parts, rows) {
    if (!parts.psu || !(parts.cpu || parts.gpu)) return null;
    const rule = rows.find((r) => r.subject === 'cpu+gpu');
    const cpuW = parts.cpu ? parts.cpu.tdp_watts : 0;
    const gpuW = parts.gpu ? parts.gpu.tdp_watts : 0;
    const required = cpuW + gpuW + 150;
    const note = rule?.note ? `${rule.note} ` : '';
    if (parts.psu.wattage < required) {
      return { category: 'psu', status: 'error', message: `${note}Estimated system draw ~${required}W exceeds the ${parts.psu.wattage}W PSU. Recommended: at least ${required}W.`, evidence: { drawW: required, psuWattage: parts.psu.wattage } };
    }
    if (parts.psu.wattage < required + 100) {
      return { category: 'psu', status: 'warn', message: `${note}PSU (${parts.psu.wattage}W) covers the ~${required}W estimate with limited headroom for transient spikes.`, evidence: { drawW: required, psuWattage: parts.psu.wattage } };
    }
    return { category: 'psu', status: 'ok', message: `${note}PSU (${parts.psu.wattage}W) has comfortable headroom over the ~${required}W estimated draw.`, evidence: { drawW: required, psuWattage: parts.psu.wattage } };
  },

  pcie_version(parts, rows) {
    if (!parts.gpu || !parts.motherboard) return null;
    const rule = rows.find((r) => r.subject === 'info') || rows[0];
    const note = rule?.note ? `${rule.note} ` : '';
    return { category: 'pcie', status: 'info', message: `${note}GPU (${parts.gpu.pcie_version}) and motherboard (${parts.motherboard.pcie_version}) are PCIe backward compatible. ${parts.gpu.pcie_version < parts.motherboard.pcie_version ? '' : 'Running at the motherboard link version.'}`, evidence: { gpu: parts.gpu.pcie_version, mb: parts.motherboard.pcie_version } };
  },
};

export function checkCompatibility(ids) {
  const parts = fetchParts(ids);
  const checks = [];
  const push = (category, status, message, evidence = {}) => checks.push({ category, status, message, evidence });

  // 1. Rules-driven checks (from the compatibility_rules table).
  const rules = db.prepare('SELECT * FROM compatibility_rules WHERE enabled = 1').all();
  const byType = {};
  for (const r of rules) (byType[r.rule_type] ||= []).push(r);
  for (const [rtype, rows] of Object.entries(byType)) {
    const evalFn = RULE_EVALUATORS[rtype];
    if (!evalFn) continue;
    const result = evalFn(parts, rows);
    if (result) push(result.category, result.status, result.message, result.evidence);
  }

  // 2. Structural checks (not governed by the rules table).
  if (parts.ram && parts.motherboard) {
    if (parts.ram.capacity_gb > parts.motherboard.max_ram_gb) {
      push('ram', 'error', `Memory capacity (${parts.ram.capacity_gb}GB) exceeds motherboard maximum (${parts.motherboard.max_ram_gb}GB).`, {});
    }
    if (parts.ram.modules > parts.motherboard.ram_slots) {
      push('ram', 'error', `${parts.ram.modules} RAM modules but the motherboard only has ${parts.motherboard.ram_slots} slots.`, {});
    } else if (parts.motherboard.ram_slots - parts.ram.modules < 2) {
      push('ram', 'warn', `${parts.ram.modules} of ${parts.motherboard.ram_slots} RAM slots used — limited upgrade headroom.`, {});
    }
    if (parts.ram.speed_mhz > parts.motherboard.max_ram_speed_mhz) {
      push('ram', 'warn', `RAM runs at ${parts.ram.speed_mhz}MHz but the motherboard officially supports up to ${parts.motherboard.max_ram_speed_mhz}MHz (XMP/EXPO may not be guaranteed).`, {});
    }
  }

  if (parts.gpu && parts.case) {
    if (parts.gpu.length_mm > parts.case.max_gpu_length_mm) {
      push('gpu', 'error', `GPU is ${parts.gpu.length_mm}mm long but the case allows up to ${parts.case.max_gpu_length_mm}mm.`, {});
    } else {
      const headroom = parts.case.max_gpu_length_mm - parts.gpu.length_mm;
      push('gpu', headroom < 20 ? 'warn' : 'ok', `GPU (${parts.gpu.length_mm}mm) fits with ${headroom}mm of clearance.`, {});
    }
  }

  if (parts.cooler && parts.case && parts.cooler.type === 'air' && parts.cooler.height_mm) {
    if (parts.cooler.height_mm > parts.case.max_cooler_height_mm) {
      push('cooler', 'error', `Air cooler height (${parts.cooler.height_mm}mm) exceeds case limit (${parts.case.max_cooler_height_mm}mm).`, {});
    } else {
      push('cooler', 'ok', `Cooler height (${parts.cooler.height_mm}mm) fits the case.`, {});
    }
  }

  if (parts.psu && parts.gpu) {
    const connectors = parse(parts.gpu.power_connectors);
    if (connectors.includes('12VHPWR') && !parts.psu.has_12vhpwr) {
      if (parts.psu.pcie_connectors_8pin >= 2) {
        push('psu', 'warn', `GPU uses a 12VHPWR connector; this PSU has no native 12VHPWR — use the included 8-pin to 12VHPWR adapter (if provided).`, {});
      } else {
        push('psu', 'error', `GPU needs 12VHPWR but the PSU has no 12VHPWR connector and fewer than 2 PCIe 8-pin outputs.`, {});
      }
    } else if (connectors.includes('12VHPWR') && parts.psu.has_12vhpwr) {
      push('psu', 'ok', `PSU provides a native 12VHPWR connector for the GPU.`, {});
    }
    const need8pin = connectors.filter((c) => c.includes('8-pin')).length;
    if (need8pin > 0 && parts.psu.pcie_connectors_8pin < need8pin) {
      push('psu', 'error', `GPU requires ${need8pin} PCIe 8-pin connector(s) but the PSU provides ${parts.psu.pcie_connectors_8pin}.`, {});
    }
  }

  if (parts.cpu && parts.motherboard && parts.motherboard.bios_notes) {
    push('bios', 'warn', `BIOS note: ${parts.motherboard.bios_notes}`, {});
  }

  const errors = checks.filter((c) => c.status === 'error').length;
  const warns = checks.filter((c) => c.status === 'warn').length;
  const infos = checks.filter((c) => c.status === 'info').length;
  const status = errors > 0 ? 'incompatible' : warns > 0 ? 'compatible_with_notes' : 'compatible';

  // --- Compatibility score -------------------------------------------------
  // Transparent point model: start at 100 and subtract a fixed, documented
  // penalty per finding (error −30, warning −8, info −1). The floor is 0. The
  // score reflects only the checks that could be evaluated from the selected
  // parts; `coverage` reports how many of the 8 part slots were selected so a
  // partial build is never mistaken for a fully verified one.
  const SCORE_PENALTIES = { error: 30, warn: 8, info: 1 };
  const deductions = checks
    .filter((c) => SCORE_PENALTIES[c.status])
    .map((c) => ({ category: c.category, status: c.status, penalty: SCORE_PENALTIES[c.status], message: c.message }));
  const totalPenalty = deductions.reduce((s, d) => s + d.penalty, 0);
  const score = Math.max(0, 100 - totalPenalty);
  const verdict = score >= 90 ? 'excellent' : score >= 75 ? 'good' : score >= 50 ? 'fair' : 'poor';
  const selectedCount = Object.values(parts).filter(Boolean).length;

  return {
    status,
    score,
    scoreVerdict: verdict,
    scoreFormula: '100 − Σ(penalty per finding: error −30, warning −8, info −1)',
    scoreBreakdown: deductions,
    coverage: { selected: selectedCount, total: 8, percent: Math.round((selectedCount / 8) * 100) },
    summary: errors > 0
      ? `${errors} compatibility problem(s) found.`
      : warns > 0
        ? `Compatible with ${warns} note(s) to review.`
        : infos > 0
          ? `All selected components are compatible (${infos} informational note(s)).`
          : 'All selected components are compatible.',
    checks,
    rulesApplied: Object.keys(byType).length,
    checkedAt: new Date().toISOString(),
  };
}
