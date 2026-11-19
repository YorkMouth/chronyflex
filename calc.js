/* ChronyFlex : logique de calcul pure (sans DOM), testée par tests/calc.test.js
   Utilisable dans le navigateur (window.Calc) et dans Node (require). Toutes les durées sont en minutes. */
(function (root) {
  'use strict';
  const MINUS = '−';

  /* ---------- temps & formats ---------- */
  const toMin = t => { if (!t) return null; const [h, m] = String(t).split(':').map(Number); return isNaN(h) ? null : h * 60 + (m || 0); };
  const hm = m => { if (m == null || isNaN(m)) return '--:--'; m = Math.round(m); const h = Math.floor(m / 60) % 24, r = ((m % 60) + 60) % 60; return String(h).padStart(2, '0') + ':' + String(r).padStart(2, '0'); };
  // 376 → « 6h16 », -70 → « −1h10 »
  const dur = m => { if (m == null || isNaN(m)) return '--'; m = Math.round(m); const s = m < 0 ? MINUS : ''; m = Math.abs(m); return s + Math.floor(m / 60) + 'h' + String(m % 60).padStart(2, '0'); };
  // avec signe : « +6h16 »
  const sdur = m => m == null || isNaN(m) ? '--' : (Math.round(m) >= 0 ? '+' : '') + dur(m);
  // heures décimales : 376.2 → « +6,27 »
  const dec = m => { if (m == null || isNaN(m)) return '--'; const v = Math.round(m / 60 * 100) / 100; return (v > 0 ? '+' : v < 0 ? MINUS : '') + Math.abs(v).toFixed(2).replace('.', ','); };
  // Solde saisi : « 6,27 » (décimal) ou « 6:16 » / « 6h16 » (heures:minutes) → minutes, null si illisible
  function parseBal(s) {
    s = String(s || '').replace(/\s/g, '').replace(MINUS, '-'); if (!s) return null;
    const neg = s[0] === '-'; s = s.replace(/^[+-]/, ''); let v;
    if (/[:h]/i.test(s)) { const [h, m] = s.split(/[:h]/i); v = (+h || 0) * 60 + (+m || 0); if (!/^\d*$/.test(h) || !/^\d*$/.test(m || '')) v = NaN; }
    else v = /^\d*[.,]?\d*$/.test(s) ? parseFloat(s.replace(',', '.')) * 60 : NaN;
    return isNaN(v) ? null : (neg ? -v : v);
  }

  /* ---------- règles métier (cfg = réglages : start, end, minH, tgtH, maxH, pauseMin, mode, balGoal, spread) ---------- */
  const effPause = (p, cfg) => Math.max(cfg.pauseMin, +p || 0);           // 30 min mini, sinon la durée réelle
  const effArr = (a, cfg) => Math.max(toMin(a), toMin(cfg.start));       // rien ne compte avant 7h
  // minutes travaillées (brut, non plafonné) = min(départ, 20h) − max(arrivée, 7h) − pause décomptée
  function workOf(arr, depM, pause, cfg) {
    if (!arr || depM == null) return null;
    return Math.max(0, Math.min(depM, toMin(cfg.end)) - effArr(arr, cfg) - effPause(pause, cfg));
  }
  const credit = (w, cfg) => w == null ? null : Math.min(w, cfg.maxH * 60);  // plafond 10h
  const dayWork = (d, cfg) => d && d.arr && d.dep ? workOf(d.arr, toMin(d.dep), d.pause, cfg) : null;
  // solde de départ + écarts des jours après sa date ; le jour en cours ne compte qu'une fois le départ enregistré
  function balance(state, todayIso, skipToday) {
    const cfg = state.cfg; let b = state.base.min || 0;
    for (const [k, d] of Object.entries(state.days)) {
      if (state.base.date && k <= state.base.date) continue;
      if (k === todayIso && (skipToday || !d.dep)) continue;
      const w = dayWork(d, cfg); if (w != null) b += credit(w, cfg) - cfg.tgtH * 60;
    }
    return b;
  }
  // durée visée aujourd'hui : neutre = cible ; lisser = cible − (solde − soldeVisé) / jours, bornée entre mini et maxi
  function targetWork(bal, cfg) {
    let t = cfg.tgtH * 60;
    if (cfg.mode === 'lisser') t -= (bal - cfg.balGoal * 60) / Math.max(1, cfg.spread);
    return Math.min(cfg.maxH * 60, Math.max(cfg.minH * 60, t));
  }

  /* ---------- trains ---------- */
  // point d'arrêt HAFAS {time, rtTime, date, rtDate, track, rtTrack} → minutes depuis minuit du jour todayIso
  function legTime(p, todayIso) {
    const plan = toMin(p.time.slice(0, 5)) + (p.date && p.date > todayIso ? 1440 : 0);
    const rt = p.rtTime ? toMin(p.rtTime.slice(0, 5)) + ((p.rtDate || p.date) > todayIso ? 1440 : 0) : null;
    return { plan, real: rt ?? plan, delay: rt != null ? rt - plan : 0, track: p.rtTrack || p.track || '' };
  }

  /* ---------- couleur du curseur 🏎️ ---------- */
  function mix(a, b, t) {
    const p = x => [1, 3, 5].map(i => parseInt(x.slice(i, i + 2), 16)); const A = p(a), B = p(b);
    return '#' + A.map((v, i) => Math.round(v + (B[i] - v) * Math.max(0, Math.min(1, t))).toString(16).padStart(2, '0')).join('');
  }
  function zoneColor(w, cfg) {
    const mn = cfg.minH * 60, tg = cfg.tgtH * 60, mx = cfg.maxH * 60;
    if (w < mn - 60) return '#ef4444';                              // rouge loin du mini
    if (w < mn) return mix('#ef4444', '#f97316', (w - mn + 60) / 60); // rouge → orange en approchant 6h
    if (w < tg) return mix('#f97316', '#22c55e', (w - mn) / (tg - mn)); // orange → vert vers 8h
    return mix('#22c55e', '#39ff14', (w - tg) / (mx - tg));         // vert → vert fluo à 10h
  }

  const Calc = { MINUS, toMin, hm, dur, sdur, dec, parseBal, effPause, effArr, workOf, credit, dayWork, balance, targetWork, legTime, mix, zoneColor };
  if (typeof module !== 'undefined' && module.exports) module.exports = Calc; else root.Calc = Calc;
})(typeof window !== 'undefined' ? window : globalThis);
