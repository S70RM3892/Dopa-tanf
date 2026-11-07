/* 超ドーパミン英単語帳 — app.js (v3 / DOPAMINE LAB)
 * 英→日・日→英の4択だけで回す語彙の「実験ノート」。
 * 各試行の前にモデルが正答確率 p̂ を予測し、正答した時の報酬 DA は予測誤差 δ = 1 − p̂ に比例する（予測を裏切るほど大きい）。
 * 連続正答で膜電位 Vm が上がり、発火→バースト→γ同期と状態が変わる。結果は試行ごとのラスタ図として描く（模式図）。
 * 復習間隔は SM-2 系。正誤と反応時間から自動で評価する（自己採点なし）。就寝前は減光期、就寝〜起床は暗期ロック。
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
const CUTOFF = 4 * HOUR; // 1日の区切りは午前4時
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
function hashStr(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function seeded(seed) { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }
const norm = (s) => String(s || "").toLowerCase().replace(/[’‘`]/g, "'").replace(/\s+/g, " ").trim();
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const KAN = ["〇", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
const kan = (n) => (n < 10 ? KAN[n] : (n >= 20 ? KAN[Math.floor(n / 10)] : "") + "十" + (n % 10 ? KAN[n % 10] : ""));
const fmtNum = (n) => Math.round(n).toLocaleString("ja-JP");
const signed = (d, k = 2) => (d >= 0 ? "+" : "−") + Math.abs(d).toFixed(k);

/* ================= content ================= */
const DECKS = {
  poly:     { name: "多義語",     en: "POLYSEMY",   sub: "訳語は文脈で選ぶ。京大和訳の急所" },
  verbs:    { name: "動詞",       en: "VERBS",      sub: "構文ごと覚える" },
  adjs:     { name: "形容詞",     en: "ADJECTIVES", sub: "評価・態度・程度を表す語" },
  nouns:    { name: "名詞",       en: "NOUNS",      sub: "抽象名詞は述語的に訳す" },
  abstract: { name: "評論語",     en: "DISCOURSE",  sub: "評論の骨格になる語" },
  tech:     { name: "情報・科学", en: "SCI-TECH",   sub: "情報学科志望の必修" },
  idioms:   { name: "熟語",       en: "IDIOMS",     sub: "固定表現・前置詞句" },
  mine:     { name: "マイ単語",   en: "CUSTOM",     sub: "自分で追加した語" },
};
const DECK_ORDER = Object.keys(DECKS);
// 階級（京大の「回生」と研究職のキャリアになぞらえる）。累積DAで昇任する。
const RANKS = [
  [0, "受験生"], [500, "合格者"], [1500, "1回生"], [3500, "2回生"], [6500, "3回生"], [10000, "4回生（研究室配属）"],
  [15000, "修士1回生"], [21000, "修士2回生"], [29000, "博士1回生"], [38000, "博士2回生"], [50000, "博士3回生"],
  [65000, "博士（情報学）"], [82000, "助教"], [105000, "講師"], [135000, "准教授"], [170000, "教授"],
  [220000, "研究科長"], [290000, "名誉教授"], [400000, "ノーベル賞"],
];
const STATES = [
  { i: 0, min: 0, id: "rest", name: "静止", mul: 1 },
  { i: 1, min: 6, id: "fire", name: "発火", mul: 1.5 },
  { i: 2, min: 12, id: "burst", name: "バースト", mul: 2 },
  { i: 3, min: 24, id: "gamma", name: "γ同期", mul: 3 },
];
const stateOf = (run) => STATES.filter((s) => run >= s.min).pop();
const vmOf = (run) => Math.min(35, -70 + 2.5 * run);
const BASE_T = { en: 8000, ja: 9000 };
const TIMER_MUL = { slow: 1.5, std: 1, fast: 0.7, off: 0 };
const FIX_MS = 260;
const LV_PRIOR = { "1": 0.38, "2": 0.24, "3": 0.12 };

const J1 = "京都語彙神経科学雑誌", J2 = "J. Lexical Dopamine", J3 = "鴨川記憶学会誌", J4 = "吉田睡眠研究会報";
const PUBS = [
  ["first", "初回試行ブロックにおける語彙応答の記録", J1, "ブロックを1回完了", (s) => s.totals.blocks >= 1],
  ["c100", "想起成功100回に関する予備的報告", J1, "累計100回正答", (s) => s.totals.correct >= 100],
  ["c1000", "1,000回の想起成功：縦断的観察", J2, "累計1,000回正答", (s) => s.totals.correct >= 1000],
  ["c5000", "5,000回の想起成功と語彙皮質の再編", J2, "累計5,000回正答", (s) => s.totals.correct >= 5000],
  ["big1", "予測誤差 δ ≥ 0.5 を伴う単語想起の初報告", J2, "予測を大きく裏切る正答（大発見）を1回", (s) => s.totals.bigs >= 1],
  ["big50", "予測を裏切る想起50例の症例集積", J2, "大発見を50回", (s) => s.totals.bigs >= 50],
  ["fire", "連続正答6回による発火状態の誘導", J3, "6連続正答（発火）", (s) => s.best >= 6],
  ["burst", "連続正答12回によるバースト発火", J3, "12連続正答（バースト）", (s) => s.best >= 12],
  ["gamma", "連続正答24回によるγ同期状態の誘導", J3, "24連続正答（γ同期）", (s) => s.best >= 24],
  ["g50", "50連続正答：持続的γ同期の一例", J3, "50連続正答", (s) => s.best >= 50],
  ["m50", "50語の長期定着", J1, "50語を定着", (s, x) => x.mastered >= 50],
  ["m200", "200語の長期定着", J1, "200語を定着", (s, x) => x.mastered >= 200],
  ["m500", "500語の長期定着と忘却曲線の平坦化", J2, "500語を定着", (s, x) => x.mastered >= 500],
  ["mall", "全収録語の定着：語彙皮質の完全マッピング", J2, "収録語をすべて定着", (s, x) => x.total > 0 && x.mastered >= x.total],
  ["deck", "刺激セット1つの完全制圧", J1, "1つの刺激セットを全語定着", (s, x) => x.deckDone >= 1],
  ["p3", "3日間連続実験の記録", J4, "3日連続で目標試行数を達成", (s) => s.streak.best >= 3],
  ["p7", "7日間連続実験の記録", J4, "7日連続で目標試行数を達成", (s) => s.streak.best >= 7],
  ["p30", "30日間連続実験：習慣化の過程", J4, "30日連続で目標試行数を達成", (s) => s.streak.best >= 30],
  ["proto", "プロトコル完全遵守の1日", J4, "今日のプロトコルを3項目とも達成", (s) => s.totals.protoDays >= 1],
  ["sleep7", "暗期遵守が翌朝の再学習に及ぼす効果：7夜の観察", J4, "暗期遵守ボーナスを7回", (s) => s.totals.sleepBonus >= 7],
  ["morning10", "明期開始3時間以内の再学習に関する報告", J4, "朝のブロックを10回", (s) => s.totals.morningBlocks >= 10],
  ["rt1", "平均反応時間1秒未満の意味検索", J3, "20試行以上のブロックで平均反応時間1秒未満", (s) => s.totals.fastBlock >= 1],
].map(([id, title, journal, cond, test]) => ({ id, title, journal, cond, test }));

const SOURCES = [
  ["想起練習と分散学習は、10の学習法のうち「有用度：高」と評価された2つ。", "Dunlosky et al. (2013) Psychol. Sci. Public Interest 14(1)", "https://www.psychologicalscience.org/news/releases/which-study-strategies-make-the-grade.html"],
  ["一度思い出せた語をさらに繰り返し想起させると1週間後の保持が大きく伸び、読み直しには効果がなかった。", "Karpicke & Roediger (2008) Science 319", "https://source.washu.edu/2008/02/practicing-information-retrieval-is-key-to-memory-retention/"],
  ["難しいが成功した想起ほど、後の記憶成績が高かった（想起努力仮説）。予測正答率 p̂ が低い語を当てたときほど DA が大きいのはこのため。", "Pyc & Rawson (2009) J. Memory and Language 60(4)", "https://core.ac.uk/download/357306317.pdf"],
  ["ドーパミン神経は予想外の報酬に強く反応し、予測どおりの報酬には反応が弱まる（報酬予測誤差）。DA = 100 × (1 − p̂) はこの考え方を借りた得点式。ラスタ図は実測ではなく模式図。", "Schultz, Dayan & Montague (1997) Science 275", "https://pubmed.ncbi.nlm.nih.gov/9054347/"],
  ["誤答の選択肢が紛らわしい4択は本物の想起を起こし、誤答の選択肢に関する記憶まで強めた。選択肢は同じ刺激セット・同じ品詞から選び、同義語は外す。", "Little, Bjork, Bjork & Angello (2012) Psychological Science 23(11)", "https://www.psychologicalscience.org/journals/psychological-science/0956797612443370/"],
  ["4択のあとに正解を見せると（直後でも遅らせても）正答が増え、誤った選択肢を覚えてしまう害が減った。", "Butler & Roediger (2008) Memory & Cognition 36(3)", "https://doi.org/10.3758/MC.36.3.604"],
  ["答えを知らないうちに解こうとして失敗すると、その後の学習がむしろ強まった。新しい語も解説より先に出題する。", "Kornell, Hays & Bjork (2009) J. Exp. Psychol.: LMC 35(4)", "https://pubmed.ncbi.nlm.nih.gov/19586265/"],
  ["失敗した想起の恩恵は、正解を学ぶまでに間が空くと消えた。正誤表はその場で出す。", "Grimaldi & Karpicke (2012) Memory & Cognition", "https://learninglab.psych.purdue.edu/downloads/2012/2012_Grimaldi_Karpicke_MC.pdf"],
  ["学習が最も速く進む正答率は約85%（単純な二択課題のモデルでの理論値）。プロトコルの正答率目標と新出語の投入量の目安にしている。", "Wilson, Shenhav, Straccia & Cohen (2019) Nature Communications 10", "https://pmc.ncbi.nlm.nih.gov/articles/PMC6831579"],
  ["エビングハウスの忘却曲線は現代の追試でも再現された。「いま思い出せる見込み」は単純な指数関数モデルによる推定。", "Murre & Dros (2015) PLOS ONE 10(7)", "https://doi.org/10.1371/journal.pone.0120644"],
  ["最適な復習間隔は試験までの期間の約20%（数週間先）〜5%（1年先）。残り日数の15%で間隔に上限をかける。", "Cepeda et al. (2008) Psychological Science 19(11)", "https://www.evullab.org/pdf/CepedaVulRohrerWixtedPashler-PS-2008.pdf"],
  ["分散学習のメタ分析（839件の評価）。", "Cepeda et al. (2006) Psychological Bulletin 132(3)", "https://pubmed.ncbi.nlm.nih.gov/16719566/"],
  ["睡眠中（徐波睡眠）に学習時の手がかりを与えて記憶を再活性化させると、翌日の記憶が良くなった。", "Rasch, Büchel, Gais & Born (2007) Science 315", "https://doi.org/10.1126/science.1138581"],
  ["学習→睡眠→再学習の組は、必要な練習量が約半分で済み、6か月後も保持が良かった。", "Mazza et al. (2016) Psychological Science", "https://www.sciencedaily.com/releases/2016/08/160822083446.htm"],
  ["13〜18歳は1日8〜10時間の睡眠を定期的にとるべき。", "AASM コンセンサス声明 (Paruthi et al., 2016) J. Clin. Sleep Med. 12(6)", "https://www.sciencedaily.com/releases/2016/06/160613122419.htm"],
  ["就寝前に発光タブレットで読書すると寝つきが遅れ、メラトニン分泌が減り、翌朝の覚醒度が下がった（12名の実験）。", "Chang et al. (2015) PNAS 112(4)", "https://pubmed.ncbi.nlm.nih.gov/25535358/"],
  ["京大英語は英文和訳・和文英訳・自由英作文が柱。", "study-search.jp", "https://study-search.jp/columns/296"],
  ["難度の目安にした市販書『鉄壁』は見出し語3,000語超（本アプリの語・例文・訳はすべて独自に作成）。", "KADOKAWA『改訂版 鉄緑会東大英単語熟語 鉄壁』", "https://www.kadokawa.co.jp/product/321904000781/"],
];

const SVG_CHECK = '<svg viewBox="0 0 28 28" aria-hidden="true"><path d="M5 15l6 6L24 6"/></svg>';
const SVG_ARROW = '<svg viewBox="0 0 28 28" aria-hidden="true"><path d="M24 14H6m6-6-6 6 6 6"/></svg>';
const SVG_SPEAK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4zm12.5 3a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4z"/></svg>';

