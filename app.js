/* 超ドーパミン英単語帳 — app.js
 * 分散学習(SM-2系スケジューラ) × 想起練習(4つの出題形式) × 変動報酬(クリティカル/宝箱/コンボ) × 就寝ガード
 * 依存なし。words/*.js が window.DOPA_DATA に単語を積む。
 */
(() => {
"use strict";
document.documentElement.lang = "ja";

/* ================= utilities ================= */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ESC[c]);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const rand = (a, b) => a + Math.random() * (b - a);
const randInt = (a, b) => Math.floor(rand(a, b + 1));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const shuffle = (arr) => { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; };
const MIN = 60e3, HOUR = 60 * MIN, DAY = 24 * HOUR;
const reduceMotion = (() => { try { return matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; } })();

// 1日の区切りは午前4時（夜更かしで日付が変わってもその日の扱い）
const CUTOFF = 4 * HOUR;
const pad2 = (n) => String(n).padStart(2, "0");
const keyOf = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const dayKey = (t = Date.now()) => keyOf(new Date(t - CUTOFF));
function dayStart(t = Date.now()) { const d = new Date(t - CUTOFF); d.setHours(0, 0, 0, 0); return d.getTime() + CUTOFF; }
const dayEnd = (t = Date.now()) => dayStart(t) + DAY;
function addDays(key, n) { const [y, m, d] = key.split("-").map(Number); return keyOf(new Date(y, m - 1, d + n)); }
function daysBetween(a, b) {
  const p = (k) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(k || ""); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : NaN; };
  return Math.round((p(b) - p(a)) / DAY);
}
function lev(a, b) {
  const dp = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0]; dp[0] = i;
    for (let j = 1; j <= b.length; j++) { const t = dp[j]; dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = t; }
  }
  return dp[b.length];
}
const norm = (s) => String(s || "").toLowerCase().replace(/[’‘`]/g, "'").replace(/[.,!?;:"“”]/g, "").replace(/\s+/g, " ").trim();

/* ================= content ================= */
const DECKS = {
  poly:     { name: "多義語",     sub: "京大和訳の生命線。訳語は文脈で選べ" },
  abstract: { name: "評論語",     sub: "抽象名詞・形容詞。下線部和訳の語彙" },
  verbs:    { name: "評論動詞",   sub: "構文ごと覚えろ。英作文にも直結" },
  write:    { name: "英作文表現", sub: "和文英訳・自由英作文で「書ける」形に" },
  tech:     { name: "情報・科学", sub: "情報学科志望ならここは落とすな" },
  mine:     { name: "マイ単語",   sub: "自分の単語帳から追加した語" },
};
const DECK_ORDER = Object.keys(DECKS);
const deckColor = (tag) => `var(--d-${DECKS[tag] ? tag : "mine"})`;

const RANKS = [
  [1, "出町柳の迷子"], [3, "鴨川デルタの飛び石渡り"], [6, "百万遍の常連"], [10, "吉田山の修行者"],
  [15, "時計台の見張り番"], [20, "折田先生像の弟子"], [26, "二次試験の破壊者"], [33, "京大情報学科 合格圏"],
  [40, "京大情報学科 現役合格者"], [50, "計算機科学の覇王"],
];
const rankOf = (L) => RANKS.filter(([l]) => L >= l).pop()[1];

const COMBO_LINES = { 5: ["COMBO 5", "いい流れ"], 10: ["FEVER!!", "XP ×1.5 発動"], 20: ["止まらねえ", "COMBO 20"], 30: ["京大が見えた", "COMBO 30"], 50: ["伝説", "COMBO 50"], 100: ["人間やめた", "COMBO 100"] };
const CLEAR_LINES = ["上出来。次も行け。", "脳に刻んだ。", "その調子で二次まで走れ。", "いい回転だ。", "まだ行けるだろ？"];

const TIPS = [
  "下線部和訳は、訳し始める前に S・V・O・C と修飾関係を確定させろ。構造が取れていない訳は部分点も消える。",
  "多義語の訳語は決め打ちするな。主語・目的語との相性で選べ。address the problem は「住所」ではない。",
  "和文英訳は、まず日本語を「英語にしやすい日本語」に言い換えろ。難しい単語より、確実に書ける構文。",
  "自由英作文は 主張 → 理由 → 具体例 → 結論。2025年の京大はこの型（結論・論証・総括）を条件に指定した。",
  "抽象名詞は動詞的に訳すと自然になる。the importance of A →「Aが重要であること」。",
  "無生物主語は「〜によって」「〜のおかげで」と副詞的に訳すと日本語が死なない。",
  "it / this / that が何を指すかを確定させてから訳せ。指示語の取り違えは内容の誤読と同じ扱いになる。",
  "英作文で自信のない語は使うな。減点されない英語が最強。",
  "時制・冠詞・単複・三単現の s は英作文の典型的な減点ポイント。書いたら必ずここだけ見直せ。",
  "知らない単語は、前後の対比（but, however）や言い換え（that is, in other words）から推測しろ。",
  "京大の下線部は一文が長く、カンマ・ダッシュ・等位接続詞が多い。and が何と何を結ぶかを先に決めろ。",
  "答えを見る前に必ず一度思い出そうとしろ。その「思い出す努力」が記憶を強くする（Karpicke & Roediger, 2008）。",
  "分散学習と想起練習は、学習法研究で「有用度：高」と評価された2つ（Dunlosky et al., 2013）。このアプリはその2つでできている。",
  "徹夜は最悪のコスパ。学習と再学習の間に睡眠を挟むと、再学習の量が半分で済み、長く残った（Mazza et al., 2016）。",
  "寝る前の画面は短く、暗く。発光タブレットで読書すると寝つきが遅れ、翌朝の覚醒度も下がった（Chang et al., 2015）。",
];

const SOURCES = [
  ["想起練習（自分でテストする）と分散学習は、10の学習法のうち「有用度：高」と評価された2つ。", "Dunlosky et al. (2013) Psychological Science in the Public Interest 14(1)", "https://www.psychologicalscience.org/news/releases/which-study-strategies-make-the-grade.html"],
  ["一度思い出せた単語をさらに繰り返し想起させると、1週間後の保持が大きく伸びた。思い出せた後の読み直しには効果がなかった。", "Karpicke & Roediger (2008) Science 319", "https://source.washu.edu/2008/02/practicing-information-retrieval-is-key-to-memory-retention/"],
  ["839件の評価を統合したメタ分析。分散学習は集中学習より強く、最適な間隔は覚えておきたい期間が長いほど長くなる。", "Cepeda et al. (2006) Psychological Bulletin 132(3)", "https://pubmed.ncbi.nlm.nih.gov/16719566/"],
  ["最適な復習間隔は、試験までの期間の約20%（数週間先の場合）から約5%（1年先の場合）。本アプリは残り日数の15%で間隔に上限をかける。", "Cepeda et al. (2008) Psychological Science 19(11)", "https://www.evullab.org/pdf/CepedaVulRohrerWixtedPashler-PS-2008.pdf"],
  ["学習→睡眠→再学習の組は、必要な練習量が約半分で済み、1週間後・6か月後の保持も良かった。", "Mazza et al. (2016) Psychological Science", "https://www.sciencedaily.com/releases/2016/08/160822083446.htm"],
  ["13〜18歳は1日8〜10時間の睡眠を定期的にとるべき。", "AASM コンセンサス声明 (Paruthi et al., 2016) J Clin Sleep Med 12(6)", "https://www.sciencedaily.com/releases/2016/06/160613122419.htm"],
  ["就寝前に発光タブレットで読書すると、紙の本に比べて寝つきが遅れ、メラトニン分泌が減り、翌朝の覚醒度が下がった（12名の実験）。", "Chang et al. (2015) PNAS 112(4)", "https://pubmed.ncbi.nlm.nih.gov/25535358/"],
  ["ドーパミン神経は予想外の報酬に強く反応し、予測できる報酬には反応が弱まる（報酬予測誤差）。XPを毎回同じにせず、クリティカルと宝箱で振れ幅を作っているのはこのため。", "Schultz, Dayan & Montague (1997) Science 275", "https://pubmed.ncbi.nlm.nih.gov/9054347/"],
  ["好奇心が高まった状態では中脳ドーパミン系と海馬の連携が強まり、記憶が良くなった。報酬で動機づけられた学習（Adcock et al., 2006）と同じ回路。", "Gruber, Gelman & Ranganath (2014) Neuron 84(2)", "https://pmc.ncbi.nlm.nih.gov/articles/PMC4252494"],
  ["京大英語は英文和訳・和文英訳・自由英作文が柱。2025年の自由英作文はAIと想像力がテーマ（80〜100語）。", "study-search.jp / UP-EDU 京大英語解説 (2025)", "https://study-search.jp/columns/296"],
];

const ICON = {
  speaker: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4zm12.5 3a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4z"/></svg>',
  x: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  chest: '<svg viewBox="0 0 48 48" aria-hidden="true"><rect x="6" y="19" width="36" height="21" rx="3" fill="currentColor" opacity=".28"/><path d="M6 22a9 9 0 0 1 9-9h18a9 9 0 0 1 9 9v3H6z" fill="currentColor" opacity=".6"/><rect x="20" y="21" width="8" height="10" rx="2" fill="currentColor"/></svg>',
};

/* ================= words ================= */
let WORDS = [], BYID = new Map();
function addWord(tag, r) {
  if (!Array.isArray(r) || !r[0]) return;
  const [w, pos, ja, more, ex, hit, exJa, note] = r;
  const id = tag + ":" + w;
  if (BYID.has(id)) return;
  const o = { id, tag, w: String(w), pos: pos || "", ja: ja || "", more: more || "", ex: ex || "", hit: hit || "", exJa: exJa || "", note: note || "" };
  WORDS.push(o); BYID.set(id, o);
}
function buildWords() {
  WORDS = []; BYID = new Map();
  for (const deck of window.DOPA_DATA || []) if (DECKS[deck.tag]) for (const r of deck.rows || []) addWord(deck.tag, r);
  for (const r of state.custom || []) addWord("mine", r);
}
const hasEx = (w) => !!(w.ex && w.hit && w.ex.includes(w.hit));
const countTag = (t) => WORDS.filter((w) => w.tag === t).length;

/* ================= state & storage ================= */
const LS_KEY = "dopa-tanf:v1";
const DEFAULT_SETTINGS = {
  newPerDay: 20, goal: 80, roundSize: 20, bedtime: "22:30", wake: "06:30", examDate: "2027-02-25",
  sound: true, effects: true, tts: false,
  decks: { poly: true, abstract: true, verbs: true, write: true, tech: true, mine: true },
};
function freshState() {
  return { v: 1, updatedAt: 0, cards: {}, xp: 0, days: {}, streak: { count: 0, best: 0, lastDay: "", shields: 1 },
    bestCombo: 0, custom: [], prio: [], chestIn: randInt(7, 13), override: 0, nightOverrides: 0, settings: JSON.parse(JSON.stringify(DEFAULT_SETTINGS)) };
}
function normalize(s) {
  s = s && typeof s === "object" ? s : {};
  const f = freshState();
  const st = s.settings || {};
  return { ...f, ...s,
    settings: { ...f.settings, ...st, decks: { ...f.settings.decks, ...(st.decks || {}) } },
    streak: { ...f.streak, ...(s.streak || {}) },
    cards: s.cards || {}, days: s.days || {}, custom: Array.isArray(s.custom) ? s.custom : [], prio: Array.isArray(s.prio) ? s.prio : [] };
}

const Store = {
  ref: null, customRef: null, busy: false, dirty: false, timer: 0, status: "local", lastCustom: "",
  loadLocal() { try { const raw = localStorage.getItem(LS_KEY); return raw ? JSON.parse(raw) : null; } catch { return null; } },
  saveLocal() { try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch { /* private mode etc. */ } },
  save() { state.updatedAt = Date.now(); this.saveLocal(); this.schedule(); },
  schedule() { if (!this.ref) return; this.dirty = true; clearTimeout(this.timer); this.timer = setTimeout(() => this.push(), 2500); },
  async push() {
    if (!this.ref || this.busy || !this.dirty) return;
    this.busy = true; this.dirty = false;
    const { custom, ...main } = state;
    try {
      await this.ref.set(JSON.parse(JSON.stringify(main)));
      const cj = JSON.stringify(custom);
      if (cj !== this.lastCustom) { await this.customRef.set({ rows: JSON.parse(cj) }); this.lastCustom = cj; }
      setSync("ok");
    } catch (e) {
      this.dirty = true; setSync("err");
      const fatal = e && ["invalid_argument", "revoked", "quota_exceeded", "not_granted", "capability_disabled", "capability_removed"].includes(e.code);
      if (fatal) this.ref = null; else setTimeout(() => this.push(), 10000);
    } finally {
      this.busy = false;
      if (this.dirty && this.ref) this.schedule();
    }
  },
  flush() { if (this.ref && this.dirty) { clearTimeout(this.timer); this.push(); } },
  async initRemote() {
    const c = window.claude;
    if (!c || typeof c.use !== "function") return;
    try {
      const [db, user] = await Promise.all([c.use("db"), c.use("user")]);
      if (!db || !user) return;
      const uid = await user.id();
      if (!uid) return;
      const base = "data/users/" + uid;
      const ref = db.doc(base + "/state"), customRef = db.doc(base + "/custom");
      const [snap, csnap] = await Promise.all([ref.get(), customRef.get()]);
      this.ref = ref; this.customRef = customRef;
      const remote = snap.exists ? snap.data() : null;
      const rcustom = csnap.exists ? (csnap.data().rows || []) : [];
      if (remote && (remote.updatedAt || 0) > (state.updatedAt || 0)) {
        state = normalize(JSON.parse(JSON.stringify({ ...remote, custom: rcustom })));
        this.lastCustom = JSON.stringify(state.custom);
        this.saveLocal(); buildWords(); renderAll();
        setSync("ok");
      } else {
        this.lastCustom = JSON.stringify(rcustom);
        if ((state.updatedAt || 0) > (remote?.updatedAt || 0)) { this.dirty = true; await this.push(); } else setSync("ok");
      }
    } catch { this.ref = null; setSync("local"); }
  },
};
function setSync(kind) {
  Store.status = kind;
  const el = $("#syncLine"); if (!el) return;
  el.className = "sync " + (kind === "ok" ? "ok" : kind === "err" ? "err" : "");
  $("span", el).textContent = kind === "ok" ? "claude.ai に同期中" : kind === "err" ? "同期エラー（端末には保存済み）" : "このブラウザに保存";
}

let state = normalize(Store.loadLocal());
const S = () => state.settings;

/* ================= sleep guard ================= */
function hm(s) { const m = /^(\d{1,2}):(\d{2})/.exec(s || ""); return m ? (+m[1] * 60 + +m[2]) % 1440 : 0; }
const inWin = (x, a, b) => (a === b ? false : a < b ? x >= a && x < b : x >= a || x < b);
const minsOfDay = (t) => { const d = new Date(t); return d.getHours() * 60 + d.getMinutes(); };
const minsUntil = (target, now = Date.now()) => (target - minsOfDay(now) + 1440) % 1440;
const fmtHM = (mins) => (mins >= 60 ? `${Math.floor(mins / 60)}時間${mins % 60}分` : `${mins}分`);
function getPhase(now = Date.now()) {
  const m = minsOfDay(now), bed = hm(S().bedtime), wake = hm(S().wake);
  if (inWin(m, bed, wake)) return state.override > now ? "wind" : "lock";
  if (inWin(m, (bed + 1380) % 1440, bed)) return "wind";
  if (inWin(m, wake, (wake + 180) % 1440)) return "morning";
  return "day";
}
let phase = getPhase();
const isNight = () => phase === "wind" || phase === "lock";
const fxOn = () => S().effects && !isNight();
const soundOn = () => S().sound && !isNight();
const sleepMins = () => (hm(S().wake) - hm(S().bedtime) + 1440) % 1440;
function applyPhase() { document.documentElement.dataset.mode = isNight() ? "night" : "day"; }

/* ================= scheduler (SM-2 系) ================= */
const LEARN = [1 * MIN, 10 * MIN], RELEARN = [10 * MIN];
const BOUNTY = 30, SLAY = 150, FEVER_AT = 10;
function ivlCap(now = Date.now()) {
  const dl = daysBetween(dayKey(now), S().examDate);
  return Number.isFinite(dl) && dl > 0 ? Math.max(3, Math.round(dl * 0.15)) : 365;
}
const isMastered = (c) => !!c && c.st === 2 && c.ivl >= Math.min(21, ivlCap());
const isNemesis = (c) => !!c && c.lapses >= 4 && !c.slain;
const newCard = (now) => ({ st: 1, step: 0, due: now + LEARN[0], ivl: 0, ease: 2.5, reps: 0, lapses: 0, ok: 0, last: 0, first: now });
const fz = (d) => (d < 3 ? d : d * rand(0.95, 1.05));
function grade(c0, g, now) {
  const c = { ...c0 };
  const prevLast = c.last || now;
  c.reps++; c.last = now; if (g >= 3) c.ok++;
  const cap = ivlCap(now);
  const toReview = (days) => { c.st = 2; c.step = 0; c.ivl = Math.max(1, Math.min(cap, Math.round(days))); c.due = dayStart(now) + c.ivl * DAY; };
  if (c.st !== 2) {
    const steps = c.st === 1 ? LEARN : RELEARN;
    if (g === 1) { c.step = 0; c.due = now + steps[0]; }
    else if (g === 2) c.due = now + Math.round(steps[Math.min(c.step, steps.length - 1)] * 1.5);
    else if (g === 4) toReview(c.st === 1 ? 4 : Math.max(c.ivl, 1) + 1);
    else { c.step++; if (c.step >= steps.length) toReview(c.st === 1 ? 1 : Math.max(c.ivl, 1)); else c.due = now + steps[c.step]; }
  } else {
    const ivl = Math.max(1, c.ivl);
    const late = Math.max(0, (now - prevLast) / DAY - ivl);
    if (g === 1) { c.lapses++; c.ease = Math.max(1.3, c.ease - 0.2); c.ivl = Math.max(1, Math.round(ivl * 0.3)); c.st = 3; c.step = 0; c.due = now + RELEARN[0]; }
    else if (g === 2) { c.ease = Math.max(1.3, c.ease - 0.15); toReview(fz(Math.max(ivl + 1, (ivl + late / 4) * 1.2))); }
    else if (g === 3) toReview(fz(Math.max(ivl + 1, (ivl + late / 2) * c.ease)));
    else { c.ease = Math.min(3.2, c.ease + 0.15); toReview(fz(Math.max(ivl + 2, (ivl + late) * c.ease * 1.3))); }
  }
  return c;
}
function fmtIvl(ms) {
  if (ms < HOUR) return Math.max(1, Math.round(ms / MIN)) + "分";
  if (ms < DAY * 0.9) return Math.round(ms / HOUR) + "時間";
  return Math.max(1, Math.round(ms / DAY)) + "日";
}
function previewLabel(c, g) { const now = Date.now(); const n = grade(c, g, now); return n.st === 2 ? n.ivl + "日" : fmtIvl(n.due - now); }
const isDue = (c, now) => !!c && (c.st === 2 ? c.due < dayEnd(now) : c.due <= now + 20 * MIN);
const stateName = (c) => (!c ? "未習" : c.st === 1 ? "学習中" : c.st === 3 ? "再学習" : isMastered(c) ? "定着" : "復習中");

/* ================= stats ================= */
const blankDay = () => ({ reps: 0, ok: 0, xp: 0, newc: 0, ms: 0, goal: false });
function today() { const k = dayKey(); return state.days[k] || (state.days[k] = blankDay()); }
const peekToday = () => state.days[dayKey()] || blankDay();
const enabledTag = (t) => S().decks[t] !== false;
const activeWords = () => WORDS.filter((w) => enabledTag(w.tag));
function counts(now = Date.now()) {
  let due = 0, learning = 0, unseen = 0;
  for (const w of activeWords()) {
    const c = state.cards[w.id];
    if (!c) { unseen++; continue; }
    if (isDue(c, now)) c.st === 2 ? due++ : learning++;
  }
  const newLeft = Math.max(0, Math.min(unseen, S().newPerDay - peekToday().newc));
  return { due, learning, unseen, newLeft };
}
const needFor = (L) => Math.round(80 + 30 * Math.pow(L, 1.5));
function levelInfo(xp) { let L = 1, acc = 0; while (xp >= acc + needFor(L)) { acc += needFor(L); L++; } return { L, into: xp - acc, need: needFor(L) }; }
function addXP(n) { state.xp += n; today().xp += n; }
function liveStreak() {
  const s = state.streak; if (!s.lastDay) return 0;
  const gap = daysBetween(s.lastDay, dayKey());
  return gap <= 1 ? s.count : s.shields >= gap - 1 ? s.count : 0;
}
function bumpStreak() {
  const k = dayKey(), s = state.streak;
  if (s.lastDay === k) return;
  const gap = s.lastDay ? daysBetween(s.lastDay, k) : 1;
  if (gap === 1) s.count++;
  else if (gap > 1 && s.shields >= gap - 1) { s.shields -= gap - 1; s.count++; setTimeout(() => toast(`シールド${gap - 1}個を消費して連続記録を守った`), 1200); }
  else s.count = 1;
  s.lastDay = k; s.best = Math.max(s.best, s.count);
}
function pace() {
  const dl = daysBetween(dayKey(), S().examDate);
  const unseen = activeWords().filter((w) => !state.cards[w.id]).length;
  if (!Number.isFinite(dl) || dl <= 0) return { dl, unseen, need: 0 };
  return { dl, unseen, need: Math.ceil(unseen / Math.max(1, dl - 14)) };
}

/* ================= sound (WebAudio, 音源ファイルなし) ================= */
const Sound = {
  ctx: null, master: null,
  ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null;
      try {
        this.ctx = new AC();
        const comp = this.ctx.createDynamicsCompressor();
        this.master = this.ctx.createGain(); this.master.gain.value = 0.5;
        this.master.connect(comp); comp.connect(this.ctx.destination);
      } catch { this.ctx = null; return null; }
    }
    if (this.ctx.state === "suspended") this.ctx.resume().catch(() => {});
    return this.ctx;
  },
  tone(f, at, dur, type = "sine", vol = 0.2) {
    const ctx = this.ctx, t = ctx.currentTime + at;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.05);
  },
  play(fn) { if (!soundOn() || !this.ensure()) return; try { fn(); } catch { /* ignore */ } },
  note(n) { const sc = [0, 2, 4, 7, 9]; return 392 * Math.pow(2, (12 * Math.floor(n / 5) + sc[n % 5]) / 12); },
  correct(combo) { this.play(() => { const f = this.note(Math.min(combo, 14)); this.tone(f, 0, 0.3, "triangle", 0.22); this.tone(f * 2, 0, 0.18, "sine", 0.07); }); },
  soft() { this.play(() => this.tone(330, 0, 0.16, "sine", 0.12)); },
  wrong() { this.play(() => { this.tone(155, 0, 0.22, "triangle", 0.24); this.tone(116, 0.07, 0.26, "triangle", 0.2); }); },
  crit() { this.play(() => [0, 4, 7, 12].forEach((s, i) => this.tone(523.25 * 2 ** (s / 12), i * 0.055, 0.25, "square", 0.06))); },
  jackpot() { this.play(() => { [0, 4, 7, 12, 16, 19, 24].forEach((s, i) => this.tone(523.25 * 2 ** (s / 12), i * 0.06, 0.35, "square", 0.06)); for (let i = 0; i < 6; i++) this.tone(2093 + Math.random() * 1500, 0.45 + i * 0.05, 0.12, "sine", 0.05); }); },
  fanfare() { this.play(() => [[0, 0], [4, 0.12], [7, 0.24], [12, 0.36], [7, 0.5], [12, 0.62]].forEach(([s, t]) => this.tone(392 * 2 ** (s / 12), t, 0.3, "triangle", 0.2))); },
  chest() { this.play(() => [0, 7, 12, 19].forEach((s, i) => this.tone(659.25 * 2 ** (s / 12), i * 0.07, 0.22, "sine", 0.12))); },
};
const vibrate = (p) => { try { if (fxOn() && navigator.vibrate) navigator.vibrate(p); } catch { /* ignore */ } };

/* ================= visual fx ================= */
const FX = {
  cv: null, ctx: null, parts: [], raf: 0, dpr: 1,
  init() { this.cv = $("#fx"); this.ctx = this.cv.getContext("2d"); this.resize(); addEventListener("resize", () => this.resize()); },
  resize() { this.dpr = Math.min(2, window.devicePixelRatio || 1); this.cv.width = innerWidth * this.dpr; this.cv.height = innerHeight * this.dpr; },
  color(v) { return getComputedStyle(document.documentElement).getPropertyValue(v).trim() || "#e8175f"; },
  run() { if (!this.raf) this.raf = requestAnimationFrame(() => this.tick()); },
  burst(x, y, n, vars) {
    if (!fxOn() || reduceMotion || !this.ctx) return;
    const cols = vars.map((v) => this.color(v));
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, sp = rand(2, 7.5);
      this.parts.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - rand(1, 3), g: 0.18, life: 1, dec: rand(0.014, 0.03), s: rand(3, 7), c: pick(cols), r: Math.random() * 6, vr: rand(-0.3, 0.3), sq: Math.random() < 0.5 });
    }
    this.run();
  },
  confetti() {
    if (!fxOn() || reduceMotion || !this.ctx) return;
    const cols = ["--accent", "--gold", "--info", "--good"].map((v) => this.color(v));
    for (let i = 0; i < 140; i++) this.parts.push({ x: rand(0, innerWidth), y: rand(-90, -10), vx: rand(-1.5, 1.5), vy: rand(1, 4), g: 0.05, life: 1, dec: rand(0.004, 0.008), s: rand(4, 8), c: pick(cols), r: Math.random() * 6, vr: rand(-0.2, 0.2), sq: true });
    this.run();
  },
  tick() {
    const { ctx, dpr } = this;
    ctx.clearRect(0, 0, this.cv.width, this.cv.height);
    this.parts = this.parts.filter((p) => p.life > 0 && p.y < innerHeight + 40);
    for (const p of this.parts) {
      p.vy += p.g; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.r += p.vr; p.life -= p.dec;
      ctx.globalAlpha = clamp(p.life * 1.5, 0, 1); ctx.fillStyle = p.c;
      ctx.save(); ctx.translate(p.x * dpr, p.y * dpr); ctx.rotate(p.r);
      if (p.sq) ctx.fillRect((-p.s * dpr) / 2, (-p.s * dpr) / 4, p.s * dpr, (p.s * dpr) / 2);
      else { ctx.beginPath(); ctx.arc(0, 0, (p.s * dpr) / 2, 0, Math.PI * 2); ctx.fill(); }
      ctx.restore();
    }
    ctx.globalAlpha = 1;
    this.raf = this.parts.length ? requestAnimationFrame(() => this.tick()) : 0;
  },
};
function floatText(text, x, y) {
  const el = document.createElement("div");
  el.className = "float"; el.textContent = text; el.style.left = x + "px"; el.style.top = y + "px";
  document.body.appendChild(el); setTimeout(() => el.remove(), 1000);
}
const bannerQ = []; let bannerBusy = false;
function banner(big, small) { if (!fxOn()) return; bannerQ.push([big, small]); if (!bannerBusy) runBanner(); }
function runBanner() {
  const b = bannerQ.shift(); if (!b) { bannerBusy = false; return; }
  bannerBusy = true;
  const el = document.createElement("div");
  el.className = "banner"; el.setAttribute("role", "status");
  el.innerHTML = esc(b[0]) + (b[1] ? `<small>${esc(b[1])}</small>` : "");
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1300); setTimeout(runBanner, 850);
}
function flash() { if (!fxOn() || reduceMotion) return; const el = document.createElement("div"); el.className = "flash"; document.body.appendChild(el); setTimeout(() => el.remove(), 750); }
let toastTimer = 0;
function toast(msg) {
  $$(".toast").forEach((t) => t.remove()); clearTimeout(toastTimer);
  const el = document.createElement("div"); el.className = "toast"; el.setAttribute("role", "status"); el.textContent = msg;
  document.body.appendChild(el); toastTimer = setTimeout(() => el.remove(), 2800);
}

/* ================= speech ================= */
const canSpeak = "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
let enVoice = null;
function pickVoice() {
  try {
    const vs = speechSynthesis.getVoices();
    enVoice = vs.find((v) => /^en[-_]US/i.test(v.lang) && /Samantha|Google|Natural|Aria|Jenny|Ava/i.test(v.name)) || vs.find((v) => /^en[-_]US/i.test(v.lang)) || vs.find((v) => /^en/i.test(v.lang)) || null;
  } catch { enVoice = null; }
}
if (canSpeak) { pickVoice(); try { speechSynthesis.addEventListener("voiceschanged", pickVoice); } catch { /* ignore */ } }
function speak(text) {
  if (!canSpeak) return;
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(String(text).replace(/\b[AB]\b/g, "something").replace(/\(|\)/g, ""));
    u.lang = "en-US"; u.rate = 0.92; if (enVoice) u.voice = enVoice;
    speechSynthesis.speak(u);
  } catch { /* ignore */ }
}

/* ================= session ================= */
let round = null;
const stage = () => $("#stage");
const actions = () => $("#actions");
const MODE_LABEL = { intro: "NEW 初見", recall: "想起 英→日", context: "和訳 下線部を訳せ", cloze: "英作文 書け", choice: "4択 即答" };

function buildQueue(now = Date.now()) {
  const night = phase === "wind";
  const size = night ? 12 : clamp(Math.round(+S().roundSize) || 20, 5, 100);
  const learn = [], rev = [], fresh = [];
  for (const w of activeWords()) {
    const c = state.cards[w.id];
    if (!c) { fresh.push(w); continue; }
    if (night) { if ((c.last || 0) >= dayStart(now) || (c.first || 0) >= dayStart(now)) learn.push(w); continue; }
    if (!isDue(c, now)) continue;
    (c.st === 2 ? rev : learn).push(w);
  }
  if (night) return shuffle(learn).slice(0, size).map((w) => w.id);
  const C = (w) => state.cards[w.id];
  learn.sort((a, b) => C(a).due - C(b).due);
  if (phase === "morning") rev.sort((a, b) => C(b).last - C(a).last); // 昨夜触った語から朝の再学習
  else rev.sort((a, b) => C(a).due - C(b).due || C(b).lapses - C(a).lapses);
  // 新規はデッキ横断で交互に（インターリーブ）。図鑑で予約された語が先頭。
  const prio = new Map(state.prio.map((id, i) => [id, i]));
  const byDeck = DECK_ORDER.map((t) => fresh.filter((w) => w.tag === t)).filter((a) => a.length);
  const newPick = fresh.filter((w) => prio.has(w.id)).sort((a, b) => prio.get(a.id) - prio.get(b.id));
  const newLeft = Math.max(0, S().newPerDay - peekToday().newc);
  let i = 0;
  while (newPick.length < newLeft && byDeck.some((a) => a.length)) { const a = byDeck[i % byDeck.length]; const w = a.shift(); if (w && !prio.has(w.id)) newPick.push(w); i++; }
  const q = learn.slice(0, size);
  const newCap = Math.min(newPick.length, newLeft, q.length < size ? Math.ceil(size * 0.35) : 0);
  let r = 0, n = 0;
  while (q.length < size && (r < rev.length || n < newCap)) {
    if (n < newCap && (r >= rev.length || q.length % 3 === 2)) q.push(newPick[n++]);
    else if (r < rev.length) q.push(rev[r++]);
    else break;
  }
  return q.map((w) => w.id);
}

function startRound() {
  if (phase === "lock") { updateLock(); return; }
  Sound.ensure();
  const q = buildQueue();
  if (!q.length) {
    toast(phase === "wind" ? "今日はまだ何も覚えていない。今夜は寝ろ。朝にやれ。" : "今日の分は片付いた。新規の上限を上げるか、休め。");
    return;
  }
  round = { queue: q, tries: {}, done: 0, combo: 0, maxCombo: 0, xp: 0, ok: 0, answered: 0, chests: 0, opened: 0, newSeen: 0, slain: [], cur: null, lastMode: null, night: phase === "wind" };
  $("#session").hidden = false; document.body.style.overflow = "hidden";
  $("#session").classList.remove("fever");
  nextCard();
}

function chooseMode(w, c) {
  if (!c) return "intro";
  const ex = hasEx(w);
  if (phase === "wind") return ex && Math.random() < 0.35 ? "context" : "recall";
  if (c.st === 1 && c.step === 0) return "choice";
  if (c.st === 1) return w.tag === "write" && ex ? "cloze" : "recall";
  if (c.st === 3) return ex && Math.random() < 0.5 ? "context" : "recall";
  const wt = { recall: 30, context: ex ? 25 : 0, cloze: ex ? 25 : 0, choice: 15 };
  if (w.tag === "poly") wt.context += 20;
  if (w.tag === "write") { wt.cloze += 40; wt.choice = 5; wt.context = ex ? 5 : 0; }
  if (c.ivl >= 7) { wt.cloze += ex ? 15 : 0; wt.choice = Math.max(0, wt.choice - 10); }
  if (round && round.lastMode && wt[round.lastMode] > 0) wt[round.lastMode] *= 0.4;
  let tot = 0; for (const k in wt) tot += wt[k];
  let x = Math.random() * tot;
  for (const k in wt) { x -= wt[k]; if (x < 0) return k; }
  return "recall";
}

function nextCard() {
  if (!round) return;
  clearTimeout(round.auto);
  if (phase === "lock") { closeSession(); updateLock(); return; }
  if (round.cur) round.done++;
  if (!round.queue.length) return showResult();
  const id = round.queue.shift();
  const w = BYID.get(id);
  if (!w || !enabledTag(w.tag)) { round.cur = null; return nextCard(); }
  const c = state.cards[id];
  const mode = chooseMode(w, c);
  round.cur = { id, w, mode, t0: performance.now(), done: false, committed: false, revealed: false };
  round.lastMode = mode;
  renderCard();
  renderMeta();
}

function cardHead(w, c, mode) {
  const nem = isNemesis(c);
  return `<div class="qhead"><span class="mode ${mode === "intro" ? "new" : ""}">${MODE_LABEL[mode]}</span>${
    nem ? `<span class="mode nem">賞金首 +${BOUNTY}XP</span>` : `<span class="deckname" style="--dc:${deckColor(w.tag)}">${esc(DECKS[w.tag].name)}</span>`}</div>`;
}
const speakBtn = (text) => (canSpeak ? `<button class="speak" data-speak="${esc(text)}" aria-label="発音を聞く">${ICON.speaker}</button>` : "");
const hwBlock = (w) => `<div class="hwrow"><div><h2 class="hw ${w.w.length > 13 ? "long" : ""}">${esc(w.w)}</h2>${w.pos ? `<div class="pos">${esc(w.pos)}</div>` : ""}</div>${speakBtn(w.w)}</div>`;
const blankOf = (s) => s.split(" ").map((t) => (t ? t[0] + "_".repeat(Math.max(1, t.length - 1)) : t)).join(" ");
function exHTML(w, how) {
  if (!hasEx(w)) return "";
  const i = w.ex.indexOf(w.hit);
  const a = esc(w.ex.slice(0, i)), b = esc(w.ex.slice(i + w.hit.length));
  return how === "blank" ? `${a}<span class="blank">${esc(blankOf(w.hit))}</span>${b}` : `${a}<mark>${esc(w.hit)}</mark>${b}`;
}
function ansHTML(w, { lead = "", showEx = true, showWord = false } = {}) {
  return `<div class="ans">${lead}
    ${showWord ? `<div class="hwrow"><div><b class="ex">${esc(w.w)}</b> <span class="pos">${esc(w.pos)}</span></div>${speakBtn(w.w)}</div>` : ""}
    <div class="ans-ja">${esc(w.ja)}</div>
    ${w.more ? `<div class="ans-more">${esc(w.more)}</div>` : ""}
    ${showEx && hasEx(w) ? `<p class="ex">${exHTML(w, "mark")}</p>${w.exJa ? `<p class="exja">${esc(w.exJa)}</p>` : ""}` : ""}
    ${w.note ? `<p class="note"><b>京大ポイント</b>${esc(w.note)}</p>` : ""}
  </div>`;
}
const nextBtn = () => `<button class="btn primary" data-act="next">次へ <kbd>Enter</kbd></button>`;

function renderCard() {
  const { w, mode } = round.cur, c = state.cards[w.id];
  const head = cardHead(w, c, mode);
  let st = "", ac = "";
  if (mode === "intro") {
    st = `<div class="qcard">${head}${hwBlock(w)}${ansHTML(w)}</div>`;
    ac = `<button class="btn primary" data-act="introDone">覚えた → テストへ <kbd>Space</kbd></button>`;
    if (S().tts && !isNight()) speak(w.w);
  } else if (mode === "recall") {
    st = `<div class="qcard">${head}${hwBlock(w)}<p class="prompt">意味を口に出してから開け。思い出せなかったら正直に「もう一回」。嘘の正解は本番で自分に返ってくる。</p><div id="ansSlot"></div></div>`;
    ac = `<button class="btn primary" data-act="reveal">答えを見る <kbd>Space</kbd></button>`;
  } else if (mode === "context") {
    st = `<div class="qcard">${head}<p class="ex big ctx">${exHTML(w, "mark")}</p><p class="prompt">下線部 <b>${esc(w.hit)}</b> をこの文脈で訳せ。辞書の第1義を貼るな。</p><div id="ansSlot"></div></div>`;
    ac = `<button class="btn primary" data-act="reveal">答えを見る <kbd>Space</kbd></button>`;
  } else if (mode === "cloze") {
    const nw = w.hit.split(" ").length;
    st = `<div class="qcard">${head}<p class="exja lead">${esc(w.exJa || w.ja)}</p><p class="ex" id="clozeEx">${exHTML(w, "blank")}</p><p class="prompt">空所を英語で書け（${nw}語・頭文字ヒントあり。頭文字も含めて全部打て）</p><div id="ansSlot"></div></div>`;
    ac = `<input class="cloze-in" id="clozeIn" type="text" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="done" aria-label="空所に入る英語">
          <div class="row2"><button class="btn ghost" data-act="giveup">わからん</button><button class="btn primary" data-act="submit">答える <kbd>Enter</kbd></button></div>`;
  } else if (mode === "choice") {
    const opts = shuffle([w, ...distractors(w)]);
    st = `<div class="qcard">${head}${hwBlock(w)}<p class="prompt">意味はどれ？ 速いほどXPが増える。</p><div id="ansSlot"></div></div>`;
    ac = `<div class="choices">${opts.map((o, i) => `<button class="ch" data-act="choose" data-id="${esc(o.id)}"><kbd>${i + 1}</kbd><span>${esc(o.ja)}</span></button>`).join("")}</div>`;
  }
  stage().innerHTML = st.replace('<div class="qcard">', `<div class="qcard" data-id="${esc(w.id)}">`); actions().innerHTML = ac;
  stage().scrollTop = 0;
  if (mode === "cloze") setTimeout(() => { try { $("#clozeIn").focus({ preventScroll: true }); } catch { /* ignore */ } }, 50);
}

function distractors(w, n = 3) {
  const p0 = w.pos.split("・")[0];
  const pool = WORDS.filter((x) => x.id !== w.id && x.ja && x.ja !== w.ja);
  const sameDeck = shuffle(pool.filter((x) => x.tag === w.tag && x.pos.split("・")[0] === p0));
  const samePos = shuffle(pool.filter((x) => x.pos.split("・")[0] === p0));
  const rest = shuffle(pool.slice());
  const out = [], seen = new Set([w.ja]);
  for (const x of [...sameDeck, ...samePos, ...rest]) { if (out.length >= n) break; if (!seen.has(x.ja)) { seen.add(x.ja); out.push(x); } }
  return out;
}

function reveal() {
  const cur = round?.cur; if (!cur || cur.revealed || (cur.mode !== "recall" && cur.mode !== "context")) return;
  cur.revealed = true; cur.ms = performance.now() - cur.t0;
  const w = cur.w, c = state.cards[w.id];
  $("#ansSlot").innerHTML = cur.mode === "context"
    ? ansHTML(w, { lead: w.exJa ? `<p class="exja lead">${esc(w.exJa)}</p>` : "", showEx: false, showWord: true })
    : ansHTML(w);
  const labels = ["もう一回", "微妙", "正解", "余裕"];
  actions().innerHTML = `<div class="grades">${[1, 2, 3, 4].map((g) => `<button class="g g${g}" data-act="grade" data-g="${g}">${labels[g - 1]}<small>${previewLabel(c, g)}</small></button>`).join("")}</div>`;
  if (S().tts && !isNight()) speak(w.w);
}

function choose(id, btn) {
  const cur = round?.cur; if (!cur || cur.done || cur.mode !== "choice") return;
  cur.done = true; cur.ms = performance.now() - cur.t0;
  const ok = id === cur.id;
  $$(".ch", actions()).forEach((b) => { b.disabled = true; if (b.dataset.id === cur.id) b.classList.add("ok"); else if (b === btn) b.classList.add("ng"); });
  $("#ansSlot").innerHTML = ansHTML(cur.w);
  commit(ok ? 3 : 1);
  actions().insertAdjacentHTML("beforeend", nextBtn());
  if (ok) round.auto = setTimeout(nextCard, 900);
}

function submitCloze(giveUp) {
  const cur = round?.cur; if (!cur || cur.done || cur.mode !== "cloze") return;
  const input = $("#clozeIn");
  const val = giveUp ? "" : input.value;
  if (!giveUp && !norm(val)) { input.focus(); return; }
  cur.done = true; cur.ms = performance.now() - cur.t0; input.disabled = true;
  const a = norm(val), b = norm(cur.w.hit);
  let g, verdict;
  if (a === b) { g = cur.ms < 7000 ? 4 : 3; verdict = `<div class="verdict ok">正解${g === 4 ? "（即答）" : ""}</div>`; }
  else if (a && b.length >= 4 && lev(a, b) <= 1) { g = 2; verdict = `<div class="verdict near">惜しい（1字違い）</div>`; }
  else { g = 1; verdict = `<div class="verdict ng">${giveUp ? "わからん＝不正解" : "不正解"}</div>`; }
  const yours = g < 3 && val ? `<div class="yours">あなた: <s>${esc(val)}</s> → 正: <b>${esc(cur.w.hit)}</b></div>` : "";
  $("#clozeEx").innerHTML = exHTML(cur.w, "mark");
  $("#ansSlot").innerHTML = ansHTML(cur.w, { lead: verdict + yours, showEx: false, showWord: true });
  if (g >= 2) {
    commit(g);
    actions().innerHTML = nextBtn();
    if (g >= 3) round.auto = setTimeout(nextCard, 1400);
  } else {
    cur.pending = 1;
    wrongFx();
    actions().innerHTML = `<button class="btn small ghost" data-act="override">実は合ってた（別解・表記ゆれ）→ 正解にする</button>${nextBtn()}`;
  }
  setTimeout(() => { try { $("[data-act=next]", actions()).focus({ preventScroll: true }); } catch { /* ignore */ } }, 30);
}

function introDone() {
  const cur = round?.cur; if (!cur || cur.done || cur.mode !== "intro") return;
  cur.done = true;
  const now = Date.now();
  state.cards[cur.id] = newCard(now);
  state.prio = state.prio.filter((x) => x !== cur.id);
  today().newc++;
  addXP(3); round.xp += 3; round.newSeen++;
  round.queue.splice(Math.min(2 + randInt(0, 1), round.queue.length), 0, cur.id);
  Store.save(); renderHeader();
  nextCard();
}

function requeue(id, c, g) {
  if (c.st === 2) return;
  round.tries[id] = (round.tries[id] || 0) + 1;
  if (round.tries[id] >= 5) return; // 1ラウンドで5回落ちたら次のラウンドへ回す（無限ループ防止）
  const pos = g === 1 ? 2 + randInt(0, 1) : 4 + randInt(0, 2);
  round.queue.splice(Math.min(pos, round.queue.length), 0, id);
}

function commit(g, { silent = false } = {}) {
  const cur = round.cur; if (!cur || cur.committed) return;
  cur.committed = true; cur.done = true;
  const now = Date.now();
  const ms = cur.ms ?? performance.now() - cur.t0;
  const prev = state.cards[cur.id];
  const wasNem = isNemesis(prev);
  const c = grade(prev, g, now);
  const t = today();
  t.reps++; if (g >= 3) t.ok++; t.ms += Math.min(ms, 60000);
  round.answered++; if (g >= 3) round.ok++;
  if (g >= 3) round.combo++; else if (g === 1) round.combo = 0;
  round.maxCombo = Math.max(round.maxCombo, round.combo);
  state.bestCombo = Math.max(state.bestCombo || 0, round.combo);

  const night = isNight();
  let base = [0, 2, 6, 10, 12][g];
  if (g >= 3 && cur.mode === "cloze") base += 6;
  if (g >= 3 && cur.mode === "context") base += 2;
  if (g >= 3 && cur.mode === "choice" && ms < 3000) base += 3;
  let mul = 1, luck = null;
  if (!night) {
    mul *= 1 + Math.min(round.combo, 30) * 0.05;
    if (round.combo >= FEVER_AT) mul *= 1.5;
    if (phase === "morning") mul *= 1.5;
    if (g >= 3) { const r = Math.random(); if (r < 0.02) luck = "jackpot"; else if (r < 0.12) luck = "crit"; }
    if (luck === "jackpot") mul *= 5; else if (luck === "crit") mul *= 2;
  }
  let gain = Math.round(base * mul);
  const ev = [];
  if (wasNem && g >= 3) {
    gain += BOUNTY; ev.push("bounty");
    if (c.st === 2 && c.ivl >= 7) { c.slain = true; gain += SLAY; ev.push("slay"); round.slain.push(cur.w.w); }
  }
  state.cards[cur.id] = c;
  if (!night && g >= 3) {
    state.chestIn = (state.chestIn ?? 10) - 1;
    if (state.chestIn <= 0) { round.chests++; state.chestIn = randInt(7, 13); ev.push("chest"); }
  }
  const lvBefore = levelInfo(state.xp).L;
  addXP(gain); round.xp += gain;
  const lvAfter = levelInfo(state.xp).L;
  if (!t.goal && t.reps >= S().goal) { t.goal = true; bumpStreak(); ev.push("goal"); }
  requeue(cur.id, c, g);
  Store.save();
  if (!silent) feedback(g, gain, luck, ev, lvAfter > lvBefore ? lvAfter : 0, lvBefore);
  else if (lvAfter > lvBefore) setTimeout(() => levelUp(lvAfter, lvBefore), 300);
  renderMeta(); renderHeader();
}

function cardPoint() {
  const card = $(".qcard", stage());
  const r = card?.getBoundingClientRect();
  return { card, x: r ? r.left + r.width / 2 : innerWidth / 2, y: r ? r.top + 56 : innerHeight / 3 };
}
function wrongFx() {
  const { card } = cardPoint();
  if (card) { card.classList.remove("shake"); void card.offsetWidth; card.classList.add("shake"); }
  Sound.wrong(); vibrate(30);
}
function feedback(g, gain, luck, ev, newLv, oldLv) {
  const { card, x, y } = cardPoint();
  if (g >= 3) {
    if (card) { card.classList.remove("pop"); void card.offsetWidth; card.classList.add("pop"); }
    floatText(`+${gain}`, x, y);
    FX.burst(x, y, luck === "jackpot" ? 130 : luck === "crit" ? 60 : 16 + Math.min(round.combo, 24), luck ? ["--gold", "--accent", "--gold"] : ["--accent", "--gold", "--info"]);
    Sound.correct(round.combo);
    vibrate(luck ? [20, 40, 20] : 10);
    if (luck === "jackpot") { banner("JACKPOT", "XP ×5"); flash(); Sound.jackpot(); }
    else if (luck === "crit") { banner("CRITICAL", "XP ×2"); flash(); Sound.crit(); }
    else if (COMBO_LINES[round.combo]) { banner(...COMBO_LINES[round.combo]); Sound.crit(); }
  } else if (g === 1) wrongFx();
  else { floatText(`+${gain}`, x, y); Sound.soft(); }
  if (ev.includes("bounty")) setTimeout(() => { banner(ev.includes("slay") ? "賞金首 撃破" : "賞金首 命中", `+${ev.includes("slay") ? BOUNTY + SLAY : BOUNTY} XP`); Sound.crit(); }, 250);
  if (ev.includes("chest")) setTimeout(() => { toast("宝箱ドロップ！ ラウンドの最後に開けろ"); Sound.chest(); }, 200);
  if (ev.includes("goal")) setTimeout(() => { banner("ノルマ達成", `連続 ${state.streak.count}日`); Sound.fanfare(); FX.confetti(); }, 450);
  if (newLv) setTimeout(() => levelUp(newLv, oldLv), 650);
}
function levelUp(L, oldL) {
  const promoted = rankOf(L) !== rankOf(oldL || L - 1);
  banner(`LEVEL ${L}`, promoted ? `${rankOf(L)} に昇格` : rankOf(L));
  Sound.fanfare(); FX.confetti(); vibrate([30, 50, 30, 50, 60]);
  if (!fxOn()) toast(`Lv.${L} ${rankOf(L)}`);
}

function renderMeta() {
  if (!round) return;
  const total = round.done + round.queue.length + (round.cur ? 1 : 0);
  $("#sProg").style.width = (total ? (round.done / total) * 100 : 0) + "%";
  $("#sCount").textContent = `${Math.min(round.done + 1, total)}/${total}`;
  const combo = $("#combo");
  const prevN = +$("#comboNum").textContent;
  $("#comboNum").textContent = round.combo;
  combo.classList.toggle("hot", round.combo >= 5);
  if (round.combo > prevN && fxOn()) { combo.classList.remove("bump"); void combo.offsetWidth; combo.classList.add("bump"); }
  const fever = !isNight() && round.combo >= FEVER_AT;
  $("#session").classList.toggle("fever", fever);
  $("#feverSlot").innerHTML = fever ? `<span class="feverbar">FEVER ×1.5</span>` : phase === "morning" ? `<span class="mode new">朝ボーナス ×1.5</span>` : isNight() ? `<span class="mode">夜モード</span>` : "";
  $("#rxp").textContent = `+${round.xp} XP`;
}

function rollChest() {
  const r = Math.random();
  const tip = pick(TIPS);
  if (r < 0.05) return { xp: 500, label: "超激レア", rar: "ur", text: "+500 XP", tip };
  if (r < 0.15) return { shield: 1, label: "SR", rar: "sr", text: "ストリーク・シールド +1（1日サボっても連続記録が切れない）", tip };
  if (r < 0.4) return { xp: randInt(100, 200), label: "レア", rar: "r", tip };
  return { xp: randInt(30, 80), label: "ノーマル", rar: "n", tip };
}
function applyLoot(l) {
  if (l.xp) { const before = levelInfo(state.xp).L; addXP(l.xp); round && (round.xp += l.xp); const after = levelInfo(state.xp).L; if (after > before) setTimeout(() => levelUp(after, before), 500); }
  if (l.shield) state.streak.shields++;
  Store.save(); renderHeader();
}
function openChest(btn) {
  if (!round || btn.classList.contains("opened") || btn.classList.contains("opening")) return;
  btn.classList.add("opening"); Sound.chest();
  setTimeout(() => {
    btn.classList.remove("opening"); btn.classList.add("opened"); btn.disabled = true;
    const l = rollChest(); applyLoot(l); round.opened++;
    if (l.rar === "ur") { banner("超激レア", "+500 XP"); Sound.jackpot(); flash(); }
    const r = btn.getBoundingClientRect(); FX.burst(r.left + r.width / 2, r.top + r.height / 2, l.rar === "ur" ? 120 : 40, ["--gold", "--accent"]);
    $("#lootSlot").insertAdjacentHTML("afterbegin", `<div class="loot"><span class="rar ${l.rar}">${esc(l.label)}</span><b>${esc(l.text || `+${l.xp} XP`)}</b><p>京大英語Tips: ${esc(l.tip)}</p></div>`);
    $("#rxp").textContent = `+${round.xp} XP`;
    $("#resXp") && ($("#resXp").textContent = `+${round.xp}`);
  }, 600);
}

function showResult() {
  const r = round; r.cur = null;
  const acc = r.answered ? Math.round((r.ok / r.answered) * 100) : 0;
  const p = pace();
  const tail = r.night
    ? `<div class="alert calm"><b>寝ろ</b>今日の単語は眠っている間に固まる。画面を閉じて、明日の朝に再学習（XP×1.5）。</div>`
    : p.need > S().newPerDay ? `<div class="alert warn"><b>ペース不足</b>未習${p.unseen}語を試験2週間前までに終えるには1日${p.need}語。設定で新規を上げろ。</div>` : "";
  stage().innerHTML = `<div class="result">
    <span class="eyebrow">ROUND CLEAR</span>
    <h2>${r.night ? "おつかれ。もう寝ろ。" : esc(pick(CLEAR_LINES))}</h2>
    <div class="rgrid">
      <div class="rbox"><b class="num" id="resXp">+${r.xp}</b><span>獲得XP</span></div>
      <div class="rbox"><b class="num">${acc}%</b><span>正答率（${r.ok}/${r.answered}）</span></div>
      <div class="rbox"><b class="num">${r.maxCombo}</b><span>最大コンボ</span></div>
      <div class="rbox"><b class="num">${r.newSeen}</b><span>新しく覚えた語</span></div>
    </div>
    ${r.chests ? `<div class="memo"><span class="eyebrow">宝箱 ×${r.chests} — タップで開けろ</span><div class="chests">${Array.from({ length: r.chests }, (_, i) => `<button class="chest" data-act="chest" data-i="${i}" aria-label="宝箱を開ける">${ICON.chest}</button>`).join("")}</div><div id="lootSlot" class="memo"></div></div>` : ""}
    ${r.slain.length ? `<div class="alert good"><b>撃破</b>賞金首 ${esc(r.slain.join(", "))} を倒した。</div>` : ""}
    ${tail}
  </div>`;
  actions().innerHTML = r.night
    ? `<button class="btn primary" data-act="home">閉じて寝る</button>`
    : `<div class="row2"><button class="btn" data-act="home">ホームへ</button><button class="btn primary" data-act="again">もう1ラウンド</button></div>`;
  $("#session").classList.remove("fever");
  $("#feverSlot").innerHTML = "";
  $("#sProg").style.width = "100%";
  if (r.answered) { FX.confetti(); Sound.fanfare(); }
}

function closeSession() {
  if (round && round.chests > round.opened) {
    let gained = 0, shields = 0;
    for (let i = round.opened; i < round.chests; i++) { const l = rollChest(); applyLoot(l); gained += l.xp || 0; shields += l.shield || 0; }
    toast(`未開封の宝箱を自動で開けた: +${gained} XP${shields ? ` / シールド+${shields}` : ""}`);
  }
  if (round) clearTimeout(round.auto);
  round = null;
  $("#session").hidden = true; document.body.style.overflow = "";
  try { speechSynthesis.cancel(); } catch { /* ignore */ }
  renderAll();
}
function endRoundEarly() {
  if (!round) return;
  if (round.cur && round.cur.pending && !round.cur.committed) commit(round.cur.pending, { silent: true });
  if (round.answered > 0 && round.cur) { round.queue = []; showResult(); } else closeSession();
}

/* ================= views ================= */
const VIEWS = ["home", "zukan", "kiroku", "config"];
let currentView = "home";
function showView(v) {
  if (!VIEWS.includes(v)) v = "home";
  currentView = v;
  for (const name of VIEWS) $("#view-" + name).hidden = name !== v;
  $$(".tab").forEach((t) => (t.dataset.view === v ? t.setAttribute("aria-current", "page") : t.removeAttribute("aria-current")));
  renderView();
  scrollTo(0, 0);
}
function renderView() {
  if (currentView === "home") renderHome();
  else if (currentView === "zukan") renderZukan();
  else if (currentView === "kiroku") renderLog();
  else if (currentView === "config") renderSettings();
}
function renderAll() { applyPhase(); renderHeader(); renderView(); updateLock(); }

function renderHeader() {
  const li = levelInfo(state.xp);
  $("#lvNum").textContent = "Lv." + li.L;
  $("#lvTitle").textContent = rankOf(li.L);
  $("#xpFill").style.width = ((li.into / li.need) * 100).toFixed(1) + "%";
  $("#xpBar").setAttribute("aria-valuenow", String(Math.round((li.into / li.need) * 100)));
  $("#xpInto").textContent = `${li.into} / ${li.need} XP`;
  $("#xpTotal").textContent = `累計 ${state.xp.toLocaleString()}`;
  $("#streakNum").textContent = liveStreak();
  $("#streak").classList.toggle("cold", !peekToday().goal);
}

function ring(v, goal) {
  const R = 27, L = 2 * Math.PI * R, p = clamp(v / Math.max(1, goal), 0, 1);
  return `<div class="ring" aria-label="今日のノルマ ${v}/${goal}"><svg viewBox="0 0 64 64"><circle class="bgc" cx="32" cy="32" r="${R}"/><circle class="fgc" cx="32" cy="32" r="${R}" stroke-dasharray="${L.toFixed(1)}" stroke-dashoffset="${(L * (1 - p)).toFixed(1)}"/></svg><div><b>${v}</b><small>/${goal}</small></div></div>`;
}

function renderHome() {
  const v = $("#view-home");
  if (!WORDS.length) { v.innerHTML = `<div class="alert warn"><b>データなし</b>words/*.js が読み込めていない。</div>`; return; }
  const now = Date.now(), k = counts(now), t = peekToday(), p = pace();
  const night = phase === "wind";
  const qn = buildQueue(now).length;
  const bed = hm(S().bedtime), wake = hm(S().wake);
  const chip = phase === "wind" ? `就寝まで ${fmtHM(minsUntil(bed, now))}`
    : phase === "morning" ? `朝ボーナス ×1.5 あと${fmtHM(minsUntil((wake + 180) % 1440, now))}`
    : phase === "lock" ? "就寝時間" : `就寝まで ${fmtHM(minsUntil(bed, now))}`;
  const todayWords = activeWords().filter((w) => { const c = state.cards[w.id]; return c && Math.max(c.last || 0, c.first || 0) >= dayStart(now); }).length;
  const ammo = night
    ? `<div><b class="num">${todayWords}</b><span>今日の語</span></div>`
    : `<div><b>${k.due + k.learning}</b><span>復習</span></div><div><b>+${k.newLeft}</b><span>新規</span></div>`;
  const startLabel = night ? ["寝る前ミニ復習", `${qn}語・5分で終われ`] : ["ぶっ放せ", qn ? `${qn}語 ・ 約${Math.max(1, Math.round((qn * 1.8 * 9) / 60))}分` : "今日の分は完了"];
  const dl = p.dl;

  const alerts = [];
  if (night) alerts.push(`<div class="alert calm"><b>夜モード</b>演出・効果音・新規はオフ。今日触った語だけ軽く1周して寝ろ。寝る前の明るい画面は寝つきを遅らせる（Chang et al., 2015）。</div>`);
  else if (phase === "morning") alerts.push(`<div class="alert good"><b>朝の再学習</b>昨夜の語から出す。睡眠を挟んだ再学習は少ない練習で長く残る（Mazza et al., 2016）。今ならXP×1.5。</div>`);
  if (!night && Number.isFinite(dl) && dl > 0 && p.need > S().newPerDay) alerts.push(`<div class="alert warn"><b>ペース不足</b>未習${p.unseen}語を試験2週間前までに終えるには1日${p.need}語必要。今は${S().newPerDay}語。設定で上げろ。</div>`);
  if (!night && k.due > 150) alerts.push(`<div class="alert warn"><b>復習過多</b>復習が${k.due}語溜まっている。今日は新規を0にして復習を片付けろ。</div>`);
  if (t.goal && !night) alerts.push(`<div class="alert good"><b>ノルマ達成</b>追加ラウンドは歓迎。ただし就寝時刻は守れ。</div>`);
  if (sleepMins() < 480) alerts.push(`<div class="alert warn"><b>睡眠不足設定</b>就寝〜起床が${fmtHM(sleepMins())}。13〜18歳の推奨は8〜10時間（AASM）。設定で直せ。</div>`);

  const deckRows = DECK_ORDER.filter((tag) => countTag(tag)).map((tag) => {
    const ws = WORDS.filter((w) => w.tag === tag);
    let m = 0, l = 0;
    for (const w of ws) { const c = state.cards[w.id]; if (isMastered(c)) m++; else if (c) l++; }
    const on = enabledTag(tag);
    return `<div class="deck ${on ? "" : "off"}" style="--dc:${deckColor(tag)}">
      <h3><i></i>${esc(DECKS[tag].name)}${on ? "" : '<span class="small muted">（オフ）</span>'}</h3>
      <p>${esc(DECKS[tag].sub)}</p>
      <div class="cnt"><b>${m}</b>/${ws.length}<br>学習中 ${l}</div>
      <div class="stack"><i class="m" style="width:${(m / ws.length) * 100}%"></i><i class="l" style="width:${(l / ws.length) * 100}%"></i></div>
    </div>`;
  }).join("");

  const nem = activeWords().filter((w) => isNemesis(state.cards[w.id])).sort((a, b) => state.cards[b.id].lapses - state.cards[a.id].lapses).slice(0, 14);

  v.innerHTML = `
  <div class="hero">
    <div class="hero-top"><span class="eyebrow">${night ? "就寝前" : "今日の残弾"}</span><span class="phase-chip">${esc(chip)}</span></div>
    <div class="ammo">${ammo}</div>
    <button class="start" data-act="start" ${qn ? "" : "disabled"}><b>${startLabel[0]}</b><span>${startLabel[1]}</span></button>
    <div class="hero-stats">
      ${ring(t.reps, S().goal)}
      <div class="hstat"><b>${liveStreak()}日</b><span>連続達成${state.streak.shields ? `・盾${state.streak.shields}` : ""}</span></div>
      <div class="hstat"><b>${Number.isFinite(dl) ? (dl > 0 ? dl + "日" : "本番") : "—"}</b><span>二次試験まで</span></div>
    </div>
  </div>
  ${alerts.join("")}
  <div class="section-h"><h2>単語帳</h2><span class="small muted">定着 / 全語</span></div>
  <div class="decks">${deckRows}</div>
  ${nem.length ? `<div class="section-h"><h2>賞金首</h2><span class="small muted">4回以上忘れた天敵</span></div>
  <div class="panel memo"><p class="small muted">正解で +${BOUNTY}XP。復習間隔7日以上まで育てたら撃破 +${SLAY}XP。</p><div class="bounty">${nem.map((w) => `<button data-open="${esc(w.id)}">${esc(w.w)}<small>×${state.cards[w.id].lapses}</small></button>`).join("")}</div></div>` : ""}
  <div class="panel memo">
    <span class="eyebrow">京大英語 × このアプリ</span>
    <ol>
      <li><b>英文和訳</b> → 多義語・評論語を「下線部を文脈で訳す」和訳モードで出す。辞書の第1義では点にならない。</li>
      <li><b>和文英訳</b> → 英作文モード。日本語訳を見て、空所の英語を頭文字ヒントだけで書く。</li>
      <li><b>自由英作文</b> → 英作文表現デッキと情報・科学デッキ。2025年のテーマはAIと想像力だった。</li>
    </ol>
    <p class="src">出題傾向: <a href="https://study-search.jp/columns/296" target="_blank" rel="noopener">study-search.jp</a> ／ <a href="https://up-edu.com/blog/wp-content/uploads/tsuwamono-way/english/tsuwamono-english_20251010.pdf" target="_blank" rel="noopener">UP-EDU 京大英語解説</a>。学習設計の根拠は「設定」タブの最下部。</p>
  </div>`;
}

let zFilter = "all";
function tileState(c) { return !c ? "s-new" : isMastered(c) ? "s-master" : c.st === 2 ? "s-review" : "s-learn"; }
function renderZukan() {
  const v = $("#view-zukan");
  if (!v.dataset.built) {
    v.innerHTML = `<div class="section-h"><h2>単語図鑑</h2><span class="small muted num" id="zSum"></span></div>
      <input class="search" id="zq" type="search" placeholder="検索（英語・日本語）" autocomplete="off" aria-label="単語を検索">
      <div class="chips" id="zchips">${[["all", "全部"], ["new", "未習"], ["learn", "学習中"], ["master", "定着"], ["nem", "賞金首"]].map(([k, l]) => `<button class="chipbtn" data-z="${k}" aria-pressed="${k === zFilter}">${l}</button>`).join("")}</div>
      <div class="legend"><span><i style="border:1.5px dashed var(--line)"></i>未習</span><span><i style="border:1.5px solid var(--ink-2)"></i>学習中</span><span><i style="background:var(--surface-2)"></i>復習中</span><span><i style="background:var(--d-poly)"></i>定着</span><span><i style="box-shadow:0 0 0 2px var(--bad)"></i>賞金首</span></div>
      <div id="zList" class="view" style="padding-top:0"></div>`;
    v.dataset.built = "1";
    $("#zq").addEventListener("input", renderZList);
  }
  renderZList();
}
function renderZList() {
  const q = norm($("#zq")?.value || "");
  const total = WORDS.length, mastered = WORDS.filter((w) => isMastered(state.cards[w.id])).length;
  $("#zSum").textContent = `定着 ${mastered}/${total}（${total ? Math.round((mastered / total) * 100) : 0}%）`;
  $$("#zchips .chipbtn").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.z === zFilter)));
  const pass = (w) => {
    const c = state.cards[w.id];
    if (zFilter === "new" && c) return false;
    if (zFilter === "learn" && (!c || isMastered(c))) return false;
    if (zFilter === "master" && !isMastered(c)) return false;
    if (zFilter === "nem" && !isNemesis(c)) return false;
    return !q || norm(w.w).includes(q) || w.ja.includes(q) || w.more.includes(q);
  };
  const html = DECK_ORDER.map((tag) => {
    const all = WORDS.filter((w) => w.tag === tag); if (!all.length) return "";
    const ws = all.filter(pass); if (!ws.length) return "";
    const m = all.filter((w) => isMastered(state.cards[w.id])).length;
    return `<div class="zdeck" style="--dc:${deckColor(tag)}"><h3><i></i>${esc(DECKS[tag].name)} <small>${m}/${all.length}</small></h3>
      <div class="tiles">${ws.map((w) => { const c = state.cards[w.id]; return `<button class="tile ${tileState(c)} ${isNemesis(c) ? "nem" : ""}" data-open="${esc(w.id)}">${esc(w.w)}</button>`; }).join("")}</div></div>`;
  }).join("");
  $("#zList").innerHTML = html || `<p class="muted">該当なし。</p>`;
}

function fmtDue(c) {
  const now = Date.now();
  if (c.due <= now) return "今すぐ";
  if (c.st === 2) { const d = new Date(c.due); return `${d.getMonth() + 1}/${d.getDate()} 以降`; }
  return fmtIvl(c.due - now) + "後";
}
function openSheet(id) {
  const w = BYID.get(id); if (!w) return;
  const c = state.cards[id];
  $("#sheetBody").innerHTML = `
    <div class="qhead"><span class="deckname" style="--dc:${deckColor(w.tag)}">${esc(DECKS[w.tag].name)}</span><button class="iconbtn" data-act="closeSheet" aria-label="閉じる">${ICON.x}</button></div>
    ${hwBlock(w)}
    ${ansHTML(w)}
    <div class="kv"><div><b>${stateName(c)}</b><span>状態</span></div><div><b>${c ? c.reps : 0}</b><span>回答数</span></div><div><b>${c ? c.lapses : 0}</b><span>忘れた回数</span></div><div><b>${c && c.st === 2 ? c.ivl + "日" : "—"}</b><span>復習間隔</span></div></div>
    ${c ? `<p class="small muted">次回: ${fmtDue(c)}</p>` : ""}
    <div class="btnrow">${c ? `<button class="btn small" data-act="dueNow" data-id="${esc(id)}">次のラウンドで出す</button>` : `<button class="btn small" data-act="learnNow" data-id="${esc(id)}">次のラウンドで新規に出す</button>`}</div>`;
  $("#sheet").hidden = false;
  setTimeout(() => { try { $("[data-act=closeSheet]").focus({ preventScroll: true }); } catch { /* ignore */ } }, 30);
}
const closeSheet = () => { $("#sheet").hidden = true; };

