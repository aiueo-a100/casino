/*
 * にゃんこ大戦争 ガチャ乱数コア
 *
 * godfat/battle-cats-rolls (https://gitlab.com/godfat/battle-cats-rolls, Apache-2.0)
 * の Ruby 実装 (lib/battle-cats-rolls/gacha.rb) と、同梱の
 * Seeker-VampireFlower.c の探索方法を JavaScript に移植したものです。
 * ブラウザ(メインスレッド/Worker)と Node のどちらでも動くよう、DOM には触れません。
 */
'use strict';
var BC = (function () {
  var RARE = 2, SUPA = 3, UBER = 4, LEGEND = 5;
  var BASE = 10000;
  var MAX_SEED = 4294967296;

  // xorshift32 (13, 17, 15)。戻り値は常に 0 以上の 32bit 整数
  function advance(x) {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 15;
    return x >>> 0;
  }

  // advance の逆関数 (gacha.rb の retreat_seed と同じ手順)
  function retreat(x) {
    x ^= x << 15;
    x ^= x << 30;
    x ^= x >>> 17;
    x ^= x << 13;
    x ^= x << 26;
    return x >>> 0;
  }

  function rarityOf(score, rates) {
    var rs = rates.rare + rates.supa;
    if (score < rates.rare) return RARE;
    if (score < rs) return SUPA;
    if (score < rs + rates.uber) return UBER;
    return LEGEND;
  }

  // ガチャの排出テーブル(プール)を作る
  //   gachaCats: ガチャに含まれるキャラ ID の配列(ゲームデータ順)
  //   catsDB:    { id: { rarity, name: [...] } }
  //   rates:     { rare, supa, uber } (1/10000 単位。伝説レアは残り)
  function makePool(gachaCats, catsDB, rates) {
    var slots = {};
    slots[RARE] = []; slots[SUPA] = []; slots[UBER] = []; slots[LEGEND] = [];
    var missing = [];
    for (var i = 0; i < gachaCats.length; i++) {
      var id = gachaCats[i];
      var c = catsDB[id];
      if (!c) { missing.push(id); continue; }
      if (slots[c.rarity]) slots[c.rarity].push(id);
    }
    // godfat と同じく、1体でもデータが無いキャラがあればプール全体を無効扱いにする
    if (missing.length) { slots[RARE] = []; slots[SUPA] = []; slots[UBER] = []; slots[LEGEND] = []; }
    var r = {
      rare: rates.rare | 0, supa: rates.supa | 0, uber: rates.uber | 0
    };
    r.legend = BASE - r.rare - r.supa - r.uber;
    return {
      slots: slots,
      rates: r,
      missing: missing,
      exist: !missing.length && (slots[RARE].length + slots[SUPA].length + slots[UBER].length + slots[LEGEND].length) > 0
    };
  }

  function catLabel(cat) {
    var t = cat.track == null ? '+' : (cat.track === 0 ? 'A' : 'B');
    return '' + cat.seq + t + (cat.extra || '');
  }

  // ---- テーブル生成 (gacha.rb の roll_both! / finish_* を忠実に移植) ----
  //   seed:            表示上のシード。最初に1回進めてから使う
  //   last:            直前に引いたキャラの ID (0 なら無し)。1A のレア被り判定に使う
  //   guaranteedRolls: 0 / 11 / 15
  function tracks(opt) {
    var pool = opt.pool;
    var count = opt.count || 100;
    var guaranteedRolls = opt.guaranteedRolls || 0;
    var s = advance(opt.seed >>> 0);

    function newCat(rarity, slotSeed, extra) {
      var list = pool.slots[rarity];
      var cat = {
        id: -1, rarity: rarity, slot: null, slotSeed: slotSeed, score: null, raritySeed: null,
        seq: null, track: null, steps: null, next: null, rerolled: null, guaranteed: null, extra: '',
        origSlot: null
      };
      if (list.length) { cat.slot = slotSeed % list.length; cat.id = list[cat.slot]; cat.origSlot = cat.slot; }
      if (extra) for (var k in extra) cat[k] = extra[k];
      return cat;
    }
    function rollCat(raritySeed, slotSeed) {
      var score = raritySeed % BASE;
      var cat = newCat(rarityOf(score, pool.rates), slotSeed);
      cat.raritySeed = raritySeed;
      cat.score = score;
      return cat;
    }
    // レア被りの再抽選。プール内に同じキャラが複数いる場合は複数回進むことがある
    function rerollCat(cat) {
      var orig = pool.slots[cat.rarity];
      var list = [];
      for (var i = 0; i < orig.length; i++) list.push(i);
      var seed = cat.slotSeed, slot = cat.slot, id = null, steps = 0;
      var dupes = 0;
      for (i = 0; i < orig.length; i++) if (orig[i] === cat.id) dupes++;
      for (var k = 1; k <= dupes; k++) {
        seed = advance(seed);
        list.splice(slot, 1);
        slot = seed % list.length;
        id = orig[list[slot]];
        steps = k;
        if (id !== cat.id) break;
      }
      return {
        id: id, rarity: cat.rarity, slot: slot, origSlot: list[slot], slotSeed: seed, score: cat.score, raritySeed: null,
        seq: cat.seq, track: cat.track, steps: steps, next: null, rerolled: null, guaranteed: null,
        extra: (cat.extra || '') + 'R'
      };
    }
    function duped(cat, last) {
      return !!last && cat.rarity === RARE && cat.id === last.id && cat.id > 0;
    }
    function link(cat, lastCat) {
      if (duped(cat, lastCat)) {
        if (!cat.rerolled) cat.rerolled = rerollCat(cat);
        lastCat.next = cat.rerolled;
      } else if (lastCat) {
        lastCat.next = cat;
      }
    }

    var lastRoll = opt.last ? { id: opt.last, rarity: null, next: null, seq: 0, track: null, extra: '' } : null;
    var lastBoth = [lastRoll, null];
    var rows = [];
    for (var seq = 1; seq <= count; seq++) {
      var aSeed = s; s = advance(s);
      var bSeed = s;
      var a = rollCat(aSeed, s); s = advance(s);
      var b = rollCat(bSeed, s);
      a.track = 0; b.track = 1; a.seq = b.seq = seq;
      link(a, lastBoth[0]); link(b, lastBoth[1]);
      lastBoth = [a, b];
      rows.push([a, b]);
    }

    // 再抽選後の移動先 (半回し分ずれて反対のトラックへ)
    rows.forEach(function (row, index) {
      row.forEach(function (cat, track) {
        var rr = cat.rerolled;
        if (!rr) return;
        var ni = index + (((track + rr.steps) / 2) | 0) + 1;
        var nt = ((track + rr.steps - 1) ^ 1) & 1;
        var nextCat = rows[ni] && rows[ni][nt];
        if (nextCat) link(nextCat, rr);
      });
    });
    if (lastRoll) link(rows[0][0], lastRoll);

    if (guaranteedRolls > 0) {
      var follow = function (cat, steps) {
        var c = cat;
        for (var i = 0; i < steps; i++) { c = c.next; if (!c) return null; }
        return c;
      };
      var fillG = function (cat) {
        var last = follow(cat, guaranteedRolls - 1);
        if (!last) return;
        var ni = last.seq - (last.track ^ 1), nt = last.track ^ 1;
        var nextCat = rows[ni] && rows[ni][nt];
        if (!nextCat) return;
        var gSeed = rows[last.seq - 1][last.track].raritySeed;
        cat.guaranteed = newCat(UBER, gSeed, { seq: cat.seq, track: cat.track, next: nextCat, extra: (cat.extra || '') + 'G' });
      };
      rows.forEach(function (row) {
        row.forEach(function (cat) {
          fillG(cat);
          if (cat.rerolled) fillG(cat.rerolled);
        });
      });
    }
    return rows;
  }

  // ---- シード探索 ----
  // entries: [{ type: 'roll', rarity, id } | { type: 'g', id }]  (g = 11連/15連の確定枠)
  function compilePlan(entries, pool) {
    var r = pool.rates;
    var steps = entries.map(function (e) {
      var rarity = e.type === 'g' ? UBER : e.rarity;
      return { g: e.type === 'g', rarity: rarity, id: e.id, pool: pool.slots[rarity] };
    });
    var rarePool = pool.slots[RARE];
    var rareDup = false;
    var seen = {};
    for (var i = 0; i < rarePool.length; i++) { if (seen[rarePool[i]]) rareDup = true; seen[rarePool[i]] = 1; }
    return {
      steps: steps, rare: r.rare, rs: r.rare + r.supa, ru: r.rare + r.supa + r.uber,
      rarePool: rarePool, rareDup: rareDup
    };
  }

  // プール内に同じキャラが複数いる場合の一般形 (gacha.rb の reroll_cat と同じ)
  function rerollGeneral(orig, slot, seed, dupId) {
    var list = [];
    for (var i = 0; i < orig.length; i++) list.push(i);
    var dupes = 0, id = null;
    for (i = 0; i < orig.length; i++) if (orig[i] === dupId) dupes++;
    for (var k = 1; k <= dupes; k++) {
      seed = advance(seed);
      list.splice(slot, 1);
      slot = seed % list.length;
      id = orig[list[slot]];
      if (id !== dupId) break;
    }
    return { seed: seed, id: id };
  }

  // seed: entries[from] を引く「直前」のシード。prevRareId: 直前に引いたレアの ID (無ければ -1)
  // 戻り値: 全て一致すれば最後に使ったシード、不一致なら -1
  function verify(plan, seed, from, prevRareId) {
    var s = seed >>> 0;
    var steps = plan.steps;
    for (var i = from; i < steps.length; i++) {
      var st = steps[i];
      if (st.g) {
        s = advance(s);
        if (st.id != null && st.pool[s % st.pool.length] !== st.id) return -1;
        prevRareId = -1;
        continue;
      }
      s = advance(s);
      var score = s % BASE;
      var rar = score < plan.rare ? RARE : score < plan.rs ? SUPA : score < plan.ru ? UBER : LEGEND;
      if (rar !== st.rarity) return -1;
      s = advance(s);
      var pool = st.pool, n = pool.length;
      var slot = s % n, id = pool[slot];
      if (rar === RARE && id === prevRareId && id > 0) {
        if (plan.rareDup) {
          var g = rerollGeneral(pool, slot, s, id);
          s = g.seed; id = g.id;
        } else {
          s = advance(s);
          var m = s % (n - 1);
          id = pool[m + (m >= slot ? 1 : 0)];
        }
      }
      if (id !== st.id) return -1;
      prevRareId = rar === RARE ? id : -1;
    }
    return s;
  }

  function slotsOfId(pool, id) {
    var res = [];
    for (var i = 0; i < pool.length; i++) if (pool[i] === id) res.push(i);
    return res;
  }

  // 探索の進め方を決める
  //   mode 'rarity': 最初のレアリティ乱数 s1 を列挙 (レアリティの出現幅が狭いとき有利)
  //   mode 'slot'  : 最初のスロット乱数 s2 を列挙 (プールが大きいとき有利)
  //   mode 'g'     : 最初が確定枠のとき
  //   mode 'reroll': 最初のキャラがレア被りの再抽選で出た場合 (通常探索で見つからないときの予備)
  function makeSearch(entries, pool, mode) {
    var plan = compilePlan(entries, pool);
    var first = plan.steps[0];
    var rates = pool.rates;
    var low, high;
    if (first.rarity === RARE) { low = 0; high = rates.rare; }
    else if (first.rarity === SUPA) { low = rates.rare; high = rates.rare + rates.supa; }
    else if (first.rarity === UBER) { low = rates.rare + rates.supa; high = low + rates.uber; }
    else { low = rates.rare + rates.supa + rates.uber; high = BASE; }
    var residues = slotsOfId(first.pool, first.id);
    var n = first.pool.length;
    if (!mode) {
      if (first.g) mode = 'g';
      else {
        var rarityCost = (high - low) / BASE;
        var slotCost = 1.5 * residues.length / n;
        mode = rarityCost < slotCost ? 'rarity' : 'slot';
      }
    }
    var search = { plan: plan, mode: mode, low: low, high: high, residues: residues, n: n, canReroll: !first.g && first.rarity === RARE && n > 1 };
    if (mode === 'reroll') {
      // s3 ≡ b (mod n-1)。b = 観測スロット(元のスロット X より小さい場合) または 観測スロット-1 (X 以上の場合)
      var rr = [];
      residues.forEach(function (obs) {
        if (obs < n - 1) rr.push({ b: obs, obs: obs, below: true });
        if (obs >= 1) rr.push({ b: obs - 1, obs: obs, below: false });
      });
      search.rerollResidues = rr;
    }
    return search;
  }

  // [lo, hi) の範囲を探索する。tick(進捗 0〜1) を定期的に呼ぶ
  function seekRange(search, lo, hi, maxFound, tick) {
    var plan = search.plan, found = [], truncated = false;
    var CH = 0x1000000;
    var done = lo;
    var span = hi - lo;
    function push(seed, extra) {
      var rec = { seed: seed };
      if (extra) for (var k in extra) rec[k] = extra[k];
      found.push(rec);
      if (found.length >= maxFound) { truncated = true; return true; }
      return false;
    }
    if (search.mode === 'rarity') {
      var low = search.low, high = search.high, first = plan.steps[0], okSlot = {};
      search.residues.forEach(function (b) { okSlot[b] = 1; });
      var n = search.n;
      for (var base = Math.floor(lo / BASE) * BASE; base < hi; base += BASE) {
        var from = Math.max(base + low, lo), to = Math.min(base + high, hi);
        for (var s1 = from; s1 < to; s1++) {
          var s2 = advance(s1);
          if (!okSlot[s2 % n]) continue;
          var s0 = retreat(s1);
          var end = verify(plan, s0, 0, -1);
          if (end >= 0 && push(s0, { end: end, run: 0 })) return { found: found, truncated: truncated };
        }
        if (tick && base - done >= CH) { done = base; tick((base - lo) / span); }
      }
    } else if (search.mode === 'slot' || search.mode === 'g') {
      var mod = search.n, isG = search.mode === 'g', nres = search.residues.length;
      for (var ri = 0; ri < nres; ri++) {
        var b = search.residues[ri];
        var start = lo + ((b - lo % mod) + mod) % mod;
        for (var sx = start; sx < hi; sx += mod) {
          // slot モードでは sx は s2 (スロット乱数)。g モードでは sx は確定枠の乱数 s1
          var sA = retreat(sx);
          if (!isG) {
            var score = sA % BASE;
            if (score < search.low || score >= search.high) continue;
            sA = retreat(sA);
          }
          var e = verify(plan, sA, 0, -1);
          if (e >= 0 && push(sA, { end: e, run: 0 })) return { found: found, truncated: truncated };
          if (tick && sx - done >= CH) { done = sx; tick((ri + (sx - lo) / span) / nres); }
        }
        done = lo;
      }
    } else if (search.mode === 'reroll') {
      var n2 = search.n, m2 = n2 - 1, rarePool = plan.rarePool, nq = search.rerollResidues.length;
      for (var qi = 0; qi < nq; qi++) {
        var q = search.rerollResidues[qi];
        var st2 = lo + ((q.b - lo % m2) + m2) % m2;
        for (var s3 = st2; s3 < hi; s3 += m2) {
          var s2b = retreat(s3);
          var X = s2b % n2;
          if (q.below ? !(X > q.obs) : !(X < q.obs)) continue;
          var s1b = retreat(s2b);
          if (s1b % BASE >= plan.rare) continue;
          var e2 = verify(plan, s3, 1, rarePool[q.obs]);
          if (e2 >= 0 && push(retreat(s1b), { end: e2, run: q.below ? 1 : 2, prevId: rarePool[X] })) return { found: found, truncated: truncated };
          if (tick && s3 - done >= CH) { done = s3; tick((qi + (s3 - lo) / span) / nq); }
        }
        done = lo;
      }
    }
    return { found: found, truncated: truncated };
  }

  // 1人のプレイヤーが実際に引く順に entries を辿ったときの最終シードなど (結果の確認用)
  function simulate(entries, pool, seed, prevRareId) {
    var plan = compilePlan(entries, pool);
    return verify(plan, seed, 0, prevRareId == null ? -1 : prevRareId);
  }

  return {
    RARE: RARE, SUPA: SUPA, UBER: UBER, LEGEND: LEGEND, BASE: BASE, MAX_SEED: MAX_SEED,
    advance: advance, retreat: retreat, rarityOf: rarityOf, makePool: makePool, tracks: tracks,
    catLabel: catLabel, compilePlan: compilePlan, verify: verify, makeSearch: makeSearch,
    seekRange: seekRange, simulate: simulate
  };
})();
if (typeof module !== 'undefined') module.exports = BC;
