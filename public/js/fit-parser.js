// ══════════════════════════════════════════════
// FIT File Parser
// ══════════════════════════════════════════════

const FIT_EPOCH = 631065600;
const SPORT_NAMES = {0:'generic',1:'running',2:'cycling',3:'transition',4:'fitness_equipment',5:'swimming',6:'basketball',7:'soccer',8:'tennis',9:'american_football',10:'training',11:'walking',12:'cross_country_skiing',13:'alpine_skiing',14:'snowboarding',15:'rowing',16:'mountaineering',17:'hiking',18:'multisport',19:'paddling',20:'flying',21:'e_biking',22:'motorcycling',23:'boating',24:'driving',25:'golf',26:'hang_gliding',27:'horseback_riding',28:'hunting',29:'fishing',30:'inline_skating',31:'rock_climbing',32:'sailing',33:'ice_skating',34:'sky_diving',35:'snowshoeing',36:'snowmobiling',37:'stand_up_paddleboarding',38:'surfing',39:'wakeboarding',40:'water_skiing',41:'kayaking',42:'rafting',43:'windsurfing',44:'kitesurfing',45:'tactical',46:'jumpmaster',47:'boxing',48:'floor_climbing',53:'diving',62:'hiit',84:'yoga'};

function parseFitFile(buf) {
  const dv = new DataView(buf), u8 = new Uint8Array(buf), fL = buf.byteLength;
  const hS = dv.getUint8(0), dS = dv.getUint32(4, true);
  const sig = String.fromCharCode(u8[8], u8[9], u8[10], u8[11]);
  if (sig !== '.FIT') throw new Error('Not a valid FIT file');

  let p = hS;
  const eP = Math.min(hS + dS, fL);
  log(`[FIT] hdr=${hS} data=${dS}`, 'info');

  const ld = {}, sM = [], rM = [];
  let lT = null;

  while (p < eP && p < fL - 1) {
    const b = u8[p]; p++;

    if (b & 0x80) {
      const lt = (b >> 5) & 3, to = b & 0x1F;
      if (lT != null) {
        if (to >= (lT & 0x1F)) lT = (lT & 0xFFFFFFE0) | to;
        else lT = ((lT & 0xFFFFFFE0) + 0x20) | to;
      }
      const d = ld[lt];
      if (d && p + d.tdb <= fL) {
        const f = readFitFields(dv, u8, p, d);
        if (f && !f[253] && lT) f[253] = lT;
        if (f) dispatchFitMsg(d.gmn, f, sM, rM);
        p += d.tdb;
      }
      continue;
    }

    const lt = b & 0xF, isD = !!(b & 0x40), hD = !!(b & 0x20);

    if (isD) {
      if (p + 5 > fL) break;
      p++; // reserved
      const ar = u8[p]; p++;
      const le = ar === 0;
      const gm = le ? dv.getUint16(p, true) : dv.getUint16(p, false); p += 2;
      const fc = u8[p]; p++;
      if (p + fc * 3 > fL) break;
      const fd = [];
      let bo = 0;
      for (let i = 0; i < fc; i++) {
        const dn = u8[p]; p++;
        const sz = u8[p]; p++;
        const bt = u8[p]; p++;
        fd.push({ dn, sz, bt, bo });
        bo += sz;
      }
      let db = 0;
      if (hD) {
        if (p >= fL) break;
        const dc = u8[p]; p++;
        if (p + dc * 3 > fL) break;
        for (let i = 0; i < dc; i++) { p++; const ds = u8[p]; p++; p++; db += ds; }
      }
      ld[lt] = { gmn: gm, fd, le, tdb: bo + db };
      continue;
    }

    const d = ld[lt];
    if (!d) continue;
    if (p + d.tdb > fL) break;
    const f = readFitFields(dv, u8, p, d);
    p += d.tdb;
    if (f) {
      if (f[253] != null && f[253] > 0 && f[253] < 0xF0000000) lT = f[253];
      dispatchFitMsg(d.gmn, f, sM, rM);
    }
  }

  log(`[FIT] ${sM.length} sessions, ${rM.length} records`, 'ok');
  return assembleActivity(sM, rM);
}

