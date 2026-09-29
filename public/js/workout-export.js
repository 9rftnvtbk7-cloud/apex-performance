// ══════════════════════════════════════════════
// Workout export: plan session steps → .zwo (Zwift) and .fit (Garmin / Wahoo workout)
// ══════════════════════════════════════════════
// Steps are free text ({ label, duration, target, rest }). parseSessionSteps() turns them into
// intervals the exporters understand. Anything unparseable becomes an "open" step with the text as a
// note, so an export never fails silently. Power targets are fractions of FTP, pace targets fractions
// of threshold speed, both taken from the thresholds valid on the session date.

// "10min", "8 min", "30s", "1h", "1h30", "90sec", "2km", "400m" → { seconds } | { meters } | null
function parseStepDuration(text) {
  const t = String(text || '').toLowerCase().replace(',', '.').trim();
  let m;
  if ((m = t.match(/^(\d+(?:\.\d+)?)\s*h(?:\s*(\d{1,2}))?/))) return { seconds: Math.round(+m[1] * 3600 + (+m[2] || 0) * 60) };
  if ((m = t.match(/^(\d+(?:\.\d+)?)\s*(?:min|mn|')(?:\s*(\d{1,2})\s*(?:s|sec|")?)?/))) return { seconds: Math.round(+m[1] * 60 + (+m[2] || 0)) };
  if ((m = t.match(/^(\d+)\s*(?:s|sec|")/))) return { seconds: +m[1] };
  if ((m = t.match(/^(\d+(?:\.\d+)?)\s*km/))) return { meters: Math.round(+m[1] * 1000) };
  if ((m = t.match(/^(\d+)\s*m(?![a-z])/))) return { meters: +m[1] };
  if ((m = t.match(/^(\d{1,2}):(\d{2})$/))) return { seconds: +m[1] * 60 + +m[2] };
  return null;
}

// Power zone → fraction of FTP (mid-zone); Z1…Z6
const POWER_ZONE_MID = [0.5, 0.65, 0.83, 0.98, 1.13, 1.35];

// "170W", "85%", "85% FTP", "Z2", "Z1-Z2", "≤135 bpm", "140-150bpm", "4:30/km", "Z1 <120W"
// → { power: fraction } | { hr: [lo, hi] } | { pace: m/s } | null
function parseStepTarget(text, th) {
  const t = String(text || '').replace(',', '.');
  let m;
  const ftp = +th.ftp || 200;
  if ((m = t.match(/(\d{2,4})\s*[-–]\s*(\d{2,4})\s*W\b/i))) return { power: (+m[1] + +m[2]) / 2 / ftp };
  if ((m = t.match(/(\d{2,4})\s*W\b/i))) return { power: +m[1] / ftp };
  if ((m = t.match(/(\d{2,3})\s*[-–]\s*(\d{2,3})\s*%/))) return { power: (+m[1] + +m[2]) / 200 };
  if ((m = t.match(/(\d{2,3})\s*%/))) return { power: +m[1] / 100 };
  if ((m = t.match(/(\d{2,3})\s*[-–]\s*(\d{2,3})\s*bpm/i))) return { hr: [+m[1], +m[2]] };
  if ((m = t.match(/[≤<]\s*(\d{2,3})\s*bpm/i))) return { hr: [Math.round(+m[1] * 0.9), +m[1]] };
  if ((m = t.match(/(\d{2,3})\s*bpm/i))) return { hr: [+m[1] - 5, +m[1] + 5] };
  if ((m = t.match(/(\d{1,2}):(\d{2})\s*\/\s*km/))) return { pace: 1000 / (+m[1] * 60 + +m[2]) };
  if ((m = t.match(/Z([1-6])\s*[-–]\s*Z?([1-6])/i))) return { power: (POWER_ZONE_MID[+m[1] - 1] + POWER_ZONE_MID[+m[2] - 1]) / 2, zone: true };
  if ((m = t.match(/Z([1-6])/i))) return { power: POWER_ZONE_MID[+m[1] - 1], zone: true };
  return null;
}

// Session → [{ kind: 'warmup'|'cooldown'|'active'|'rest', name, dur: {seconds}|{meters}|null, target, repeat?, rest? }]
function parseSessionSteps(session, th) {
  const out = [];
  for (const st of session.steps || []) {
    const label = String(st.label || '');
    const reps = label.match(/^(\d+)\s*[×x]\s*(.+)$/i);
    const dur = parseStepDuration(st.duration) || (reps ? parseStepDuration(reps[2]) : parseStepDuration(label));
    const target = parseStepTarget(st.target, th) || parseStepTarget(label, th);
    const kind = /échauff|echauff|warm/i.test(label) ? 'warmup' : /retour|cool|calme/i.test(label) ? 'cooldown' : 'active';
    const step = { kind, name: label, note: [st.target, st.rest].filter(Boolean).join(' · '), dur, target };
    if (reps && +reps[1] > 1) {
      step.repeat = +reps[1];
      if (st.rest) {
        const restDur = parseStepDuration(st.rest);
        const restTarget = parseStepTarget(String(st.rest).replace(/^[\d.,]+\s*(?:min|mn|s|sec|h|km|m)\b/i, ''), th);
        if (restDur) step.rest = { dur: restDur, target: restTarget || { power: 0.5, zone: true } };
      }
    }
    out.push(step);
  }
  return out;
}

// ── ZWO (Zwift) ──
function xmlEscape(s) { return String(s ?? '').replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c])); }

// Fraction for Zwift: power / FTP for rides, speed / threshold speed for runs; HR-only → easy default
function zwoFraction(target, sport, th) {
  if (!target) return 0.6;
  if (target.power != null) return +target.power.toFixed(3);
  if (target.pace != null && sport === 'run') return +(target.pace / paceToSpd(th.pace || '5:00')).toFixed(3);
  if (target.hr) return +(Math.min(1, (target.hr[1] / (+th.lthr || 165))) * 0.9).toFixed(3); // rough HR → intensity
  return 0.6;
}

function buildZwo(session, th) {
  const sport = isRunSport(session.sport) ? 'run' : 'bike';
  const steps = parseSessionSteps(session, th);
  const secs = d => (d && d.seconds) || (d && d.meters ? Math.round(d.meters / (sport === 'run' ? paceToSpd(th.pace || '5:00') : 8)) : 300);
  const text = s => s.note || s.name ? `<textevent timeoffset="0" message="${xmlEscape([s.name, s.note].filter(Boolean).join(' — '))}"/>` : '';
  const body = steps.map(s => {
    const p = zwoFraction(s.target, sport, th);
    if (s.kind === 'warmup') return `    <Warmup Duration="${secs(s.dur)}" PowerLow="${Math.min(0.5, p)}" PowerHigh="${p}">${text(s)}</Warmup>`;
    if (s.kind === 'cooldown') return `    <Cooldown Duration="${secs(s.dur)}" PowerLow="${p}" PowerHigh="${Math.min(0.5, p)}">${text(s)}</Cooldown>`;
    if (s.repeat) {
      const off = s.rest ? zwoFraction(s.rest.target, sport, th) : 0.5;
      return `    <IntervalsT Repeat="${s.repeat}" OnDuration="${secs(s.dur)}" OffDuration="${s.rest ? secs(s.rest.dur) : 60}" OnPower="${p}" OffPower="${off}">${text(s)}</IntervalsT>`;
    }
    return `    <SteadyState Duration="${secs(s.dur)}" Power="${p}">${text(s)}</SteadyState>`;
  }).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<workout_file>
  <author>Apex</author>
  <name>${xmlEscape(session.name)}</name>
  <description>${xmlEscape(session.description || '')}</description>
  <sportType>${sport}</sportType>
  <tags/>
  <workout>
${body}
  </workout>
</workout_file>
`;
}

function isRunSport(s) { return s === 'run' || isRun(s); }

// ── FIT workout (binary) ──
// Minimal FIT writer: file_id (0), workout (26), workout_step (27). Little-endian, CRC-16.
const FIT_CRC_TABLE = [0x0000, 0xCC01, 0xD801, 0x1400, 0xF001, 0x3C00, 0x2800, 0xE401, 0xA001, 0x6C00, 0x7800, 0xB401, 0x5000, 0x9C01, 0x8801, 0x4400];
function fitCrc(bytes, crc = 0) {
  for (const b of bytes) {
    let tmp = FIT_CRC_TABLE[crc & 0xF]; crc = (crc >> 4) & 0x0FFF; crc = crc ^ tmp ^ FIT_CRC_TABLE[b & 0xF];
    tmp = FIT_CRC_TABLE[crc & 0xF]; crc = (crc >> 4) & 0x0FFF; crc = crc ^ tmp ^ FIT_CRC_TABLE[(b >> 4) & 0xF];
  }
  return crc;
}

// field: [number, size, baseType, value]; base types: 0x00 enum, 0x84 uint16, 0x86 uint32, 0x07 string, 0x8C uint32z
function fitMessage(local, global, fields) {
  const out = [];
  out.push(0x40 | local, 0, 0, global & 0xFF, global >> 8, fields.length);
  for (const [num, size, type] of fields) out.push(num, size, type);
  out.push(local);
  for (const [, size, type, value] of fields) {
    if (type === 0x07) { const b = new TextEncoder().encode(String(value)); for (let i = 0; i < size; i++) out.push(i < b.length && i < size - 1 ? b[i] : 0); }
    else for (let i = 0; i < size; i++) out.push((value / 2 ** (8 * i)) & 0xFF); // little-endian
  }
  return out;
}

// Truncate text to at most `max` UTF-8 bytes without splitting a character
function fitString(s, max) {
  let out = '';
  for (const ch of String(s || '')) { if (new TextEncoder().encode(out + ch).length > max - 1) break; out += ch; }
  return out;
}

const FIT_SPORT = { bike: 2, run: 1, swim: 5 };
function fitTarget(target, sport, th) {
  // → [target_type, target_value, low, high]; custom power +1000 W, custom HR +100 bpm, speed mm/s
  if (target && target.power != null) { const w = target.power * (+th.ftp || 200); return [4, 0, Math.round(w * 0.95) + 1000, Math.round(w * 1.05) + 1000]; }
  if (target && target.hr) return [1, 0, target.hr[0] + 100, target.hr[1] + 100];
  if (target && target.pace != null) return [0, 0, Math.round(target.pace * 0.97 * 1000), Math.round(target.pace * 1.03 * 1000)];
  return [2, 0, 0, 0]; // open
}

function buildFitWorkout(session, th, created = new Date()) {
  const sport = FIT_SPORT[session.sport] ?? (isRunSport(session.sport) ? 1 : 2);
  const parsed = parseSessionSteps(session, th);
  const steps = [];
  const push = (name, dur, target, intensity, note) => {
    const [tt, tv, lo, hi] = fitTarget(target, session.sport, th);
    const [dt, dv] = dur && dur.seconds ? [0, dur.seconds * 1000] : dur && dur.meters ? [1, dur.meters * 100] : [5, 0];
    steps.push({ name, dt, dv, tt, tv, lo, hi, intensity, note });
  };
  for (const s of parsed) {
    const intensity = s.kind === 'warmup' ? 2 : s.kind === 'cooldown' ? 3 : 0;
    const first = steps.length;
    push(s.name, s.dur, s.target, intensity, s.note);
    if (s.repeat) {
      if (s.rest) push('Recovery', s.rest.dur, s.rest.target, 1, '');
      steps.push({ repeatFrom: first, count: s.repeat });
    }
  }
  const epoch = Math.round(created.getTime() / 1000) - 631065600; // FIT epoch: 1989-12-31
  let data = [];
  data = data.concat(fitMessage(0, 0, [[0, 1, 0x00, 5], [1, 2, 0x84, 255], [2, 2, 0x84, 1], [3, 4, 0x8C, 1], [4, 4, 0x86, epoch]]));
  data = data.concat(fitMessage(1, 26, [[4, 1, 0x00, sport], [6, 2, 0x84, steps.length], [8, 32, 0x07, fitString(session.name, 32)]]));
  steps.forEach((st, i) => {
    if (st.repeatFrom != null) {
      data = data.concat(fitMessage(2, 27, [[254, 2, 0x84, i], [1, 1, 0x00, 6], [2, 4, 0x86, st.repeatFrom], [3, 1, 0x00, 2], [4, 4, 0x86, st.count]]));
    } else {
      data = data.concat(fitMessage(2, 27, [[254, 2, 0x84, i], [0, 16, 0x07, fitString(st.name, 16)], [1, 1, 0x00, st.dt], [2, 4, 0x86, st.dv],
        [3, 1, 0x00, st.tt], [4, 4, 0x86, st.tv], [5, 4, 0x86, st.lo], [6, 4, 0x86, st.hi], [7, 1, 0x00, st.intensity], [8, 48, 0x07, fitString(st.note, 48)]]));
    }
  });
  const header = [14, 0x20, 0x08, 0x08, 0, 0, 0, 0, 0x2E, 0x46, 0x49, 0x54]; // size, protocol 2.0, profile 2056, data size, ".FIT"
  for (let i = 0; i < 4; i++) header[4 + i] = (data.length >>> (8 * i)) & 0xFF;
  const hcrc = fitCrc(header);
  header.push(hcrc & 0xFF, hcrc >> 8);
  const body = header.concat(data);
  const crc = fitCrc(body);
  body.push(crc & 0xFF, crc >> 8);
  return new Uint8Array(body);
}

// ── Download buttons ──
function workoutFileName(session, ext) { return `${String(session.id || session.name || 'workout').replace(/[^\w.-]+/g, '_').slice(0, 60)}.${ext}`; }

function downloadBlob(data, type, name) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportSessionWorkout(sessionId, kind) {
  const found = typeof findPlanSession === 'function' ? findPlanSession(sessionId) : null;
  if (!found) return;
  const date = sessionDateFor(found.s, planWeekStart(found.week, trainingPlan)) || new Date();
  const th = thresholdsAt(date);
  if (kind === 'zwo') downloadBlob(buildZwo(found.s, th), 'application/xml', workoutFileName(found.s, 'zwo'));
  else downloadBlob(buildFitWorkout(found.s, th), 'application/octet-stream', workoutFileName(found.s, 'fit'));
}

function workoutExportButtonsHtml(s) {
  if (!s.steps || !s.steps.length || !['bike', 'run'].includes(s.sport)) return '';
  const id = escapeHtml(s.id);
  return `<div class="workout-export"><button class="plan-zwo-btn" data-session-id="${id}" onclick="exportSessionWorkout(this.dataset.sessionId, 'zwo')">⬇ .zwo</button><button class="plan-zwo-btn" data-session-id="${id}" onclick="exportSessionWorkout(this.dataset.sessionId, 'fit')">⬇ .fit</button><span class="insight-muted" style="margin:0">Zwift · Garmin/Wahoo (copy to the device)</span></div>`;
}
