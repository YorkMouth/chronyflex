// Tests de la logique de calcul. Lancer depuis le dossier du projet :  node --test
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const C = require('../calc.js');

const CFG = { start: '07:00', end: '20:00', minH: 6, tgtH: 8, maxH: 10, pauseMin: 30, mode: 'neutre', balGoal: 0, spread: 5 };
const cfg = over => ({ ...CFG, ...over });
const H = h => h * 60;   // heures → minutes

describe('Pause décomptée : max(30, réelle)', () => {
  test('moins de 30 min → 30', () => {
    assert.equal(C.effPause(0, CFG), 30);
    assert.equal(C.effPause(15, CFG), 30);
    assert.equal(C.effPause('', CFG), 30);
    assert.equal(C.effPause(undefined, CFG), 30);
  });
  test('30 min ou plus → durée réelle', () => {
    assert.equal(C.effPause(30, CFG), 30);
    assert.equal(C.effPause(45, CFG), 45);
    assert.equal(C.effPause('60', CFG), 60);
  });
});

describe('Temps travaillé : min(départ, 20h) − max(arrivée, 7h) − pause', () => {
  const w = (arr, dep, pause = 30) => C.workOf(arr, C.toMin(dep), pause, CFG);
  test('journée normale', () => {
    assert.equal(w('08:00', '16:30'), H(8));
    assert.equal(w('09:57', '17:05'), 398);              // 7h18 − 30 = 6h38
  });
  test('pause courte → 30 min quand même', () => assert.equal(w('08:00', '16:30', 10), H(8)));
  test('pause longue → durée réelle', () => assert.equal(w('08:00', '16:30', 60), H(7.5)));
  test('rien ne compte avant 7h', () => assert.equal(w('06:15', '15:30'), H(8)));
  test('rien ne compte après 20h', () => {
    assert.equal(w('12:00', '21:30'), H(7.5));
    assert.equal(w('12:00', '20:00'), H(7.5));
  });
  test('arrivée et départ hors plage', () => assert.equal(w('06:00', '21:00'), H(12.5)));
  test('jamais négatif', () => assert.equal(w('10:00', '10:10'), 0));
  test('sans arrivée ou sans départ → null', () => {
    assert.equal(C.workOf('', 1000, 30, CFG), null);
    assert.equal(C.workOf('08:00', null, 30, CFG), null);
  });
});

describe('Bornes 6h – 10h', () => {
  test('crédit plafonné à 10h', () => {
    assert.equal(C.credit(H(11), CFG), H(10));
    assert.equal(C.credit(H(10), CFG), H(10));
    assert.equal(C.credit(H(7), CFG), H(7));
    assert.equal(C.credit(null, CFG), null);
  });
  test('un jour de 11h ne rapporte que +2h', () => {
    const st = { cfg: CFG, base: { min: 0, date: '' }, days: { '2026-11-10': { arr: '07:00', dep: '18:30', pause: 30 } } };
    assert.equal(C.balance(st, '2026-11-18'), H(2));
  });
});

describe('Lissage (cible du jour)', () => {
  test('neutre → toujours 8h', () => {
    assert.equal(C.targetWork(H(5), CFG), H(8));
    assert.equal(C.targetWork(-H(5), CFG), H(8));
  });
  const L = cfg({ mode: 'lisser' });
  test('solde +5h sur 5 jours → 7h', () => assert.equal(C.targetWork(H(5), L), H(7)));
  test('solde −2,5h sur 5 jours → 8h30', () => assert.equal(C.targetWork(-H(2.5), L), H(8.5)));
  test('solde nul → 8h', () => assert.equal(C.targetWork(0, L), H(8)));
  test('borné à 6h minimum', () => assert.equal(C.targetWork(H(20), L), H(6)));
  test('borné à 10h maximum', () => assert.equal(C.targetWork(-H(20), L), H(10)));
  test('solde visé +2h', () => assert.equal(C.targetWork(H(5), cfg({ mode: 'lisser', balGoal: 2 })), H(8) - 36));
  test('lissage sur 3 jours', () => assert.equal(C.targetWork(H(3), cfg({ mode: 'lisser', spread: 3 })), H(7)));
  test('nb de jours 0 traité comme 1', () => assert.equal(C.targetWork(H(1), cfg({ mode: 'lisser', spread: 0 })), H(7)));
});

describe('Solde indicatif', () => {
  const day = (arr, dep, pause = 30) => ({ arr, dep, pause });
  const st = days => ({ cfg: CFG, base: { min: H(6.27), date: '2026-11-16' }, days });
  const TODAY = '2026-11-18';

  test('solde de départ seul', () => assert.equal(C.balance(st({}), TODAY), H(6.27)));
  test('ignore les jours jusqu\'à la date du solde (incluse)', () => {
    assert.equal(C.balance(st({ '2026-11-15': day('08:00', '18:30'), '2026-11-16': day('08:00', '18:30') }), TODAY), H(6.27));
  });
  test('ajoute les écarts des jours suivants', () => {
    const s = st({ '2026-11-17': day('08:00', '17:30') });   // 9h → +1h
    assert.equal(C.balance(s, TODAY), H(6.27) + 60);
  });
  test('jour en cours ignoré tant que le départ n\'est pas enregistré', () => {
    assert.equal(C.balance(st({ [TODAY]: { arr: '08:00', pause: 30 } }), TODAY), H(6.27));
  });
  test('jour en cours compté une fois le départ enregistré', () => {
    assert.equal(C.balance(st({ [TODAY]: day('08:00', '15:30') }), TODAY), H(6.27) - 60);   // 7h → −1h
  });
  test('skipToday exclut le jour en cours même avec départ', () => {
    assert.equal(C.balance(st({ [TODAY]: day('08:00', '15:30') }), TODAY, true), H(6.27));
  });
  test('sans date de solde, tous les jours comptent', () => {
    const s = { cfg: CFG, base: { min: 0, date: '' }, days: { '2026-01-02': day('08:00', '17:30'), '2026-01-03': day('08:00', '15:30') } };
    assert.equal(C.balance(s, TODAY), 0);
  });
  test('jour incomplet ignoré', () => {
    assert.equal(C.balance(st({ '2026-11-17': { arr: '08:00' } }), TODAY), H(6.27));
  });
});

