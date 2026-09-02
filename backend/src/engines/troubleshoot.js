import { db } from '../db.js';
import { estimatePsu } from './psu.js';

// AI Troubleshooter engine.
//
// Honest design: the platform never guesses silently, so this engine does NOT
// claim to remotely diagnose hardware. It runs a documented, rule-based model
// over (a) the symptom, (b) the user's real, catalog-verified parts when known,
// and (c) the answers the user gives to structured follow-up questions.
// Every "likelihood" is an ESTIMATE from that model and is labeled as such.
// The remaining probability mass below 100% means "cannot be determined
// remotely — needs physical checks". An AI summary is an optional add-on layer
// written only from these engine results, never from invented facts.

export const MAX_PROBABILITY = 85; // no single cause is ever claimed with certainty

function clampProb(n) {
  return Math.max(3, Math.min(MAX_PROBABILITY, Math.round(n)));
}

function part(kind, id) {
  if (!id) return null;
  const table = { cpu: 'cpus', gpu: 'gpus', ram: 'memory_modules', storage: 'storage', psu: 'psus', cooler: 'coolers' }[kind];
  return db.prepare(`SELECT * FROM ${table} WHERE id=? AND enabled=1`).get(id) || null;
}

const Q = {
  q_scope: { id: 'q_scope', options: ['single', 'several', 'all', 'unknown'] },
  q_behavior: { id: 'q_behavior', options: ['crash_desktop', 'freeze_reboot', 'black_screen', 'unknown'] },
  q_heat: { id: 'q_heat', options: ['hot', 'normal', 'unknown'] },
  q_since: { id: 'q_since', options: ['after_driver', 'after_update', 'after_hardware', 'always', 'unknown'] },
  q_oc: { id: 'q_oc', options: ['yes', 'no', 'unknown'] },
  q_when: { id: 'q_when', options: ['load', 'idle', 'random', 'unknown'] },
  q_hot_where: { id: 'q_hot_where', options: ['gpu', 'cpu', 'both', 'unknown'] },
  q_care: { id: 'q_care', options: ['dusty', 'cleaned', 'fine', 'unknown'] },
  q_loadonly: { id: 'q_loadonly', options: ['load_only', 'always', 'unknown'] },
  q_situation: { id: 'q_situation', options: ['new_build', 'after_move', 'after_update', 'sudden', 'unknown'] },
  q_beeps: { id: 'q_beeps', options: ['beeps', 'led', 'silent', 'unknown'] },
  q_fans: { id: 'q_fans', options: ['fans_on', 'nothing', 'spins_stops', 'unknown'] },
  q_error_kind: { id: 'q_error_kind', options: ['specific', 'generic', 'auto_restart', 'unknown'] },
  q_background: { id: 'q_background', options: ['yes', 'no', 'unknown'] },
  q_psu_age: { id: 'q_psu_age', options: ['under2', 'over5', 'unknown'] },
};

export const SYMPTOM_QUESTIONS = {
  crash_gaming: ['q_scope', 'q_behavior', 'q_heat', 'q_since', 'q_oc'],
  random_restart: ['q_when', 'q_heat', 'q_psu_age', 'q_oc', 'q_since'],
  overheating: ['q_hot_where', 'q_loadonly', 'q_care', 'q_heat'],
  no_display: ['q_situation', 'q_beeps', 'q_fans'],
  bsod: ['q_error_kind', 'q_oc', 'q_since', 'q_heat'],
  stutter_fps: ['q_scope', 'q_since', 'q_background', 'q_heat'],
  freeze_system: ['q_scope', 'q_heat', 'q_oc', 'q_since'],
};

const SYMPTOM_LABEL = {
  crash_gaming: 'Games crash or close to the desktop while playing',
  random_restart: 'PC restarts or shuts down on its own',
  overheating: 'PC or components run very hot / fans are loud',
  no_display: 'No display / PC will not boot',
  bsod: 'Blue screen (BSOD) or a system error',
  stutter_fps: 'Stuttering or sudden FPS drops',
  freeze_system: 'Whole PC freezes and needs a hard restart',
};

export function symptomLabel(key) {
  return SYMPTOM_LABEL[key] || key;
}