function readFitFields(dv, u8, sp, def) {
  const r = {};
  for (const f of def.fd) {
    const fp = sp + f.bo;
    if (fp + f.sz > u8.length) return null;
    const bt = f.bt & 0x1F;
    let v;
    try {
      switch (bt) {
        case 0: case 2: case 10: v = u8[fp]; break;
        case 1: v = dv.getInt8(fp); break;
        case 3: v = dv.getInt16(fp, def.le); break;
        case 4: case 11: v = dv.getUint16(fp, def.le); break;
        case 5: v = dv.getInt32(fp, def.le); break;
        case 6: case 12: v = dv.getUint32(fp, def.le); break;
        case 7: { let s = ''; for (let j = 0; j < f.sz; j++) { const c = u8[fp + j]; if (!c) break; s += String.fromCharCode(c); } v = s; break; }
        case 8: v = dv.getFloat32(fp, def.le); break;
        case 9: v = dv.getFloat64(fp, def.le); break;
        default:
          if (f.sz === 1) v = u8[fp];
          else if (f.sz === 2) v = dv.getUint16(fp, def.le);
          else if (f.sz === 4) v = dv.getUint32(fp, def.le);
          else v = null;
      }
    } catch (e) { v = null; }

    if (typeof v === 'number') {
      if (f.sz === 1 && (v === 0xFF || v === 0x7F)) v = null;
      else if (f.sz === 2 && (v === 0xFFFF || v === 0x7FFF)) v = null;
      else if (f.sz === 4 && (v === 0xFFFFFFFF || v === 0x7FFFFFFF)) v = null;
    }
    if (v !== null) r[f.dn] = v;
  }
  return r;
}

function dispatchFitMsg(g, f, s, r) {
  if (g === 18) s.push(f);
  else if (g === 20) r.push(f);
}

function fitToDate(t) {
  if (t == null || t <= 0) return null;
  const d = new Date((t + FIT_EPOCH) * 1000);
  return (d.getFullYear() >= 2000 && d.getFullYear() <= 2040) ? d : null;
}

function assembleActivity(sM, rM) {
  const s = sM[0] || {};
  const se = s[5];
  const sport = (se != null && SPORT_NAMES[se]) ? SPORT_NAMES[se] : 'other';

  let sd = fitToDate(s[2]) || fitToDate(s[253]);
  if (!sd) for (const r of rM) { if (r[253]) { sd = fitToDate(r[253]); if (sd) break; } }
  if (!sd) sd = new Date();

  const rt = s[8] || s[7];
  let dur = (rt && rt > 0) ? rt / 1000 : 0;
  if (dur <= 0 && rM.length > 1) {
    const t0 = rM[0]?.[253], t1 = rM[rM.length - 1]?.[253];
    if (t0 && t1) dur = t1 - t0;
  }
  if (dur <= 0) dur = rM.length;

  const rd = s[9];
  const dist = (rd && rd > 0) ? rd / 100 : 0;

  const ha = rM.map(r => r[3]).filter(v => v != null && v > 20 && v < 255);
  const ah = s[16] || (ha.length ? Math.round(ha.reduce((a, b) => a + b, 0) / ha.length) : null);
  const mh = s[17] || (ha.length ? Math.max(...ha) : null);

  const pa = rM.map(r => r[7]).filter(v => v != null && v > 0 && v < 10000);
  const ap = s[20] || (pa.length ? Math.round(pa.reduce((a, b) => a + b, 0) / pa.length) : null);
  const np = computeNormalizedPower(pa);

  const rs = s[44] || s[14];
  let as = (rs && rs > 0) ? rs / 1000 : 0;
  if (as <= 0) {
    const sa = rM.map(r => r[6] || r[73]).filter(v => v != null && v > 0);
    if (sa.length) as = sa.reduce((a, b) => a + b, 0) / sa.length / 1000;
  }

  const cal = (s[11] && s[11] > 0 && s[11] < 50000) ? s[11] : null;

  return {
    sport, startDate: sd, duration: Math.round(dur), distance: Math.round(dist),
    avgHr: ah, maxHr: mh, avgPower: ap, np, avgSpeed: as, calories: cal,
    powerSamples: pa, hrSamples: ha
  };
}

function computeNormalizedPower(s) {
  if (!s || s.length < 30) return null;
  const w = 30, r = [];
  let sm = 0;
  for (let i = 0; i < s.length; i++) {
    sm += s[i]; if (i >= w) sm -= s[i - w];
    if (i >= w - 1) r.push(sm / w);
  }
  return r.length ? Math.round(Math.pow(r.reduce((a, v) => a + v ** 4, 0) / r.length, 0.25)) : null;
}