function renderLog() {
  const v = $("#view-kiroku");
  const now = Date.now(), k = dayKey(now);
  const act = activeWords();
  const mastered = act.filter((w) => isMastered(state.cards[w.id])).length;
  const seen = act.filter((w) => state.cards[w.id]).length;
  let r7 = 0, o7 = 0, m7 = 0;
  for (let i = 0; i < 7; i++) { const d = state.days[addDays(k, -i)]; if (d) { r7 += d.reps; o7 += d.ok; m7 += d.ms; } }
  const d14 = Array.from({ length: 14 }, (_, i) => { const key = addDays(k, i - 13); return { key, d: state.days[key] || blankDay() }; });
  const max = Math.max(S().goal, ...d14.map((x) => x.d.reps), 1);
  const fc = Array(7).fill(0);
  for (const w of act) { const c = state.cards[w.id]; if (!c) continue; const di = c.st === 2 ? Math.max(0, Math.floor((c.due - dayStart(now)) / DAY)) : 0; if (di < 7) fc[di]++; }
  const fmax = Math.max(1, ...fc);
  const p = pace();
  const goalPos = `calc(${(S().goal / max).toFixed(3)} * (100% - 18px) + 18px)`;
  v.innerHTML = `
  <div class="section-h"><h2>記録</h2><span class="small muted">直近の数字だけ見ろ</span></div>
  <div class="tiles4">
    <div class="rbox"><b class="num">${mastered}</b><span>定着語（/${act.length}）</span></div>
    <div class="rbox"><b class="num">${seen}</b><span>学習済み</span></div>
    <div class="rbox"><b class="num">${r7 ? Math.round((o7 / r7) * 100) + "%" : "—"}</b><span>7日間の正答率</span></div>
    <div class="rbox"><b class="num">${Math.round(m7 / 60000)}分</b><span>7日間の学習時間</span></div>
    <div class="rbox"><b class="num">${state.bestCombo || 0}</b><span>最大コンボ</span></div>
    <div class="rbox"><b class="num">${state.streak.best}日</b><span>最長連続</span></div>
    <div class="rbox"><b class="num">${state.xp.toLocaleString()}</b><span>累計XP</span></div>
    <div class="rbox"><b class="num">${state.nightOverrides || 0}回</b><span>就寝ロック解除</span></div>
  </div>
  <div class="panel memo">
    <span class="eyebrow">回答数 — 過去14日（金色＝ノルマ達成）</span>
    <div class="chart">${d14.map((x) => `<div class="bar ${x.d.goal ? "hit" : ""} ${x.key === k ? "today" : ""}" title="${x.key}: ${x.d.reps}回"><div class="col"><i style="height:${((x.d.reps / max) * 100).toFixed(1)}%"></i></div><span>${+x.key.slice(8)}</span></div>`).join("")}<div class="goal" style="bottom:${goalPos}"><span>ノルマ ${S().goal}</span></div></div>
  </div>
  <div class="panel memo">
    <span class="eyebrow">復習予報 — 今日から7日（語数）</span>
    <div class="chart fc">${fc.map((n, i) => `<div class="bar" title="${n}語"><div class="col"><i style="height:${((n / fmax) * 100).toFixed(1)}%"></i></div><span>${i === 0 ? "今日" : "+" + i}</span></div>`).join("")}</div>
    <p class="small muted">今日 ${fc[0]}語 ／ 7日合計 ${fc.reduce((a, b) => a + b, 0)}語</p>
  </div>
  <div class="panel memo">
    <span class="eyebrow">合格ペース</span>
    <p>${Number.isFinite(p.dl) && p.dl > 0 ? `二次試験まで <b>${p.dl}日</b>。未習 <b>${p.unseen}語</b> を試験2週間前までに終えるには <b>1日${p.need}語</b>。現在の設定は${S().newPerDay}語/日${p.need > S().newPerDay ? " — 足りない。" : " — 間に合う。"}` : "試験日を設定タブで入れろ。"}</p>
    <p class="small muted">復習間隔の上限は現在 ${ivlCap()}日（試験までの残り日数の15%、Cepeda et al., 2008 を参考）。試験が近づくほど間隔が詰まり、直前に全語をもう一度回す。</p>
  </div>`;
}