// Hardware context reduces uncertainty: it can raise evidence for real causes
// (e.g. an under-sized PSU) or lower the probability of causes that require
// hardware the user doesn't have.
function hardwareContext(hw) {
  const ctx = { known: {}, unknown: [] };
  const cpu = part('cpu', hw?.cpuId);
  const gpu = part('gpu', hw?.gpuId);
  const psu = part('psu', hw?.psuId);
  const ram = part('ram', hw?.ramId);
  const cooler = part('cooler', hw?.coolerId);
  if (cpu) ctx.known.cpu = cpu;
  if (gpu) ctx.known.gpu = gpu;
  if (psu) ctx.known.psu = psu;
  if (ram) ctx.known.ram = ram;
  if (cooler) ctx.known.cooler = cooler;

  if (cpu && gpu) {
    const est = estimatePsu({ cpuId: cpu.id, gpuId: gpu.id, coolerId: cooler?.id || null, ramId: ram?.id || null });
    if (est && est.status !== 'unavailable') ctx.estimatedDrawW = est;
  }
  if (psu && ctx.estimatedDrawW) {
    const margin = psu.wattage - ctx.estimatedDrawW.baseDraw;
    ctx.psuHeadroomW = margin;
    ctx.psuUnderpowered = margin < 0;
    ctx.psuTight = margin >= 0 && margin < ctx.estimatedDrawW.recommendedW * 0.15;
  }
  return ctx;
}

function ans(answers, qid) {
  const v = answers?.[qid];
  return v === undefined ? 'unknown' : v;
}

// ---- Cause model: each cause returns [probability, rationale] ----
const CAUSES = {
  psu_underpowered: {
    severity: 'high',
    check: 'Compare your PSU wattage with the PSU Calculator recommendation.',
    fixes: [
      'Use the PSU Calculator to check the recommended wattage for your exact CPU + GPU.',
      'If your PSU is at or below the recommendation, test with a known-good higher-wattage PSU before replacing parts.',
      'Do not add a second PSU; replace it if it is genuinely undersized.',
    ],
  },
  psu_aging: {
    severity: 'medium',
    check: 'PSUs degrade over time; capacitance ages and ripple increases.',
    fixes: [
      'If the PSU is 5+ years old or has survived a surge, test with a known-good replacement.',
      'Check the 12V rail with a monitoring tool (e.g. HWiNFO) during load.',
    ],
  },
  thermal_cpu: {
    severity: 'high',
    check: 'CPU thermal throttling often causes sudden stutters, freezes and restarts.',
    fixes: [
      'Monitor CPU package temperature under load (HWiNFO / MSI Afterburner).',
      'If above ~90°C, clean dust, re-seat the cooler, reapply thermal paste, or check the fan curve.',
    ],
  },
  thermal_gpu: {
    severity: 'high',
    check: 'GPU overheating causes black screens, driver resets and game crashes.',
    fixes: [
      'Monitor GPU temperature and hot-spot under load.',
      'Clean fans/heatsink, improve case airflow, check fan curve; avoid vertical mounts with poor clearance.',
    ],
  },
  gpu_driver: {
    severity: 'medium',
    check: 'Graphics drivers are the most common cause of game crashes and black screens.',
    fixes: [
      'Clean-install the latest driver with DDU (Display Driver Uninstaller) in Safe Mode.',
      'If the issue persists on the newest driver, install the previous stable release.',
    ],
  },
  ram_unstable: {
    severity: 'medium',
    check: 'Unstable memory (often XMP/EXPO) causes crashes, BSODs and random reboots.',
    fixes: [
      'Test with XMP/EXPO disabled first.',
      'Run a memory test (Windows Memory Diagnostic / MemTest86) with default settings.',
      'Update the BIOS; newer AGESA/BIOS often fixes memory stability.',
    ],
  },
  ram_insufficient: {
    severity: 'low',
    check: 'Not enough RAM forces swapping, which causes stutter and freezes in heavy games.',
    fixes: [
      'Check in-game RAM usage and Task Manager while playing.',
      'Close background apps; if usage pins at 100%, add RAM.',
    ],
  },
  cpu_underpowered: {
    severity: 'medium',
    check: 'A CPU below the game\'s requirement causes FPS drops and hitches the game logic.',
    fixes: [
      'Compare your CPU with the game\'s official requirement (Can I Run This Game?).',
      'If far below, lower resolution or quality, or upgrade the CPU.',
    ],
  },
  storage_failing: {
    severity: 'high',
    check: 'Failing or full storage causes crashes while loading and freezes.',
    fixes: [
      'Check drive health (CrystalDiskInfo) and free space (keep 10%+ free).',
      'Back up important data; replace the drive if SMART shows errors.',
    ],
  },
  os_conflict: {
    severity: 'low',
    check: 'Overlays, antivirus or conflicting background apps can crash specific games.',
    fixes: [
      'Disable in-game overlays (Discord, NVIDIA/AMD, Steam) one at a time.',
      'Add the game to antivirus exceptions or close background apps and retest.',
    ],
  },
  windows_corrupt: {
    severity: 'low',
    check: 'Corrupted OS/driver state can cause generic BSODs.',
    fixes: [
      'Run `sfc /scannow` and `DISM /Online /Cleanup-Image /RestoreHealth` in an admin terminal.',
      'Verify Windows is fully updated, then retest.',
    ],
  },
  case_airflow: {
    severity: 'medium',
    check: 'Restricted airflow and dust raise every component temperature.',
    fixes: [
      'Clean dust filters and fans.',
      'Verify front-intake / rear-exhaust orientation; add fans if needed.',
    ],
  },
  cooler_mount: {
    severity: 'high',
    check: 'A loose cooler or missing thermal paste makes a CPU overheat immediately.',
    fixes: [
      'Re-seat the cooler with even pressure and fresh thermal paste.',
      'Confirm the pump spins on AIO liquid coolers.',
    ],
  },
  cable_port: {
    severity: 'low',
    check: 'No display is often a cable/port problem before a hardware failure.',
    fixes: [
      'Plug the cable into the GPU ports (not the motherboard unless using iGPU).',
      'Test another cable, port and monitor.',
    ],
  },
  gpu_seating: {
    severity: 'medium',
    check: 'A half-seated GPU is a common cause of no display right after building.',
    fixes: [
      'Re-seat the GPU fully into the PCIe slot and latch the retention clip.',
      'Plug in the PCIe power connectors firmly.',
    ],
  },
  ram_seating: {
    severity: 'medium',
    check: 'Poorly seated memory prevents POST and can cause silent no-boot.',
    fixes: [
      'Re-seat both RAM sticks in the correct slots (check the motherboard manual).',
      'Test with a single stick at a time.',
    ],
  },
  psu_fail: {
    severity: 'high',
    check: 'A dead PSU gives no power at all (no fans, no lights).',
    fixes: [
      'Test the PSU with a known-good unit or a PSU tester.',
      'If nothing powers on, the PSU or motherboard is the prime suspect.',
    ],
  },
  monitor_issue: {
    severity: 'low',
    check: 'The display itself (or its input) can be the problem.',
    fixes: [
      'Test the monitor with another device.',
      'Try another input source on the monitor.',
    ],
  },
  motherboard_power: {
    severity: 'high',
    check: 'VRM or motherboard power delivery instability can reset the system under load.',
    fixes: [
      'Update the BIOS to the latest stable version.',
      'If it only happens under heavy multi-core load, check VRM temperatures.',
    ],
  },
  bios_instability: {
    severity: 'medium',
    check: 'An unstable BIOS/CPU setting (PBO, voltage) causes random freezes.',
    fixes: [
      'Reset the BIOS to defaults and retest.',
      'If stable on defaults, apply settings back one at a time.',
    ],
  },
};