/* ================= words ================= */
let WORDS = [], BYID = new Map();
function rootKey(root) {
  const ms = [...String(root || "").matchAll(/([A-Za-z-]+)\s*[（(]/g)].map((m) => m[1].replace(/-/g, "").toLowerCase()).filter((x) => x.length >= 2);
  if (!ms.length) return "";
  let best = ms[0];
  for (const m of ms) if (m.length >= best.length) best = m;
  return best;
}
function addWord(tag, r) {
  if (!Array.isArray(r) || !r[0]) return;
  const [w, pos, ja, more, ex, hit, exJa, note, pat, root, lv] = r;
  const id = tag + ":" + w;
  if (BYID.has(id)) return;
  const o = { id, tag, w: String(w), pos: pos || "", ja: ja || "", more: more || "", ex: ex || "", hit: hit || "", exJa: exJa || "", note: note || "", pat: pat || "", root: root || "", lv: lv || "" };
  o.rk = rootKey(o.root);
  WORDS.push(o); BYID.set(id, o);
}
// words/synonyms.js: 誤答にしない近義語の組（見出し語で引く）
let SYN = new Map();
function buildSyn() {
  SYN = new Map();
  const key = (id) => norm(String(id).slice(String(id).indexOf(":") + 1));
  for (const p of window.DOPA_SYN || []) {
    if (!Array.isArray(p) || p.length < 2) continue;
    const a = key(p[0]), b = key(p[1]);
    if (!SYN.has(a)) SYN.set(a, new Set());
    if (!SYN.has(b)) SYN.set(b, new Set());
    SYN.get(a).add(b); SYN.get(b).add(a);
  }
}
function buildWords() {
  buildSyn();
  WORDS = []; BYID = new Map();
  for (const deck of window.DOPA_DATA || []) if (DECKS[deck.tag]) for (const r of deck.rows || []) addWord(deck.tag, r);
  for (const r of state.custom || []) addWord("mine", r);
  cortexCache = null;
}
const hasEx = (w) => !!(w.ex && w.hit && w.ex.includes(w.hit));
const countTag = (t) => WORDS.filter((w) => w.tag === t).length;
const posHead = (w) => (w.pos || "").split("・")[0];
// 選択肢に出す意味。英語(=答え)とカタカナの音写を抜く。
function optJa(w) {
  if (w._opt) return w._opt;
  let s = String(w.ja).replace(/[（(][^）)]*[A-Za-z]{2,}[^）)]*[）)]/g, "").replace(/[A-Za-z]{2,}/g, "～");
  const segs = []; let cur = "", sep = "";
  for (const ch of s) { if (ch === "・" || ch === "／") { segs.push({ t: cur, sep }); sep = ch; cur = ""; } else cur += ch; }
  segs.push({ t: cur, sep });
  const kata = (t) => /^[゠-ヿ\s()（）]+$/.test(t) && /[ァ-ヺ]/.test(t);
  const kept = segs.filter((x) => x.t.trim() && !kata(x.t));
  if (kept.length && kept.length < segs.length) s = kept.map((x, i) => (i ? x.sep || "・" : "") + x.t).join("");
  s = s.replace(/^[・／\s]+|[・／\s]+$/g, "").trim() || w.ja;
  return (w._opt = s);
}
function jaTokens(s) {
  return s.split(/[・／、,，()（）「」～〜\s]+/).map((t) => t.replace(/(させる|される|している|する|である|的な|な|だ|の|に|を|と|が|で)$/u, "")).filter((t) => t.length >= 2);
}
function kanjiBigrams(s) {
  const set = new Set();
  for (const run of s.match(/[一-鿿々]{2,}/g) || []) for (let i = 0; i < run.length - 1; i++) set.add(run.slice(i, i + 2));
  return set;
}
function feat(w) { if (!w._f) { const s = optJa(w); w._f = { s, tok: jaTokens(s), big: kanjiBigrams(s) }; } return w._f; }
function similar(a, b) {
  const A = feat(a), B = feat(b);
  if (A.s === B.s) return true;
  for (const x of A.tok) for (const y of B.tok) if (x === y || x.includes(y) || y.includes(x)) return true;
  for (const x of A.big) if (B.big.has(x)) return true;
  return false;
}
// 他の意味・注釈・型にある「＝ A／B」「≒ A」「類義 A」「A と(ほぼ)同義」から同義語を拾う
const EN_LIST = "[A-Za-z][A-Za-z' -]*(?:\\s*[／・/,，]\\s*[A-Za-z][A-Za-z' -]*)*";
const SYN_AFTER = new RegExp(`(?:＝|=|≒|類義(?:語)?[:：]?)\\s*(${EN_LIST})`, "g");
const SYN_BEFORE = new RegExp(`(${EN_LIST})\\s*と(?:ほぼ)?同義`, "g");
function synOf(w) {
  if (w._syn) return w._syn;
  const full = new Set(), head = new Set();
  const t = [w.more, w.note, w.pat].filter(Boolean).join("。");
  const add = (list) => {
    for (const p of list.split(/[／・/,，]/)) {
      const q = norm(p).replace(/[^a-z' -]/g, "").trim();
      if (q.length < 2) continue;
      full.add(q); head.add(q.split(" ")[0]);
    }
  };
  for (const m of t.matchAll(SYN_AFTER)) add(m[1]);
  for (const m of t.matchAll(SYN_BEFORE)) add(m[1]);
  return (w._syn = { full, head });
}
// 同義語どうしは「正解が2つ」になるので誤答にしない
function synonymous(a, b) {
  const A = synOf(a), B = synOf(b), an = norm(a.w), bn = norm(b.w);
  if (SYN.get(an)?.has(bn)) return true;
  if (A.full.has(bn) || A.head.has(bn) || B.full.has(an) || B.head.has(an)) return true;
  for (const x of A.full) if (x.length > 3 && B.full.has(x)) return true;
  return false;
}
const clash = (a, b) => similar(a, b) || synonymous(a, b);
// 紛らわしいが同義ではない誤答を、同じ刺激セット・同じ品詞から優先して選ぶ
function distractors(w, n, en) {
  const p0 = posHead(w);
  const tiers = [WORDS.filter((x) => x.tag === w.tag && posHead(x) === p0), WORDS.filter((x) => posHead(x) === p0), WORDS];
  const out = [], seen = new Set([en ? norm(w.w) : optJa(w)]);
  for (const pool of tiers) {
    for (const x of shuffle(pool.slice())) {
      if (out.length >= n) break;
      if (x.id === w.id) continue;
      const key = en ? norm(x.w) : optJa(x);
      if (seen.has(key) || clash(w, x) || out.some((o) => clash(o, x))) continue;
      seen.add(key); out.push(x);
    }
    if (out.length >= n) break;
  }
  return out;
}

/* ================= state & storage ================= */
const LS_KEY = "dopa-tanf:v1";
const DEFAULT_SETTINGS = {
  newPerDay: 20, goal: 100, block: 25, dir: "mix", timer: "std", bedtime: "22:30", wake: "06:30", examDate: "2027-02-25",
  spikes: true, tones: true, haptics: true, tts: false,
  decks: { poly: true, verbs: true, adjs: true, nouns: true, abstract: true, tech: true, idioms: true, mine: true },
};
const TOTALS0 = { trials: 0, correct: 0, bigs: 0, blocks: 0, morningBlocks: 0, sleepBonus: 0, fastBlock: 0, protoDays: 0 };
function freshState() {
  return { v: 3, updatedAt: 0, cards: {}, da: 0, days: {}, streak: { count: 0, best: 0, lastDay: "" }, best: 0,
    custom: [], prio: [], override: 0, overrideAt: 0, nightOverrides: 0, totals: { ...TOTALS0 }, pubs: {},
    newStat: { n: 0, ok: 0 }, trace: [], blockNo: 0, firstDay: "", settings: JSON.parse(JSON.stringify(DEFAULT_SETTINGS)) };
}
function normalize(s) {
  s = s && typeof s === "object" ? s : {};
  const f = freshState(), st = s.settings || {}, tt = s.totals || {};
  const days = s.days && typeof s.days === "object" ? s.days : {};
  for (const d of Object.values(days)) if (d && d.n == null && d.reps != null) d.n = d.reps; // v1/v2 からの移行
  const firstDay = s.firstDay || Object.keys(days).sort()[0] || "";
  return {
    ...f, ...s, v: 3,
    da: Number.isFinite(+s.da) ? +s.da : Math.round((+s.xp || 0) * 0.5),
    best: +s.best || +s.bestCombo || 0,
    settings: { ...f.settings, ...st, block: +st.block || +st.roundSize || f.settings.block, decks: { ...f.settings.decks, ...(st.decks || {}) } },
    streak: { ...f.streak, ...(s.streak || {}) },
    totals: { ...TOTALS0, ...tt, trials: +tt.trials || +tt.answers || 0, correct: +tt.correct || 0, blocks: +tt.blocks || +tt.rounds || 0 },
    pubs: s.pubs && typeof s.pubs === "object" ? s.pubs : {},
    newStat: s.newStat && typeof s.newStat === "object" ? s.newStat : { n: 0, ok: 0 },
    trace: Array.isArray(s.trace) ? s.trace.slice(-60) : [],
    cards: s.cards || {}, days, custom: Array.isArray(s.custom) ? s.custom : [], prio: Array.isArray(s.prio) ? s.prio : [], firstDay,
  };
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
    } finally { this.busy = false; if (this.dirty && this.ref) this.schedule(); }
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
        this.saveLocal(); buildWords(); if (!T) renderAll();
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
const sleepMins = () => (hm(S().wake) - hm(S().bedtime) + 1440) % 1440;
function lastBedtime(now = Date.now()) {
  const d = new Date(now), b = hm(S().bedtime);
  const t = new Date(d.getFullYear(), d.getMonth(), d.getDate(), Math.floor(b / 60), b % 60).getTime();
  return t <= now ? t : t - DAY;
}
function applyLook() { document.documentElement.dataset.mode = isNight() ? "night" : "day"; }

/* ================= scheduler & memory model ================= */
const LEARN = [1 * MIN, 10 * MIN], RELEARN = [10 * MIN];
function ivlCap(now = Date.now()) {
  const dl = daysBetween(dayKey(now), S().examDate);
  return Number.isFinite(dl) && dl > 0 ? Math.max(3, Math.round(dl * 0.15)) : 365;
}
const isMastered = (c) => !!c && c.st === 2 && c.ivl >= Math.min(21, ivlCap());
const newCard = (now) => ({ st: 1, step: 0, due: now, ivl: 0, ease: 2.5, reps: 0, lapses: 0, ok: 0, last: 0, first: now });
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
// 想起可能性 R（単純な指数型の忘却モデル）: 復習間隔 ivl 日たつと R = 0.9 になるように置く
function retr(c, now = Date.now()) {
  if (!c) return 0;
  if (c.st === 2) return Math.pow(0.9, Math.max(0, (now - (c.last || now)) / DAY) / Math.max(0.5, c.ivl));
  const S_min = c.st === 1 && c.step === 0 ? 1 : 10;
  return Math.pow(0.9, Math.max(0, (now - (c.last || c.first || now)) / MIN) / S_min);
}
// 予測正答率 p̂（4択の当て推量 1/4 を含む）
function pHat(w, c, dir, now = Date.now()) {
  let R;
  if (!c) {
    const lp = LV_PRIOR[w.lv] ?? 0.25, ns = state.newStat;
    R = ns.n >= 10 ? 0.5 * lp + 0.5 * clamp((ns.ok / ns.n - 0.25) / 0.75, 0, 1) : lp;
  } else R = retr(c, now);
  if (dir === "ja") R *= 0.92;
  return clamp(R + (1 - R) * 0.25, 0.05, 0.97);
}
const isDue = (c, now) => !!c && (c.st === 2 ? c.due < dayEnd(now) : c.due <= now + 20 * MIN);
const touchedToday = (c, now = Date.now()) => Math.max(c.last || 0, c.first || 0) >= dayStart(now);
const stateName = (c) => (!c ? "未発見" : c.st === 1 ? "学習中" : c.st === 3 ? "再学習" : isMastered(c) ? "定着" : "保持中");
function fmtIvl(ms) {
  if (ms < HOUR) return Math.max(1, Math.round(ms / MIN)) + "分";
  if (ms < DAY * 0.9) return Math.round(ms / HOUR) + "時間";
  return Math.max(1, Math.round(ms / DAY)) + "日";
}

/* ================= stats ================= */
const blankDay = () => ({ n: 0, ok: 0, rtSum: 0, rtN: 0, newc: 0, da: 0, sr0: null, goalHit: false, protoDone: false, sleepBonus: false, morningN: 0 });
function today() { const k = dayKey(); const d = state.days[k] || (state.days[k] = blankDay()); for (const [key, v] of Object.entries(blankDay())) if (d[key] === undefined) d[key] = v; return d; }
const peekToday = () => ({ ...blankDay(), ...(state.days[dayKey()] || {}) });
const enabledTag = (t) => S().decks[t] !== false;
const activeWords = () => WORDS.filter((w) => enabledTag(w.tag));
const seenCount = () => activeWords().filter((w) => state.cards[w.id]).length;
const masteredCount = () => activeWords().filter((w) => isMastered(state.cards[w.id])).length;
function sumR(now = Date.now()) { let s = 0; for (const w of activeWords()) { const c = state.cards[w.id]; if (c) s += retr(c, now); } return s; }
function counts(now = Date.now()) {
  let due = 0, learning = 0, unseen = 0;
  for (const w of activeWords()) {
    const c = state.cards[w.id];
    if (!c) { unseen++; continue; }
    if (isDue(c, now)) c.st === 2 ? due++ : learning++;
  }
  return { due, learning, unseen, newLeft: Math.max(0, Math.min(unseen, S().newPerDay - peekToday().newc)) };
}
function rankInfo(da) {
  let i = 0; while (i + 1 < RANKS.length && da >= RANKS[i + 1][0]) i++;
  const next = RANKS[i + 1];
  return { i, name: RANKS[i][1], next: next ? next[1] : null, need: next ? next[0] - da : 0, pct: next ? (da - RANKS[i][0]) / (next[0] - RANKS[i][0]) : 1 };
}
function liveStreak() {
  const s = state.streak; if (!s.lastDay) return 0;
  const gap = daysBetween(s.lastDay, dayKey());
  return gap <= 1 ? s.count : 0;
}
function bumpStreak() {
  const k = dayKey(), s = state.streak;
  if (s.lastDay === k) return;
  const gap = s.lastDay ? daysBetween(s.lastDay, k) : 1;
  s.count = gap === 1 ? s.count + 1 : 1;
  s.lastDay = k; s.best = Math.max(s.best, s.count);
}
function protocol(t) {
  const goal = S().goal;
  const acc = t.n ? t.ok / t.n : 0;
  const mrt = t.rtN ? t.rtSum / t.rtN : 0;
  return [
    { t: `試行数 n ≥ ${goal}`, ok: t.n >= goal, v: `${t.n}` },
    { t: "正答率 ≥ 85%", ok: t.n >= 30 && acc >= 0.85, v: t.n ? `${Math.round(acc * 100)}%` : "—" },
    { t: "平均反応時間 ≤ 2.5 s", ok: t.rtN >= 20 && mrt <= 2500, v: t.rtN ? `${(mrt / 1000).toFixed(2)} s` : "—" },
  ];
}
function pace() {
  const dl = daysBetween(dayKey(), S().examDate);
  const unseen = activeWords().filter((w) => !state.cards[w.id]).length;
  if (!Number.isFinite(dl) || dl <= 0) return { dl, unseen, need: 0 };
  return { dl, unseen, need: Math.ceil(unseen / Math.max(1, dl - 14)) };
}
function checkPubs() {
  const decks = DECK_ORDER.filter((t) => countTag(t) >= 20);
  const x = { mastered: masteredCount(), total: activeWords().length, deckDone: decks.filter((t) => WORDS.filter((w) => w.tag === t).every((w) => isMastered(state.cards[w.id]))).length };
  const got = [];
  for (const p of PUBS) if (!state.pubs[p.id] && p.test(state, x)) { state.pubs[p.id] = Date.now(); got.push(p); }
  return got;
}

/* ================= sound: スパイクのクリック音 ================= */
const Sound = {
  ctx: null, master: null, click1: null,
  ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null;
      try {
        this.ctx = new AC();
        const comp = this.ctx.createDynamicsCompressor();
        this.master = this.ctx.createGain(); this.master.gain.value = 0.7;
        this.master.connect(comp); comp.connect(this.ctx.destination);
        const sr = this.ctx.sampleRate, len = Math.round(sr * 0.004), buf = this.ctx.createBuffer(1, len, sr), ch = buf.getChannelData(0);
        for (let i = 0; i < len; i++) ch[i] = (Math.random() * 2 - 1) * Math.exp(-i / (sr * 0.0007));
        this.click1 = buf;
      } catch { this.ctx = null; return null; }
    }
    if (this.ctx.state === "suspended") this.ctx.resume().catch(() => {});
    return this.ctx;
  },
  on(kind) { return !isNight() && (kind === "click" ? S().spikes : S().tones); },
  click(at, vol) {
    const c = this.ctx, src = c.createBufferSource(), hp = c.createBiquadFilter(), g = c.createGain();
    src.buffer = this.click1; hp.type = "highpass"; hp.frequency.value = 800; g.gain.value = vol;
    src.connect(hp); hp.connect(g); g.connect(this.master); src.start(at);
  },
  tone(f, at, dur, type = "sine", vol = 0.12) {
    const c = this.ctx, t = c.currentTime + at, o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.05);
  },
  burst(d, run, big) {
    if (!this.ensure()) return;
    try {
      if (this.on("click")) { let t = this.ctx.currentTime + 0.01; const n = 2 + Math.round(18 * d) + (big ? 14 : 0); for (let i = 0; i < n; i++) { t += rand(0.004, 0.017); this.click(t, 0.16 + 0.34 * d); } }
      if (this.on("tone")) { const f = 300 * Math.pow(2, Math.min(run, 30) / 24); this.tone(f, 0.02, 0.24, "sine", 0.07 + 0.08 * d); this.tone(f * 1.5, 0.05, 0.2, "sine", 0.035); if (big) [0, 4, 7, 12].forEach((s, i) => this.tone(f * 2 ** (s / 12) * 2, 0.12 + i * 0.06, 0.3, "triangle", 0.05)); }
    } catch { /* ignore */ }
  },
  thud() { if (!this.ensure() || !this.on("tone")) return; try { this.tone(110, 0, 0.16, "sine", 0.26); this.tone(78, 0.05, 0.22, "sine", 0.2); } catch { /* ignore */ } },
  ripple() {
    if (!this.ensure()) return;
    try {
      let t = this.ctx.currentTime;
      if (this.on("click")) for (let i = 0; i < 36; i++) { t += 0.026 * (1 - i / 44); this.click(t, 0.1 + 0.007 * i); }
      if (this.on("tone")) [0, 4, 7, 12].forEach((s, i) => this.tone(392 * 2 ** (s / 12), 0.2 + i * 0.07, 0.4, "triangle", 0.07));
    } catch { /* ignore */ }
  },
  stamp() { if (!this.ensure() || !this.on("tone")) return; try { this.tone(68, 0, 0.22, "sine", 0.4); this.tone(140, 0, 0.06, "triangle", 0.12); } catch { /* ignore */ } },
  tick() { if (!this.ensure() || !this.on("click")) return; try { this.click(this.ctx.currentTime + 0.01, 0.12); } catch { /* ignore */ } },
};
const vibrate = (p) => { try { if (S().haptics && !isNight() && navigator.vibrate) navigator.vibrate(p); } catch { /* ignore */ } };