describe('Formats : décimal et heures:minutes', () => {
  test('saisie décimale', () => {
    assert.ok(Math.abs(C.parseBal('6,27') - 376.2) < 1e-9);
    assert.ok(Math.abs(C.parseBal('6.27') - 376.2) < 1e-9);
    assert.equal(C.parseBal('-1,5'), -90);
    assert.equal(C.parseBal('+2'), 120);
    assert.equal(C.parseBal(' 4,54 ') , 4.54 * 60);
    assert.equal(C.parseBal('−2,00'), -120);              // signe moins typographique
    assert.equal(C.parseBal(',5'), 30);
  });
  test('saisie heures:minutes', () => {
    assert.equal(C.parseBal('+3:45'), 225);
    assert.equal(C.parseBal('-1:10'), -70);
    assert.equal(C.parseBal('3h45'), 225);
    assert.equal(C.parseBal('0:05'), 5);
  });
  test('saisie illisible → null', () => {
    for (const s of ['', '   ', 'abc', '6,2x', '1:ab', '--3', null, undefined]) assert.equal(C.parseBal(s), null, String(s));
  });
  test('affichage décimal', () => {
    assert.equal(C.dec(376.2), '+6,27');
    assert.equal(C.dec(-70), '−1,17');
    assert.equal(C.dec(0), '0,00');
    assert.equal(C.dec(0.2), '0,00');
    assert.equal(C.dec(null), '--');
  });
  test('affichage heures:minutes', () => {
    assert.equal(C.dur(376), '6h16');
    assert.equal(C.dur(-70), '−1h10');
    assert.equal(C.sdur(376.2), '+6h16');
    assert.equal(C.sdur(-70), '−1h10');
    assert.equal(C.sdur(0), '+0h00');
    assert.equal(C.sdur(-0.4), '+0h00');                  // pas de « −0h00 »
  });
  test('aller-retour : chaque valeur décimale saisie s\'affiche à l\'identique', () => {
    for (let c = -1500; c <= 1500; c++) {
      const txt = (c < 0 ? '-' : '') + Math.floor(Math.abs(c) / 100) + ',' + String(Math.abs(c) % 100).padStart(2, '0');
      const shown = C.dec(C.parseBal(txt));
      const expected = c === 0 ? '0,00' : (c > 0 ? '+' : '−') + txt.replace('-', '');
      assert.equal(shown, expected, txt);
    }
  });
  test('heures', () => {
    assert.equal(C.toMin('19:30'), 1170);
    assert.equal(C.toMin(''), null);
    assert.equal(C.hm(1170), '19:30');
    assert.equal(C.hm(1450), '00:10');
    assert.equal(C.hm(null), '--:--');
  });
});

describe('Retards des trains (HAFAS)', () => {
  const T = '2026-11-18';
  test('à l\'heure', () => {
    const r = C.legTime({ time: '17:15:00', date: T, track: '3' }, T);
    assert.deepEqual(r, { plan: 1035, real: 1035, delay: 0, track: '3' });
  });
  test('retard simple', () => {
    const r = C.legTime({ time: '17:15:00', rtTime: '17:22:00', date: T, rtDate: T, track: '3', rtTrack: '5' }, T);
    assert.equal(r.delay, 7); assert.equal(r.real, 1042); assert.equal(r.track, '5');
  });
  test('en avance → retard négatif', () => {
    assert.equal(C.legTime({ time: '17:15:00', rtTime: '17:14:00', date: T, rtDate: T }, T).delay, -1);
  });
  test('retard qui passe minuit', () => {
    const r = C.legTime({ time: '23:58:00', rtTime: '00:03:00', date: T, rtDate: '2026-11-19' }, T);
    assert.equal(r.delay, 5); assert.equal(r.real, 1440 + 3);
  });
  test('train du lendemain', () => {
    const r = C.legTime({ time: '00:10:00', rtTime: '00:12:00', date: '2026-11-19', rtDate: '2026-11-19' }, T);
    assert.equal(r.plan, 1450); assert.equal(r.delay, 2);
  });
  test('rtDate absent → même date que prévu', () => {
    assert.equal(C.legTime({ time: '17:15:00', rtTime: '17:20:00', date: T }, T).delay, 5);
  });
});

describe('Couleur du curseur 🏎️', () => {
  test('rouge loin des 6h', () => assert.equal(C.zoneColor(H(2), CFG), '#ef4444'));
  test('orange à 6h', () => assert.equal(C.zoneColor(H(6), CFG), '#f97316'));
  test('vert à 8h', () => assert.equal(C.zoneColor(H(8), CFG), '#22c55e'));
  test('vert fluo à 10h', () => assert.equal(C.zoneColor(H(10), CFG), '#39ff14'));
  test('dégradé entre deux repères', () => {
    const c = C.zoneColor(H(7), CFG);
    assert.notEqual(c, '#f97316'); assert.notEqual(c, '#22c55e'); assert.match(c, /^#[0-9a-f]{6}$/);
  });
});