// Human titles for every possible cause (client i18n may override by cause id).
const CAUSE_TITLES = {
  psu_underpowered: 'Insufficient or failing power supply',
  psu_aging: 'Aging power supply',
  psu_fail: 'Dead power supply',
  thermal_cpu: 'CPU overheating',
  thermal_gpu: 'GPU overheating',
  cooler_mount: 'Cooler mounting or thermal paste problem',
  case_airflow: 'Restricted case airflow',
  gpu_driver: 'Graphics driver fault',
  ram_unstable: 'Unstable memory (XMP/EXPO)',
  ram_insufficient: 'Not enough RAM',
  ram_seating: 'Poorly seated memory',
  cpu_underpowered: 'CPU below the game requirement',
  storage_failing: 'Failing or full storage',
  os_conflict: 'Overlay or background software conflict',
  windows_corrupt: 'Corrupted OS state',
  cable_port: 'Cable or port problem',
  gpu_seating: 'GPU not seated properly',
  monitor_issue: 'Display / input problem',
  motherboard_power: 'Motherboard or BIOS power instability',
  bios_instability: 'Unstable BIOS or CPU settings',
};

function prob(rules) {
  return clampProb(rules.reduce((s, v) => s + (typeof v === 'number' ? v : 0), 0));
}

export function troubleshootAnalysis({ symptom, hardware = {}, answers = {} }) {
  if (!SYMPTOM_QUESTIONS[symptom]) {
    return { status: 'error', message: 'Unknown symptom.' };
  }
  const hw = hardwareContext(hardware);
  const a = (q) => ans(answers, q);
  const rows = [];

  const push = (id, score, rationale) => {
    if (!CAUSES[id]) return;
    const cause = CAUSES[id];
    rows.push({ ...cause, id, title: CAUSE_TITLES[id] || id, probability: clampProb(score), rationale: [rationale].flat() });
  };

  const cpuKnown = hw.known.cpu;
  const gpuKnown = hw.known.gpu;

  // Per-symptom scoring -----------------------------------------------------
  if (symptom === 'crash_gaming') {
    let gpuDriver = 22;
    let thermalGpu = 12;
    let thermalCpu = 8;
    let psu = 14;
    let ramUnstable = 10;
    let osConflict = 10;
    let storage = 4;
    let cpuWeak = 6;
    const scope = a('q_scope');
    if (scope === 'single') { osConflict += 14; gpuDriver += 6; cpuWeak += 4; }
    if (scope === 'all') { psu += 12; ramUnstable += 8; thermalGpu += 8; gpuDriver -= 2; }
    const behavior = a('q_behavior');
    if (behavior === 'freeze_reboot') { psu += 14; thermalGpu += 12; }
    if (behavior === 'black_screen') { gpuDriver += 14; thermalGpu += 14; }
    const heat = a('q_heat');
    if (heat === 'hot') { thermalGpu += 18; thermalCpu += 16; }
    const since = a('q_since');
    if (since === 'after_driver') gpuDriver += 12;
    if (since === 'after_update') { osConflict += 8; gpuDriver += 4; }
    if (since === 'after_hardware') { psu += 6; ramUnstable += 4; }
    if (a('q_oc') === 'yes') ramUnstable += 8;
    if (hw.psuUnderpowered) psu += 22;
    if (hw.psuTight) psu += 8;
    if (cpuKnown && cpuKnown.tdp_watts >= 120 && hw.known.cooler && hw.known.cooler.type === 'air') thermalCpu += 6;
    push('gpu_driver', gpuDriver, 'GPU driver faults are the most frequent trigger for games crashing to the desktop or a black screen.');
    push('thermal_gpu', thermalGpu, heat === 'hot' ? 'Hot components right before the crash point to thermal throttling or shutdown protection.' : 'If the crash happens after long sessions, heat is a likely contributor.');
    push('psu_underpowered', psu, hw.psuUnderpowered ? `Your PSU is ${hw.known.psu.wattage}W, below the ~${hw.estimatedDrawW.recommendedW}W this CPU+GPU realistically needs under gaming spikes.` : 'Random crashes under load are a classic underpowered / aging PSU symptom.');
    push('os_conflict', osConflict, scope === 'single' ? 'A crash in exactly one game often points to an overlay or a game/engine-specific conflict.' : 'Background overlays can destabilize games even without other faults.');
    push('ram_unstable', ramUnstable, 'Unstable memory (especially with XMP/EXPO on) can crash games without warning.');
    push('thermal_cpu', thermalCpu, 'An overheating CPU can trigger a protective shutdown or freeze.');
    push('cpu_underpowered', cpuWeak, 'If the game is CPU-heavy, a weak CPU can hard-crash or hitch the game.');
    push('storage_failing', storage, 'A failing drive can crash the game when it streams textures or levels.');
  } else if (symptom === 'random_restart') {
    let psu = 16;
    let psuAge = 10;
    let thermalCpu = 12;
    let thermalGpu = 12;
    let ramUnstable = 12;
    let mb = 6;
    const when = a('q_when');
    if (when === 'load') { psu += 14; thermalCpu += 10; thermalGpu += 12; }
    if (when === 'idle') { ramUnstable += 10; mb += 8; psu -= 6; }
    if (when === 'random') { ramUnstable += 6; mb += 6; }
    if (a('q_heat') === 'hot') { thermalCpu += 16; thermalGpu += 16; }
    if (a('q_psu_age') === 'over5') { psuAge += 16; psu += 6; }
    if (a('q_oc') === 'yes') { ramUnstable += 8; mb += 4; }
    if (a('q_since') === 'after_hardware') { psu += 8; }
    if (hw.psuUnderpowered) psu += 20;
    if (hw.psuTight) psu += 8;
    push('psu_underpowered', psu, hw.psuUnderpowered ? `Sudden restarts under load with a ${hw.known.psu.wattage}W PSU (needs ~${hw.estimatedDrawW.recommendedW}W) point to the power supply tripping.` : 'Instant shutdowns under load are the classic signature of a PSU hitting its protection limit.');
    push('thermal_cpu', thermalCpu, 'CPU over-temperature protection restarts the PC without a warning.');
    push('thermal_gpu', thermalGpu, 'A GPU thermal trip can power-cycle the whole system.');
    push('ram_unstable', ramUnstable, 'Unstable memory causes random reboots, including at idle.');
    push('psu_aging', psuAge, 'An older PSU loses capacity and trips earlier than its rated wattage.');
    push('motherboard_power', mb, 'VRM or board power-delivery problems can reset under changing load.');
  } else if (symptom === 'overheating') {
    let gpu = 18;
    let cpu = 18;
    let airflow = 14;
    let mount = 10;
    const where = a('q_hot_where');
    if (where === 'gpu') gpu += 18;
    if (where === 'cpu') cpu += 18;
    if (where === 'both') { gpu += 12; cpu += 12; airflow += 8; }
    if (a('q_care') === 'dusty') { airflow += 16; gpu += 6; cpu += 6; }
    if (a('q_care') === 'cleaned') airflow -= 10;
    if (a('q_loadonly') === 'always') { mount += 10; airflow += 6; }
    if (a('q_heat') === 'hot') { gpu += 6; cpu += 6; }
    if (cpuKnown && cpuKnown.tdp_watts >= 120 && hw.known.cooler && hw.known.cooler.type === 'air') cpu += 6;
    push('thermal_gpu', gpu, 'Hot GPU hotspots under load are usually dust, fan curve or airflow related.');
    push('thermal_cpu', cpu, 'A hot CPU often means the cooler cannot handle the TDP or is poorly mounted.');
    push('case_airflow', airflow, 'Restricted or dusty airflow raises every temperature in the case.');
    push('cooler_mount', mount, 'If temperatures are high even at idle, check the cooler mount and paste.');
  } else if (symptom === 'no_display') {
    let cable = 16;
    let gpuSeat = 14;
    let ramSeat = 14;
    let psu = 12;
    let monitor = 12;
    const situ = a('q_situation');
    if (situ === 'new_build') { gpuSeat += 12; ramSeat += 12; cable += 4; }
    if (situ === 'after_move') { gpuSeat += 10; cable += 10; ramSeat += 4; }
    if (situ === 'after_update') { gpuSeat += 8; cable += 4; }
    if (situ === 'sudden') { psu += 10; gpuSeat += 6; }
    if (a('q_fans') === 'nothing') psu += 20;
    if (a('q_fans') === 'spins_stops') psu += 10;
    if (a('q_beeps') === 'beeps') { ramSeat += 12; gpuSeat += 4; }
    push('psu_fail', psu, a('q_fans') === 'nothing' ? 'If absolutely nothing spins or lights, power delivery is the first suspect.' : 'Power problems can prevent POST even when fans briefly spin.');
    push('ram_seating', ramSeat, 'No display with a new build or after a move is frequently just unseated memory.');
    push('gpu_seating', gpuSeat, 'A GPU not fully seated (or missing power) gives a black screen while fans spin.');
    push('cable_port', cable, 'Try the GPU ports and another cable before suspecting hardware.');
    push('monitor_issue', monitor, 'Confirm the monitor and its input source are working.');
  } else if (symptom === 'bsod') {
    let ramUnstable = 18;
    let gpuDriver = 14;
    let storage = 10;
    let win = 10;
    let psu = 8;
    const kind = a('q_error_kind');
    if (kind === 'specific') { ramUnstable += 8; gpuDriver += 4; }
    if (kind === 'auto_restart') { psu += 6; win += 4; }
    if (a('q_oc') === 'yes') ramUnstable += 10;
    if (a('q_since') === 'after_driver') gpuDriver += 12;
    if (a('q_heat') === 'hot') { psu += 6; }
    if (hw.psuUnderpowered) psu += 14;
    push('ram_unstable', ramUnstable, 'Error-code BSODs are dominated by memory instability, especially with XMP/EXPO enabled.');
    push('gpu_driver', gpuDriver, 'Kernel graphics errors (e.g. VIDEO_TDR_*) come from the GPU driver.');
    push('storage_failing', storage, 'Disk-related stop codes point to a failing or corrupt drive.');
    push('windows_corrupt', win, 'Corrupt system files cause generic and driver-related stop errors.');
    push('psu_underpowered', psu, 'An unstable power rail can manifest as stop errors under load.');
  } else if (symptom === 'stutter_fps') {
    let cpuWeak = 14;
    let ramInsuf = 12;
    let gpuDriver = 12;
    let storageSlow = 10;
    let thermal = 8;
    let bg = 10;
    const scope = a('q_scope');
    if (scope === 'all') { cpuWeak += 10; thermal += 8; ramInsuf += 6; }
    if (scope === 'single') { gpuDriver += 6; }
    if (a('q_since') === 'after_driver') gpuDriver += 10;
    if (a('q_background') === 'yes') bg += 12;
    if (a('q_heat') === 'hot') thermal += 14;
    push('cpu_underpowered', cpuWeak, 'Stutter in all games usually means the CPU cannot feed frames fast enough.');
    push('ram_insufficient', ramInsuf, 'Ram pressure causes hitches when the system swaps.');
    push('gpu_driver', gpuDriver, 'Driver regressions cause periodic stutter even at the same average FPS.');
    push('storage_failing', storageSlow, 'Slow storage causes texture pop-in and stutter while loading.');
    push('thermal_cpu', thermal, 'Throttling spikes appear as short, sharp stutters.');
    push('os_conflict', bg, 'Background apps competing for CPU/memory create stutter.');
  } else if (symptom === 'freeze_system') {
    let ramUnstable = 18;
    let storage = 12;
    let thermal = 12;
    let mb = 8;
    let gpuDriver = 8;
    if (a('q_scope') === 'all') { thermal += 8; mb += 6; }
    if (a('q_scope') === 'single') gpuDriver += 10;
    if (a('q_heat') === 'hot') thermal += 16;
    if (a('q_oc') === 'yes') { ramUnstable += 10; mb += 4; }
    if (a('q_since') === 'after_hardware') ramUnstable += 4;
    push('ram_unstable', ramUnstable, 'A total freeze with no error is very often memory instability or a hung driver on a corrupt memory controller state.');
    push('thermal_cpu', thermal, 'Throttling or a thermal event can freeze the system before a shutdown.');
    push('storage_failing', storage, 'A stalled disk can freeze the whole system while it waits on I/O.');
    push('gpu_driver', gpuDriver, 'A hung graphics driver freezes the display and input.');
    push('motherboard_power', mb, 'BIOS/VRM instability can hard-freeze under load.');
  }

  rows.sort((x, y) => y.probability - x.probability);
  const causes = rows.slice(0, 5).map((r, i) => ({ rank: i + 1, ...r }));

  const usedQuestions = SYMPTOM_QUESTIONS[symptom];
  const asked = usedQuestions.filter((qid) => answers[qid] !== undefined && answers[qid] !== 'unknown').length;
  const total = usedQuestions.length;

  return {
    status: 'ok',
    symptom,
    symptomLabel: symptomLabel(symptom),
    label: 'Estimated likelihood',
    evidenceType: 'estimated',
    causeModel: 'Rule-based model from symptom + catalog hardware + your answers. Not a remote diagnosis.',
    hardwareUsed: {
      cpu: cpuKnown ? { id: cpuKnown.id, name: cpuKnown.name } : null,
      gpu: gpuKnown ? { id: gpuKnown.id, name: gpuKnown.name } : null,
      psu: hw.known.psu ? { id: hw.known.psu.id, name: hw.known.psu.name, wattage: hw.known.psu.wattage } : null,
      ram: hw.known.ram ? { id: hw.known.ram.id, name: hw.known.ram.name } : null,
    },
    powerCheck: hw.estimatedDrawW && hw.known.psu
      ? { psuWattage: hw.known.psu.wattage, estimatedDraw: hw.estimatedDrawW.baseDraw, recommendedW: hw.estimatedDrawW.recommendedW, verdict: hw.psuUnderpowered ? 'underpowered' : hw.psuTight ? 'tight' : 'adequate' }
      : null,
    questions: { asked, total },
    causes,
    disclaimer: 'Percentages are estimates from a documented rule-based model, not a diagnosis. They show which cause is most probable to investigate first. The remaining probability belongs to causes that cannot be verified remotely — always confirm with the physical checks listed.',
  };
}

export function symptomDefs() {
  return Object.entries(SYMPTOM_QUESTIONS).map(([key, questions]) => ({
    key,
    label: symptomLabel(key),
    questions: questions.map((qid) => ({ ...Q[qid], id: qid })),
  }));
}

// question text/options are localized on the client via i18n keys built from
// the question id and option value, e.g. trbl.q_scope.text / trbl.q_scope.o.single
export function questionMeta(qid) {
  return Q[qid] || null;
}