/* ================= speech ================= */
const canSpeak = "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
let enVoice = null;
function pickVoice() {
  try { const vs = speechSynthesis.getVoices(); enVoice = vs.find((v) => /^en[-_]US/i.test(v.lang) && /Samantha|Google|Natural|Aria|Jenny|Ava/i.test(v.name)) || vs.find((v) => /^en[-_]US/i.test(v.lang)) || vs.find((v) => /^en/i.test(v.lang)) || null; } catch { enVoice = null; }
}
if (canSpeak) { pickVoice(); try { speechSynthesis.addEventListener("voiceschanged", pickVoice); } catch { /* ignore */ } }
function speak(text) {
  if (!canSpeak) return;
  try { speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(String(text).replace(/\b[AB]\b/g, "something").replace(/one's/g, "one's").replace(/[()]/g, "")); u.lang = "en-US"; u.rate = 0.92; if (enVoice) u.voice = enVoice; speechSynthesis.speak(u); } catch { /* ignore */ }
}
const speakBtn = (text) => (canSpeak ? `<button class="speak" data-speak="${esc(text)}" aria-label="発音を聞く">${SVG_SPEAK}</button>` : "");

/* ================= chart recorder（記録計） ================= */
function makeStrip(wrap) {
  const cv = $("canvas", wrap), ctx = cv.getContext("2d");
  const SP = [0.18, 0.6, 1, 0.42, -0.26, -0.17, -0.07];
  const s = { w: 0, h: 0, dpr: 1, ys: [], cs: [], q: [], t: 0, tonic: 0, tonicT: 0, gamma: false, raf: 0, over: -1 };
  s.resize = () => {
    const r = wrap.getBoundingClientRect();
    s.dpr = Math.min(2, window.devicePixelRatio || 1);
    s.w = Math.max(20, Math.round(r.width)); s.h = Math.max(20, Math.round(r.height));
    cv.width = s.w * s.dpr; cv.height = s.h * s.dpr;
    if (s.ys.length !== s.w) { s.ys = Array(s.w).fill(null); s.cs = Array(s.w).fill(0); }
  };
  s.base = () => s.h * (0.74 - 0.44 * s.tonic);
  s.spike = (d, big, quiet) => { const n = 1 + Math.round(d * (quiet ? 2 : 5)) + (big && !quiet ? 3 : 0); for (let k = 0; k < n; k++) s.q.push({ at: s.t + 3 + k * 6, amp: s.h * (0.22 + 0.5 * d) * (k ? 0.82 : 1) * (big && !quiet ? 1.7 : 1) * (quiet ? 0.7 : 1), kind: "s" }); };
  s.dip = (p, quiet) => s.q.push({ at: s.t + 3, len: 36 + Math.round(p * 40), amp: s.h * (0.07 + 0.14 * p) * (quiet ? 0.7 : 1), kind: "d" });
  s.sample = () => {
    let y = s.base() + (Math.random() - 0.5) * 2.2, c = 0;
    if (s.gamma) y += Math.sin(s.t * 1.7) * 3.4;
    for (const e of s.q) {
      const k = s.t - e.at;
      if (e.kind === "s" && k >= 0 && k < SP.length) { y -= SP[k] * e.amp; c = 1; }
      else if (e.kind === "d" && k >= 0 && k < e.len) { y += Math.sin((Math.PI * k) / e.len) * e.amp; c = 2; }
    }
    s.q = s.q.filter((e) => s.t - e.at < (e.len || SP.length) + 2);
    return [y, c];
  };
  s.push = (n) => { for (let k = 0; k < n; k++) { s.t++; const [y, c] = s.sample(); s.ys.shift(); s.cs.shift(); s.ys.push(y); s.cs.push(c); } };
  s.draw = () => {
    const { w, h, dpr } = s;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
    const ink = css("--ink"), da = css("--da"), red = css("--red"), grid = css("--grid-2");
    ctx.strokeStyle = grid; ctx.lineWidth = 1;
    const off = s.t % 16;
    ctx.beginPath();
    for (let x = w - off; x > 0; x -= 16) { ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, h); }
    for (let k = 1; k < 4; k++) { const y = Math.round((h * k) / 4) + 0.5; ctx.moveTo(0, y); ctx.lineTo(w, y); }
    ctx.stroke();
    const cols = [ink, da, red];
    ctx.lineWidth = 1.6; ctx.lineJoin = "round"; ctx.lineCap = "round";
    let cur = -1, px = 0, py = 0, over = false;
    for (let x = 0; x < s.ys.length; x++) {
      let y = s.ys[x]; if (y == null) continue;
      if (y < 3) { y = 3; over = true; } if (y > h - 3) y = h - 3;
      const c = s.cs[x];
      if (c !== cur) { if (cur >= 0) { ctx.lineTo(x, y); ctx.strokeStyle = cols[cur]; ctx.stroke(); } ctx.beginPath(); ctx.moveTo(cur >= 0 ? px : x, cur >= 0 ? py : y); cur = c; }
      ctx.lineTo(x, y); px = x; py = y;
    }
    if (cur >= 0) { ctx.strokeStyle = cols[cur]; ctx.stroke(); ctx.fillStyle = cols[cur]; ctx.beginPath(); ctx.arc(px, py, 3, 0, Math.PI * 2); ctx.fill(); }
    if (over) { ctx.fillStyle = da; ctx.font = `600 9px ${css("--f-mono")}`; ctx.fillText("OVERRANGE", w - 78, 12); }
  };
  s.loop = () => { s.tonic += (s.tonicT - s.tonic) * 0.06; s.push(2); s.draw(); s.raf = requestAnimationFrame(s.loop); };
  s.start = () => { if (!s.raf) { s.resize(); s.raf = requestAnimationFrame(s.loop); } };
  s.stop = () => { cancelAnimationFrame(s.raf); s.raf = 0; };
  // 保存した δ の列から静止した記録を描く（ノートの表紙用）
  s.fill = (ds) => {
    s.stop(); s.resize(); s.ys = []; s.cs = []; s.q = []; s.t = 0; s.tonic = s.tonicT = 0; s.gamma = false;
    const n = s.w, list = ds.slice(-Math.max(1, Math.floor((n - 24) / 9)));
    const step = list.length ? Math.max(9, Math.floor((n - 24) / list.length)) : 9;
    let i = 0;
    while (s.ys.length < n) {
      if (i < list.length && s.ys.length >= 12 && (s.ys.length - 12) % step === 0) { const d = list[i++]; if (d >= 0) s.spike(d, false, true); else s.dip(-d, true); }
      s.t++; const [y, c] = s.sample(); s.ys.push(y); s.cs.push(c);
    }
    s.draw();
  };
  return s;
}
let tStrip = null, homeStrip = null;

/* ================= trial engine（試行ブロック） ================= */
let T = null;
const stageEl = () => $("#stage"), optsEl = () => $("#opts"), footEl = () => $("#tfoot");
function clearTimers() { if (!T) return; clearTimeout(T.auto); clearTimeout(T.tmo); clearTimeout(T.fix); clearTimeout(T.tick1); clearTimeout(T.tick2); }
function planBlock(kind, now = Date.now()) {
  const learn = [], rev = [], fresh = [];
  for (const w of activeWords()) {
    const c = state.cards[w.id];
    if (!c) { fresh.push(w); continue; }
    if (kind === "night") { if (touchedToday(c, now)) rev.push(w); continue; }
    if (kind === "weak") { if (retr(c, now) < 0.7) rev.push(w); continue; }
    if (!isDue(c, now)) continue;
    (c.st === 2 ? rev : learn).push(w);
  }
  const C = (w) => state.cards[w.id];
  learn.sort((a, b) => C(a).due - C(b).due);
  if (kind === "night") shuffle(rev);
  else if (kind === "weak") rev.sort((a, b) => retr(C(a), now) - retr(C(b), now));
  else if (phase === "morning") rev.sort((a, b) => C(b).last - C(a).last); // 昨夜の語から朝の再学習
  else rev.sort((a, b) => C(a).due - C(b).due || C(b).lapses - C(a).lapses);
  let newPick = [];
  if (kind === "main") {
    const prio = new Map(state.prio.map((id, i) => [id, i]));
    newPick = fresh.filter((w) => prio.has(w.id)).sort((a, b) => prio.get(a.id) - prio.get(b.id));
    // 刺激セットを交互に。セット内は難度1→2→3の順
    const byDeck = DECK_ORDER.map((t) => fresh.filter((w) => w.tag === t && !prio.has(w.id)).sort((a, b) => (+a.lv || 2) - (+b.lv || 2))).filter((a) => a.length);
    const left = Math.max(0, S().newPerDay - peekToday().newc);
    let i = 0;
    while (newPick.length < left && byDeck.some((a) => a.length)) { const a = byDeck[i++ % byDeck.length]; if (a.length) newPick.push(a.shift()); }
    newPick = newPick.slice(0, left);
  }
  const avail = learn.length + rev.length + newPick.length;
  if (!avail) return null;
  const size = kind === "main" ? clamp(Math.round(+S().block) || 25, 10, 60) : kind === "weak" ? 15 : 12;
  const est = kind === "main" ? learn.length + rev.length + newPick.length * 2.2 : rev.length;
  return { size, total: clamp(Math.ceil(est), Math.min(3, avail), size), learn: learn.map((w) => w.id), rev: rev.slice(0, kind === "main" ? 999 : size).map((w) => w.id), fresh: newPick.map((w) => w.id) };
}
function startBlock(kind = "main") {
  if (phase === "lock") { updateLock(); return; }
  if (phase === "wind" && kind === "main") kind = "night";
  Sound.ensure();
  const plan = planBlock(kind);
  if (!plan) { toast(kind === "night" ? "今日はまだ何も覚えていない。今夜は寝ろ。続きは明期に。" : kind === "weak" ? "弱化しているニューロンはない。" : "今日の刺激は出し尽くした。新出の上限を上げるか、休め。"); return; }
  const td = today(); if (td.sr0 == null) td.sr0 = sumR();
  T = { kind, ...plan, qi: 0, pending: [], tries: {}, trials: [], run: 0, best: 0, da: 0, bigs: 0, newGot: 0, q: null, done: false, promoted: null, lastId: null, lastDir: null, rank0: rankInfo(state.da).i };
  const tr = $("#trial");
  tr.hidden = false; tr.dataset.state = "rest";
  document.body.style.overflow = "hidden";
  $("#errata").hidden = true;
  stageEl().classList.remove("scroll");
  if (!tStrip) tStrip = makeStrip($("#tStrip"));
  tStrip.resize(); tStrip.tonicT = 0; tStrip.gamma = false; tStrip.start();
  next();
}
function closeTrial() {
  if (T) clearTimers();
  T = null;
  $("#trial").hidden = true; $("#errata").hidden = true; $("#overlay").hidden = true;
  document.body.style.overflow = "";
  if (tStrip) tStrip.stop();
  try { speechSynthesis.cancel(); } catch { /* ignore */ }
  renderAll();
}
function quitBlock() {
  if (!T) return;
  if (T.done || !T.trials.length) return closeTrial();
  finishBlock();
}
function pickNext() {
  T.pending.sort((a, b) => a.at - b.at);
  if (T.pending.length && T.pending[0].at <= T.qi) return T.pending.shift().id;
  if (T.learn.length) return T.learn.shift();
  // 直近の正答率が高ければ新出を増やし、低ければ既習で立て直す（85%前後を狙う）
  const recent = T.trials.filter((x) => !x.unknown).slice(-10);
  const acc = recent.length >= 4 ? recent.filter((x) => x.ok).length / recent.length : 0.85;
  if (T.fresh.length && T.rev.length) {
    const pNew = acc >= 0.92 ? 0.6 : acc >= 0.8 ? 0.35 : acc >= 0.65 ? 0.15 : 0.05;
    return Math.random() < pNew ? T.fresh.shift() : T.rev.shift();
  }
  if (T.rev.length) return T.rev.shift();
  if (T.fresh.length) return T.fresh.shift();
  if (T.pending.length) return T.pending.shift().id;
  return null;
}
function requeue(id, g) {
  const n = (T.tries[id] = (T.tries[id] || 0) + 1);
  if (n >= 4) return;
  T.pending.push({ id, at: T.qi + (g === 1 ? 2 + randInt(0, 1) : 4 + randInt(0, 2)) });
}
function next() {
  if (!T) return;
  clearTimers();
  $("#errata").hidden = true;
  if (phase === "lock") { closeTrial(); updateLock(); return; }
  if (T.qi >= T.total) return finishBlock();
  let id = pickNext();
  if (id && id === T.lastId && (T.rev.length || T.fresh.length)) { const alt = T.rev.length ? T.rev.shift() : T.fresh.shift(); T.pending.push({ id, at: T.qi + 2 }); id = alt; }
  if (!id) return finishBlock();
  const w = BYID.get(id);
  if (!w || !enabledTag(w.tag)) return next();
  T.lastId = id; T.qi++;
  ask(w);
}
function chooseDir(w, c) {
  if (T.kind === "night") return "en";
  const d = S().dir;
  if (d === "en" || d === "ja") return d;
  if (!c) return "en";
  if (c.st !== 2) return c.step === 0 ? "en" : Math.random() < 0.5 ? "ja" : "en";
  return Math.random() < (T.lastDir === "ja" ? 0.35 : 0.5) ? "ja" : "en";
}
function limitFor(dir) {
  if (T.kind === "night") return 0;
  const mul = TIMER_MUL[S().timer] ?? 1;
  return mul ? BASE_T[dir] * mul : 0;
}
const KEYS = ["a", "b", "c", "d"];
function ask(w) {
  const c = state.cards[w.id], dir = chooseDir(w, c);
  const q = { w, c, dir, isNew: !c, p: pHat(w, c, dir), opts: shuffle([w, ...distractors(w, 3, dir === "ja")]), done: false, ready: false };
  q.limit = limitFor(dir);
  T.q = q; T.lastDir = dir;
  stageEl().classList.remove("scroll");
  stageEl().innerHTML = `<div class="stim" id="stim"><div class="fix" aria-hidden="true">+</div></div><div class="ruler off" id="ruler"><i></i></div><div class="readout" id="readout" aria-live="polite"></div>`;
  optsEl().innerHTML = q.opts.map((_, i) => `<button class="opt skel" disabled><span class="k">(${KEYS[i]})</span><span class="tx">—</span><span class="mk"></span></button>`).join("");
  footEl().innerHTML = `<button class="textbtn" data-act="unknown">知らない</button><span class="hint">押しても連続正答は切れない<span class="kb"> ・ キー a–d / 1–4 / 0</span></span>`;
  updateTop(); renderDots();
  T.fix = setTimeout(() => showStim(q), isNight() ? 160 : FIX_MS);
}
function showStim(q) {
  if (!T || T.q !== q) return;
  const w = q.w, ja = q.dir === "ja";
  const deck = DECKS[w.tag] || DECKS.mine;
  const tags = `<div class="tags"><span class="lbl">${ja ? "日 → 英" : "英 → 日"}</span><span class="lbl">${esc(deck.en)}</span>${q.isNew ? '<span class="lbl new">初出</span>' : ""}</div><span class="pred">予測 ${Math.round(q.p * 100)}%</span>`;
  const body = ja
    ? `<div class="word ja">${esc(optJa(w))}</div><div class="pos">${w.pos ? `<span>${esc(w.pos)}</span>` : ""}<span>に当たる英語</span></div>`
    : `<div><div class="word ${w.w.length > 13 ? "long" : ""}">${esc(w.w)}</div><div class="pos">${w.pos ? `<span>${esc(w.pos)}</span>` : ""}${speakBtn(w.w)}</div></div>`;
  $("#stim").innerHTML = tags + body;
  const r = $("#ruler");
  if (q.limit) { r.classList.remove("off"); r.style.setProperty("--t", (q.limit / 1000).toFixed(2) + "s"); r.innerHTML = "<i></i>"; }
  optsEl().innerHTML = q.opts.map((o, i) => `<button class="opt ${ja ? "enw" : ""}" data-act="opt" data-i="${i}"><span class="k">(${KEYS[i]})</span><span class="tx">${esc(ja ? o.w : optJa(o))}</span><span class="mk"></span></button>`).join("");
  q.ready = true; q.t0 = performance.now();
  if (q.limit) {
    T.tmo = setTimeout(() => resolve(false, { timeout: true }), q.limit);
    T.tick1 = setTimeout(() => { if (!q.done) Sound.tick(); }, q.limit * 0.8);
    T.tick2 = setTimeout(() => { if (!q.done) Sound.tick(); }, q.limit * 0.9);
  }
  if (S().tts && !ja && !isNight()) speak(w.w);
}
function onOpt(i) {
  const q = T?.q; if (!q || q.done || !q.ready) return;
  const chosen = q.opts[i]; if (!chosen) return;
  resolve(chosen.id === q.w.id, { idx: i, chosen });
}
function note(text, cls = "", dy = 0) {
  const stim = $("#stim"); if (!stim || reduceMotion) return;
  const el = document.createElement("div");
  el.className = "margin-note " + cls; el.textContent = text;
  el.style.top = Math.max(0, stim.offsetTop - 14 + dy) + "px"; el.style.right = "6px";
  stageEl().appendChild(el); setTimeout(() => el.remove(), 1700);
}
function resolve(ok, info = {}) {
  const q = T?.q; if (!q || q.done || !q.ready) return;
  q.done = true; q.ok = ok;
  clearTimeout(T.tmo); clearTimeout(T.tick1); clearTimeout(T.tick2);
  $("#ruler")?.classList.add("stop");
  const rt = performance.now() - q.t0, L = q.limit || BASE_T[q.dir];
  const now = Date.now(), w = q.w, prev = state.cards[w.id];
  // 自己採点はしない。正誤と反応時間から評価を決めてスケジューラへ
  const g = !ok ? 1 : rt <= L * 0.25 ? (prev && prev.st === 2 && prev.ok >= 1 ? 4 : 3) : rt <= L * 0.5 ? 3 : prev && prev.st === 2 ? 2 : 3;
  const c = grade(prev || newCard(now), g, now);
  state.cards[w.id] = c;
  if (c.st !== 2) requeue(w.id, g);
  const t = today();
  if (!prev) { t.newc++; T.newGot++; state.newStat.n++; if (ok) state.newStat.ok++; }
  t.n++; if (ok) { t.ok++; t.rtSum += Math.min(rt, 20000); t.rtN++; }
  if (phase === "morning") t.morningN++;
  state.totals.trials++; if (ok) state.totals.correct++;
  const st0 = stateOf(T.run);
  if (ok) T.run++; else if (!info.unknown) T.run = 0;
  T.best = Math.max(T.best, T.run); state.best = Math.max(state.best, T.run);
  const st1 = stateOf(T.run);
  // 報酬予測誤差 δ。正答なら 1 − p̂、誤答なら −p̂
  const d = ok ? 1 - q.p : -q.p;
  const big = ok && !q.isNew && d >= 0.5;
  if (big) { state.totals.bigs++; T.bigs++; }
  let da = 0;
  if (ok) da = Math.round(100 * d * (isNight() ? 1 : st1.mul) * (phase === "morning" ? 1.5 : 1)) + (q.isNew ? 10 : 0);
  const ev = [];
  const r0 = rankInfo(state.da).i;
  state.da += da; t.da += da; T.da += da;
  if (!t.goalHit && t.n >= S().goal) { t.goalHit = true; bumpStreak(); ev.push("goal"); }
  if (!t.protoDone && protocol(t).every((x) => x.ok)) { t.protoDone = true; state.totals.protoDays++; state.da += 300; t.da += 300; T.da += 300; ev.push("proto"); }
  const r1 = rankInfo(state.da).i;
  if (r1 > r0) { T.promoted = r1; ev.push("rank"); }
  T.trials.push({ d, ok, p: q.p, rt, id: w.id, unknown: !!info.unknown, isNew: q.isNew, big });
  state.trace.push(Number(d.toFixed(3))); if (state.trace.length > 60) state.trace.splice(0, state.trace.length - 60);
  Store.save();
  feedback(q, ok, d, da, big, rt, info, st0, st1, ev);
  if (!ok) showErrata(q, info, false);
  else if (q.isNew) showErrata(q, info, true);
  else T.auto = setTimeout(next, big ? 950 : 520);
}
function feedback(q, ok, d, da, big, rt, info, st0, st1, ev) {
  $$(".opt", optsEl()).forEach((b, i) => {
    b.disabled = true;
    const o = q.opts[i];
    if (o.id === q.w.id) { b.classList.add(ok ? "ok" : "rv"); $(".mk", b).innerHTML = ok ? SVG_CHECK : SVG_ARROW; }
    else if (info.idx === i) b.classList.add("ng");
    else b.classList.add("dim");
  });
  footEl().innerHTML = "";
  const ro = $("#readout");
  if (ro) ro.innerHTML = `<span>δ = <b class="${d >= 0 ? "pos-d" : "neg-d"}">${signed(d)}</b></span>${ok ? `<span><b class="pos-d">+${da}</b> DA</span>` : `<span>${info.unknown ? "知らない" : info.timeout ? "時間切れ" : "誤答"}</span>`}<span>RT ${(rt / 1000).toFixed(2)} s</span>`;
  if (tStrip) {
    if (ok) tStrip.spike(d, big); else tStrip.dip(q.p);
    tStrip.tonicT = clamp((vmOf(T.run) + 70) / 105, 0, 1); tStrip.gamma = st1.id === "gamma" && !isNight();
  }
  if (ok) { Sound.burst(d, T.run, big); vibrate(big ? [10, 30, 10, 30, 10] : 8 + Math.round(20 * d)); }
  else if (!info.unknown) { Sound.thud(); vibrate(30); }
  if (big && !isNight()) {
    const stim = $("#stim"); if (stim && !reduceMotion) { const f = document.createElement("div"); f.className = "over"; stim.appendChild(f); setTimeout(() => f.remove(), 750); }
    note("予測を裏切った", "da");
  } else if (ok && q.isNew) note("初見で正解", "bl");
  if (st1.i > st0.i && !isNight()) { note(`→ ${st1.name}`, "da", 24); Sound.ripple(); }
  else if (st1.i < st0.i && st0.i >= 1) note(`${st0.name} 解除`, "", 24);
  if (ev.includes("goal")) setTimeout(() => toast(`目標試行数に到達。実験継続 ${state.streak.count} 日目`, true), 300);
  if (ev.includes("proto")) setTimeout(() => toast("プロトコル完全遵守 ＋300 DA", true), 900);
  if (ev.includes("rank")) setTimeout(() => note("昇任内定", "", 48), 400);
  updateTop(); renderDots();
}
function showErrata(q, info, auto) {
  const w = q.w, ex = $("#errata");
  const v = q.ok ? ["初見で正解。ここで固めろ", "nw"] : info.unknown ? ["知らない → ここで覚えろ", "un"] : info.timeout ? ["時間切れ", "ng"] : ["誤答", "ng"];
  const ch = info.chosen && info.chosen.id !== w.id ? info.chosen : null;
  const yours = !ch ? "" : q.dir === "ja"
    ? `<p class="yours">選んだ <s class="en">${esc(ch.w)}</s> は「${esc(optJa(ch))}」</p>`
    : `<p class="yours">選んだ「<s>${esc(optJa(ch))}</s>」は <b class="en">${esc(ch.w)}</b></p>`;
  ex.innerHTML = `<div class="in">
    <div class="e-head"><b>正誤表</b><span class="v ${v[1]}">${v[0]}</span></div>
    <div class="e-word"><div><b>${esc(w.w)}</b><span>${esc(w.pos)}</span></div>${speakBtn(w.w)}</div>
    <div class="e-ja">${esc(w.ja)}</div>
    ${w.pat ? `<div class="e-row"><span class="lbl">型</span><span class="pat">${esc(w.pat)}</span></div>` : ""}
    ${w.root ? `<div class="e-row"><span class="lbl">語源</span><span>${esc(w.root)}</span></div>` : ""}
    ${w.more ? `<div class="e-row"><span class="lbl">他に</span><span>${esc(w.more)}</span></div>` : ""}
    ${yours}
    ${hasEx(w) ? `<p class="ex">${exHTML(w)}</p>${w.exJa ? `<p class="exja">${esc(w.exJa)}</p>` : ""}` : ""}
    ${w.note ? `<p class="note">${esc(w.note)}</p>` : ""}
    ${auto ? `<div class="autobar" id="autobar" style="--t:3.4s"><i></i></div>` : ""}
    <button class="btn ink" data-act="next">了解 — 次の試行 <span class="mono">▶</span></button>
  </div>`;
  ex.hidden = false; ex.scrollTop = 0;
  if (auto) T.auto = setTimeout(next, 3400);
  if (S().tts && !isNight()) speak(w.w);
}
function exHTML(w) {
  const i = w.ex.indexOf(w.hit);
  return `${esc(w.ex.slice(0, i))}<mark>${esc(w.hit)}</mark>${esc(w.ex.slice(i + w.hit.length))}`;
}
function updateTop() {
  if (!T) return;
  const st = stateOf(T.run), vm = vmOf(T.run);
  const tr = $("#trial");
  tr.dataset.state = isNight() ? "rest" : st.id;
  $("#vm").innerHTML = `<b>${vm >= 0 ? "+" : "−"}${Math.abs(vm).toFixed(1)} mV</b><span>${isNight() ? "減光期" : `${st.name}${st.mul > 1 ? ` ×${st.mul}` : ""}`}${phase === "morning" && !isNight() ? " ・ 明期×1.5" : ""}</span>`;
  const label = T.kind === "night" ? "減光期ブロック" : T.kind === "weak" ? "弱化ニューロン刺激" : `BLOCK ${pad2(state.blockNo + 1)}`;
  $("#tMeta").innerHTML = `<span>${esc(label)} ・ TRIAL ${pad2(Math.min(T.qi, T.total))}/${pad2(T.total)}</span><b>+${fmtNum(T.da)} DA</b>`;
  $("#tStripR").textContent = `tonic ${T.run}`;
}
function renderDots() {
  if (!T) return;
  $("#dots").innerHTML = Array.from({ length: T.total }, (_, i) => {
    const tr = T.trials[i];
    const cls = tr ? (tr.ok ? (tr.big ? "b" : "o") : tr.unknown ? "u" : "x") : i === T.qi - 1 && T.q && !T.q.done ? "c" : "";
    return `<i class="${cls}"></i>`;
  }).join("");
}

/* ================= 図（ブロック結果） ================= */
function rasterSVG(trials) {
  const W = 600, left = 40, right = 8, top = 64, rows = trials.length;
  const rowH = clamp(Math.floor(190 / Math.max(rows, 1)), 4, 9), H = top + rows * rowH + 30;
  const t0 = -0.6, t1 = 1.0, plotW = W - left - right;
  const x = (t) => left + ((t - t0) / (t1 - t0)) * plotW;
  const bins = 32, counts = Array(bins).fill(0);
  let dots = "";
  trials.forEach((tr, i) => {
    const rnd = seeded(hashStr(tr.id + ":" + i));
    let sp = [], tt = t0;
    for (;;) { tt += -Math.log(1 - rnd()) / 5; if (tt > t1) break; sp.push(tt); }
    if (tr.ok) { const n = 2 + Math.round(13 * tr.d); for (let k = 0; k < n; k++) sp.push(0.04 + rnd() * (0.1 + 0.14 * tr.d)); }
    else { const end = 0.28 + 0.45 * tr.p; sp = sp.filter((s) => s < 0.03 || s > end); }
    const y = top + i * rowH;
    for (const s of sp) {
      const hot = tr.ok && s >= 0.03 && s <= 0.3;
      dots += `<rect class="${hot ? "f-hot" : "f-sp"}" x="${x(s).toFixed(1)}" y="${y}" width="1.7" height="${Math.max(2, rowH * 0.74).toFixed(1)}"/>`;
      const b = Math.floor(((s - t0) / (t1 - t0)) * bins); if (b >= 0 && b < bins) counts[b]++;
    }
  });
  const maxC = Math.max(1, ...counts), bw = plotW / bins;
  const bars = counts.map((n, b) => { const h = (n / maxC) * 46, bt = t0 + (b + 0.5) * ((t1 - t0) / bins); return `<rect class="${bt > 0 && bt < 0.32 ? "f-hot" : "f-bar"}" x="${(left + b * bw + 0.6).toFixed(1)}" y="${(56 - h).toFixed(1)}" width="${(bw - 1.2).toFixed(1)}" height="${h.toFixed(1)}"/>`; }).join("");
  const ticks = [-0.5, 0, 0.5, 1].map((s) => `<line class="f-ax" x1="${x(s)}" x2="${x(s)}" y1="${top + rows * rowH + 2}" y2="${top + rows * rowH + 6}"/><text x="${x(s)}" y="${top + rows * rowH + 18}" text-anchor="middle">${s === 0 ? "0" : s.toFixed(1)}</text>`).join("");
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="ラスタ図（模式図）">
    <text x="0" y="12" class="f-pn">a</text>
    ${bars}
    <line class="f-ax" x1="${left}" x2="${W - right}" y1="57" y2="57"/>
    <text x="${left - 6}" y="20" text-anchor="end">発火</text><text x="${left - 6}" y="32" text-anchor="end">頻度</text>
    ${dots}
    <line class="f-zero" x1="${x(0)}" x2="${x(0)}" y1="0" y2="${top + rows * rowH}"/>
    <text x="${x(0) + 4}" y="9">結果提示</text>
    <line class="f-ax" x1="${left}" x2="${W - right}" y1="${top + rows * rowH + 2}" y2="${top + rows * rowH + 2}"/>
    ${ticks}
    <text x="${W - right}" y="${top + rows * rowH + 18}" text-anchor="end">s</text>
    <text x="${left - 6}" y="${top + 8}" text-anchor="end">試行1</text>
    <text x="${left - 6}" y="${top + rows * rowH - 1}" text-anchor="end">${rows}</text>
  </svg>`;
}
function scatterSVG(trials) {
  const W = 600, H = 128, left = 40, right = 8, plotW = W - left - right;
  const x = (p) => left + p * plotW, yOk = 34, yNg = 84;
  const pts = trials.map((tr, i) => {
    const j = (seeded(hashStr(tr.id + "j" + i))() - 0.5) * 16;
    if (tr.ok) return `<circle class="${tr.big ? "f-big" : "f-ok"}" cx="${x(tr.p).toFixed(1)}" cy="${(yOk + j).toFixed(1)}" r="${tr.big ? 4.6 : 3.4}"/>`;
    return `<circle class="${tr.unknown ? "f-un" : "f-ng"}" cx="${x(tr.p).toFixed(1)}" cy="${(yNg + j).toFixed(1)}" r="3.4"/>`;
  }).join("");
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((p) => `<line class="f-ax" x1="${x(p)}" x2="${x(p)}" y1="${H - 26}" y2="${H - 22}"/><text x="${x(p)}" y="${H - 10}" text-anchor="middle">${p}</text>`).join("");
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="予測正答率と結果">
    <text x="0" y="12" class="f-pn">b</text>
    <rect class="f-zone" x="${left}" y="${yOk - 14}" width="${(plotW * 0.5).toFixed(1)}" height="28"/>
    <text x="${left + 4}" y="${yOk - 17}" class="f-zt">予測を裏切った領域</text>
    <text x="${left - 6}" y="${yOk + 4}" text-anchor="end">正答</text>
    <text x="${left - 6}" y="${yNg + 4}" text-anchor="end">誤答</text>
    <line class="f-ax" x1="${left}" x2="${W - right}" y1="${H - 26}" y2="${H - 26}"/>
    ${pts}${ticks}
    <text x="${W - right}" y="${H}" text-anchor="end">予測正答率 p̂</text>
  </svg>`;
}
function finishBlock() {
  if (!T || T.done) return;
  clearTimers();
  T.done = true; T.q = null;
  $("#errata").hidden = true;
  const trials = T.trials;
  state.totals.blocks++; state.blockNo++;
  if (phase === "morning") state.totals.morningBlocks++;
  const okT = trials.filter((x) => x.ok);
  const mrt = okT.length ? okT.reduce((a, x) => a + x.rt, 0) / okT.length : 0;
  if (trials.length >= 20 && mrt && mrt < 1000) state.totals.fastBlock++;
  const pubs = checkPubs();
  Store.save();
  const acc = trials.length ? Math.round((okT.length / trials.length) * 100) : 0;
  const sumD = trials.reduce((a, x) => a + x.d, 0);
  const ri = rankInfo(state.da);
  stageEl().classList.add("scroll");
  stageEl().innerHTML = `<div class="fig">
    <div class="fig-h"><b>Fig. ${state.blockNo}</b><span class="lbl">${dayKey().replace(/-/g, ".")} ・ ${T.kind === "night" ? "減光期" : T.kind === "weak" ? "弱化刺激" : "BLOCK"}</span></div>
    ${trials.length ? rasterSVG(trials) + scatterSVG(trials) : ""}
    <p class="cap"><b>Fig. ${state.blockNo} |</b> 本ブロックのドーパミン応答（模式図）。<b>a</b>, 各行が1試行。正答は予測誤差 δ に比例したバースト、誤答は発火の休止として描いた。上は平均発火頻度。<b>b</b>, モデルの予測正答率 p̂ と結果。左上の点ほど「予測を裏切った」想起で、DAも大きい。</p>
    <div class="stats">
      <div><span class="lbl">試行 n</span><b>${trials.length}</b></div>
      <div><span class="lbl">正答率</span><b>${acc}%</b></div>
      <div><span class="lbl">平均RT</span><b>${mrt ? (mrt / 1000).toFixed(2) + " s" : "—"}</b></div>
      <div><span class="lbl">獲得</span><b class="da">+${fmtNum(T.da)}</b></div>
      <div><span class="lbl">Σδ</span><b>${signed(sumD)}</b></div>
      <div><span class="lbl">最大連続</span><b>${T.best}</b></div>
      <div><span class="lbl">大発見</span><b>${T.bigs}</b></div>
      <div><span class="lbl">初出</span><b>${T.newGot}</b></div>
      <div><span class="lbl">階級</span><b style="font-family:var(--f-ja);font-size:13px;white-space:normal;line-height:1.35">${esc(ri.name)}</b></div>
    </div>
    ${pubs.map((p) => `<div class="accepted"><span class="st">ACCEPTED</span><div><b>${esc(p.title)}</b><span>${esc(p.journal)} — ${esc(p.cond)}</span></div></div>`).join("")}
    ${T.kind === "night" ? `<p class="note">減光期のブロックはここまで。今日の語は眠っている間に固まる。画面を閉じて寝ろ。</p>` : ""}
  </div>`;
  optsEl().innerHTML = T.kind === "night" ? `<div class="t-actions" style="grid-template-columns:1fr"><button class="btn ink" data-act="home">閉じて寝る</button></div>` : `<div class="t-actions"><button class="btn" data-act="home">ノートへ</button><button class="btn ink" data-act="again">次のブロック <span class="mono">▶</span></button></div>`;
  footEl().innerHTML = "";
  updateTop();
  $("#tMeta").innerHTML = `<span>Fig. ${state.blockNo} ・ RESULT</span><b>+${fmtNum(T.da)} DA</b>`;
  renderDots();
  if (pubs.length) setTimeout(() => Sound.stamp(), 500);
  if (T.promoted != null && !isNight()) { const rk = RANKS[T.promoted][1]; setTimeout(() => { if (T && T.done) jirei(rk); }, 1000); }
}
function jirei(rank) {
  const d = new Date(), ov = $("#overlay");
  const date = `令和${kan(d.getFullYear() - 2018)}年${kan(d.getMonth() + 1)}月${kan(d.getDate())}日`;
  ov.innerHTML = `<div class="jirei" role="dialog" aria-label="辞令"><div class="doc"><span class="big">辞令</span>\n\n被験者殿\n\n<span class="rank">${esc(rank)}</span>に任ずる\n\n${date}\n\n超ドーパミン英単語帳</div><div class="hanko">昇任<br>承認</div><p class="tap">タップで閉じる</p></div>`;
  ov.hidden = false;
  setTimeout(() => Sound.stamp(), 600);
  vibrate([20, 60, 40]);
}

/* ================= views ================= */
const VIEWS = ["note", "cortex", "pubs", "config"];
let currentView = "note";
function showView(v) {
  if (!VIEWS.includes(v)) v = "note";
  currentView = v;
  for (const name of VIEWS) $("#view-" + name).hidden = name !== v;
  $$(".nav button").forEach((b) => (b.dataset.view === v ? b.setAttribute("aria-current", "page") : b.removeAttribute("aria-current")));
  renderView(); scrollTo(0, 0);
}
function renderView() {
  if (currentView === "note") renderNote();
  else if (currentView === "cortex") renderCortex();
  else if (currentView === "pubs") renderPubs();
  else renderConfig();
}
function renderAll() { applyLook(); renderView(); updateLock(); }

let projCache = { at: 0, key: "", data: null };
function projection(now) {
  const dl = daysBetween(dayKey(now), S().examDate);
  const span = Number.isFinite(dl) && dl > 0 ? Math.min(dl, 150) : 30;
  const key = span + ":" + Object.keys(state.cards).length + ":" + state.updatedAt;
  if (projCache.data && projCache.key === key && now - projCache.at < 60000) return projCache.data;
  const steps = 30, pts = [];
  for (let i = 0; i <= steps; i++) { const dd = (span * i) / steps; pts.push([dd, sumR(now + dd * DAY)]); }
  projCache = { at: now, key, data: { span, pts, exam: Number.isFinite(dl) && dl > 0 && dl <= 150 } };
  return projCache.data;
}
function projSVG(pr) {
  const W = 600, H = 92, l = 6, r = 6, top = 10, bot = 22;
  const max = Math.max(1, pr.pts[0][1]);
  const x = (d) => l + (d / pr.span) * (W - l - r), y = (v) => top + (1 - v / max) * (H - top - bot);
  const path = pr.pts.map(([d, v], i) => `${i ? "L" : "M"}${x(d).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const end = pr.pts[pr.pts.length - 1];
  return `<svg class="projection" viewBox="0 0 ${W} ${H}" role="img" aria-label="勉強しなかった場合の予測">
    <line x1="${l}" x2="${W - r}" y1="${H - bot}" y2="${H - bot}" stroke="var(--rule-2)"/>
    <path d="${path}" fill="none" stroke="var(--blue)" stroke-width="2" stroke-dasharray="6 5"/>
    <circle cx="${x(0)}" cy="${y(pr.pts[0][1])}" r="4" fill="var(--ink)"/>
    <circle cx="${x(end[0])}" cy="${y(end[1])}" r="3.5" fill="none" stroke="var(--blue)" stroke-width="2"/>
    <text x="${l}" y="${H - 6}" font-family="var(--f-mono)" font-size="10" fill="var(--ink-2)">いま</text>
    <text x="${W - r}" y="${H - 6}" text-anchor="end" font-family="var(--f-mono)" font-size="10" fill="var(--ink-2)">${pr.exam ? "試験日" : pr.span + "日後"}</text>
  </svg>`;
}
function renderNote() {
  const v = $("#view-note");
  if (!WORDS.length) { v.innerHTML = `<p class="note">words/*.js が読み込めていない。</p>`; return; }
  const now = Date.now(), t = peekToday(), ri = rankInfo(state.da), k = counts(now);
  const night = phase === "wind";
  const plan = planBlock(night ? "night" : "main", now);
  const sr = sumR(now), pr = projection(now);
  const sr0 = t.sr0 ?? sr;
  const dl = daysBetween(dayKey(now), S().examDate);
  const sheetNo = state.firstDay ? daysBetween(state.firstDay, dayKey(now)) + 1 : 1;
  const d = new Date(now), wd = "日月火水木金土"[d.getDay()];
  const bed = hm(S().bedtime), wake = hm(S().wake);
  const todaysWords = activeWords().filter((w) => { const c = state.cards[w.id]; return c && touchedToday(c, now); }).length;
  const claimable = sleepBonusStatus();
  const pro = protocol(t);
  const weakN = activeWords().filter((w) => { const c = state.cards[w.id]; return c && retr(c, now) < 0.7; }).length;
  const end = pr.pts[pr.pts.length - 1][1];
  const setRows = DECK_ORDER.filter((tag) => countTag(tag)).map((tag) => {
    const ws = WORDS.filter((w) => w.tag === tag);
    let m = 0, s2 = 0;
    for (const w of ws) { const c = state.cards[w.id]; if (isMastered(c)) m++; else if (c) s2++; }
    return `<div class="setrow ${enabledTag(tag) ? "" : "off"}"><b>${esc(DECKS[tag].name)}<small>${DECKS[tag].en}</small></b><span class="n">定着 ${m} ・ 発見 ${m + s2} / ${ws.length}</span><div class="bar"><i class="m" style="width:${(m / ws.length) * 100}%"></i><i class="s" style="width:${(s2 / ws.length) * 100}%"></i></div></div>`;
  }).join("");
  v.innerHTML = `
  <div class="title-block">
    <div class="name"><span class="lbl">Title</span><b>超ドーパミン英単語帳</b></div>
    <div class="num"><span class="lbl">Sheet No.</span><b>${String(sheetNo).padStart(4, "0")} ・ ${pad2(d.getMonth() + 1)}.${pad2(d.getDate())} ${wd}</b></div>
    <div><span class="lbl">被験者 Subject</span><b>${esc(ri.name)}</b><div class="rankbar" aria-hidden="true"><i style="width:${(ri.pct * 100).toFixed(1)}%"></i></div><span class="small muted">${ri.next ? `次の「${esc(ri.next)}」まで ${fmtNum(ri.need)} DA` : "最高位"}</span></div>
    <div class="num"><span class="lbl">T₀ 二次試験</span><b>${Number.isFinite(dl) ? (dl > 0 ? `T − ${dl} d` : "本番") : "未設定"}</b></div>
    <div class="last"><span class="lbl">累積 DA</span><b class="mono" style="font-size:17px;font-weight:800">${fmtNum(state.da)}</b></div>
    <div class="num last"><span class="lbl">実験継続</span><b>${liveStreak()} 日</b></div>
  </div>

  <section class="sec">
    <div class="sech"><h2>いま思い出せる見込み</h2><span class="lbl">ΣR ・ 推定</span></div>
    ${seenCount() ? `<div class="sr-wrap">
      <div class="sr" id="srNum">${sr.toFixed(2)}<small>語</small></div>
      <p class="sr-note">きょう <span class="up">${signed(sr - sr0, 1)}</span> ・ 発見 ${seenCount()} / ${activeWords().length} 語。何もしなければ忘却曲線に沿って減る。</p>
      ${projSVG(pr)}
      <p class="sr-note">このまま1問も解かなければ、${pr.exam ? "試験日" : pr.span + "日後"}には <b class="mono">${end.toFixed(1)} 語</b>。</p>
    </div>` : `<p class="note">まだ1語も記録していない。最初のブロックを記録すると、ここに「いま思い出せる語数」の推定と、放置した場合にどう減るかが出る。</p>`}
  </section>

  <section class="sec">
    <div class="strip" id="homeStrip"><canvas aria-hidden="true"></canvas><span class="lbl">DA trace ・ 直近${Math.min(state.trace.length, 60)}試行</span></div>
    <button class="rec" data-act="start" ${plan ? "" : "disabled"}><span class="dot" aria-hidden="true"></span><div><b>${night ? "減光期ブロックを記録" : "記録開始"}</b><span>${plan ? `${plan.total} 試行 ・ ${night ? `今日の語 ${todaysWords}` : `既習 ${k.due + k.learning} ・ 新出 ${Math.min(k.newLeft, plan.fresh.length)}`}` : night ? "今日の語なし。寝ろ" : "今日の刺激は出し尽くした"}</span></div><span class="go" aria-hidden="true">▶</span></button>
    ${!night && weakN ? `<div><button class="textbtn" data-act="weak">弱化ニューロンだけ刺激する（R &lt; 0.7 の語 ${weakN}）</button></div>` : ""}
  </section>

  <section class="sec">
    <div class="sech"><h2>今日のプロトコル</h2><span class="lbl">Protocol ${dayKey(now).replace(/-/g, ".")}</span></div>
    <div class="proto">
      ${pro.map((x, i) => `<div class="proto-row ${x.ok ? "ok" : ""}"><span class="ck">${x.ok ? `<svg viewBox="0 0 26 26"><path d="M4 14l6 6L23 4"/></svg>` : ""}</span><span class="t">${i + 1}. ${x.t}</span><span class="lead"></span><span class="v">${x.v}</span></div>`).join("")}
      <p class="why">3項目そろうと ＋300 DA。正答率85%は「学習が最も速く進む正答率」の理論値（Wilson et al., 2019）を目安にしている。</p>
    </div>
  </section>

  <section class="sec">
    <div class="sech"><h2>明暗周期</h2><span class="lbl">LD ${Math.round((1440 - sleepMins()) / 60)}:${Math.round(sleepMins() / 60)}</span></div>
    <div class="ld">
      <div><span class="lbl">明期</span><b>${esc(S().wake)}–${esc(S().bedtime)}</b></div>
      <div><span class="lbl">${night ? "暗期まで" : phase === "morning" ? "明期ボーナス残り" : "暗期まで"}</span><b>${phase === "morning" ? fmtHM(minsUntil((wake + 180) % 1440, now)) : fmtHM(minsUntil(bed, now))}</b></div>
    </div>
    ${claimable === "ready" ? `<div class="claim"><div><b>暗期遵守ボーナス</b><span>昨夜は暗期のロックを破らなかった。</span></div><button class="btn ink" data-act="claim">＋200 DA</button></div>`
      : claimable === "denied" ? `<div class="claim denied"><div><b>暗期遵守ボーナスなし</b><span>昨夜は暗期に点灯した。今夜は守れ。</span></div></div>` : ""}
    ${sleepMins() < 480 ? `<p class="note">暗期が${fmtHM(sleepMins())}しかない。13〜18歳の推奨は8〜10時間（AASM）。「条件」で直せ。</p>` : ""}
    ${night ? `<p class="note">減光期。音・演出・時間制限・新出は止めてある。今日触った語だけ確認して寝ろ。</p>` : phase === "morning" ? `<p class="small muted">明期開始から3時間は DA ×1.5。昨夜の語から出す（学習→睡眠→再学習: Mazza et al., 2016）。</p>` : ""}
  </section>

  <section class="sec">
    <div class="sech"><h2>刺激セット</h2><span class="lbl">${activeWords().length} 語 ・ 定着 ${masteredCount()}</span></div>
    <div class="sets">${setRows}</div>
  </section>
  <p class="small muted">例文・訳・注釈はすべて独自に作成。設計の根拠は「条件」の文献欄。</p>`;
  if (!homeStrip || homeStrip.wrap !== $("#homeStrip")) { homeStrip = makeStrip($("#homeStrip")); homeStrip.wrap = $("#homeStrip"); }
  requestAnimationFrame(() => homeStrip && homeStrip.fill(state.trace));
}
function sleepBonusStatus() {
  const t = peekToday();
  if (t.sleepBonus) return "claimed";
  if (phase !== "morning" && phase !== "day") return "none";
  if (!state.firstDay || state.firstDay === dayKey()) return "none";
  return state.overrideAt && state.overrideAt >= lastBedtime() - HOUR ? "denied" : "ready";
}
function claimSleep() {
  if (sleepBonusStatus() !== "ready") return;
  const t = today(); t.sleepBonus = true;
  state.da += 200; t.da += 200; state.totals.sleepBonus++;
  const pubs = checkPubs();
  Store.save();
  Sound.ensure(); Sound.stamp();
  toast(`暗期遵守ボーナス ＋200 DA${pubs.length ? ` ・ 論文受理: ${pubs.map((p) => p.title).join("、")}` : ""}`);
  renderAll();
}

/* ---- 皮質マップ ---- */
let cortexCache = null;
function cortexLayout() {
  if (cortexCache) return cortexCache;
  const GOLD = Math.PI * (3 - Math.sqrt(5)), d = 6;
  const groups = DECK_ORDER.map((tag) => ({ tag, words: WORDS.filter((w) => w.tag === tag) })).filter((g) => g.words.length);
  for (const g of groups) { g.r = d * Math.sqrt(g.words.length) + 10; g.words.sort((a, b) => (a.rk || "~").localeCompare(b.rk || "~") || (+a.lv || 2) - (+b.lv || 2) || a.w.localeCompare(b.w)); }
  const placed = [];
  for (const g of groups.slice().sort((a, b) => b.r - a.r)) {
    if (!placed.length) { g.cx = 0; g.cy = 0; placed.push(g); continue; }
    let done = false;
    for (let dist = placed[0].r + g.r + 8; !done && dist < 4000; dist += 6) {
      for (let a = 0; a < 360 && !done; a += 9) {
        const rad = ((a + placed.length * 47) * Math.PI) / 180, cx = Math.cos(rad) * dist, cy = Math.sin(rad) * dist * 1.08;
        if (placed.every((p) => Math.hypot(p.cx - cx, p.cy - cy) >= p.r + g.r + 14)) { g.cx = cx; g.cy = cy; placed.push(g); done = true; }
      }
    }
  }
  const nodes = [];
  for (const g of groups) g.words.forEach((w, i) => { const a = i * GOLD, rr = d * Math.sqrt(i + 0.5); nodes.push({ w, x: g.cx + Math.cos(a) * rr, y: g.cy + Math.sin(a) * rr, g }); });
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const g of groups) { minX = Math.min(minX, g.cx - g.r); maxX = Math.max(maxX, g.cx + g.r); minY = Math.min(minY, g.cy - g.r - 18); maxY = Math.max(maxY, g.cy + g.r); }
  cortexCache = { groups, nodes, minX, maxX, minY, maxY };
  return cortexCache;
}
let cortexView = null;
function drawCortex() {
  const wrap = $("#cortexWrap"); if (!wrap) return;
  const cv = $("canvas", wrap), L = cortexLayout();
  const W = Math.round(wrap.getBoundingClientRect().width) || 360, pad = 14;
  if (W < 80 || !L.nodes.length) return;
  const sc = (W - pad * 2) / (L.maxX - L.minX), H = Math.round((L.maxY - L.minY) * sc + pad * 2);
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  cv.width = W * dpr; cv.height = H * dpr; cv.style.height = H + "px";
  const ctx = cv.getContext("2d"); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
  const X = (x) => pad + (x - L.minX) * sc, Y = (y) => pad + (y - L.minY) * sc;
  const now = Date.now(), ink = css("--ink"), ink3 = css("--ink-3"), da = css("--da"), red = css("--red"), blue = css("--blue-soft"), ink2 = css("--ink-2"), rule2 = css("--rule-2");
  const nr = Math.max(1.3, 2.3 * sc);
  // 同じ語根の発見済みの語を線で結ぶ
  const byRoot = new Map();
  for (const n of L.nodes) if (n.w.rk && state.cards[n.w.id]) { if (!byRoot.has(n.w.rk)) byRoot.set(n.w.rk, []); byRoot.get(n.w.rk).push(n); }
  ctx.strokeStyle = blue; ctx.lineWidth = 1;
  ctx.beginPath();
  for (const arr of byRoot.values()) for (let i = 1; i < arr.length; i++) { ctx.moveTo(X(arr[i - 1].x), Y(arr[i - 1].y)); ctx.lineTo(X(arr[i].x), Y(arr[i].y)); }
  ctx.stroke();
  for (const g of L.groups) {
    ctx.strokeStyle = rule2; ctx.setLineDash([3, 4]); ctx.beginPath(); ctx.arc(X(g.cx), Y(g.cy), Math.max(1, g.r * sc), 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = ink2; ctx.font = `600 ${Math.max(8.5, 10 * Math.min(1.2, sc * 1.3))}px ${css("--f-mono")}`; ctx.textAlign = "center";
    ctx.fillText(DECKS[g.tag].en, X(g.cx), Y(g.cy - g.r) - 5);
  }
  for (const n of L.nodes) {
    const c = state.cards[n.w.id], x = X(n.x), y = Y(n.y);
    ctx.beginPath();
    if (!c) { ctx.fillStyle = ink3; ctx.globalAlpha = 0.45; ctx.arc(x, y, nr * 0.55, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1; continue; }
    const R = retr(c, now);
    if (isMastered(c)) { ctx.fillStyle = da; ctx.arc(x, y, nr * 1.15, 0, Math.PI * 2); ctx.fill(); }
    else if (R < 0.5) { ctx.strokeStyle = red; ctx.lineWidth = 1.3; ctx.arc(x, y, nr, 0, Math.PI * 2); ctx.stroke(); }
    else { ctx.fillStyle = ink; ctx.globalAlpha = 0.35 + 0.65 * R; ctx.arc(x, y, nr, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1; }
  }
  cortexView = { X, Y, L, W, H };
}
function renderCortex() {
  const v = $("#view-cortex"), now = Date.now();
  const act = activeWords();
  let seen = 0, mast = 0, weak = 0;
  const weakList = [];
  for (const w of act) { const c = state.cards[w.id]; if (!c) continue; seen++; if (isMastered(c)) mast++; const R = retr(c, now); if (R < 0.7) { weak++; weakList.push([w, R]); } }
  weakList.sort((a, b) => a[1] - b[1]);
  v.innerHTML = `
  <div class="sech"><h2>語彙皮質</h2><span class="lbl">Lexical cortex ・ ${act.length} neurons</span></div>
  <p class="small muted">1点が1語。刺激セットごとに集まり、同じ語根をもつ発見済みの語は青い線でつながる。点をタップすると中身が出る（未発見の語は伏せてある）。</p>
  <div class="cortex" id="cortexWrap"><canvas role="img" aria-label="語彙皮質マップ"></canvas></div>
  <div class="legend"><span><i style="background:var(--ink-3);opacity:.5"></i>未発見</span><span><i style="background:var(--ink)"></i>保持（濃いほど R が高い）</span><span><i style="border:1.5px solid var(--red)"></i>弱化 R &lt; 0.5</span><span><i style="background:var(--da)"></i>定着</span></div>
  <div class="kv"><div><span class="lbl">発見</span><b>${seen}</b></div><div><span class="lbl">定着</span><b>${mast}</b></div><div><span class="lbl">弱化</span><b>${weak}</b></div><div><span class="lbl">ΣR</span><b>${sumR(now).toFixed(1)}</b></div></div>
  ${weakList.length ? `<section class="sec"><div class="sech"><h2>弱化ニューロン</h2><span class="lbl">R の低い順</span></div><div class="weak">${weakList.slice(0, 24).map(([w, R]) => `<button data-open="${esc(w.id)}" title="R = ${R.toFixed(2)}">${esc(w.w)}</button>`).join("")}</div><div><button class="btn ink" data-act="weak" ${isNight() ? "disabled" : ""}>弱化ニューロンを刺激（${Math.min(15, weakList.length)} 試行）</button></div></section>` : ""}`;
  requestAnimationFrame(drawCortex);
}
function cortexTap(ev) {
  if (!cortexView) return;
  const cv = $("#cortexWrap canvas"); const r = cv.getBoundingClientRect();
  const px = ev.clientX - r.left, py = ev.clientY - r.top;
  let best = null, bd = 16;
  for (const n of cortexView.L.nodes) { const dd = Math.hypot(cortexView.X(n.x) - px, cortexView.Y(n.y) - py); if (dd < bd) { bd = dd; best = n; } }
  if (best) openSheet(best.w.id);
}

/* ---- 業績 ---- */
function renderPubs() {
  const v = $("#view-pubs"), now = Date.now(), k = dayKey(now);
  const acc = PUBS.filter((p) => state.pubs[p.id]).sort((a, b) => state.pubs[a.id] - state.pubs[b.id]);
  const pend = PUBS.filter((p) => !state.pubs[p.id]);
  const year = (ts) => new Date(ts).getFullYear();
  const d14 = Array.from({ length: 14 }, (_, i) => { const key = addDays(k, i - 13); return { key, d: { ...blankDay(), ...(state.days[key] || {}) } }; });
  const goal = S().goal, max = Math.max(goal, ...d14.map((x) => x.d.n), 1);
  const W = 600, H = 150, l = 30, b = 22, bw = (W - l) / 14;
  const yv = (n) => 10 + (1 - n / max) * (H - b - 10);
  const bars = d14.map((x, i) => `<rect x="${(l + i * bw + 3).toFixed(1)}" y="${yv(x.d.n).toFixed(1)}" width="${(bw - 6).toFixed(1)}" height="${(H - b - yv(x.d.n)).toFixed(1)}" fill="${x.d.goalHit ? "var(--ink)" : "none"}" stroke="var(--ink)" stroke-width="1.5"/>${x.d.n ? `<circle cx="${(l + i * bw + bw / 2).toFixed(1)}" cy="${(10 + (1 - x.d.ok / Math.max(1, x.d.n)) * (H - b - 10)).toFixed(1)}" r="3" fill="var(--da)"/>` : ""}<text x="${(l + i * bw + bw / 2).toFixed(1)}" y="${H - 6}" text-anchor="middle" font-family="var(--f-mono)" font-size="10" fill="var(--ink-2)">${+x.key.slice(8)}</text>`).join("");
  v.innerHTML = `
  <div class="sech"><h2>業績一覧</h2><span class="lbl">Accepted ${acc.length} / ${PUBS.length}</span></div>
  <ol class="pubs">
    ${acc.map((p, i) => `<li><span class="no">[${i + 1}]</span><span><span class="ttl">被験者.「${esc(p.title)}」</span> <span class="jr">${esc(p.journal)}</span> ${year(state.pubs[p.id])}.<span class="acc">ACCEPTED</span></span></li>`).join("")}
    ${pend.map((p) => `<li class="pending"><span class="no">—</span><span><span class="ttl">「${esc(p.title)}」</span><br><span class="small">受理条件: ${esc(p.cond)}</span></span></li>`).join("")}
  </ol>
  <section class="sec">
    <div class="sech"><h2>試行数の推移</h2><span class="lbl">14日 ・ 黒塗り=目標達成 ・ 点=正答率</span></div>
    <svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="過去14日の試行数">
      <line x1="${l}" x2="${W}" y1="${yv(goal).toFixed(1)}" y2="${yv(goal).toFixed(1)}" stroke="var(--red)" stroke-dasharray="5 4"/>
      <text x="${l - 4}" y="${(yv(goal) + 4).toFixed(1)}" text-anchor="end" font-family="var(--f-mono)" font-size="10" fill="var(--red)">${goal}</text>
      <line x1="${l}" x2="${W}" y1="${H - b}" y2="${H - b}" stroke="var(--rule)"/>
      ${bars}
    </svg>
  </section>
  <div class="stats">
    <div><span class="lbl">累計試行</span><b>${fmtNum(state.totals.trials)}</b></div>
    <div><span class="lbl">累計正答</span><b>${fmtNum(state.totals.correct)}</b></div>
    <div><span class="lbl">大発見</span><b>${state.totals.bigs}</b></div>
    <div><span class="lbl">最大連続</span><b>${state.best}</b></div>
    <div><span class="lbl">最長継続</span><b>${state.streak.best} 日</b></div>
    <div><span class="lbl">暗期点灯</span><b>${state.nightOverrides || 0} 回</b></div>
  </div>`;
}

/* ---- 条件（設定） ---- */
function numField(id, label, val, min, max, hint) {
  return `<div class="field"><label for="${id}">${label}</label><input type="number" id="${id}" value="${val}" min="${min}" max="${max}" inputmode="numeric">${hint ? `<span class="hint">${hint}</span>` : ""}</div>`;
}
function chkField(id, label, on, hint) {
  return `<div class="field"><label for="${id}">${label}</label><input type="checkbox" class="chk" id="${id}" ${on ? "checked" : ""}>${hint ? `<span class="hint">${esc(hint)}</span>` : ""}</div>`;
}
function segField(key, label, opts, cur, hint) {
  return `<div class="field"><label>${label}</label><div class="seg" style="--n:${opts.length}" role="group" aria-label="${label}">${opts.map(([k2, l2]) => `<button data-seg="${key}" data-val="${k2}" aria-pressed="${cur === k2}">${l2}</button>`).join("")}</div>${hint ? `<span class="hint">${hint}</span>` : ""}</div>`;
}
function sleepText() {
  const m = sleepMins();
  if (m < 480) return `暗期 ${fmtHM(m)}。8時間未満。AASM は13〜18歳に8〜10時間を推奨している。削るな。`;
  if (m > 600) return `暗期 ${fmtHM(m)}。10時間超えは推奨範囲（8〜10時間）の外。`;
  return `暗期 ${fmtHM(m)}。推奨範囲（8〜10時間, AASM）に入っている。`;
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
      else { const stem = w.toLowerCase().slice(0, Math.max(3, w.length - 2)); const tok = ex.split(/[^A-Za-z'-]+/).find((t) => t.toLowerCase().startsWith(stem)); if (tok && ex.split(tok).length === 2) hit = tok; }
    }
    rows.push([w, "", ja.slice(0, 60), "", ex, hit, "", note.slice(0, 120)]);
  }
  return rows;
}
function renderConfig() {
  const v = $("#view-config"), s = S();
  v.innerHTML = `
  <div class="sech"><h2>実験条件</h2><span class="sync" id="syncLine"><i></i><span></span></span></div>
  <section class="sec form">
    <div class="sech"><h2>ブロック設計</h2></div>
    ${numField("block", "1ブロックの試行数", s.block, 10, 60, "")}
    ${numField("newPerDay", "新出刺激 / 日", s.newPerDay, 0, 200, "1日に初めて出す語の上限。")}
    ${numField("goal", "目標試行数 / 日", s.goal, 10, 1000, "達成で実験継続日数＋1。プロトコル1項目め。")}
    ${segField("dir", "出題方向", [["mix", "混合"], ["en", "英→日だけ"], ["ja", "日→英だけ"]], s.dir, "混合: 新出は英→日から入り、既習は英→日と日→英を半々で出す。")}
    ${segField("timer", "反応窓", [["slow", "長め"], ["std", "標準"], ["fast", "短い"], ["off", "なし"]], s.timer, "標準は英→日8秒・日→英9秒。速く正答するほど次の復習までの間隔が伸びる。")}
  </section>
  <section class="sec form">
    <div class="sech"><h2>刺激セット</h2></div>
    ${DECK_ORDER.map((t) => chkField("deck_" + t, `${DECKS[t].name}（${countTag(t)}語）`, s.decks[t] !== false, DECKS[t].sub)).join("")}
  </section>
  <section class="sec form">
    <div class="sech"><h2>明暗周期</h2></div>
    <div class="field"><label for="bedtime">消灯（就寝）</label><input type="time" id="bedtime" value="${esc(s.bedtime)}"><span class="hint">60分前から減光期（音・演出・時間制限・新出を停止し、今日の語だけ確認）。消灯〜点灯は暗期としてロックする。</span></div>
    <div class="field"><label for="wake">点灯（起床）</label><input type="time" id="wake" value="${esc(s.wake)}"><span class="hint">暗期を破らずに朝を迎えると暗期遵守ボーナス。点灯から3時間は DA ×1.5。</span></div>
    <p class="small" id="sleepLen">${esc(sleepText())}</p>
  </section>
  <section class="sec form">
    <div class="sech"><h2>T₀（二次試験）</h2></div>
    <div class="field"><label for="examDate">試験日</label><input type="date" id="examDate" value="${esc(s.examDate)}"><span class="hint">初期値は2027年2月25日（国公立の前期日程は例年2月25日開始）。必ず募集要項・受験票の日付に直せ。復習間隔は残り日数の15%で頭打ちになる。</span></div>
  </section>
  <section class="sec form">
    <div class="sech"><h2>出力</h2></div>
    ${chkField("spikes", "スパイク音（正答でクリックが鳴る）", s.spikes, "予測誤差が大きいほどクリックが密になる。")}
    ${chkField("tones", "音程", s.tones, "連続正答で音程が上がる。")}
    ${chkField("haptics", "振動", s.haptics, "")}
    ${chkField("tts", "英単語を自動で発音", s.tts, canSpeak ? "" : "このブラウザは音声合成に非対応。")}
  </section>
  <section class="sec form">
    <div class="sech"><h2>マイ単語</h2></div>
    <p class="small muted">自分の単語帳や過去問で覚えにくい語を追加。1行1語。タブ区切りなら「単語⇥意味⇥例文⇥メモ」、カンマ区切りなら「単語,意味,例文」。意味は日本語だけで書け（英語を入れると選択肢で答えがばれる）。</p>
    <textarea id="impText" placeholder="meticulous&#9;細心の注意を払った&#9;She kept meticulous records of every experiment."></textarea>
    <div class="btnrow"><button class="btn ink" id="impBtn">追加する</button><button class="btn danger" id="clearMine">マイ単語を全削除</button></div>
    <p class="small muted" id="impMsg">登録済み: ${state.custom.length}語</p>
  </section>
  <section class="sec form">
    <div class="sech"><h2>バックアップ</h2></div>
    <p class="small muted">${Store.ref ? "claude.ai のアカウントに自動で同期している。念のための控えも取れる。" : "記録はこのブラウザだけに保存されている。ブラウザのデータを消すと消える。定期的に書き出せ。"}</p>
    <div class="btnrow"><button class="btn" id="expBtn">書き出す</button><button class="btn" id="copyBtn" hidden>コピー</button></div>
    <textarea id="expText" readonly hidden aria-label="バックアップ"></textarea>
    <textarea id="restText" placeholder="書き出したJSONを貼り付けて復元" aria-label="復元するJSON"></textarea>
    <div class="btnrow"><button class="btn" id="restBtn">復元する</button></div>
  </section>
  <section class="sec">
    <div class="sech"><h2>文献</h2><span class="lbl">References</span></div>
    <ol class="sources">${SOURCES.map(([c, cite, url]) => `<li>${esc(c)}<br><a href="${esc(url)}" target="_blank" rel="noopener">${esc(cite)}</a></li>`).join("")}</ol>
  </section>
  <section class="sec form">
    <div class="sech"><h2>全リセット</h2></div>
    <div class="field"><label for="resetIn">RESET と入力</label><input id="resetIn" type="text" autocomplete="off" autocapitalize="characters"></div>
    <div><button class="btn danger" id="resetBtn" disabled>全データを消す</button></div>
  </section>`;
  setSync(Store.status);
  const num = (id, key, lo, hi) => $("#" + id).addEventListener("change", (e) => { const n = clamp(Math.round(+e.target.value || 0), lo, hi); e.target.value = n; s[key] = n; Store.save(); });
  num("block", "block", 10, 60); num("newPerDay", "newPerDay", 0, 200); num("goal", "goal", 10, 1000);
  $$("[data-seg]", v).forEach((b) => b.addEventListener("click", () => { s[b.dataset.seg] = b.dataset.val; Store.save(); $$(`[data-seg="${b.dataset.seg}"]`, v).forEach((x) => x.setAttribute("aria-pressed", String(x === b))); }));
  for (const t of DECK_ORDER) $("#deck_" + t).addEventListener("change", (e) => { s.decks[t] = e.target.checked; Store.save(); });
  for (const key of ["spikes", "tones", "haptics", "tts"]) $("#" + key).addEventListener("change", (e) => { s[key] = e.target.checked; Store.save(); });
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
    const fallback = () => { ta.focus(); ta.select(); toast("選択した。長押しでコピーしろ。"); };
    try { navigator.clipboard.writeText(ta.value).then(() => toast("コピーした。メモアプリ等に貼って保管しろ。"), fallback); } catch { fallback(); }
  });
  $("#restBtn").addEventListener("click", (e) => {
    let data;
    try { data = JSON.parse($("#restText").value); } catch { toast("JSONとして読めない。書き出した文字列をそのまま貼れ。"); return; }
    if (!data || typeof data !== "object" || !data.cards) { toast("このアプリのバックアップではない。"); return; }
    armed(e.currentTarget, "今の記録を上書きする。もう一度押せ", () => { state = normalize(data); state.updatedAt = Date.now(); buildWords(); Store.save(); renderAll(); toast("復元した。"); });
  });
  $("#resetIn").addEventListener("input", (e) => { $("#resetBtn").disabled = e.target.value.trim() !== "RESET"; });
  $("#resetBtn").addEventListener("click", () => {
    const keep = state.settings; state = freshState(); state.settings = keep; state.firstDay = dayKey(); state.updatedAt = Date.now();
    buildWords(); Store.save(); renderAll(); toast("全データを消した。ゼロからやり直せ。");
  });
}

/* ---- 語の詳細 ---- */
function fmtDue(c) {
  const now = Date.now();
  if (c.due <= now) return "いま";
  if (c.st === 2) { const d = new Date(c.due); return `${d.getMonth() + 1}/${d.getDate()} 以降`; }
  return fmtIvl(c.due - now) + "後";
}
function openSheet(id) {
  const w = BYID.get(id); if (!w) return;
  const c = state.cards[id];
  const head = `<div class="e-head"><b>${esc(DECKS[w.tag]?.name || "")}</b><button class="btn" data-act="closeSheet">閉じる</button></div>`;
  $("#sheetBody").innerHTML = head + (c ? `
    <div class="e-word"><div><b>${esc(w.w)}</b><span>${esc(w.pos)}</span></div>${speakBtn(w.w)}</div>
    <div class="e-ja">${esc(w.ja)}</div>
    ${w.pat ? `<div class="e-row"><span class="lbl">型</span><span class="pat">${esc(w.pat)}</span></div>` : ""}
    ${w.root ? `<div class="e-row"><span class="lbl">語源</span><span>${esc(w.root)}</span></div>` : ""}
    ${w.more ? `<div class="e-row"><span class="lbl">他に</span><span>${esc(w.more)}</span></div>` : ""}
    ${hasEx(w) ? `<p class="ex">${exHTML(w)}</p>${w.exJa ? `<p class="exja">${esc(w.exJa)}</p>` : ""}` : ""}
    ${w.note ? `<p class="note">${esc(w.note)}</p>` : ""}
    <div class="kv"><div><span class="lbl">状態</span><b style="font-family:var(--f-ja)">${stateName(c)}</b></div><div><span class="lbl">R</span><b>${retr(c).toFixed(2)}</b></div><div><span class="lbl">試行</span><b>${c.reps}</b></div><div><span class="lbl">忘却</span><b>${c.lapses}</b></div></div>
    <p class="small muted">次回: ${fmtDue(c)}${c.st === 2 ? ` ・ 間隔 ${c.ivl}日` : ""}</p>
    <div class="btnrow"><button class="btn" data-act="dueNow" data-id="${esc(id)}">次のブロックで出す</button></div>`
    : `<div class="e-word"><div><b>${esc(w.w[0])}${"?".repeat(Math.max(2, w.w.length - 1))}</b><span>未発見</span></div></div>
    <p class="small">まだ記録していないニューロン。中身は試行で出会うまで伏せてある。</p>
    <div class="btnrow"><button class="btn ink" data-act="learnNow" data-id="${esc(id)}">次のブロックで出会う</button></div>`);
  $("#sheet").hidden = false;
}
const closeSheet = () => { $("#sheet").hidden = true; };

/* ================= 暗期 ================= */
function hypnoSVG() {
  // 睡眠段階の模式図（周期約90分、前半に深い睡眠、後半にレム睡眠が多い）
  const lv = { W: 0, R: 1, N1: 2, N2: 3, N3: 4 };
  const seq = [["W", 0.2], ["N1", 0.1], ["N2", 0.3], ["N3", 0.6], ["N2", 0.2], ["R", 0.15], ["N2", 0.35], ["N3", 0.45], ["N2", 0.2], ["R", 0.3], ["N2", 0.5], ["N3", 0.2], ["N2", 0.2], ["R", 0.45], ["N2", 0.6], ["R", 0.55], ["N1", 0.1], ["W", 0.15]];
  const total = seq.reduce((a, s) => a + s[1], 0), W = 420, H = 120, l = 34, r = 6;
  let x = l, d = "";
  for (const [st, dur] of seq) { const y = 14 + lv[st] * 22, w2 = (dur / total) * (W - l - r); d += `${d ? "L" : "M"}${x.toFixed(1)},${y}H${(x + w2).toFixed(1)}`; x += w2; }
  const labels = Object.entries(lv).map(([k, i]) => `<text x="${l - 6}" y="${18 + i * 22}" text-anchor="end" font-family="var(--f-mono)" font-size="10" fill="#7A5233">${k === "W" ? "覚醒" : k === "R" ? "レム" : k}</text>`).join("");
  return `${labels}<path d="${d}" fill="none" stroke="#C48A55" stroke-width="2"/><text x="${W - r}" y="${H - 2}" text-anchor="end" font-family="var(--f-mono)" font-size="9" fill="#7A5233">睡眠段階の模式図</text>`;
}
function updateLock() {
  const lock = $("#lock");
  if (phase === "lock") {
    $("#lockTime").textContent = `点灯 ${S().wake} まで ${fmtHM(minsUntil(hm(S().wake)))}`;
    const n = activeWords().filter((w) => { const c = state.cards[w.id]; return c && touchedToday(c); }).length;
    $("#lockMsg").textContent = n ? `今日記録した ${n} 語は、眠っている間に再活性化されて固まる。夜更かしで削っているのは時間ではなく記憶そのものだ。` : "今日は1語も記録していない。それでも寝ろ。明日やれ。";
    if (lock.hidden) { $("#hypno").innerHTML = hypnoSVG(); lock.hidden = false; closeSheet(); $("#overlay").hidden = true; if (T) closeTrial(); }
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
      state.override = Date.now() + 10 * MIN; state.overrideAt = Date.now(); state.nightOverrides = (state.nightOverrides || 0) + 1; Store.save();
      tick(true); toast("10分だけ点灯。暗期遵守ボーナスは消えた。終わったら寝ろ。");
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

let toastTimer = 0;
function toast(msg, top) {
  $$(".toast").forEach((t) => t.remove()); clearTimeout(toastTimer);
  const el = document.createElement("div"); el.className = "toast" + (top || !$("#trial").hidden ? " top" : ""); el.setAttribute("role", "status"); el.textContent = msg;
  document.body.appendChild(el); toastTimer = setTimeout(() => el.remove(), 3200);
}

let lastDayKey = dayKey();
function tick(force) {
  const p = getPhase(), dk = dayKey();
  const changed = p !== phase || dk !== lastDayKey;
  phase = p; lastDayKey = dk;
  if (changed || force) { applyLook(); updateLock(); if (T) updateTop(); else renderAll(); }
  else updateLock();
}

/* ================= events ================= */
document.addEventListener("click", (e) => {
  const ov = e.target.closest("#overlay");
  if (ov) { ov.hidden = true; return; }
  const sp = e.target.closest("[data-speak]");
  if (sp) { speak(sp.dataset.speak); return; }
  const nav = e.target.closest(".nav button[data-view]");
  if (nav) { if (location.hash !== "#" + nav.dataset.view) location.hash = nav.dataset.view; else showView(nav.dataset.view); return; }
  const op = e.target.closest("[data-open]");
  if (op) { openSheet(op.dataset.open); return; }
  if (e.target === $("#sheet")) { closeSheet(); return; }
  if (e.target.closest("#cortexWrap canvas")) { cortexTap(e); return; }
  const a = e.target.closest("[data-act]");
  if (!a) { if (e.target.closest("#errata") && T?.auto) { clearTimeout(T.auto); T.auto = 0; $("#autobar")?.remove(); } return; }
  const act = a.dataset.act;
  if (act === "start") startBlock("main");
  else if (act === "weak") startBlock("weak");
  else if (act === "opt") onOpt(+a.dataset.i);
  else if (act === "unknown") { const q = T?.q; if (q && !q.done && q.ready) resolve(false, { unknown: true }); }
  else if (act === "next") next();
  else if (act === "again") { closeTrial(); startBlock("main"); }
  else if (act === "home") closeTrial();
  else if (act === "claim") claimSleep();
  else if (act === "closeSheet") closeSheet();
  else if (act === "dueNow") { const c = state.cards[a.dataset.id]; if (c) { c.due = c.st === 2 ? dayStart() - 1 : Date.now(); Store.save(); toast("次のブロックで出す。"); closeSheet(); renderView(); } }
  else if (act === "learnNow") { state.prio = [a.dataset.id, ...state.prio.filter((x) => x !== a.dataset.id)]; Store.save(); toast("次のブロックで出会う。"); closeSheet(); renderView(); }
});
$("#quit").addEventListener("click", quitBlock);
document.addEventListener("keydown", (e) => {
  const ov = $("#overlay");
  if (e.key === "Escape") { if (!ov.hidden) { ov.hidden = true; return; } if (!$("#sheet").hidden) closeSheet(); return; }
  if (!ov.hidden) { if (e.key === " " || e.key === "Enter") { e.preventDefault(); ov.hidden = true; } return; }
  if (!T || $("#trial").hidden || !$("#lock").hidden) return;
  if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA")) return;
  if (T.done) { if (e.key === "Enter") { e.preventDefault(); if (T.kind === "night") closeTrial(); else { closeTrial(); startBlock("main"); } } return; }
  if (!$("#errata").hidden) { if (e.key === " " || e.key === "Enter") { e.preventDefault(); next(); } return; }
  const q = T.q; if (!q || q.done || !q.ready) return;
  const k = e.key.toLowerCase();
  const idx = /^[1-4]$/.test(k) ? +k - 1 : KEYS.indexOf(k);
  if (idx >= 0) { e.preventDefault(); onOpt(idx); return; }
  if (k === "0" || k === "?") { e.preventDefault(); resolve(false, { unknown: true }); }
});
addEventListener("hashchange", () => showView(location.hash.slice(1)));
addEventListener("resize", () => { if (currentView === "cortex" && !T) drawCortex(); if (T && tStrip) tStrip.resize(); else if (homeStrip && currentView === "note") homeStrip.fill(state.trace); });
document.addEventListener("visibilitychange", () => { if (document.hidden) Store.flush(); else tick(); });
addEventListener("pagehide", () => Store.flush());
// 「いま思い出せる見込み」は1秒ごとに減っていく
setInterval(() => { if (T || currentView !== "note" || document.hidden) return; const el = $("#srNum"); if (el) el.innerHTML = `${sumR().toFixed(2)}<small>語</small>`; }, 1000);
setInterval(() => tick(), 20000);

/* ================= boot ================= */
(function prune() {
  const cutoff = addDays(dayKey(), -400);
  for (const key of Object.keys(state.days)) if (key < cutoff) delete state.days[key];
  if (!state.firstDay) state.firstDay = dayKey();
})();
buildWords();
applyLook();
showView(location.hash.slice(1));
updateLock();
Store.initRemote();
// テスト用の読み取り口（状態は変えない）
window.__dopa = { get block() { return T; }, get state() { return state; }, optJa: (id) => optJa(BYID.get(id)), clash: (a, b) => clash(BYID.get(a), BYID.get(b)), syn: (a, b) => synonymous(BYID.get(a), BYID.get(b)), distractors: (id, en) => distractors(BYID.get(id), 3, en).map((x) => x.id), get words() { return WORDS; } };
})();