function numField(id, label, val, min, max, hint) {
  return `<div class="field"><label for="${id}">${label}</label><input type="number" id="${id}" value="${val}" min="${min}" max="${max}" inputmode="numeric">${hint ? `<span class="hint">${hint}</span>` : ""}</div>`;
}
function toggleField(id, label, on, hint) {
  return `<div class="field"><label for="${id}">${label}</label><input type="checkbox" class="switch" id="${id}" ${on ? "checked" : ""}>${hint ? `<span class="hint">${esc(hint)}</span>` : ""}</div>`;
}
function sleepText() {
  const m = sleepMins();
  if (m < 480) return `睡眠 ${fmtHM(m)}。8時間未満。AASM は13〜18歳に8〜10時間を推奨している。削るな。`;
  if (m > 600) return `睡眠 ${fmtHM(m)}。10時間超えは推奨範囲（8〜10時間）の外。`;
  return `睡眠 ${fmtHM(m)}。推奨範囲（8〜10時間, AASM）に入っている。`;
}
function armed(btn, label, fn) {
  if (btn.dataset.armed) { delete btn.dataset.armed; btn.textContent = btn.dataset.label; fn(); return; }
  btn.dataset.label = btn.textContent; btn.dataset.armed = "1"; btn.textContent = label;
  setTimeout(() => { if (btn.dataset.armed) { delete btn.dataset.armed; btn.textContent = btn.dataset.label; } }, 4000);
}
function parseImport(text) {
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let f = line.includes("\t") ? line.split("\t") : (() => { const p = line.split(","); return [p[0], p[1] || "", p.slice(2).join(",")]; })();
    f = f.map((x) => (x || "").trim());
    const [w, ja, ex = "", note = ""] = f;
    if (!w || !ja) continue;
    let hit = "";
    if (ex) {
      if (ex.includes(w)) hit = w;
      else {
        const stem = w.toLowerCase().slice(0, Math.max(3, w.length - 2));
        const tok = ex.split(/[^A-Za-z'-]+/).find((t) => t.toLowerCase().startsWith(stem));
        if (tok && ex.split(tok).length === 2) hit = tok;
      }
    }
    rows.push([w, "", ja.slice(0, 60), "", ex, hit, "", note.slice(0, 120)]);
  }
  return rows;
}
function renderSettings() {
  const v = $("#view-config"), s = S();
  v.innerHTML = `
  <div class="section-h"><h2>設定</h2><span class="sync" id="syncLine"><i></i><span></span></span></div>
  <div class="panel form">
    <span class="eyebrow">学習量</span>
    ${numField("newPerDay", "新規 / 日", s.newPerDay, 0, 200, "1日に初めて見る語数。合格ペースはホームと記録に出る。")}
    ${numField("goal", "ノルマ（回答数 / 日）", s.goal, 10, 1000, "達成で連続日数+1。")}
    ${numField("roundSize", "1ラウンドの問題数", s.roundSize, 5, 100, "")}
  </div>
  <div class="panel form">
    <span class="eyebrow">単語帳</span>
    ${DECK_ORDER.map((t) => toggleField("deck_" + t, `${DECKS[t].name}（${countTag(t)}語）`, s.decks[t] !== false, DECKS[t].sub)).join("")}
  </div>
  <div class="panel form">
    <span class="eyebrow">睡眠ガード</span>
    <div class="field"><label for="bedtime">就寝時刻</label><input type="time" id="bedtime" value="${esc(s.bedtime)}"><span class="hint">60分前から夜モード（演出・音・新規オフ、今日の語だけ復習）。就寝〜起床は「寝ろ。」画面でロックする。</span></div>
    <div class="field"><label for="wake">起床時刻</label><input type="time" id="wake" value="${esc(s.wake)}"><span class="hint">起床から3時間は朝の再学習ボーナス XP×1.5。</span></div>
    <p class="small" id="sleepLen">${esc(sleepText())}</p>
  </div>
  <div class="panel form">
    <span class="eyebrow">試験</span>
    <div class="field"><label for="examDate">二次試験の日</label><input type="date" id="examDate" value="${esc(s.examDate)}"><span class="hint">初期値は2027年2月25日（国公立の前期日程は例年2月25日開始）。必ず募集要項・受験票の日付に直せ。復習間隔はこの日までの残り日数の15%で頭打ちになる。</span></div>
  </div>
  <div class="panel form">
    <span class="eyebrow">演出</span>
    ${toggleField("sound", "効果音", s.sound, "コンボが続くほど音程が上がる。夜モードでは鳴らない。")}
    ${toggleField("effects", "エフェクト（紙吹雪・バナー・振動）", s.effects, "OS の「視差効果を減らす」がオンなら紙吹雪は出ない。")}
    ${toggleField("tts", "答えを見たら自動で発音", s.tts, canSpeak ? "スピーカーボタンでいつでも聞ける。" : "このブラウザは音声合成に非対応。")}
  </div>
  <div class="panel form">
    <span class="eyebrow">マイ単語を追加</span>
    <p class="small muted">自分の単語帳や過去問で覚えにくかった語を打ち込め。1行1語。タブ区切りなら「単語⇥意味⇥例文⇥メモ」、カンマ区切りなら「単語,意味,例文」。例文に単語が入っていれば和訳・英作文モードにも出る。</p>
    <textarea id="impText" placeholder="meticulous&#9;細心の注意を払った&#9;She kept meticulous records of every experiment."></textarea>
    <div class="btnrow"><button class="btn small primary" id="impBtn">追加する</button><button class="btn small danger" id="clearMine">マイ単語を全削除</button></div>
    <p class="small muted" id="impMsg">登録済み: ${state.custom.length}語</p>
  </div>
  <div class="panel form">
    <span class="eyebrow">バックアップ</span>
    <p class="small muted">${Store.ref ? "claude.ai のアカウントに自動で同期している。念のための控えも取れる。" : "記録はこのブラウザだけに保存されている。ブラウザのデータを消すと消える。定期的に書き出せ。"}</p>
    <div class="btnrow"><button class="btn small" id="expBtn">書き出す</button><button class="btn small" id="copyBtn" hidden>コピー</button></div>
    <textarea id="expText" readonly hidden aria-label="バックアップ"></textarea>
    <textarea id="restText" placeholder="書き出したJSONを貼り付けて復元" aria-label="復元するJSON"></textarea>
    <div class="btnrow"><button class="btn small" id="restBtn">復元する</button></div>
  </div>
  <div class="panel form">
    <span class="eyebrow">根拠 — このアプリの設計の出典</span>
    <ol class="sources">${SOURCES.map(([c, cite, url]) => `<li>${esc(c)}<br><a href="${esc(url)}" target="_blank" rel="noopener">${esc(cite)}</a></li>`).join("")}</ol>
    <p class="small muted">例文と訳はこのアプリのオリジナル。市販単語帳・過去問からの転載はない。</p>
  </div>
  <div class="panel form">
    <span class="eyebrow">全リセット</span>
    <div class="field"><label for="resetIn">RESET と入力</label><input id="resetIn" type="text" autocomplete="off" autocapitalize="characters"></div>
    <button class="btn small danger" id="resetBtn" disabled>全データを消す</button>
  </div>`;
  setSync(Store.status);
  const num = (id, key, lo, hi) => $("#" + id).addEventListener("change", (e) => { const n = clamp(Math.round(+e.target.value || 0), lo, hi); e.target.value = n; s[key] = n; Store.save(); renderHeader(); });
  num("newPerDay", "newPerDay", 0, 200); num("goal", "goal", 10, 1000); num("roundSize", "roundSize", 5, 100);
  for (const t of DECK_ORDER) $("#deck_" + t).addEventListener("change", (e) => { s.decks[t] = e.target.checked; Store.save(); });
  for (const key of ["sound", "effects", "tts"]) $("#" + key).addEventListener("change", (e) => { s[key] = e.target.checked; Store.save(); });
  for (const key of ["bedtime", "wake"]) $("#" + key).addEventListener("change", (e) => { if (/^\d{1,2}:\d{2}/.test(e.target.value)) { s[key] = e.target.value.slice(0, 5); Store.save(); $("#sleepLen").textContent = sleepText(); tick(true); } });
  $("#examDate").addEventListener("change", (e) => { if (/^\d{4}-\d{2}-\d{2}$/.test(e.target.value)) { s.examDate = e.target.value; Store.save(); } });
  $("#impBtn").addEventListener("click", () => {
    const rows = parseImport($("#impText").value);
    const have = new Set(state.custom.map((r) => r[0].toLowerCase()));
    const add = rows.filter((r) => !have.has(r[0].toLowerCase()) && have.add(r[0].toLowerCase()));
    if (!add.length) { $("#impMsg").textContent = "追加できる行がない。「単語⇥意味」の形で書け（重複は無視）。"; return; }
    state.custom.push(...add); buildWords(); Store.save();
    $("#impText").value = ""; $("#impMsg").textContent = `${add.length}語を追加。登録済み: ${state.custom.length}語`;
  });
  $("#clearMine").addEventListener("click", (e) => armed(e.currentTarget, "本当に消す？もう一度押せ", () => {
    for (const r of state.custom) delete state.cards["mine:" + r[0]];
    state.custom = []; buildWords(); Store.save(); $("#impMsg").textContent = "マイ単語を全削除した。";
  }));
  $("#expBtn").addEventListener("click", () => { const ta = $("#expText"); ta.value = JSON.stringify(state); ta.hidden = false; $("#copyBtn").hidden = false; ta.select(); });
  $("#copyBtn").addEventListener("click", () => {
    const ta = $("#expText");
    const done = () => toast("コピーした。メモアプリ等に貼って保管しろ。");
    const fallback = () => { ta.focus(); ta.select(); toast("選択した。長押しでコピーしろ。"); };
    try { navigator.clipboard.writeText(ta.value).then(done, fallback); } catch { fallback(); }
  });
  $("#restBtn").addEventListener("click", (e) => {
    let data;
    try { data = JSON.parse($("#restText").value); } catch { toast("JSONとして読めない。書き出した文字列をそのまま貼れ。"); return; }
    if (!data || typeof data !== "object" || !data.cards) { toast("このアプリのバックアップではない。"); return; }
    armed(e.currentTarget, "今の記録を上書きする。もう一度押せ", () => {
      state = normalize(data); state.updatedAt = Date.now(); buildWords(); Store.save(); renderAll(); toast("復元した。");
    });
  });
  $("#resetIn").addEventListener("input", (e) => { $("#resetBtn").disabled = e.target.value.trim() !== "RESET"; });
  $("#resetBtn").addEventListener("click", () => {
    const keep = state.settings; state = freshState(); state.settings = keep; state.updatedAt = Date.now();
    buildWords(); Store.save(); renderAll(); toast("全データを消した。ゼロからやり直せ。");
  });
}

/* ================= sleep lock ================= */
function updateLock() {
  const lock = $("#lock");
  if (phase === "lock") {
    $("#lockTime").textContent = `起床 ${S().wake} まで あと ${fmtHM(minsUntil(hm(S().wake)))}`;
    if (lock.hidden) { lock.hidden = false; closeSheet(); if (round) closeSession(); }
  } else lock.hidden = true;
}
(function holdToUnlock() {
  const btn = $("#holdBtn"), fill = $("#holdFill");
  let t0 = 0, raf = 0;
  const reset = () => { cancelAnimationFrame(raf); raf = 0; t0 = 0; fill.style.width = "0"; };
  const step = () => {
    const p = (performance.now() - t0) / 3000;
    fill.style.width = Math.min(100, p * 100) + "%";
    if (p >= 1) {
      reset();
      state.override = Date.now() + 10 * MIN; state.nightOverrides = (state.nightOverrides || 0) + 1; Store.save();
      tick(true); toast("10分だけだ。終わったら寝ろ。");
      return;
    }
    raf = requestAnimationFrame(step);
  };
  const start = (e) => { if (e) e.preventDefault(); if (raf) return; t0 = performance.now(); raf = requestAnimationFrame(step); };
  btn.addEventListener("pointerdown", start);
  ["pointerup", "pointerleave", "pointercancel"].forEach((ev) => btn.addEventListener(ev, reset));
  btn.addEventListener("keydown", (e) => { if ((e.key === " " || e.key === "Enter") && !e.repeat) start(e); });
  btn.addEventListener("keyup", reset);
  btn.addEventListener("contextmenu", (e) => e.preventDefault());
})();

let lastDayKey = dayKey();
function tick(force) {
  const p = getPhase(), dk = dayKey();
  const changed = p !== phase || dk !== lastDayKey;
  phase = p; lastDayKey = dk;
  if (changed || force) {
    applyPhase(); updateLock();
    if (round) renderMeta();
    else renderAll();
  } else {
    updateLock();
    if (!round && currentView === "home" && $("#sheet").hidden) renderHome();
  }
}

/* ================= events ================= */
document.addEventListener("click", (e) => {
  const sp = e.target.closest("[data-speak]");
  if (sp) { speak(sp.dataset.speak); return; }
  const tab = e.target.closest(".tab[data-view]");
  if (tab) { if (location.hash !== "#" + tab.dataset.view) location.hash = tab.dataset.view; else showView(tab.dataset.view); return; }
  const z = e.target.closest("[data-z]");
  if (z) { zFilter = z.dataset.z; renderZList(); return; }
  const op = e.target.closest("[data-open]");
  if (op) { openSheet(op.dataset.open); return; }
  if (e.target === $("#sheet")) { closeSheet(); return; }
  const a = e.target.closest("[data-act]");
  if (!a) return;
  const act = a.dataset.act;
  if (act === "start") startRound();
  else if (act === "introDone") introDone();
  else if (act === "reveal") reveal();
  else if (act === "grade") { const g = +a.dataset.g; if (round?.cur?.revealed && !round.cur.committed) { commit(g); setTimeout(nextCard, g >= 3 ? 260 : 380); } }
  else if (act === "choose") choose(a.dataset.id, a);
  else if (act === "submit") submitCloze(false);
  else if (act === "giveup") submitCloze(true);
  else if (act === "override") { if (round?.cur && !round.cur.committed) { round.cur.pending = 0; commit(3); setTimeout(nextCard, 500); } }
  else if (act === "next") { if (round?.cur?.pending && !round.cur.committed) commit(round.cur.pending, { silent: true }); if (round?.cur?.done || !round?.cur) nextCard(); }
  else if (act === "chest") openChest(a);
  else if (act === "again") { closeSession(); startRound(); }
  else if (act === "home") closeSession();
  else if (act === "closeSheet") closeSheet();
  else if (act === "dueNow") { const c = state.cards[a.dataset.id]; if (c) { c.due = c.st === 2 ? dayStart() - 1 : Date.now(); Store.save(); toast("次のラウンドで出す。"); closeSheet(); renderView(); } }
  else if (act === "learnNow") { state.prio = [a.dataset.id, ...state.prio.filter((x) => x !== a.dataset.id)]; Store.save(); toast("次のラウンドの新規の先頭に入れた。"); closeSheet(); renderView(); }
});
$("#sClose").addEventListener("click", endRoundEarly);

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") { if (!$("#sheet").hidden) closeSheet(); return; }
  if (!round || $("#session").hidden || !$("#lock").hidden) return;
  const cur = round.cur;
  const inInput = e.target && e.target.id === "clozeIn";
  if (!cur) return;
  if (cur.mode === "cloze" && !cur.done) { if (e.key === "Enter" && inInput) { e.preventDefault(); submitCloze(false); } return; }
  if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") && !inInput) return;
  if (e.key === " " || e.key === "Enter") {
    if (e.target && e.target.tagName === "BUTTON" && e.key === "Enter") return; // フォーカス中のボタンはそのまま
    e.preventDefault();
    if (cur.mode === "intro" && !cur.done) introDone();
    else if ((cur.mode === "recall" || cur.mode === "context") && !cur.revealed) reveal();
    else if (cur.done) { if (cur.pending && !cur.committed) commit(cur.pending, { silent: true }); nextCard(); }
    return;
  }
  if (/^[1-4]$/.test(e.key)) {
    const n = +e.key;
    if ((cur.mode === "recall" || cur.mode === "context") && cur.revealed && !cur.committed) { commit(n); setTimeout(nextCard, n >= 3 ? 260 : 380); }
    else if (cur.mode === "choice" && !cur.done) { const b = $$(".ch", actions())[n - 1]; if (b) choose(b.dataset.id, b); }
  }
});
addEventListener("hashchange", () => showView(location.hash.slice(1)));
document.addEventListener("visibilitychange", () => { if (document.hidden) Store.flush(); else tick(); });
addEventListener("pagehide", () => Store.flush());

/* ================= boot ================= */
(function prune() {
  const cutoff = addDays(dayKey(), -400);
  for (const k of Object.keys(state.days)) if (k < cutoff) delete state.days[k];
})();
buildWords();
FX.init();
applyPhase();
showView(location.hash.slice(1));
renderHeader();
updateLock();
setInterval(() => tick(), 20000);
Store.initRemote();
})();
