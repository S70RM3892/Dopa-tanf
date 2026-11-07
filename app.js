/* 超ドーパミン英単語帳 — app.js (v2)
 * 答えて答えて答えまくる自動判定クイズ。自己採点なし。速さと正誤で PERFECT/GREAT/GOOD/MISS を判定し、
 * それをそのまま分散学習スケジューラ(SM-2系)に渡す。コンボ段階・宝箱・ミッション・実績・ガチャ・タイムアタック。
 * 就寝前は演出ゼロの夜モード、就寝〜起床はロック。依存ライブラリなし。words/*.js が window.DOPA_DATA に単語を積む。
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
const centerOf = (el) => { if (!el) return { x: innerWidth / 2, y: innerHeight / 3 }; const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
const norm = (s) => String(s || "").toLowerCase().replace(/[’‘`]/g, "'").replace(/\s+/g, " ").trim();

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
  [1, "出町柳の迷子"], [3, "鴨川デルタの飛び石渡り"], [6, "百万遍の常連"], [10, "吉田山の修行者"], [15, "時計台の見張り番"],
  [20, "折田先生像の弟子"], [26, "二次試験の破壊者"], [33, "京大情報学科 合格圏"], [40, "京大情報学科 現役合格者"],
  [50, "計算機科学の覇王"], [60, "情報学の神童"], [75, "時計台の主"], [99, "伝説の京大生"],
];
const rankOf = (L) => RANKS.filter(([l]) => L >= l).pop()[1];
const TIERS = [
  { i: 0, min: 0, id: "", mul: 1, short: "" },
  { i: 1, min: 5, id: "warm", mul: 1.2, short: "WARM", label: "WARM UP", sub: "XP ×1.2" },
  { i: 2, min: 10, id: "fever", mul: 1.5, short: "FEVER", label: "FEVER!!", sub: "XP ×1.5" },
  { i: 3, min: 25, id: "zone", mul: 2, short: "ZONE", label: "ZONE突入", sub: "XP ×2" },
  { i: 4, min: 50, id: "god", mul: 3, short: "GOD", label: "GOD MODE", sub: "XP ×3" },
];
const tierOf = (combo) => TIERS.filter((t) => combo >= t.min).pop();
const COMBO_LINES = { 15: ["止まらねえ", "COMBO 15"], 20: ["京大が見えた", "COMBO 20 ・ 宝箱確定"], 35: ["覚醒", "COMBO 35"], 40: ["まだ行ける", "COMBO 40 ・ 宝箱確定"], 60: ["人外", "COMBO 60 ・ 宝箱確定"], 75: ["伝説", "COMBO 75"], 100: ["人間やめた", "COMBO 100"] };
const CLEAR_LINES = ["上出来。次も行け。", "脳に刻んだ。", "その調子で二次まで走れ。", "いい回転だ。", "まだ行けるだろ？", "ゾーンの入口は見えた。"];
const TYPE_LABEL = { meaning: "意味は？", context: "和訳 下線部", reverse: "逆引き 日→英", spell: "スペル 英作文" };
const BASE_T = { meaning: 8000, reverse: 8000, context: 12000, spell: 20000 };
const TIMER_MUL = { slow: 1.5, std: 1, fast: 0.7, off: 0 };
const BOUNTY = 30, SLAY = 150, AUTO_MS = 3500;

const TIPS = [
  "下線部和訳は、訳し始める前に S・V・O・C と修飾関係を確定させろ。構造が取れていない訳は部分点も消える。",
  "多義語の訳語は決め打ちするな。主語・目的語との相性で選べ。address the problem は「住所」ではない。",
  "和文英訳は、まず日本語を「英語にしやすい日本語」に言い換えろ。難しい単語より確実な構文。",
  "自由英作文は 主張 → 理由 → 具体例 → 結論。2025年の京大はこの型（結論・論証・総括）を条件に指定した。",
  "抽象名詞は動詞的に訳すと自然になる。the importance of A →「Aが重要であること」。",
  "無生物主語は「〜によって」「〜のおかげで」と副詞的に訳すと日本語が死なない。",
  "it / this / that が何を指すかを確定させてから訳せ。指示語の取り違えは誤読と同じ扱いになる。",
  "英作文で自信のない語は使うな。減点されない英語が最強。",
  "時制・冠詞・単複・三単現の s は英作文の典型的な減点ポイント。書いたら必ずここだけ見直せ。",
  "京大の下線部は一文が長く、カンマ・ダッシュ・等位接続詞が多い。and が何と何を結ぶかを先に決めろ。",
  "間違えた選択肢の意味も見ておけ。紛らわしい4択は、選ばなかった語の記憶まで強める（Little et al., 2012）。",
  "わからない語で当てずっぽうはするな。「わからん」はコンボが切れない。正直に押して解説を読め。",
  "分散学習と想起練習は、学習法研究で「有用度：高」と評価された2つ（Dunlosky et al., 2013）。",
  "徹夜は最悪のコスパ。学習と再学習の間に睡眠を挟むと、再学習の量が半分で済んだ（Mazza et al., 2016）。",
];

const SOURCES = [
  ["想起練習（自分でテストする）と分散学習は、10の学習法のうち「有用度：高」と評価された2つ。", "Dunlosky et al. (2013) Psychological Science in the Public Interest 14(1)", "https://www.psychologicalscience.org/news/releases/which-study-strategies-make-the-grade.html"],
  ["一度思い出せた単語をさらに繰り返し想起させると、1週間後の保持が大きく伸びた。読み直しには効果がなかった。", "Karpicke & Roediger (2008) Science 319", "https://source.washu.edu/2008/02/practicing-information-retrieval-is-key-to-memory-retention/"],
  ["誤答の選択肢が紛らわしい4択は本物の想起を起こし、誤答の選択肢に関する記憶まで強めた。だから選択肢は同じデッキ・同じ品詞から選び、同義語は外す。", "Little, Bjork, Bjork & Angello (2012) Psychological Science 23(11)", "https://www.psychologicalscience.org/journals/psychological-science/0956797612443370/"],
  ["4択のあとに正解を見せると（直後でも遅らせても）正答が増え、誤った選択肢を覚えてしまう害が減った。だから間違えたら必ず解説を出す。", "Butler & Roediger (2008) Memory & Cognition 36(3)", "https://doi.org/10.3758/MC.36.3.604"],
  ["答えを知らないうちに解こうとして失敗すると、その後の学習がむしろ強まった。だから新しい単語も解説より先にクイズで出す。", "Kornell, Hays & Bjork (2009) J Exp Psychol: LMC 35(4)", "https://pubmed.ncbi.nlm.nih.gov/19586265/"],
  ["思い出そうとして失敗した恩恵は、正解を学ぶまでに少しでも間が空くと消えた。だから解説は待たせずにその場で出す。", "Grimaldi & Karpicke (2012) Memory & Cognition", "https://learninglab.psych.purdue.edu/downloads/2012/2012_Grimaldi_Karpicke_MC.pdf"],
  ["学習が最も速く進む正答率は約85%（単純な二択課題のモデルでの理論値）。本アプリは直近の正答率を見て新出語の投入量を変え、85%前後を狙う。", "Wilson, Shenhav, Straccia & Cohen (2019) Nature Communications 10", "https://pmc.ncbi.nlm.nih.gov/articles/PMC6831579"],
  ["839件の評価を統合したメタ分析。最適な復習間隔は、覚えておきたい期間が長いほど長くなる。", "Cepeda et al. (2006) Psychological Bulletin 132(3)", "https://pubmed.ncbi.nlm.nih.gov/16719566/"],
  ["最適な復習間隔は試験までの期間の約20%（数週間先）〜5%（1年先）。本アプリは残り日数の15%で間隔に上限をかける。", "Cepeda et al. (2008) Psychological Science 19(11)", "https://www.evullab.org/pdf/CepedaVulRohrerWixtedPashler-PS-2008.pdf"],
  ["ドーパミン神経は予想外の報酬に強く反応し、予測できる報酬には反応が弱まる（報酬予測誤差）。XPを毎回同じにせず、クリティカル・宝箱・ガチャで振れ幅を作っているのはこのため。", "Schultz, Dayan & Montague (1997) Science 275", "https://pubmed.ncbi.nlm.nih.gov/9054347/"],
  ["好奇心が高まった状態では中脳ドーパミン系と海馬の連携が強まり、記憶が良くなった。", "Gruber, Gelman & Ranganath (2014) Neuron 84(2)", "https://pmc.ncbi.nlm.nih.gov/articles/PMC4252494"],
  ["学習→睡眠→再学習の組は、必要な練習量が約半分で済み、1週間後・6か月後の保持も良かった。", "Mazza et al. (2016) Psychological Science", "https://www.sciencedaily.com/releases/2016/08/160822083446.htm"],
  ["13〜18歳は1日8〜10時間の睡眠を定期的にとるべき。", "AASM コンセンサス声明 (Paruthi et al., 2016) J Clin Sleep Med 12(6)", "https://www.sciencedaily.com/releases/2016/06/160613122419.htm"],
  ["就寝前に発光タブレットで読書すると、紙の本に比べて寝つきが遅れ、メラトニン分泌が減り、翌朝の覚醒度が下がった（12名の実験）。", "Chang et al. (2015) PNAS 112(4)", "https://pubmed.ncbi.nlm.nih.gov/25535358/"],
  ["京大英語は英文和訳・和文英訳・自由英作文が柱。2025年の自由英作文はAIと想像力がテーマ（80〜100語）。", "study-search.jp / UP-EDU 京大英語解説 (2025)", "https://study-search.jp/columns/296"],
];

/* ---- gacha catalog (見た目だけの報酬。学習でしか手に入らない) ---- */
const RAR = ["N", "R", "SR", "SSR", "UR"];
const RC = { N: "var(--r-n)", R: "var(--r-r)", SR: "var(--r-sr)", SSR: "var(--r-ssr)", UR: "var(--r-ur)" };
const REFUND = { N: 10, R: 25, SR: 60, SSR: 150, UR: 500 };
const TYPE_NAME = { title: "称号", fx: "正解エフェクト", sfx: "効果音", skin: "テーマ色" };
const CATALOG = [
  ["t_hiroi", "title", "N", "単語拾い"], ["t_asa", "title", "N", "朝型の受験生"], ["t_4taku", "title", "N", "4択の狩人"], ["t_kamo", "title", "N", "鴨川ランナー"], ["t_minarai", "title", "N", "復習の鬼・見習い"],
  ["t_gogen", "title", "R", "語源ハンター"], ["t_kaitai", "title", "R", "下線部の解体屋"], ["t_wayaku", "title", "R", "和訳職人"], ["t_combo", "title", "R", "コンボ職人"], ["t_nemuri", "title", "R", "眠りを守る者"],
  ["t_tagi", "title", "SR", "多義語マスター"], ["t_renkin", "title", "SR", "英作文の錬金術師"], ["t_kenja", "title", "SR", "百万遍の賢者"], ["t_tokei", "title", "SR", "時計台の番人"],
  ["t_moushigo", "title", "SSR", "京大の申し子"], ["t_zone", "title", "SSR", "ゾーンの住人"], ["t_shindo", "title", "UR", "情報学の神童"],
  ["fx_snow", "fx", "R", "雪月花", "白と青の粒が舞う"], ["fx_star", "fx", "R", "星屑", "星形の光が散る"], ["fx_sakura", "fx", "SR", "桜吹雪", "花びらがひらひら落ちる"],
  ["fx_neon", "fx", "SR", "ネオン", "蛍光色の粒がはじける"], ["fx_gold", "fx", "SSR", "金箔", "金箔が大量に舞う"], ["fx_rainbow", "fx", "UR", "虹", "全色の粒が噴き出す"],
  ["sfx_8bit", "sfx", "R", "8bit", "ゲーム機の矩形波"], ["sfx_music", "sfx", "R", "オルゴール", "澄んだベルの音"], ["sfx_wa", "sfx", "SR", "和音階", "都節音階で上がっていく"],
  ["sfx_synth", "sfx", "SR", "シンセ", "のこぎり波のリード"], ["sfx_harp", "sfx", "SSR", "ハープ", "正解ごとに分散和音"],
  ["sk_matcha", "skin", "R", "抹茶", "アクセントが緑に", "#1C8650"], ["sk_kyodai", "skin", "R", "京大ブルー", "アクセントが濃紺に", "#16388A"],
  ["sk_cyan", "skin", "SR", "サイバーシアン", "アクセントが水色に", "#077FA6"], ["sk_sunset", "skin", "SR", "夕焼け", "アクセントが橙に", "#D14A12"],
  ["sk_gold", "skin", "SSR", "ロイヤルゴールド", "アクセントが金に", "#946200"], ["sk_violet", "skin", "UR", "ネオンバイオレット", "アクセントが紫に", "#7128E8"],
].map(([id, type, rar, name, desc = "", sw = ""]) => ({ id, type, rar, name, desc, sw }));
const DEFAULT_ITEMS = [
  { id: "fx_std", type: "fx", rar: "N", name: "標準", desc: "ピンクと金の粒" },
  { id: "sfx_std", type: "sfx", rar: "N", name: "標準", desc: "コンボで音程が上がる三角波" },
  { id: "sk_pink", type: "skin", rar: "N", name: "ドーパピンク", desc: "初期の色", sw: "#E8175F" },
];
const ITEM = new Map([...CATALOG, ...DEFAULT_ITEMS].map((x) => [x.id, x]));
const SKIN_ATTR = { sk_pink: "", sk_matcha: "matcha", sk_kyodai: "kyodai", sk_cyan: "cyan", sk_sunset: "sunset", sk_gold: "gold", sk_violet: "violet" };
const SFX_PACKS = {
  sfx_std: { wave: "triangle", scale: [0, 2, 4, 7, 9], base: 392, vol: 0.22 },
  sfx_8bit: { wave: "square", scale: [0, 2, 4, 7, 9], base: 392, vol: 0.08 },
  sfx_music: { wave: "sine", scale: [0, 2, 4, 7, 9], base: 523.25, vol: 0.24, bell: true },
  sfx_wa: { wave: "triangle", scale: [0, 1, 5, 7, 8], base: 329.63, vol: 0.22 },
  sfx_synth: { wave: "sawtooth", scale: [0, 3, 5, 7, 10], base: 261.63, vol: 0.07 },
  sfx_harp: { wave: "triangle", scale: [0, 2, 4, 7, 9], base: 392, vol: 0.18, arp: true },
};
const FX_STYLES = {
  fx_std: { colors: ["--accent", "--gold", "--info"], shape: "mix" },
  fx_snow: { colors: ["#FFFFFF", "#BFE3FF", "#7FC0FF"], shape: "circle", grav: 0.05 },
  fx_star: { colors: ["#FFE27A", "#FFFFFF", "#FFC23D"], shape: "star" },
  fx_sakura: { colors: ["#FFB7D0", "#FF8FB8", "#FFD6E5"], shape: "petal", grav: 0.05 },
  fx_neon: { colors: ["#00F0FF", "#FF2BD6", "#7CFF4F"], shape: "circle" },
  fx_gold: { colors: ["#FFD34D", "#E39500", "#FFF0B0"], shape: "rect", count: 1.7 },
  fx_rainbow: { colors: "rainbow", shape: "mix", count: 1.4 },
};

/* ---- missions & achievements ---- */
const MISSIONS = [
  { id: "rounds3", text: "ラウンドを3回クリア", goal: 3, key: "rounds", coin: 80 },
  { id: "perfect20", text: "PERFECTを20回出す", goal: 20, key: "perfect", coin: 90 },
  { id: "combo20", text: "20コンボ達成", goal: 20, key: "maxCombo", coin: 100 },
  { id: "new10", text: "新しい語に10語出会う", goal: 10, key: "newc", coin: 60 },
  { id: "spell6", text: "スペル問題を6問正解", goal: 6, key: "spellOk", coin: 90, need: () => graduatedCount() >= 15 },
  { id: "ctx8", text: "和訳(下線部)問題を8問正解", goal: 8, key: "ctxOk", coin: 80, need: () => graduatedCount() >= 8 },
  { id: "rev10", text: "逆引き(日→英)を10問正解", goal: 10, key: "revOk", coin: 80, need: () => graduatedCount() >= 8 },
  { id: "ta15", text: "タイムアタックで15点", goal: 15, key: "taBest", coin: 100, need: () => seenCount() >= 12 },
  { id: "acc90", text: "正答率90%以上でラウンドクリア", goal: 1, key: "acc90", coin: 100 },
  { id: "goal", text: "今日のノルマを達成", goal: 1, key: "goalHit", coin: 100 },
  { id: "bounty1", text: "賞金首に1回正解", goal: 1, key: "bounty", coin: 90, need: () => nemesisCount() > 0 },
  { id: "combo40", text: "40コンボ達成", goal: 40, key: "maxCombo", coin: 160, need: () => (state.bestCombo || 0) >= 25 },
];
const ACH = [
  ["first", "初", "初陣", "ラウンドを初クリア", 50, (s) => s.totals.rounds >= 1],
  ["c100", "百", "百問斬り", "累計100問正解", 100, (s) => s.totals.correct >= 100],
  ["c1000", "千", "千問斬り", "累計1,000問正解", 300, (s) => s.totals.correct >= 1000],
  ["c5000", "万", "五千問斬り", "累計5,000問正解", 800, (s) => s.totals.correct >= 5000],
  ["p100", "P", "PERFECT職人", "PERFECTを累計100回", 150, (s) => s.totals.perfect >= 100],
  ["combo25", "Z", "ゾーン突入", "25コンボ（ZONE）", 150, (s) => (s.bestCombo || 0) >= 25],
  ["combo50", "神", "神の領域", "50コンボ（GOD MODE）", 300, (s) => (s.bestCombo || 0) >= 50],
  ["combo100", "極", "人間やめた", "100コンボ", 800, (s) => (s.bestCombo || 0) >= 100],
  ["m10", "10", "定着10", "10語を定着", 100, (s, x) => x.mastered >= 10],
  ["m50", "50", "定着50", "50語を定着", 300, (s, x) => x.mastered >= 50],
  ["m150", "150", "定着150", "150語を定着", 600, (s, x) => x.mastered >= 150],
  ["mall", "全", "全語定着", "収録語をすべて定着", 3000, (s, x) => x.total > 0 && x.mastered >= x.total],
  ["s3", "3", "三日坊主卒業", "連続3日ノルマ達成", 100, (s) => s.streak.best >= 3],
  ["s7", "7", "一週間皆勤", "連続7日ノルマ達成", 250, (s) => s.streak.best >= 7],
  ["s30", "30", "一か月皆勤", "連続30日ノルマ達成", 1000, (s) => s.streak.best >= 30],
  ["jackpot", "★", "大当たり", "JACKPOTを引く", 100, (s) => s.totals.jackpots >= 1],
  ["slay1", "撃", "初撃破", "賞金首を撃破", 150, (s) => s.totals.slain >= 1],
  ["slay10", "賞", "賞金稼ぎ", "賞金首を10体撃破", 500, (s) => s.totals.slain >= 10],
  ["ta20", "速", "速読の鬼", "タイムアタック20点", 200, (s) => s.taBest >= 20],
  ["ta35", "光", "光速", "タイムアタック35点", 500, (s) => s.taBest >= 35],
  ["sleep1", "眠", "よく寝た", "快眠ボーナスを受け取る", 50, (s) => s.totals.sleepBonus >= 1],
  ["sleep7", "快", "快眠の達人", "快眠ボーナス7回", 300, (s) => s.totals.sleepBonus >= 7],
  ["srank", "S", "Sランク", "ラウンドでSランク", 200, (s) => s.totals.sRanks >= 1],
  ["gacha1", "回", "初ガチャ", "ガチャを回す", 30, (s) => s.totals.pulls >= 1],
  ["ur", "虹", "虹色", "URを引く", 500, (s) => s.totals.ur >= 1],
].map(([id, g, name, desc, coin, test]) => ({ id, g, name, desc, coin, test }));

const ICON = {
  speaker: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4zm12.5 3a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4z"/></svg>',
  x: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  chest: '<svg viewBox="0 0 48 48" aria-hidden="true"><rect x="6" y="19" width="36" height="21" rx="3" fill="currentColor" opacity=".28"/><path d="M6 22a9 9 0 0 1 9-9h18a9 9 0 0 1 9 9v3H6z" fill="currentColor" opacity=".6"/><rect x="20" y="21" width="8" height="10" rx="2" fill="currentColor"/></svg>',
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  moon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.5 14.6A8.5 8.5 0 0 1 9.4 3.5a8.5 8.5 0 1 0 11.1 11.1z"/></svg>',
};

/* ================= words ================= */
let WORDS = [], BYID = new Map();
function addWord(tag, r) {
  if (!Array.isArray(r) || !r[0]) return;
  const [w, pos, ja, more, ex, hit, exJa, note, pat] = r;
  const id = tag + ":" + w;
  if (BYID.has(id)) return;
  const o = { id, tag, w: String(w), pos: pos || "", ja: ja || "", more: more || "", ex: ex || "", hit: hit || "", exJa: exJa || "", note: note || "", pat: pat || "" };
  WORDS.push(o); BYID.set(id, o);
}
function buildWords() {
  WORDS = []; BYID = new Map();
  for (const deck of window.DOPA_DATA || []) if (DECKS[deck.tag]) for (const r of deck.rows || []) addWord(deck.tag, r);
  for (const r of state.custom || []) addWord("mine", r);
}
const hasEx = (w) => !!(w.ex && w.hit && w.ex.includes(w.hit));
const countTag = (t) => WORDS.filter((w) => w.tag === t).length;
const posHead = (w) => (w.pos || "").split("・")[0];

// 選択肢・問題文に出す意味。英語(=答え)とカタカナの音写を抜いて、音だけで当てられないようにする。
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
  return s.split(/[・／、,，()（）「」～〜\s]+/)
    .map((t) => t.replace(/(させる|される|している|する|である|的な|な|だ|の|に|を|と|が|で)$/u, ""))
    .filter((t) => t.length >= 2);
}
function kanjiBigrams(s) {
  const set = new Set();
  for (const run of s.match(/[一-鿿々]{2,}/g) || []) for (let i = 0; i < run.length - 1; i++) set.add(run.slice(i, i + 2));
  return set;
}
function feat(w) { if (!w._f) { const s = optJa(w); w._f = { s, tok: jaTokens(s), big: kanjiBigrams(s) }; } return w._f; }
// 同義・類義の選択肢を並べない（正解が2つある4択は欠陥問題）
function similar(a, b) {
  const A = feat(a), B = feat(b);
  if (A.s === B.s) return true;
  for (const x of A.tok) for (const y of B.tok) if (x === y || x.includes(y) || y.includes(x)) return true;
  for (const x of A.big) if (B.big.has(x)) return true;
  return false;
}
function distractors(w, n, en) {
  const p0 = posHead(w);
  const tiers = [WORDS.filter((x) => x.tag === w.tag && posHead(x) === p0), WORDS.filter((x) => posHead(x) === p0), WORDS];
  const out = [], seen = new Set([en ? norm(w.w) : optJa(w)]);
  for (const pool of tiers) {
    for (const x of shuffle(pool.slice())) {
      if (out.length >= n) break;
      if (x.id === w.id) continue;
      const key = en ? norm(x.w) : optJa(x);
      if (seen.has(key) || similar(w, x) || out.some((o) => similar(o, x))) continue;
      seen.add(key); out.push(x);
    }
    if (out.length >= n) break;
  }
  return out;
}

/* ================= state & storage ================= */
const LS_KEY = "dopa-tanf:v1";
const DEFAULT_SETTINGS = {
  newPerDay: 20, goal: 100, roundSize: 25, timer: "std", bedtime: "22:30", wake: "06:30", examDate: "2027-02-25",
  sound: true, effects: true, tts: false,
  decks: { poly: true, abstract: true, verbs: true, write: true, tech: true, mine: true },
};
const TOTALS0 = { answers: 0, correct: 0, perfect: 0, rounds: 0, jackpots: 0, slain: 0, pulls: 0, sleepBonus: 0, sRanks: 0, ur: 0 };
function freshState() {
  return { v: 2, updatedAt: 0, cards: {}, xp: 0, coins: 0, days: {}, streak: { count: 0, best: 0, lastDay: "", shields: 1 },
    bestCombo: 0, taBest: 0, custom: [], prio: [], override: 0, overrideAt: 0, nightOverrides: 0,
    inv: { fx_std: 1, sfx_std: 1, sk_pink: 1 }, equip: { title: "", fx: "fx_std", sfx: "sfx_std", skin: "sk_pink" },
    totals: { ...TOTALS0 }, ach: {}, settings: JSON.parse(JSON.stringify(DEFAULT_SETTINGS)) };
}
function normalize(s) {
  s = s && typeof s === "object" ? s : {};
  const f = freshState(), st = s.settings || {};
  return { ...f, ...s,
    settings: { ...f.settings, ...st, decks: { ...f.settings.decks, ...(st.decks || {}) } },
    streak: { ...f.streak, ...(s.streak || {}) },
    inv: { ...f.inv, ...(s.inv || {}) }, equip: { ...f.equip, ...(s.equip || {}) },
    totals: { ...f.totals, ...(s.totals || {}) }, ach: s.ach && typeof s.ach === "object" ? s.ach : {},
    cards: s.cards || {}, days: s.days || {}, custom: Array.isArray(s.custom) ? s.custom : [], prio: Array.isArray(s.prio) ? s.prio : [],
    coins: +s.coins || 0, taBest: +s.taBest || 0 };
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
        this.saveLocal(); buildWords(); if (!R) renderAll();
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
function lastBedtime(now = Date.now()) {
  const d = new Date(now), b = hm(S().bedtime);
  const t = new Date(d.getFullYear(), d.getMonth(), d.getDate(), Math.floor(b / 60), b % 60).getTime();
  return t <= now ? t : t - DAY;
}
function applyLook() {
  const root = document.documentElement;
  root.dataset.mode = isNight() ? "night" : "day";
  const sk = SKIN_ATTR[state.equip.skin] || "";
  if (sk) root.dataset.skin = sk; else root.removeAttribute("data-skin");
}

/* ================= scheduler (SM-2 系) ================= */
const LEARN = [1 * MIN, 10 * MIN], RELEARN = [10 * MIN];
function ivlCap(now = Date.now()) {
  const dl = daysBetween(dayKey(now), S().examDate);
  return Number.isFinite(dl) && dl > 0 ? Math.max(3, Math.round(dl * 0.15)) : 365;
}
const isMastered = (c) => !!c && c.st === 2 && c.ivl >= Math.min(21, ivlCap());
const isNemesis = (c) => !!c && c.lapses >= 4 && !c.slain;
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
const isDue = (c, now) => !!c && (c.st === 2 ? c.due < dayEnd(now) : c.due <= now + 20 * MIN);
const touchedToday = (c, now = Date.now()) => Math.max(c.last || 0, c.first || 0) >= dayStart(now);
const stateName = (c) => (!c ? "未発見" : c.st === 1 ? "学習中" : c.st === 3 ? "再学習" : isMastered(c) ? "定着" : "復習中");
function fmtIvl(ms) {
  if (ms < HOUR) return Math.max(1, Math.round(ms / MIN)) + "分";
  if (ms < DAY * 0.9) return Math.round(ms / HOUR) + "時間";
  return Math.max(1, Math.round(ms / DAY)) + "日";
}

/* ================= stats ================= */
const blankDay = () => ({ reps: 0, ok: 0, xp: 0, newc: 0, ms: 0, goal: false, perfect: 0, maxCombo: 0, spellOk: 0, ctxOk: 0, revOk: 0, rounds: 0, taBest: 0, bounty: 0, acc90: 0, goalHit: 0, mdone: [], mids: null, sleepBonus: false });
function today() { const k = dayKey(); const d = state.days[k] || (state.days[k] = blankDay()); for (const [key, v] of Object.entries(blankDay())) if (d[key] === undefined) d[key] = v; return d; }
const peekToday = () => ({ ...blankDay(), ...(state.days[dayKey()] || {}) });
const enabledTag = (t) => S().decks[t] !== false;
const activeWords = () => WORDS.filter((w) => enabledTag(w.tag));
const seenCount = () => activeWords().filter((w) => state.cards[w.id]).length;
const graduatedCount = () => activeWords().filter((w) => state.cards[w.id]?.st === 2).length;
const nemesisCount = () => activeWords().filter((w) => isNemesis(state.cards[w.id])).length;
const masteredCount = () => activeWords().filter((w) => isMastered(state.cards[w.id])).length;
function counts(now = Date.now()) {
  let due = 0, learning = 0, unseen = 0;
  for (const w of activeWords()) {
    const c = state.cards[w.id];
    if (!c) { unseen++; continue; }
    if (isDue(c, now)) c.st === 2 ? due++ : learning++;
  }
  return { due, learning, unseen, newLeft: Math.max(0, Math.min(unseen, S().newPerDay - peekToday().newc)) };
}
const needFor = (L) => Math.round(120 + 50 * Math.pow(L, 1.5));
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
  else if (gap > 1 && s.shields >= gap - 1) { s.shields -= gap - 1; s.count++; setTimeout(() => toast(`シールド${gap - 1}個を消費して連続記録を守った`), 1500); }
  else s.count = 1;
  s.lastDay = k; s.best = Math.max(s.best, s.count);
}
function pace() {
  const dl = daysBetween(dayKey(), S().examDate);
  const unseen = activeWords().filter((w) => !state.cards[w.id]).length;
  if (!Number.isFinite(dl) || dl <= 0) return { dl, unseen, need: 0 };
  return { dl, unseen, need: Math.ceil(unseen / Math.max(1, dl - 14)) };
}
function todaysMissions() {
  const t = today();
  if (Array.isArray(t.mids) && t.mids.length) return t.mids.map((id) => MISSIONS.find((m) => m.id === id)).filter(Boolean);
  const rnd = seeded(hashStr("dopa" + dayKey()));
  const pool = MISSIONS.slice();
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  const out = [], keys = new Set();
  for (const m of pool) { if (out.length >= 3) break; if (keys.has(m.key) || (m.need && !m.need())) continue; out.push(m); keys.add(m.key); }
  t.mids = out.map((m) => m.id);
  return out;
}
const mval = (m, t) => +(t[m.key] || 0);
function checkMissions(t) {
  const done = [];
  for (const m of todaysMissions()) {
    if (t.mdone.includes(m.id) || mval(m, t) < m.goal) continue;
    t.mdone.push(m.id); state.coins += m.coin; addXP(40); done.push(m);
    if (R) { R.coins += m.coin; R.xp += 40; }
  }
  if (done.length && todaysMissions().every((m) => t.mdone.includes(m.id))) {
    done.allClear = true;
    if (R) R.bonus++; else state.coins += 150;
  }
  return done;
}
function checkAch() {
  const x = { mastered: masteredCount(), total: activeWords().length };
  const got = [];
  for (const a of ACH) if (!state.ach[a.id] && a.test(state, x)) { state.ach[a.id] = Date.now(); state.coins += a.coin; got.push(a); }
  return got;
}

/* ================= sound (WebAudio, 音源ファイルなし) ================= */
const Sound = {
  ctx: null, master: null, noise: null,
  ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null;
      try {
        this.ctx = new AC();
        const comp = this.ctx.createDynamicsCompressor();
        this.master = this.ctx.createGain(); this.master.gain.value = 0.55;
        this.master.connect(comp); comp.connect(this.ctx.destination);
        const len = this.ctx.sampleRate * 0.5, buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate), ch = buf.getChannelData(0);
        for (let i = 0; i < len; i++) ch[i] = Math.random() * 2 - 1;
        this.noise = buf;
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
  hiss(at, dur, vol = 0.15, freq = 2000) {
    const ctx = this.ctx, t = ctx.currentTime + at;
    const src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    src.buffer = this.noise; f.type = "bandpass"; f.frequency.setValueAtTime(freq, t); f.frequency.exponentialRampToValueAtTime(freq * 3, t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(this.master); src.start(t); src.stop(t + dur + 0.05);
  },
  play(fn, force) { if ((!soundOn() && !force) || !this.ensure()) return; try { fn(); } catch { /* ignore */ } },
  pack() { return SFX_PACKS[state.equip.sfx] || SFX_PACKS.sfx_std; },
  note(n, p = this.pack()) { const sc = p.scale; return p.base * Math.pow(2, (12 * Math.floor(n / sc.length) + sc[n % sc.length]) / 12); },
  correct(combo, j, force) {
    this.play(() => {
      const p = this.pack(), n = Math.min(combo, 14), f = this.note(n, p);
      this.tone(f, 0, 0.3, p.wave, p.vol);
      if (p.bell) { this.tone(f * 2, 0, 0.5, "sine", p.vol * 0.4); this.tone(f * 3, 0, 0.35, "sine", p.vol * 0.15); }
      else this.tone(f * 2, 0, 0.18, "sine", p.vol * 0.3);
      if (p.arp) { this.tone(this.note(n + 2, p), 0.06, 0.3, p.wave, p.vol * 0.8); this.tone(this.note(n + 4, p), 0.12, 0.35, p.wave, p.vol * 0.7); }
      if (j === "PERFECT") this.tone(f * 4, 0.05, 0.16, "sine", 0.06);
      if (combo >= 25) this.tone(70, 0, 0.18, "sine", 0.35);
    }, force);
  },
  wrong(soft) { this.play(() => { this.tone(soft ? 220 : 155, 0, 0.2, "triangle", soft ? 0.14 : 0.24); if (!soft) this.tone(116, 0.07, 0.26, "triangle", 0.2); }); },
  tick() { this.play(() => this.tone(1500, 0, 0.04, "square", 0.04)); },
  tap(n) { this.play(() => this.tone(this.note(Math.min(n, 14)) * 2, 0, 0.12, "sine", 0.1)); },
  crit() { this.play(() => [0, 4, 7, 12].forEach((s, i) => this.tone(523.25 * 2 ** (s / 12), i * 0.055, 0.25, "square", 0.06))); },
  jackpot() { this.play(() => { [0, 4, 7, 12, 16, 19, 24].forEach((s, i) => this.tone(523.25 * 2 ** (s / 12), i * 0.06, 0.35, "square", 0.06)); for (let i = 0; i < 6; i++) this.tone(2093 + Math.random() * 1500, 0.45 + i * 0.05, 0.12, "sine", 0.05); }); },
  tierUp(i) { this.play(() => { this.hiss(0, 0.45, 0.16, 600); [0, 4, 7].forEach((s) => this.tone(261.63 * 2 ** ((s + i * 2) / 12), 0.12, 0.6, "sawtooth", 0.05)); this.tone(1046.5 * 2 ** (i / 12), 0.3, 0.4, "triangle", 0.12); }); },
  fanfare() { this.play(() => [[0, 0], [4, 0.12], [7, 0.24], [12, 0.36], [7, 0.5], [12, 0.62]].forEach(([s, t]) => this.tone(392 * 2 ** (s / 12), t, 0.3, "triangle", 0.2))); },
  chest() { this.play(() => [0, 7, 12, 19].forEach((s, i) => this.tone(659.25 * 2 ** (s / 12), i * 0.07, 0.22, "sine", 0.12))); },
  coin() { this.play(() => { this.tone(1318.5, 0, 0.08, "square", 0.05); this.tone(1975.5, 0.07, 0.18, "square", 0.05); }); },
  drum() { this.play(() => { for (let i = 0; i < 14; i++) this.hiss(i * 0.075 * (1 - i * 0.03), 0.06, 0.12 + i * 0.01, 300); }); },
  reveal(r) {
    const k = RAR.indexOf(r);
    this.play(() => {
      if (k <= 0) { this.tone(523.25, 0, 0.3, "triangle", 0.15); return; }
      const notes = [0, 4, 7, 12, 16, 19, 24].slice(0, 2 + k);
      notes.forEach((s, i) => this.tone(523.25 * 2 ** (s / 12), i * 0.07, 0.5, k >= 3 ? "square" : "triangle", k >= 3 ? 0.07 : 0.15));
      if (k >= 3) for (let i = 0; i < 8; i++) this.tone(2093 + Math.random() * 2000, 0.4 + i * 0.05, 0.14, "sine", 0.05);
    });
  },
};
const vibrate = (p) => { try { if (fxOn() && navigator.vibrate) navigator.vibrate(p); } catch { /* ignore */ } };

/* ================= visual fx ================= */
const FX = {
  cv: null, ctx: null, parts: [], raf: 0, dpr: 1,
  init() { this.cv = $("#fx"); this.ctx = this.cv.getContext("2d"); this.resize(); addEventListener("resize", () => this.resize()); },
  resize() { this.dpr = Math.min(2, window.devicePixelRatio || 1); this.cv.width = innerWidth * this.dpr; this.cv.height = innerHeight * this.dpr; },
  color(v) { return getComputedStyle(document.documentElement).getPropertyValue(v).trim() || "#e8175f"; },
  style() { return FX_STYLES[state.equip.fx] || FX_STYLES.fx_std; },
  palette(st) { return st.colors === "rainbow" ? null : st.colors.map((c) => (c.startsWith("--") ? this.color(c) : c)); },
  run() { if (!this.raf) this.raf = requestAnimationFrame(() => this.tick()); },
  burst(x, y, n, power = 1, force) {
    if ((!fxOn() && !force) || reduceMotion || !this.ctx) return;
    const st = this.style(), pal = this.palette(st);
    n = Math.round(n * (st.count || 1));
    for (let i = 0; i < n && this.parts.length < 600; i++) {
      const a = Math.random() * Math.PI * 2, sp = rand(2, 7.5) * power;
      const shape = st.shape === "mix" ? (Math.random() < 0.5 ? "rect" : "circle") : st.shape;
      this.parts.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - rand(1, 3), g: st.grav ?? 0.18, life: 1, dec: rand(0.013, 0.028), s: rand(3, 7), c: pal ? pick(pal) : `hsl(${randInt(0, 359)} 90% 60%)`, r: Math.random() * 6, vr: rand(-0.3, 0.3), shape });
    }
    this.run();
  },
  confetti(force) {
    if ((!fxOn() && !force) || reduceMotion || !this.ctx) return;
    const st = this.style(), pal = this.palette(st) || ["#FF4A86", "#FFC23D", "#4DB8FF", "#2BD394", "#B07CFF"];
    const cols = st.shape === "mix" ? [...pal, this.color("--good")] : pal;
    for (let i = 0; i < 150 && this.parts.length < 600; i++) this.parts.push({ x: rand(0, innerWidth), y: rand(-100, -10), vx: rand(-1.5, 1.5), vy: rand(1, 4), g: 0.05, life: 1, dec: rand(0.004, 0.008), s: rand(4, 8), c: pick(cols), r: Math.random() * 6, vr: rand(-0.2, 0.2), shape: st.shape === "mix" ? "rect" : st.shape });
    this.run();
  },
  tick() {
    const { ctx, dpr } = this;
    ctx.clearRect(0, 0, this.cv.width, this.cv.height);
    this.parts = this.parts.filter((p) => p.life > 0 && p.y < innerHeight + 40);
    for (const p of this.parts) {
      p.vy += p.g; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.r += p.vr; p.life -= p.dec;
      ctx.globalAlpha = clamp(p.life * 1.5, 0, 1); ctx.fillStyle = p.c;
      const s = p.s * dpr;
      ctx.save(); ctx.translate(p.x * dpr, p.y * dpr); ctx.rotate(p.r);
      if (p.shape === "rect") ctx.fillRect(-s / 2, -s / 4, s, s / 2);
      else if (p.shape === "petal") { ctx.beginPath(); ctx.ellipse(0, 0, s * 0.7, s * 0.35, 0, 0, Math.PI * 2); ctx.fill(); }
      else if (p.shape === "star") { ctx.beginPath(); for (let k = 0; k < 10; k++) { const rr = k % 2 ? s * 0.3 : s * 0.8, a = (k * Math.PI) / 5; ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); } ctx.closePath(); ctx.fill(); }
      else { ctx.beginPath(); ctx.arc(0, 0, s / 2, 0, Math.PI * 2); ctx.fill(); }
      ctx.restore();
    }
    ctx.globalAlpha = 1;
    this.raf = this.parts.length ? requestAnimationFrame(() => this.tick()) : 0;
  },
};
function floatText(text, x, y, cls = "") {
  if (isNight() && !R?.ta) return;
  const el = document.createElement("div");
  el.className = "float " + cls; el.textContent = text; el.style.left = x + "px"; el.style.top = y + "px";
  document.body.appendChild(el); setTimeout(() => el.remove(), 950);
}
const bannerQ = []; let bannerBusy = false;
function banner(big, small, cls = "") { if (!fxOn()) return; bannerQ.push([big, small, cls]); if (!bannerBusy) runBanner(); }
function runBanner() {
  const b = bannerQ.shift(); if (!b) { bannerBusy = false; return; }
  bannerBusy = true;
  const el = document.createElement("div");
  el.className = "banner " + b[2]; el.setAttribute("role", "status");
  el.innerHTML = esc(b[0]) + (b[1] ? `<small>${esc(b[1])}</small>` : "");
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1350); setTimeout(runBanner, 800);
}
function flash() { if (!fxOn() || reduceMotion) return; const el = document.createElement("div"); el.className = "flash"; document.body.appendChild(el); setTimeout(() => el.remove(), 750); }
function shakeScreen() { if (!fxOn() || reduceMotion) return; const a = $(".a-in"); if (!a) return; a.classList.remove("shakeall"); void a.offsetWidth; a.classList.add("shakeall"); }
let toastTimer = 0;
function toast(msg, top) {
  $$(".toast").forEach((t) => t.remove()); clearTimeout(toastTimer);
  const el = document.createElement("div"); el.className = "toast" + (top || !$("#arena").hidden ? " top" : ""); el.setAttribute("role", "status"); el.textContent = msg;
  document.body.appendChild(el); toastTimer = setTimeout(() => el.remove(), 3000);
}
function countUp(el, to, ms = 900) {
  if (!el) return;
  if (reduceMotion) { el.textContent = to.toLocaleString(); return; }
  const t0 = performance.now();
  const step = (t) => { const p = Math.min(1, (t - t0) / ms), e = 1 - Math.pow(1 - p, 3); el.textContent = Math.round(to * e).toLocaleString(); if (p < 1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
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
    const u = new SpeechSynthesisUtterance(String(text).replace(/\b[AB]\b/g, "something").replace(/[()]/g, ""));
    u.lang = "en-US"; u.rate = 0.92; if (enVoice) u.voice = enVoice;
    speechSynthesis.speak(u);
  } catch { /* ignore */ }
}
const speakBtn = (text) => (canSpeak ? `<button class="speak" data-speak="${esc(text)}" aria-label="発音を聞く">${ICON.speaker}</button>` : "");

/* ================= arena: round engine ================= */
let R = null; // 進行中のラウンド
const stageEl = () => $("#stage"), optsEl = () => $("#opts"), footEl = () => $("#afoot");
function clearTimers() { if (!R) return; clearTimeout(R.auto); clearTimeout(R.tmo); clearTimeout(R.hurry); clearTimeout(R.hurry2); }

function planRound(kind) {
  const now = Date.now();
  const learn = [], rev = [], fresh = [];
  for (const w of activeWords()) {
    const c = state.cards[w.id];
    if (!c) { fresh.push(w); continue; }
    if (kind === "night") { if (touchedToday(c, now)) rev.push(w); continue; }
    if (kind === "bounty") { if (isNemesis(c)) rev.push(w); continue; }
    if (!isDue(c, now)) continue;
    (c.st === 2 ? rev : learn).push(w);
  }
  const C = (w) => state.cards[w.id];
  learn.sort((a, b) => C(a).due - C(b).due);
  if (kind === "night" || kind === "bounty") shuffle(rev);
  else if (phase === "morning") rev.sort((a, b) => C(b).last - C(a).last); // 昨夜触った語から朝の再学習
  else rev.sort((a, b) => C(a).due - C(b).due || C(b).lapses - C(a).lapses);
  let newPick = [];
  if (kind === "main") {
    const prio = new Map(state.prio.map((id, i) => [id, i]));
    newPick = fresh.filter((w) => prio.has(w.id)).sort((a, b) => prio.get(a.id) - prio.get(b.id));
    const byDeck = DECK_ORDER.map((t) => fresh.filter((w) => w.tag === t && !prio.has(w.id))).filter((a) => a.length);
    const left = Math.max(0, S().newPerDay - peekToday().newc);
    let i = 0;
    while (newPick.length < left && byDeck.some((a) => a.length)) { const a = byDeck[i++ % byDeck.length]; if (a.length) newPick.push(a.shift()); }
    newPick = newPick.slice(0, left);
  }
  const avail = learn.length + rev.length + newPick.length;
  if (!avail) return null;
  const size = kind === "main" ? clamp(Math.round(+S().roundSize) || 25, 10, 60) : 12;
  const est = kind === "main" ? learn.length + rev.length + newPick.length * 2.2 : learn.length + rev.length;
  return { size, total: clamp(Math.ceil(est), Math.min(3, avail), size), learn: learn.map((w) => w.id), rev: rev.map((w) => w.id), fresh: newPick.map((w) => w.id) };
}
function newRoundState(kind, extra) {
  return { kind, qi: 0, pending: [], tries: {}, results: [], dots: [], combo: 0, maxCombo: 0, xp: 0, coins: 0, chests: 0, bonus: 0, opened: 0,
    perfect: 0, ok: 0, answered: 0, newGot: 0, slain: [], missions: [], achs: [], lv0: levelInfo(state.xp).L, best0: state.bestCombo || 0, q: null, done: false, ta: false, ...extra };
}
function startRound(kind = "main") {
  if (phase === "lock") { updateLock(); return; }
  if (phase === "wind") kind = "night";
  Sound.ensure();
  const plan = planRound(kind);
  if (!plan) {
    toast(kind === "night" ? "今日はまだ何も覚えていない。今夜は寝ろ。朝にやれ。" : kind === "bounty" ? "賞金首はいない。" : "今日の分は片付いた。タイムアタックで遊ぶか、新規の上限を上げろ。");
    return;
  }
  R = newRoundState(kind, plan);
  openArena();
  if (kind === "bounty") setTimeout(() => banner("賞金首狩り", `${plan.rev.length}体 ・ 賞金2倍`, "accent"), 100);
  next();
}
function openArena() {
  const a = $("#arena");
  a.hidden = false; a.dataset.tier = "";
  document.body.style.overflow = "hidden";
  $("#taClock").hidden = !R.ta; $("#dots").hidden = !!R.ta;
  $("#explain").hidden = true;
  stageEl().classList.remove("scroll");
  renderDots(); updateHud();
}
function closeArena() {
  if (R) {
    clearTimers(); clearInterval(R.clock);
    const left = R.chests + R.bonus - R.opened;
    if (left > 0) {
      let coin = 0, xp = 0;
      for (let i = 0; i < left; i++) { const l = rollLoot(R.opened + i >= R.chests); applyLoot(l); coin += l.coin; xp += l.xp; }
      setTimeout(() => toast(`未開封の宝箱を自動で開けた: +${coin}◆ +${xp}XP`), 300);
    }
  }
  R = null;
  $("#arena").hidden = true; $("#explain").hidden = true; document.body.style.overflow = "";
  try { speechSynthesis.cancel(); } catch { /* ignore */ }
  renderAll();
}
function quitArena() {
  if (!R) return;
  if (R.done) return closeArena();
  if (R.ta) return taFinish();
  if (R.answered > 0) finish(); else closeArena();
}

function pickNext() {
  R.pending.sort((a, b) => a.at - b.at);
  if (R.pending.length && R.pending[0].at <= R.qi) return R.pending.shift().id;
  if (R.learn.length) return R.learn.shift();
  // 85%ルール: 直近の正答率が高ければ新出語を増やし、低ければ復習で立て直す
  const recent = R.results.filter((x) => x !== "PASS").slice(-10);
  const acc = recent.length >= 4 ? recent.filter((x) => x === "OK").length / recent.length : 0.85;
  if (R.fresh.length && R.rev.length) {
    const pNew = acc >= 0.92 ? 0.6 : acc >= 0.8 ? 0.35 : acc >= 0.65 ? 0.15 : 0.05;
    return Math.random() < pNew ? R.fresh.shift() : R.rev.shift();
  }
  if (R.rev.length) return R.rev.shift();
  if (R.fresh.length) return R.fresh.shift();
  if (R.pending.length) return R.pending.shift().id;
  return null;
}
function requeue(id, g) {
  const n = (R.tries[id] = (R.tries[id] || 0) + 1);
  if (n >= 4) return; // 1ラウンドで4回落ちたら次のラウンドへ
  R.pending.push({ id, at: R.qi + (g === 1 ? 2 + randInt(0, 1) : 4 + randInt(0, 2)) });
}
function next() {
  if (!R) return;
  clearTimers();
  $("#explain").hidden = true;
  if (phase === "lock") { closeArena(); updateLock(); return; }
  if (R.ta) return taNext();
  if (R.qi >= R.total) return finish();
  let id = pickNext();
  if (id && id === R.lastId && (R.rev.length || R.fresh.length)) { const alt = R.rev.length ? R.rev.shift() : R.fresh.shift(); R.pending.push({ id, at: R.qi + 2 }); id = alt; }
  if (!id) return finish();
  const w = BYID.get(id);
  if (!w || !enabledTag(w.tag)) return next();
  R.lastId = id; R.qi++;
  ask(w);
}
const spellable = (w) => hasEx(w) && w.hit.length <= 24 && w.hit.trim().split(/\s+/).length <= 5 && /^[A-Za-z' -]+$/.test(w.hit);
function chooseType(w, c) {
  if (R.ta) return Math.random() < 0.72 ? "meaning" : "reverse";
  if (!c || R.kind === "night") return "meaning"; // 新しい語はまずクイズで（解説は解いた後）
  const ex = hasEx(w);
  if (c.st !== 2) { if (c.step === 0) return "meaning"; return w.tag === "poly" && ex && Math.random() < 0.6 ? "context" : Math.random() < 0.55 ? "reverse" : "meaning"; }
  const wt = { meaning: 50, context: ex ? 20 : 0, reverse: 18, spell: spellable(w) ? 12 : 0 };
  if (w.tag === "poly") wt.context += 15;
  if (w.tag === "write") { wt.spell += spellable(w) ? 25 : 0; wt.context = ex ? 8 : 0; }
  if (c.ivl >= 7) wt.spell += spellable(w) ? 8 : 0;
  if (R.lastType && wt[R.lastType]) wt[R.lastType] *= 0.6;
  let tot = 0; for (const k in wt) tot += wt[k];
  let x = Math.random() * tot;
  for (const k in wt) { x -= wt[k]; if (x < 0) return k; }
  return "meaning";
}
const spellLimit = (q) => (q.phrase ? 15000 : Math.max(12000, 6000 + q.tokens.length * 1000));
function limitFor(q) {
  if (R.ta || R.kind === "night") return 0;
  const mul = TIMER_MUL[S().timer] ?? 1;
  if (!mul) return 0;
  return (q.type === "spell" ? spellLimit(q) : BASE_T[q.type]) * mul;
}
const refLimit = (q) => (q.type === "spell" ? spellLimit(q) : BASE_T[q.type]) * (R.ta ? 0.75 : 1);
function buildQ(w, c, type) {
  const q = { w, c, type, isNew: !c, nem: isNemesis(c), done: false, mistakes: 0 };
  if (type === "spell") {
    const hit = w.hit.trim();
    q.phrase = /\s/.test(hit);
    if (q.phrase) {
      q.tokens = hit.split(/\s+/);
      const lower = new Set(q.tokens.map((t) => t.toLowerCase()));
      const pool = shuffle([...new Set(WORDS.filter((x) => x.tag === w.tag && x.id !== w.id && x.hit).flatMap((x) => x.hit.toLowerCase().split(/\s+/)))].filter((t) => !lower.has(t) && /^[a-z']+$/.test(t)));
      const decoys = (pool.length >= 2 ? pool : shuffle(["the", "to", "of", "in", "for", "with", "on", "by"].filter((t) => !lower.has(t)))).slice(0, 2);
      q.tiles = shuffle([...q.tokens, ...decoys].map((t) => ({ t })));
    } else {
      q.tokens = [...hit];
      const extra = clamp(Math.round(hit.length / 4), 2, 4);
      const letters = "aeioustnrlcdmphgbfywk".split("");
      const decoys = Array.from({ length: extra }, () => pick(letters));
      q.tiles = shuffle([...q.tokens.map((ch) => ch.toLowerCase()), ...decoys].map((t) => ({ t })));
    }
    q.pos = 0;
  } else {
    q.opts = shuffle([w, ...distractors(w, 3, type === "reverse")]);
  }
  q.limit = limitFor(q);
  return q;
}
function exHTML(w, how) {
  if (!hasEx(w)) return "";
  const i = w.ex.indexOf(w.hit);
  const a = esc(w.ex.slice(0, i)), b = esc(w.ex.slice(i + w.hit.length));
  if (how === "u") return `${a}<u>${esc(w.hit)}</u>${b}`;
  if (how === "blank") return `${a}<u>${"　".repeat(clamp(Math.ceil(w.hit.length / 2), 2, 8))}</u>${b}`;
  return `${a}<mark>${esc(w.hit)}</mark>${b}`;
}
function slotsHTML(q) {
  return q.tokens.map((t, i) => `<span class="${q.phrase ? "w " : ""}${i < q.pos ? "f" : i === q.pos ? "nx" : ""}">${i < q.pos ? esc(t) : q.phrase ? "　" : ""}</span>`).join("");
}
function ask(w) {
  const c = state.cards[w.id];
  const type = chooseType(w, c);
  const q = buildQ(w, c, type);
  R.q = q; R.lastType = type;
  const chip = q.isNew ? `<span class="chip new">NEW 初見</span>` : q.nem ? `<span class="chip nem">賞金首 +${BOUNTY * (R.kind === "bounty" ? 2 : 1)}XP</span>` : `<span class="chip">${TYPE_LABEL[type]}</span>`;
  let body = "";
  if (type === "meaning") body = `<div class="qword ${w.w.length > 13 ? "long" : ""}">${esc(w.w)}</div><div class="qsub">${w.pos ? `<span>${esc(w.pos)}</span>` : ""}${speakBtn(w.w)}</div>`;
  else if (type === "context") body = `<p class="qsent">${exHTML(w, "u")}</p><p class="qhint">下線部の意味は？（この文脈で）</p>`;
  else if (type === "reverse") body = `<div class="qja">${esc(optJa(w))}</div><div class="qsub">${w.pos ? `<span>${esc(w.pos)}</span>` : ""}<span>に当たる英語は？</span></div>`;
  else body = `<p class="qexja">${esc(w.exJa || optJa(w))}</p><p class="qsent">${exHTML(w, "blank")}</p><div class="slots" id="slots">${slotsHTML(q)}</div>`;
  const tmr = `<div class="timer ${q.limit ? "" : "off"}" id="timer" style="--t:${((q.limit || 8000) / 1000).toFixed(2)}s"><i></i></div>`;
  stageEl().classList.remove("scroll");
  stageEl().innerHTML = `<div class="qcard in" id="qcard" data-id="${esc(w.id)}" data-type="${type}"><div class="qmeta">${chip}<span class="chip deck" style="--dc:${deckColor(w.tag)}">${esc(DECKS[w.tag].name)}</span></div>${body}${tmr}</div>`;
  if (type === "spell") optsEl().innerHTML = `<div class="tiles">${q.tiles.map((t, i) => `<button class="tile ${q.phrase ? "w" : ""}" data-act="tile" data-i="${i}">${esc(t.t)}</button>`).join("")}</div>`;
  else optsEl().innerHTML = q.opts.map((o, i) => `<button class="opt ${type === "reverse" ? "en" : ""}" data-act="opt" data-i="${i}" data-id="${esc(o.id)}"><kbd>${i + 1}</kbd><span>${esc(type === "reverse" ? o.w : optJa(o))}</span></button>`).join("");
  footEl().innerHTML = R.ta ? "" : `<button class="passbtn" data-act="pass">わからん <small>（コンボは切れない）</small><kbd class="kh">0</kbd></button>`;
  renderDots(); updateHud();
  if (S().tts && type === "meaning" && !isNight()) speak(w.w);
  q.t0 = performance.now();
  if (q.limit) {
    R.tmo = setTimeout(() => resolve(false, { timeout: true }), q.limit);
    R.hurry = setTimeout(() => { if (!q.done) Sound.tick(); }, q.limit * 0.8);
    R.hurry2 = setTimeout(() => { if (!q.done) Sound.tick(); }, q.limit * 0.9);
  }
}
function onOpt(i) {
  const q = R?.q; if (!q || q.done || !q.opts) return;
  const chosen = q.opts[i]; if (!chosen) return;
  resolve(chosen.id === q.w.id, { idx: i, chosen });
}
function onTile(i) {
  const q = R?.q; if (!q || q.done || q.type !== "spell") return;
  const tile = q.tiles[i]; if (!tile || tile.used) return;
  const need = q.tokens[q.pos];
  const btn = $(`.tile[data-i="${i}"]`, optsEl());
  if (tile.t.toLowerCase() === need.toLowerCase()) {
    tile.used = true; btn?.classList.add("used"); q.pos++;
    $("#slots").innerHTML = slotsHTML(q);
    Sound.tap(q.pos);
    if (q.pos >= q.tokens.length) resolve(true, { mistakes: q.mistakes });
  } else spellMiss(btn);
}
function spellMiss(btn) {
  const q = R.q;
  q.mistakes++;
  if (btn) { btn.classList.remove("ng"); void btn.offsetWidth; btn.classList.add("ng"); }
  Sound.wrong(true); vibrate(20);
  if (q.mistakes >= 2) resolve(false, { spellFail: true });
}

function judge(q, ok, info, ms) {
  if (!ok) return info.pass ? "PASS" : info.timeout ? "TIME" : "MISS";
  if (info.mistakes) return "GOOD";
  const L = q.limit || refLimit(q);
  return ms <= L * 0.25 ? "PERFECT" : ms <= L * 0.5 ? "GREAT" : "GOOD";
}
function resolve(ok, info = {}) {
  const q = R?.q; if (!q || q.done) return;
  q.done = true; q.ok = ok; clearTimeout(R.tmo); clearTimeout(R.hurry); clearTimeout(R.hurry2);
  $("#timer")?.classList.add("stop");
  const ms = performance.now() - q.t0;
  const j = judge(q, ok, info, ms);
  const now = Date.now(), w = q.w;
  const prev = state.cards[w.id];
  const wasNem = isNemesis(prev);
  const t = today();
  let c = prev;
  if (!R.ta) {
    // 自己採点はしない。正誤と速さからスケジューラの評価を決める
    const g = !ok ? 1 : j === "PERFECT" ? (prev && prev.st === 2 && prev.ok >= 1 ? 4 : 3) : j === "GREAT" ? 3 : prev && prev.st === 2 ? 2 : 3;
    c = grade(prev || newCard(now), g, now);
    if (!prev) { t.newc++; R.newGot++; }
    state.cards[w.id] = c;
    if (c.st !== 2) requeue(w.id, g);
    t.reps++; if (ok) t.ok++; t.ms += Math.min(ms, 60000);
  } else if (!ok && prev && prev.st === 2) prev.due = Math.min(prev.due, now); // 間違えた語は通常ラウンドの復習へ回す
  const tb = tierOf(R.combo);
  if (ok) R.combo++; else if (!info.pass) R.combo = 0;
  const tn = tierOf(R.combo);
  R.maxCombo = Math.max(R.maxCombo, R.combo);
  t.maxCombo = Math.max(t.maxCombo, R.combo);
  state.bestCombo = Math.max(state.bestCombo || 0, R.combo);
  R.answered++; if (ok) R.ok++;
  if (j === "PERFECT") { R.perfect++; t.perfect++; state.totals.perfect++; }
  state.totals.answers++; if (ok) state.totals.correct++;
  if (ok && q.type === "spell") t.spellOk++;
  if (ok && q.type === "context") t.ctxOk++;
  if (ok && q.type === "reverse") t.revOk++;
  R.results.push(ok ? "OK" : info.pass ? "PASS" : "NG");
  R.dots.push(ok ? (j === "PERFECT" ? "p" : "g") : info.pass ? "s" : "m");

  const night = isNight();
  let gain = 0, coin = 0, luck = null;
  const ev = [];
  if (ok) {
    const base = R.ta ? 4 + (j === "PERFECT" ? 2 : 0) : { PERFECT: 14, GREAT: 10, GOOD: 6 }[j] + ({ context: 2, reverse: 2, spell: 6 }[q.type] || 0) + (q.isNew ? 4 : 0);
    let mul = 1;
    if (!night) {
      mul *= tn.mul;
      if (phase === "morning") mul *= 1.5;
      const r = Math.random();
      if (r < 0.02) luck = "jackpot"; else if (r < 0.12) luck = "crit";
      if (luck === "jackpot") { mul *= 5; state.totals.jackpots++; } else if (luck === "crit") mul *= 2;
    }
    gain = Math.round(base * mul);
    coin = night ? 1 : 1 + tn.i + (j === "PERFECT" ? 1 : 0);
    if (luck === "jackpot") coin *= 3;
    if (wasNem && !R.ta) {
      gain += BOUNTY * (R.kind === "bounty" ? 2 : 1); coin += 10; t.bounty++; ev.push("bounty");
      if (c && c.st === 2 && c.ivl >= 7 && !c.slain) { c.slain = true; gain += SLAY; coin += 50; ev.push("slay"); R.slain.push(w.w); state.totals.slain++; }
    }
    if (!night && !R.ta && (Math.random() < 0.03 + tn.i * 0.015 || R.combo % 20 === 0)) { R.chests++; ev.push("chest"); }
  }
  const lv0 = levelInfo(state.xp).L;
  addXP(gain); state.coins += coin; R.xp += gain; R.coins += coin;
  if (!R.ta && !t.goal && t.reps >= S().goal) { t.goal = true; t.goalHit = 1; bumpStreak(); ev.push("goal"); }
  const missions = checkMissions(t);
  R.missions.push(...missions);
  const lv1 = levelInfo(state.xp).L;
  Store.save();
  feedback(q, ok, j, info, gain, coin, luck, ev, tb, tn, lv1 > lv0 ? lv1 : 0, missions);

  if (R.ta) {
    if (!ok) { R.end -= 3000; const c2 = centerOf($("#taClock")); floatText("-3s", c2.x, c2.y + 24, "m"); }
    else R.score++;
    updateHud();
    R.auto = setTimeout(next, ok ? 230 : 650);
  } else if (!ok) showExplain(q, j, info, false);
  else if (q.isNew) showExplain(q, j, info, true);
  else R.auto = setTimeout(next, j === "PERFECT" ? 430 : 560);
}

function feedback(q, ok, j, info, gain, coin, luck, ev, tb, tn, newLv, missions) {
  if (q.opts) {
    $$(".opt", optsEl()).forEach((b, i) => {
      b.disabled = true;
      const o = q.opts[i];
      if (o.id === q.w.id) b.classList.add(ok ? "ok" : "reveal");
      else if (info.idx === i) b.classList.add("ng");
      else b.classList.add("dim");
    });
  } else if (q.type === "spell") {
    q.pos = q.tokens.length; $("#slots").innerHTML = slotsHTML(q);
    $$(".tile", optsEl()).forEach((b) => (b.disabled = true));
  }
  footEl().innerHTML = "";
  const STAMP = { PERFECT: ["PERFECT", "p"], GREAT: ["GREAT", "g"], GOOD: ["GOOD", "o"], MISS: ["MISS", "m"], TIME: ["TIME UP", "m"] };
  if (fxOn() && STAMP[j]) {
    const el = document.createElement("div");
    const fresh = q.isNew && ok;
    el.className = "stamp " + (fresh ? "n" : STAMP[j][1]); el.textContent = fresh ? "NEW!" : STAMP[j][0];
    stageEl().appendChild(el); setTimeout(() => el.remove(), 800);
  }
  const btn = info.idx != null ? $$(".opt", optsEl())[info.idx] : $("#qcard");
  const o = centerOf(btn);
  if (ok) {
    floatText(`+${gain}`, o.x - 20, o.y - 18);
    floatText(`+${coin}◆`, o.x + 34, o.y - 6, "c");
    FX.burst(o.x, o.y, (j === "PERFECT" ? 26 : 14) + Math.min(R.combo, 24), luck ? 1.6 : 1);
    Sound.correct(R.combo, j);
    vibrate(j === "PERFECT" ? [8, 30, 8] : 10);
    if (luck === "jackpot") { banner("JACKPOT", "XP ×5 ・ ◆×3"); flash(); Sound.jackpot(); const m = centerOf($("#qcard")); FX.burst(m.x, m.y, 120, 2); }
    else if (luck === "crit") { banner("CRITICAL", "XP ×2", "accent"); Sound.crit(); flash(); }
    if (tn.i > tb.i) { banner(tn.label, tn.sub); Sound.tierUp(tn.i); shakeScreen(); FX.confetti(); }
    else if (COMBO_LINES[R.combo]) { banner(...COMBO_LINES[R.combo]); Sound.crit(); }
  } else if (!info.pass) {
    const card = $("#qcard"); if (card) { card.classList.remove("shake"); void card.offsetWidth; card.classList.add("shake"); }
    Sound.wrong(); vibrate(35);
    if (tb.i >= 2 && fxOn()) toast("コンボが途切れた。次で取り返せ。", true);
  }
  if (ev.includes("bounty")) { banner(ev.includes("slay") ? "賞金首 撃破" : "賞金首 命中", `+${ev.includes("slay") ? BOUNTY + SLAY : BOUNTY} XP`, "accent"); Sound.crit(); }
  if (ev.includes("chest")) { const box = $("#hudBox"); setTimeout(() => { Sound.chest(); if (box) { box.classList.remove("bump"); void box.offsetWidth; box.classList.add("bump"); } floatText("宝箱 GET", o.x, o.y - 40); }, 180); }
  if (ev.includes("goal")) { banner("ノルマ達成", `連続 ${state.streak.count}日`); Sound.fanfare(); FX.confetti(); }
  for (const m of missions) { banner("MISSION CLEAR", `${m.text} +${m.coin}◆`); Sound.coin(); }
  if (missions.allClear) banner("ALL CLEAR", "SR確定の宝箱");
  if (newLv) { banner(`LEVEL ${newLv}`, rankOf(newLv)); Sound.fanfare(); FX.confetti(); }
  updateHud(); renderDots();
}

function showExplain(q, j, info, auto) {
  const w = q.w, ex = $("#explain");
  const verdict = q.ok ? ["NEW WORD GET!", "new"] : info.pass ? ["わからん → ここで覚えろ", "new"] : j === "TIME" ? ["TIME UP", "ng"] : info.spellFail ? ["スペルミス", "ng"] : ["MISS", "ng"];
  const chosen = info.chosen && info.chosen.id !== w.id ? info.chosen : null;
  const yours = !chosen ? "" : q.type === "reverse"
    ? `<p class="yours">選んだ <s>${esc(chosen.w)}</s> の意味は「${esc(optJa(chosen))}」</p>`
    : `<p class="yours">選んだ「<s>${esc(optJa(chosen))}</s>」は <b>${esc(chosen.w)}</b> の意味</p>`;
  ex.innerHTML = `<div class="in">
    <div class="xhead"><span class="xv ${verdict[1]}">${verdict[0]}</span>${q.isNew ? '<span class="chip new">図鑑に登録</span>' : ""}</div>
    <div class="xword"><div><b>${esc(w.w)}</b> <span>${esc(w.pos)}</span></div>${speakBtn(w.w)}</div>
    ${w.pat ? `<span class="pat">${esc(w.pat)}</span>` : ""}
    <div class="xja">${esc(w.ja)}</div>
    ${w.more ? `<div class="xmore">${esc(w.more)}</div>` : ""}
    ${yours}
    ${hasEx(w) ? `<p class="ex">${exHTML(w, "mark")}</p>${w.exJa ? `<p class="exja">${esc(w.exJa)}</p>` : ""}` : ""}
    ${w.note ? `<p class="note"><b>京大ポイント</b>${esc(w.note)}</p>` : ""}
    ${auto ? `<div class="autobar" id="autobar" style="--t:${AUTO_MS / 1000}s"><i></i></div>` : ""}
    <button class="btn primary" data-act="next">${auto ? "次へ" : "覚えた、次へ"} <kbd>Space</kbd></button>
  </div>`;
  ex.hidden = false; ex.scrollTop = 0;
  if (auto) R.auto = setTimeout(next, AUTO_MS);
  if (S().tts && !isNight()) speak(w.w);
}

function renderDots() {
  if (!R || R.ta) return;
  const d = $("#dots");
  d.innerHTML = Array.from({ length: R.total }, (_, i) => `<i class="${R.dots[i] || (i === R.qi - 1 && R.q && !R.q.done ? "cur" : "")}"></i>`).join("");
}
function updateHud() {
  if (!R) return;
  const a = $("#arena");
  const tier = tierOf(R.combo);
  a.dataset.tier = isNight() ? "" : tier.id;
  const num = $("#comboNum"), prev = +num.textContent;
  num.textContent = R.combo;
  if (R.combo > prev && fxOn()) { const c = $("#combo"); c.classList.remove("bump"); void c.offsetWidth; c.classList.add("bump"); }
  $("#tierPill").textContent = isNight() ? "夜モード" : tier.i ? `${tier.short} ×${tier.mul}` : phase === "morning" ? "朝 ×1.5" : "×1.0";
  $("#hudXp").textContent = `+${R.xp.toLocaleString()} XP`;
  $("#hudCoin").textContent = R.coins.toLocaleString();
  const boxes = R.chests + R.bonus;
  $("#hudBox").hidden = !boxes; $("#hudBox").textContent = `宝箱 ×${boxes}`;
  $("#aCount").textContent = R.ta ? `SCORE ${R.score}` : `${Math.min(R.qi, R.total)}/${R.total}`;
}

/* ================= results ================= */
function gradeOf(r) {
  if (!r.answered) return "D";
  const acc = r.ok / r.answered, pr = r.perfect / r.answered;
  if (acc >= 0.95 && pr >= 0.4) return "S";
  if (acc >= 0.85) return "A";
  if (acc >= 0.7) return "B";
  if (acc >= 0.5) return "C";
  return "D";
}
function finish() {
  if (!R || R.done) return;
  clearTimers();
  R.done = true; R.q = null;
  $("#explain").hidden = true;
  const t = today();
  t.rounds++; state.totals.rounds++;
  const acc = R.answered ? R.ok / R.answered : 0;
  if (R.answered >= 10 && acc >= 0.9) t.acc90 = 1;
  const g = gradeOf(R);
  if (g === "S" && R.kind !== "night") state.totals.sRanks++;
  R.missions.push(...checkMissions(t));
  R.achs = checkAch();
  Store.save();
  renderResult(g);
}
function missionRows(ms, t) {
  return ms.map((m) => {
    const v = Math.min(mval(m, t), m.goal), done = (t.mdone || []).includes(m.id);
    return `<div class="mission ${done ? "done" : ""}"><span class="ck">${done ? ICON.check : ""}</span><p>${esc(m.text)}</p><span class="coin rw">${m.coin}</span><div class="mbar"><i style="width:${((v / m.goal) * 100).toFixed(0)}%"></i></div></div>`;
  }).join("");
}
function renderResult(g) {
  const r = R, night = r.kind === "night";
  const acc = r.answered ? Math.round((r.ok / r.answered) * 100) : 0;
  const lvNow = levelInfo(state.xp).L;
  const recs = [];
  if (r.maxCombo > r.best0 && r.maxCombo >= 5) recs.push(`最大コンボ更新 ${r.maxCombo}`);
  if (lvNow > r.lv0) recs.push(`LEVEL ${lvNow}`);
  if (r.slain.length) recs.push(`賞金首撃破 ×${r.slain.length}`);
  const p = pace();
  const boxes = r.chests + r.bonus;
  stageEl().classList.add("scroll");
  stageEl().innerHTML = `<div class="result">
    <div class="rhead">${night ? "" : `<div class="grade ${g}">${g}</div>`}<div><span class="eyebrow">${night ? "おやすみ前" : "ROUND CLEAR"}</span><h2>${night ? "おつかれ。もう寝ろ。" : esc(g === "S" ? "完璧。ゾーンの住人だ。" : pick(CLEAR_LINES))}</h2></div></div>
    ${recs.length ? `<div class="records">${recs.map((x) => `<span>${esc(x)}</span>`).join("")}</div>` : ""}
    <div class="rgrid">
      <div class="rbox hl"><b class="num" data-count="${r.xp}">0</b><span>獲得XP</span></div>
      <div class="rbox"><b class="coin" data-count="${r.coins}">0</b><span>獲得◆</span></div>
      <div class="rbox"><b>${acc}%</b><span>正答率 ${r.ok}/${r.answered}</span></div>
      <div class="rbox"><b>${r.maxCombo}</b><span>最大コンボ</span></div>
      <div class="rbox"><b>${r.perfect}</b><span>PERFECT</span></div>
      <div class="rbox"><b>${r.newGot}</b><span>新しく出会った語</span></div>
    </div>
    ${boxes ? `<div class="stack"><span class="eyebrow">宝箱 ×${boxes} — タップで開けろ</span><div class="chests">${Array.from({ length: boxes }, (_, i) => `<button class="chest ${i >= r.chests ? "bonus" : ""}" data-act="chest" aria-label="宝箱を開ける">${ICON.chest}</button>`).join("")}</div><div class="stack" id="lootSlot"></div></div>` : ""}
    ${r.achs.length ? `<div class="stack"><span class="eyebrow">実績解除</span>${r.achs.map((a) => `<div class="ach"><i>${esc(a.g)}</i><div><b>${esc(a.name)}</b><span>${esc(a.desc)} ・ +${a.coin}◆</span></div></div>`).join("")}</div>` : ""}
    <div class="panel missions"><span class="eyebrow">今日のミッション</span>${missionRows(todaysMissions(), today())}</div>
    ${night ? `<div class="alert calm"><b>寝ろ</b>今日の単語は眠っている間に固まる。画面を閉じろ。ロックを破らなければ朝に快眠ボーナス。</div>`
      : p.need > S().newPerDay ? `<div class="alert warn"><b>ペース不足</b>未習${p.unseen}語を試験2週間前までに終えるには1日${p.need}語。設定で新規を上げろ。</div>` : ""}
  </div>`;
  optsEl().innerHTML = night
    ? `<button class="btn primary" data-act="home">閉じて寝る</button>`
    : `<div class="subacts"><button class="btn" data-act="home">ホーム</button><button class="btn primary" data-act="again">もう1ラウンド <kbd>Enter</kbd></button></div>`;
  footEl().innerHTML = "";
  $("#arena").dataset.tier = "";
  $("#dots").innerHTML = r.dots.map((d) => `<i class="${d}"></i>`).join("");
  $("#aCount").textContent = `${r.answered}問`;
  $$("[data-count]", stageEl()).forEach((el) => countUp(el, +el.dataset.count));
  if (!night && r.answered) {
    setTimeout(() => { Sound.fanfare(); FX.confetti(); if (g === "S") { flash(); Sound.jackpot(); } }, 350);
    if (lvNow > r.lv0) setTimeout(() => { if (R === r) levelCeremony(lvNow, r.lv0); }, 1300);
  }
  if (r.achs.length) setTimeout(() => toast(`実績解除: ${r.achs.map((a) => a.name).join("・")}`), 2600);
}
const CHEST_LOOT = { N: [15, 30, 25], R: [40, 70, 50], SR: [90, 150, 100], SSR: [200, 350, 200], UR: [600, 600, 500] };
function rollLoot(minSR) {
  const r = minSR ? Math.random() * 0.2 : Math.random();
  const rar = r < 0.01 ? "UR" : r < 0.06 ? "SSR" : r < 0.2 ? "SR" : r < 0.5 ? "R" : "N";
  const [a, b, xp] = CHEST_LOOT[rar];
  return { rar, coin: randInt(a, b), xp, shield: rar === "UR" ? 2 : rar === "SSR" ? 1 : 0, tip: pick(TIPS) };
}
function applyLoot(l) {
  state.coins += l.coin; addXP(l.xp); state.streak.shields += l.shield;
  if (R) { R.coins += l.coin; R.xp += l.xp; }
  Store.save();
}
function openChest(btn) {
  if (!R || btn.classList.contains("opened") || btn.disabled) return;
  const bonus = btn.classList.contains("bonus");
  btn.disabled = true; btn.classList.add("opened");
  const l = rollLoot(bonus); R.opened++;
  const lv0 = levelInfo(state.xp).L;
  applyLoot(l);
  const o = centerOf(btn);
  FX.burst(o.x, o.y, 30 + RAR.indexOf(l.rar) * 25, 1 + RAR.indexOf(l.rar) * 0.3);
  Sound.reveal(l.rar);
  if (RAR.indexOf(l.rar) >= 3) { flash(); banner(l.rar, `+${l.coin}◆`); }
  $("#lootSlot").insertAdjacentHTML("afterbegin", `<div class="loot" style="--rc:${RC[l.rar]}"><span class="rar">${l.rar}</span><div><b><span class="coin">${l.coin}</span> ・ +${l.xp} XP${l.shield ? ` ・ シールド+${l.shield}` : ""}</b><p>${esc(l.tip)}</p></div></div>`);
  updateHud();
  const lv1 = levelInfo(state.xp).L;
  if (lv1 > lv0) setTimeout(() => levelCeremony(lv1, lv0), 600);
}
function levelCeremony(L, oldL) {
  if (isNight()) return;
  const promoted = rankOf(L) !== rankOf(oldL);
  const ov = $("#overlay");
  ov.innerHTML = `<div class="rays" style="--rc:#FFC23D"></div><div class="ovc" style="--rc:#FFC23D"><h2>LEVEL UP!</h2><div class="emblem lg"><small>Lv</small>${L}</div><p>${promoted ? `称号昇格「${esc(rankOf(L))}」` : esc(rankOf(L))}</p><p class="tap">タップで閉じる</p></div>`;
  ov.hidden = false; delete ov.dataset.lock;
  Sound.fanfare(); FX.confetti(true); FX.burst(innerWidth / 2, innerHeight / 2, 80, 1.8, true);
}

/* ================= time attack ================= */
function startTA() {
  if (isNight()) { toast("夜はタイムアタック禁止。寝ろ。"); return; }
  const seen = activeWords().filter((w) => state.cards[w.id]);
  if (seen.length < 12) { toast(`タイムアタックは学習済み12語から。あと${12 - seen.length}語、通常ラウンドで出会え。`); return; }
  Sound.ensure();
  // 忘れた回数が多い語ほど多めに出す
  const pool = shuffle(seen.slice()).sort((a, b) => state.cards[b.id].lapses - state.cards[a.id].lapses);
  R = newRoundState("ta", { ta: true, pool: shuffle(pool.slice(0, Math.max(30, Math.ceil(pool.length * 0.6)))).map((w) => w.id), score: 0, end: 0, total: 0 });
  openArena();
  stageEl().innerHTML = `<div class="qcard in" style="align-items:center;padding:30px 18px"><span class="eyebrow">60秒タイムアタック</span><div class="qword">READY</div><p class="qhint">正解+1点 ・ ミス -3秒 ・ BEST ${state.taBest || 0}</p></div>`;
  optsEl().innerHTML = ""; footEl().innerHTML = "";
  $("#taClock").textContent = "60.0"; $("#taClock").classList.remove("low");
  Sound.drum();
  const r = R;
  setTimeout(() => { if (R !== r || r.done) return; banner("GO!", ""); Sound.fanfare(); r.end = performance.now() + 60000; r.clock = setInterval(taClock, 100); next(); }, 1300);
}
function taClock() {
  if (!R || !R.ta || R.done) return;
  const left = Math.max(0, R.end - performance.now());
  const el = $("#taClock");
  el.textContent = (left / 1000).toFixed(1);
  el.classList.toggle("low", left < 10000);
  const sec = Math.ceil(left / 1000);
  if (left < 10000 && sec !== R.lastSec) { R.lastSec = sec; Sound.tick(); }
  if (left <= 0) taFinish();
}
function taNext() {
  if (!R.end) return;
  if (performance.now() >= R.end) return taFinish();
  const id = R.pool[R.qi % R.pool.length]; R.qi++;
  const w = BYID.get(id); if (!w) return taNext();
  ask(w);
}
function taFinish() {
  if (!R || !R.ta || R.done) return;
  clearTimers(); clearInterval(R.clock);
  R.done = true; R.q = null;
  const t = today();
  const best = R.score > (state.taBest || 0);
  state.taBest = Math.max(state.taBest || 0, R.score);
  t.taBest = Math.max(t.taBest, R.score);
  R.missions.push(...checkMissions(t));
  R.achs = checkAch();
  Store.save();
  $("#taClock").textContent = "0.0";
  stageEl().classList.add("scroll");
  stageEl().innerHTML = `<div class="result">
    <div class="rhead"><div class="grade ${R.score >= 30 ? "S" : R.score >= 20 ? "A" : R.score >= 12 ? "B" : "C"}">${R.score}</div><div><span class="eyebrow">TIME UP</span><h2>${best ? "自己ベスト更新！" : `BEST ${state.taBest}`}</h2></div></div>
    ${best ? `<div class="records"><span>NEW RECORD ${R.score}</span></div>` : ""}
    <div class="rgrid">
      <div class="rbox hl"><b class="num" data-count="${R.xp}">0</b><span>獲得XP</span></div>
      <div class="rbox"><b class="coin" data-count="${R.coins}">0</b><span>獲得◆</span></div>
      <div class="rbox"><b>${R.answered ? Math.round((R.ok / R.answered) * 100) : 0}%</b><span>正答率</span></div>
    </div>
    ${R.achs.length ? `<div class="stack"><span class="eyebrow">実績解除</span>${R.achs.map((a) => `<div class="ach"><i>${esc(a.g)}</i><div><b>${esc(a.name)}</b><span>${esc(a.desc)} ・ +${a.coin}◆</span></div></div>`).join("")}</div>` : ""}
    <p class="small muted">間違えた語は通常ラウンドの復習に回した。</p>
  </div>`;
  optsEl().innerHTML = `<div class="subacts"><button class="btn" data-act="home">ホーム</button><button class="btn primary" data-act="taAgain">もう一回 <kbd>Enter</kbd></button></div>`;
  footEl().innerHTML = "";
  $("#arena").dataset.tier = "";
  $$("[data-count]", stageEl()).forEach((el) => countUp(el, +el.dataset.count));
  const sc = R.score;
  setTimeout(() => { Sound.fanfare(); FX.confetti(); if (best) { flash(); banner("NEW RECORD", `${sc}点`); } }, 300);
  if (R.achs.length) setTimeout(() => toast(`実績解除: ${R.achs.map((a) => a.name).join("・")}`), 1800);
}

/* ================= gacha ================= */
function rollItem(minSR) {
  const r = minSR ? Math.random() * 0.18 : Math.random();
  const rar = r < 0.005 ? "UR" : r < 0.05 ? "SSR" : r < 0.18 ? "SR" : r < 0.5 ? "R" : "N";
  return pick(CATALOG.filter((x) => x.rar === rar));
}
function pull(n) {
  if (isNight()) { toast("ガチャは夜は閉店。寝ろ。"); return; }
  const cost = n === 10 ? 900 : 100;
  if (state.coins < cost) { toast(`◆が足りない。あと${cost - state.coins}◆。答えて稼げ。`); return; }
  Sound.ensure();
  state.coins -= cost;
  const res = [];
  for (let i = 0; i < n; i++) {
    const needSR = n === 10 && i === 9 && !res.some((x) => RAR.indexOf(x.item.rar) >= 2);
    const item = rollItem(needSR);
    const dup = !!state.inv[item.id];
    state.inv[item.id] = (state.inv[item.id] || 0) + 1;
    if (dup) state.coins += REFUND[item.rar];
    if (item.rar === "UR") state.totals.ur++;
    res.push({ item, dup });
  }
  state.totals.pulls += n;
  const achs = checkAch();
  Store.save();
  showGacha(res, achs);
}
function showGacha(res, achs) {
  const best = res.reduce((m, x) => (RAR.indexOf(x.item.rar) > RAR.indexOf(m.item.rar) ? x : m), res[0]);
  const rc = RC[best.item.rar];
  const ov = $("#overlay");
  ov.dataset.lock = "1";
  ov.innerHTML = `<div class="ovc"><div class="gorb" style="--rc:${RAR.indexOf(best.item.rar) >= 2 ? rc : "var(--r-n)"}"></div><p>${res.length === 10 ? "10連" : "1回"}…</p></div>`;
  ov.hidden = false;
  Sound.drum();
  setTimeout(() => {
    Sound.reveal(best.item.rar);
    const k = RAR.indexOf(best.item.rar);
    if (k >= 2) { flash(); FX.burst(innerWidth / 2, innerHeight / 2, 60 + k * 30, 1.5 + k * 0.3, true); }
    const sub = (x) => `${TYPE_NAME[x.item.type]}${x.dup ? ` ・ かぶり +${REFUND[x.item.rar]}◆` : " ・ NEW!"}`;
    if (res.length === 1) {
      ov.innerHTML = `<div class="rays" style="--rc:${rc}"></div><div class="ovc" style="--rc:${rc}"><div class="gcard" style="--rc:${rc}"><span class="r">${best.item.rar}</span><b>${esc(best.item.name)}</b><span>${esc(sub(best))}</span>${best.item.desc ? `<span>${esc(best.item.desc)}</span>` : ""}</div><p class="tap">タップで閉じる</p></div>`;
    } else {
      ov.innerHTML = `<div class="rays" style="--rc:${rc}"></div><div class="ovc" style="--rc:${rc}"><h2>${best.item.rar}</h2><div class="ggrid">${res.map((x, i) => `<div class="gmini" style="--rc:${RC[x.item.rar]};animation-delay:${i * 0.09}s"><b>${x.item.rar}</b>${esc(x.item.name)}${x.dup ? "" : "<br>NEW"}</div>`).join("")}</div><p class="tap">タップで閉じる</p></div>`;
    }
    delete ov.dataset.lock;
    if (achs.length) toast(`実績解除: ${achs.map((a) => a.name).join("・")} +${achs.reduce((n, a) => n + a.coin, 0)}◆`);
    renderHeader(); if (currentView === "gacha") renderGacha();
  }, 1150);
}
function equip(id) {
  const it = ITEM.get(id); if (!it || !state.inv[id]) return;
  if (it.type === "title") state.equip.title = state.equip.title === id ? "" : id;
  else state.equip[it.type] = id;
  Store.save(); applyLook();
  if (it.type === "sfx") { Sound.ensure(); Sound.correct(6, "PERFECT", true); }
  if (it.type === "fx") { const o = centerOf($(`[data-id="${id}"]`)); FX.burst(o.x, o.y, 40, 1.2, true); }
  renderGacha(); renderHeader();
}
function renderGacha() {
  const v = $("#view-gacha");
  const owned = CATALOG.filter((x) => state.inv[x.id]).length;
  const night = isNight();
  const group = (type) => {
    const items = [...DEFAULT_ITEMS.filter((x) => x.type === type), ...CATALOG.filter((x) => x.type === type)];
    return `<div class="stack"><span class="eyebrow">${TYPE_NAME[type]}</span><div class="inv">${items.map((x) => {
      const have = !!state.inv[x.id];
      const on = type === "title" ? state.equip.title === x.id : state.equip[type] === x.id;
      const lead = x.sw && have ? `<span class="swatch" style="background:${x.sw}"></span>` : `<span class="rar">${x.rar}</span>`;
      const info = have ? `<b>${esc(x.name)}</b><small>${esc(x.desc || x.rar)}${state.inv[x.id] > 1 ? ` ・ ×${state.inv[x.id]}` : ""}</small>` : `<b>？？？</b><small>${x.rar}</small>`;
      const act = !have ? "" : on ? (type === "title" ? `<button class="btn small" data-act="equip" data-id="${x.id}">外す</button>` : `<span class="eq">装備中</span>`) : `<button class="btn small" data-act="equip" data-id="${x.id}">装備</button>`;
      return `<div class="item ${have ? "" : "lock"}" style="--rc:${RC[x.rar]}">${lead}<div>${info}</div>${act}</div>`;
    }).join("")}</div></div>`;
  };
  v.innerHTML = `
  <div class="ghero">
    <div class="gorb" aria-hidden="true"></div>
    <h2>ドーパ・カプセル</h2>
    <span class="coin">${state.coins.toLocaleString()}</span>
    ${night ? `<p>ガチャは夜は閉店。寝ろ。朝になったら回せ。</p>` : `<div class="pullrow"><button class="pull" data-act="pull1" ${state.coins < 100 ? "disabled" : ""}><b>1回</b><span>◆100</span></button><button class="pull ten" data-act="pull10" ${state.coins < 900 ? "disabled" : ""}><b>10連</b><span>◆900 ・ SR以上1枠確定</span></button></div>`}
    <p>中身は見た目だけ（称号・正解エフェクト・効果音・テーマ色）。◆は答えるほど貯まる。</p>
  </div>
  <div class="rates"><span>提供割合</span><span style="color:var(--r-n)">N 50%</span><span style="color:var(--r-r)">R 32%</span><span style="color:var(--r-sr)">SR 13%</span><span style="color:var(--r-ssr)">SSR 4.5%</span><span style="color:var(--r-ur)">UR 0.5%</span><span>かぶりは◆に還元</span></div>
  <div class="section-h"><h2>コレクション</h2><span class="small muted num">${owned}/${CATALOG.length}</span></div>
  ${group("title")}${group("fx")}${group("sfx")}${group("skin")}`;
}

/* ================= views ================= */
const VIEWS = ["home", "zukan", "gacha", "kiroku", "config"];
let currentView = "home";
function showView(v) {
  if (!VIEWS.includes(v)) v = "home";
  currentView = v;
  for (const name of VIEWS) $("#view-" + name).hidden = name !== v;
  $$(".tab").forEach((t) => (t.dataset.view === v ? t.setAttribute("aria-current", "page") : t.removeAttribute("aria-current")));
  renderView(); scrollTo(0, 0);
}
function renderView() {
  if (currentView === "home") renderHome();
  else if (currentView === "zukan") renderZukan();
  else if (currentView === "gacha") renderGacha();
  else if (currentView === "kiroku") renderLog();
  else if (currentView === "config") renderSettings();
}
function renderAll() { applyLook(); renderHeader(); renderView(); updateLock(); }
function renderHeader() {
  const li = levelInfo(state.xp);
  $("#lvChip").textContent = "Lv." + li.L;
  $("#xpFill").style.width = ((li.into / li.need) * 100).toFixed(1) + "%";
  $("#xpBar").setAttribute("aria-valuenow", String(Math.round((li.into / li.need) * 100)));
  $("#coinTop").textContent = state.coins.toLocaleString();
  const st = liveStreak(), goal = peekToday().goal;
  $("#streakNum").textContent = st;
  $("#streak").classList.toggle("cold", !goal);
  $("#streak").classList.toggle("hot", st >= 3 && goal);
  const pulls = isNight() ? 0 : Math.floor(state.coins / 100);
  const badge = $("#gachaBadge"); badge.hidden = !pulls; badge.textContent = pulls > 9 ? "9+" : String(pulls);
}
function ring(v, goal) {
  const Rr = 26, L = 2 * Math.PI * Rr, p = clamp(v / Math.max(1, goal), 0, 1);
  return `<div class="ring" aria-label="今日のノルマ ${v}/${goal}"><svg viewBox="0 0 62 62"><circle class="bgc" cx="31" cy="31" r="${Rr}"/><circle class="fgc" cx="31" cy="31" r="${Rr}" stroke-dasharray="${L.toFixed(1)}" stroke-dashoffset="${(L * (1 - p)).toFixed(1)}"/></svg><div><b>${v}</b><small>/${goal}</small></div></div>`;
}
function sleepBonusStatus() {
  const t = peekToday();
  if (t.sleepBonus) return "claimed";
  if (phase !== "morning" && phase !== "day") return "none";
  return state.overrideAt && state.overrideAt >= lastBedtime() - HOUR ? "denied" : "ready";
}
function claimSleep() {
  if (sleepBonusStatus() !== "ready") return;
  Sound.ensure();
  const t = today(); t.sleepBonus = true;
  state.coins += 150; addXP(100); state.totals.sleepBonus++;
  const achs = checkAch();
  Store.save();
  banner("快眠ボーナス", "+150◆ ・ +100XP"); Sound.fanfare(); FX.confetti();
  for (const a of achs) banner("実績解除", `${a.name} +${a.coin}◆`);
  renderAll();
}
function renderHome() {
  const v = $("#view-home");
  if (!WORDS.length) { v.innerHTML = `<div class="alert warn"><b>データなし</b>words/*.js が読み込めていない。</div>`; return; }
  const now = Date.now(), k = counts(now), t = peekToday(), p = pace(), li = levelInfo(state.xp);
  const night = phase === "wind";
  const plan = planRound(night ? "night" : "main");
  const qn = plan ? plan.total : 0;
  const bed = hm(S().bedtime), wake = hm(S().wake);
  const chip = phase === "morning" ? `朝ボーナス ×1.5 あと${fmtHM(minsUntil((wake + 180) % 1440, now))}` : `就寝まで ${fmtHM(minsUntil(bed, now))}`;
  const todayWords = activeWords().filter((w) => { const c = state.cards[w.id]; return c && touchedToday(c, now); }).length;
  const title = state.equip.title ? ITEM.get(state.equip.title) : null;
  const sb = sleepBonusStatus();
  const nem = nemesisCount(), seen = seenCount();
  const alerts = [];
  if (night) alerts.push(`<div class="alert calm"><b>夜モード</b>演出・効果音・制限時間・新規はオフ。今日触った語だけ軽く1周して寝ろ。寝る前の明るい画面は寝つきを遅らせる（Chang et al., 2015）。</div>`);
  else if (phase === "morning") alerts.push(`<div class="alert good"><b>朝の再学習</b>昨夜の語から出す。睡眠を挟んだ再学習は少ない練習で長く残る（Mazza et al., 2016）。今ならXP×1.5。</div>`);
  if (!night && Number.isFinite(p.dl) && p.dl > 0 && p.need > S().newPerDay) alerts.push(`<div class="alert warn"><b>ペース不足</b>未習${p.unseen}語を試験2週間前までに終えるには1日${p.need}語。今は${S().newPerDay}語。設定で上げろ。</div>`);
  if (!night && k.due > 150) alerts.push(`<div class="alert warn"><b>復習過多</b>復習が${k.due}語溜まっている。今日は新規を0にして片付けろ。</div>`);
  if (sleepMins() < 480) alerts.push(`<div class="alert warn"><b>睡眠不足設定</b>就寝〜起床が${fmtHM(sleepMins())}。13〜18歳の推奨は8〜10時間（AASM）。設定で直せ。</div>`);
  const deckRows = DECK_ORDER.filter((tag) => countTag(tag)).map((tag) => {
    const ws = WORDS.filter((w) => w.tag === tag);
    let m = 0, l = 0;
    for (const w of ws) { const c = state.cards[w.id]; if (isMastered(c)) m++; else if (c) l++; }
    const on = enabledTag(tag), r = m / ws.length;
    const medal = r >= 1 ? '<span class="medal g">金</span>' : r >= 0.6 ? '<span class="medal s">銀</span>' : r >= 0.3 ? '<span class="medal b">銅</span>' : "";
    return `<div class="deck ${on ? "" : "off"}" style="--dc:${deckColor(tag)}"><h3><i></i>${esc(DECKS[tag].name)}${medal}${on ? "" : '<span class="small muted">（オフ）</span>'}</h3><p>${esc(DECKS[tag].sub)}</p><div class="cnt"><b>${m}</b>/${ws.length}<br>学習中 ${l}</div><div class="dstack"><i class="m" style="width:${r * 100}%"></i><i class="l" style="width:${(l / ws.length) * 100}%"></i></div></div>`;
  }).join("");
  v.innerHTML = `
  <div class="pcard">
    <div class="emblem"><small>Lv</small>${li.L}</div>
    <div class="pinfo">
      <div class="prank">${esc(rankOf(li.L))}</div>
      <div class="prow">${title ? `<span class="tchip" style="--rc:${RC[title.rar]}">${esc(title.name)}</span>` : `<span>称号なし（ガチャで手に入る）</span>`}</div>
      <div class="pxp"><div class="xpbar"><i style="width:${((li.into / li.need) * 100).toFixed(1)}%"></i></div><span>${li.into}/${li.need}</span></div>
    </div>
  </div>
  ${sb === "ready" ? `<div class="bonus">${ICON.moon}<div><b>快眠ボーナス</b><span>昨夜はロックを破らなかった。受け取れ。</span></div><button class="btn small primary" data-act="claimSleep">+150◆</button></div>`
    : sb === "denied" ? `<div class="bonus denied">${ICON.moon}<div><b>快眠ボーナスなし</b><span>昨夜はロックを解除した。今夜は守れ。</span></div></div>` : ""}
  <div class="cta">
    <div class="cta-top"><span class="eyebrow">${night ? "就寝前" : "ZONE ATTACK"}</span><span class="phase-chip">${esc(chip)}</span></div>
    <div class="ammo">${night ? `<div><b>${todayWords}</b><span>今日の語</span></div>` : `<div><b>${k.due + k.learning}</b><span>復習</span></div><div><b>+${k.newLeft}</b><span>新規</span></div>`}</div>
    <button class="start" data-act="start" ${qn ? "" : "disabled"}><b>${night ? "寝る前ミニ復習" : "ゾーンに入れ"}</b><span>${qn ? `${qn}問 ・ 約${Math.max(1, Math.round((qn * 6) / 60))}分` : night ? "今日の語なし" : "今日の分は完了"}</span></button>
    <div class="hero-stats">
      ${ring(t.reps, S().goal)}
      <div class="hstat"><b>${liveStreak()}日</b><span>連続達成${state.streak.shields ? ` ・ 盾${state.streak.shields}` : ""}</span></div>
      <div class="hstat"><b>${Number.isFinite(p.dl) ? (p.dl > 0 ? p.dl + "日" : "本番") : "—"}</b><span>二次試験まで</span></div>
    </div>
  </div>
  <div class="subacts">
    <button class="subact" data-act="ta" ${night || seen < 12 ? "disabled" : ""}><b>タイムアタック</b><span>${night ? "夜は禁止" : seen < 12 ? `60秒 ・ 学習済み12語から（あと${12 - seen}）` : `60秒 ・ BEST ${state.taBest || 0}点`}</span></button>
    <button class="subact ${nem ? "hot" : ""}" data-act="bounty" ${night || !nem ? "disabled" : ""}><b>賞金首狩り</b><span>${nem ? `${nem}体 ・ 賞金2倍` : "4回忘れた語が賞金首になる"}</span></button>
  </div>
  ${alerts.join("")}
  <div class="panel missions"><div class="section-h"><span class="eyebrow">今日のミッション</span><span class="small muted">全クリアでSR確定宝箱</span></div>${missionRows(todaysMissions(), peekToday())}</div>
  <div class="section-h"><h2>単語帳</h2><span class="small muted">定着 / 全語</span></div>
  <div class="decks">${deckRows}</div>
  <div class="panel memo">
    <span class="eyebrow">京大英語 × このアプリ</span>
    <ol>
      <li><b>英文和訳</b> → 多義語・評論語を「下線部の意味」問題で出す。辞書の第1義では点にならない。</li>
      <li><b>和文英訳</b> → 逆引き（日→英）とスペル問題。日本語から英語を引き出す。</li>
      <li><b>自由英作文</b> → 英作文表現デッキと情報・科学デッキ。2025年のテーマはAIと想像力だった。</li>
    </ol>
    <p class="src">出題傾向: <a href="https://study-search.jp/columns/296" target="_blank" rel="noopener">study-search.jp</a> ／ <a href="https://up-edu.com/blog/wp-content/uploads/tsuwamono-way/english/tsuwamono-english_20251010.pdf" target="_blank" rel="noopener">UP-EDU 京大英語解説</a>。学習設計の根拠は「設定」タブの最下部。</p>
  </div>`;
}

let zFilter = "all";
function renderZukan() {
  const v = $("#view-zukan");
  if (!v.dataset.built) {
    v.innerHTML = `<div class="section-h"><h2>単語図鑑</h2><span class="small muted num" id="zSum"></span></div>
      <input class="search" id="zq" type="search" placeholder="出会った語を検索（英語・日本語）" autocomplete="off" aria-label="単語を検索">
      <div class="chips" id="zchips">${[["all", "全部"], ["seen", "出会った"], ["learn", "学習中"], ["master", "定着"], ["nem", "賞金首"]].map(([k, l]) => `<button class="chipbtn" data-z="${k}" aria-pressed="${k === zFilter}">${l}</button>`).join("")}</div>
      <div id="zList" class="view" style="padding-top:0"></div>`;
    v.dataset.built = "1";
    $("#zq").addEventListener("input", renderZList);
  }
  renderZList();
}
function renderZList() {
  const q = norm($("#zq")?.value || "");
  const seen = WORDS.filter((w) => state.cards[w.id]).length, mastered = WORDS.filter((w) => isMastered(state.cards[w.id])).length;
  $("#zSum").textContent = `発見 ${seen}/${WORDS.length} ・ 定着 ${mastered}`;
  $$("#zchips .chipbtn").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.z === zFilter)));
  const pass = (w) => {
    const c = state.cards[w.id];
    if (zFilter === "seen" && !c) return false;
    if (zFilter === "learn" && (!c || isMastered(c))) return false;
    if (zFilter === "master" && !isMastered(c)) return false;
    if (zFilter === "nem" && !isNemesis(c)) return false;
    if (q) return !!c && (norm(w.w).includes(q) || w.ja.includes(q) || w.more.includes(q));
    return true;
  };
  const html = DECK_ORDER.map((tag) => {
    const all = WORDS.filter((w) => w.tag === tag); if (!all.length) return "";
    const ws = all.filter(pass); if (!ws.length) return "";
    const s = all.filter((w) => state.cards[w.id]).length, m = all.filter((w) => isMastered(state.cards[w.id])).length;
    return `<div class="zdeck" style="--dc:${deckColor(tag)}"><h3><i></i>${esc(DECKS[tag].name)} <small>発見 ${s}/${all.length} ・ 定着 ${m}</small></h3>
      <div class="cards">${ws.map((w) => {
        const c = state.cards[w.id];
        if (!c) return `<button class="wcard unseen" data-open="${esc(w.id)}" aria-label="未発見の単語"><b>${esc(w.w[0])}${"?".repeat(Math.min(6, Math.max(2, w.w.length - 1)))}</b></button>`;
        const cls = isMastered(c) ? "master" : "learn";
        const stars = isMastered(c) ? "★★★" : c.st === 2 ? "★★☆" : "★☆☆";
        return `<button class="wcard ${cls} ${isNemesis(c) ? "nem" : ""}" data-open="${esc(w.id)}"><b>${esc(w.w)}</b><span>${stars}${isNemesis(c) ? " 賞金首" : ""}</span></button>`;
      }).join("")}</div></div>`;
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
  const body = c ? `
    <div class="xword"><div><b>${esc(w.w)}</b> <span>${esc(w.pos)}</span></div>${speakBtn(w.w)}</div>
    ${w.pat ? `<span class="pat">${esc(w.pat)}</span>` : ""}
    <div class="xja">${esc(w.ja)}</div>
    ${w.more ? `<div class="xmore">${esc(w.more)}</div>` : ""}
    ${hasEx(w) ? `<p class="ex">${exHTML(w, "mark")}</p>${w.exJa ? `<p class="exja">${esc(w.exJa)}</p>` : ""}` : ""}
    ${w.note ? `<p class="note"><b>京大ポイント</b>${esc(w.note)}</p>` : ""}
    <div class="kv"><div><b>${stateName(c)}</b><span>状態</span></div><div><b>${c.reps}</b><span>回答数</span></div><div><b>${c.lapses}</b><span>忘れた回数</span></div><div><b>${c.st === 2 ? c.ivl + "日" : "—"}</b><span>復習間隔</span></div></div>
    <p class="small muted">次回: ${fmtDue(c)}</p>
    <div class="btnrow"><button class="btn small" data-act="dueNow" data-id="${esc(id)}">次のラウンドで出す</button></div>`
    : `<div class="xword"><div><b>${esc(w.w[0])}${"?".repeat(Math.max(2, w.w.length - 1))}</b></div></div>
    <p>まだ出会っていない単語。中身はクイズで出会うまで秘密。</p>
    <div class="btnrow"><button class="btn small primary" data-act="learnNow" data-id="${esc(id)}">次のラウンドで出会う</button></div>`;
  $("#sheetBody").innerHTML = `<div class="xhead"><span class="chip deck" style="--dc:${deckColor(w.tag)}">${esc(DECKS[w.tag].name)}</span><button class="iconbtn" data-act="closeSheet" aria-label="閉じる">${ICON.x}</button></div>${body}`;
  $("#sheet").hidden = false;
}
const closeSheet = () => { $("#sheet").hidden = true; };

function renderLog() {
  const v = $("#view-kiroku");
  const now = Date.now(), k = dayKey(now);
  const act = activeWords();
  const mastered = masteredCount(), seen = seenCount();
  let r7 = 0, o7 = 0, m7 = 0;
  for (let i = 0; i < 7; i++) { const d = state.days[addDays(k, -i)]; if (d) { r7 += d.reps || 0; o7 += d.ok || 0; m7 += d.ms || 0; } }
  const d14 = Array.from({ length: 14 }, (_, i) => { const key = addDays(k, i - 13); return { key, d: { ...blankDay(), ...(state.days[key] || {}) } }; });
  const max = Math.max(S().goal, ...d14.map((x) => x.d.reps), 1);
  const fc = Array(7).fill(0);
  for (const w of act) { const c = state.cards[w.id]; if (!c) continue; const di = c.st === 2 ? Math.max(0, Math.floor((c.due - dayStart(now)) / DAY)) : 0; if (di < 7) fc[di]++; }
  const fmax = Math.max(1, ...fc);
  const p = pace();
  const goalPos = `calc(${(S().goal / max).toFixed(3)} * (100% - 18px) + 18px)`;
  const achN = ACH.filter((a) => state.ach[a.id]).length;
  v.innerHTML = `
  <div class="section-h"><h2>記録</h2><span class="small muted">数字は嘘をつかない</span></div>
  <div class="tiles4">
    <div class="rbox"><b class="num">${mastered}</b><span>定着語（/${act.length}）</span></div>
    <div class="rbox"><b class="num">${seen}</b><span>発見した語</span></div>
    <div class="rbox"><b class="num">${r7 ? Math.round((o7 / r7) * 100) + "%" : "—"}</b><span>7日間の正答率</span></div>
    <div class="rbox"><b class="num">${Math.round(m7 / 60000)}分</b><span>7日間の解答時間</span></div>
    <div class="rbox"><b class="num">${state.bestCombo || 0}</b><span>最大コンボ</span></div>
    <div class="rbox"><b class="num">${state.taBest || 0}</b><span>タイムアタック</span></div>
    <div class="rbox"><b class="num">${state.totals.correct.toLocaleString()}</b><span>累計正解</span></div>
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
    <p class="small muted">復習間隔の上限は現在 ${ivlCap()}日（試験までの残り日数の15%、Cepeda et al., 2008 を参考）。</p>
  </div>
  <div class="section-h"><h2>実績</h2><span class="small muted num">${achN}/${ACH.length}</span></div>
  <div class="achs">${ACH.map((a) => `<div class="ach ${state.ach[a.id] ? "" : "locked"}"><i>${esc(a.g)}</i><div><b>${esc(a.name)}</b><span>${esc(a.desc)} ・ ${a.coin}◆</span></div></div>`).join("")}</div>`;
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
  const TM = [["slow", "ゆっくり"], ["std", "標準"], ["fast", "鬼"], ["off", "なし"]];
  v.innerHTML = `
  <div class="section-h"><h2>設定</h2><span class="sync" id="syncLine"><i></i><span></span></span></div>
  <div class="panel form">
    <span class="eyebrow">学習量</span>
    ${numField("newPerDay", "新規 / 日", s.newPerDay, 0, 200, "1日に初めて出会う語数。合格ペースはホームと記録に出る。")}
    ${numField("goal", "ノルマ（回答数 / 日）", s.goal, 10, 1000, "達成で連続日数+1。")}
    ${numField("roundSize", "1ラウンドの最大問題数", s.roundSize, 10, 60, "")}
  </div>
  <div class="panel form">
    <span class="eyebrow">制限時間</span>
    <div class="field"><label>1問の制限時間</label><div class="seg" role="group" aria-label="制限時間">${TM.map(([k2, l]) => `<button data-timer="${k2}" aria-pressed="${s.timer === k2}">${l}</button>`).join("")}</div><span class="hint">標準は意味・逆引き8秒、下線部12秒、スペル12〜20秒。時間の最初の25%以内に答えるとPERFECT、50%以内でGREAT。速さは復習間隔の判定にも使う。</span></div>
  </div>
  <div class="panel form">
    <span class="eyebrow">単語帳</span>
    ${DECK_ORDER.map((t) => toggleField("deck_" + t, `${DECKS[t].name}（${countTag(t)}語）`, s.decks[t] !== false, DECKS[t].sub)).join("")}
  </div>
  <div class="panel form">
    <span class="eyebrow">睡眠ガード</span>
    <div class="field"><label for="bedtime">就寝時刻</label><input type="time" id="bedtime" value="${esc(s.bedtime)}"><span class="hint">60分前から夜モード（演出・音・制限時間・新規・ガチャ・タイムアタック停止、今日の語だけ復習）。就寝〜起床は「寝ろ。」画面でロックする。</span></div>
    <div class="field"><label for="wake">起床時刻</label><input type="time" id="wake" value="${esc(s.wake)}"><span class="hint">ロックを破らずに朝を迎えると快眠ボーナス（+150◆）。起床から3時間は朝の再学習でXP×1.5。</span></div>
    <p class="small" id="sleepLen">${esc(sleepText())}</p>
  </div>
  <div class="panel form">
    <span class="eyebrow">試験</span>
    <div class="field"><label for="examDate">二次試験の日</label><input type="date" id="examDate" value="${esc(s.examDate)}"><span class="hint">初期値は2027年2月25日（国公立の前期日程は例年2月25日開始）。必ず募集要項・受験票の日付に直せ。復習間隔はこの日までの残り日数の15%で頭打ちになる。</span></div>
  </div>
  <div class="panel form">
    <span class="eyebrow">演出</span>
    ${toggleField("sound", "効果音", s.sound, "コンボが続くほど音程が上がる。夜モードでは鳴らない。")}
    ${toggleField("effects", "エフェクト（紙吹雪・バナー・判定・振動）", s.effects, "OS の「視差効果を減らす」がオンなら紙吹雪は出ない。")}
    ${toggleField("tts", "単語を自動で発音", s.tts, canSpeak ? "スピーカーボタンでいつでも聞ける。" : "このブラウザは音声合成に非対応。")}
  </div>
  <div class="panel form">
    <span class="eyebrow">マイ単語を追加</span>
    <p class="small muted">自分の単語帳や過去問で覚えにくかった語を打ち込め。1行1語。タブ区切りなら「単語⇥意味⇥例文⇥メモ」、カンマ区切りなら「単語,意味,例文」。意味に英語を入れると選択肢で答えがバレるので日本語だけにしろ。</p>
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
    <p class="small muted">例文と訳はこのアプリのオリジナル。市販単語帳・過去問からの転載はない。85%ルールは単純な課題での理論値なので、目安として使っている。</p>
  </div>
  <div class="panel form">
    <span class="eyebrow">全リセット</span>
    <div class="field"><label for="resetIn">RESET と入力</label><input id="resetIn" type="text" autocomplete="off" autocapitalize="characters"></div>
    <button class="btn small danger" id="resetBtn" disabled>全データを消す</button>
  </div>`;
  setSync(Store.status);
  const num = (id, key, lo, hi) => $("#" + id).addEventListener("change", (e) => { const n = clamp(Math.round(+e.target.value || 0), lo, hi); e.target.value = n; s[key] = n; Store.save(); renderHeader(); });
  num("newPerDay", "newPerDay", 0, 200); num("goal", "goal", 10, 1000); num("roundSize", "roundSize", 10, 60);
  $$("[data-timer]", v).forEach((b) => b.addEventListener("click", () => { s.timer = b.dataset.timer; Store.save(); $$("[data-timer]", v).forEach((x) => x.setAttribute("aria-pressed", String(x === b))); }));
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
    if (lock.hidden) { lock.hidden = false; closeSheet(); $("#overlay").hidden = true; if (R) closeArena(); }
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
      tick(true); toast("10分だけだ。快眠ボーナスは消えた。終わったら寝ろ。");
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
  if (changed || force) { applyLook(); updateLock(); if (R) updateHud(); else renderAll(); }
  else { updateLock(); if (!R && currentView === "home" && $("#sheet").hidden && $("#overlay").hidden) renderHome(); }
}

/* ================= events ================= */
document.addEventListener("click", (e) => {
  const ov = e.target.closest("#overlay");
  if (ov) { if (!ov.dataset.lock) ov.hidden = true; return; }
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
  if (!a) {
    if (e.target.closest("#explain") && R?.auto) { clearTimeout(R.auto); R.auto = 0; $("#autobar")?.remove(); } // 解説を読んでいる間は自動で進まない
    return;
  }
  const act = a.dataset.act;
  if (act === "start") startRound("main");
  else if (act === "ta") startTA();
  else if (act === "bounty") startRound("bounty");
  else if (act === "opt") onOpt(+a.dataset.i);
  else if (act === "tile") onTile(+a.dataset.i);
  else if (act === "pass") { const q = R?.q; if (q && !q.done) resolve(false, { pass: true }); }
  else if (act === "next") next();
  else if (act === "again") { closeArena(); startRound("main"); }
  else if (act === "taAgain") { closeArena(); startTA(); }
  else if (act === "home") closeArena();
  else if (act === "chest") openChest(a);
  else if (act === "claimSleep") claimSleep();
  else if (act === "pull1") pull(1);
  else if (act === "pull10") pull(10);
  else if (act === "equip") equip(a.dataset.id);
  else if (act === "closeSheet") closeSheet();
  else if (act === "dueNow") { const c = state.cards[a.dataset.id]; if (c) { c.due = c.st === 2 ? dayStart() - 1 : Date.now(); Store.save(); toast("次のラウンドで出す。"); closeSheet(); renderView(); } }
  else if (act === "learnNow") { state.prio = [a.dataset.id, ...state.prio.filter((x) => x !== a.dataset.id)]; Store.save(); toast("次のラウンドで出会う。"); closeSheet(); renderView(); }
});
$("#aClose").addEventListener("click", quitArena);
document.addEventListener("keydown", (e) => {
  const ov = $("#overlay");
  if (e.key === "Escape") { if (!ov.hidden && !ov.dataset.lock) { ov.hidden = true; return; } if (!$("#sheet").hidden) closeSheet(); return; }
  if (!ov.hidden) { if ((e.key === " " || e.key === "Enter") && !ov.dataset.lock) { e.preventDefault(); ov.hidden = true; } return; }
  if (!R || $("#arena").hidden || !$("#lock").hidden) return;
  if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA")) return;
  const q = R.q;
  if (R.done) { if (e.key === "Enter") { e.preventDefault(); if (R.ta) { closeArena(); startTA(); } else if (R.kind !== "night") { closeArena(); startRound("main"); } } return; }
  if (!$("#explain").hidden) { if (e.key === " " || e.key === "Enter") { e.preventDefault(); next(); } return; }
  if (!q || q.done) return;
  if (q.opts && /^[1-4]$/.test(e.key)) { e.preventDefault(); onOpt(+e.key - 1); return; }
  if (e.key === "0" && !R.ta) { e.preventDefault(); resolve(false, { pass: true }); return; }
  if (q.type === "spell" && !q.phrase && /^[a-zA-Z'-]$/.test(e.key)) {
    e.preventDefault();
    const idx = q.tiles.findIndex((t) => !t.used && t.t.toLowerCase() === e.key.toLowerCase());
    if (idx >= 0) onTile(idx); else spellMiss(null);
  }
});
addEventListener("hashchange", () => showView(location.hash.slice(1)));
document.addEventListener("visibilitychange", () => { if (document.hidden) Store.flush(); else tick(); });
addEventListener("pagehide", () => Store.flush());

/* ================= boot ================= */
(function prune() {
  const cutoff = addDays(dayKey(), -400);
  for (const key of Object.keys(state.days)) if (key < cutoff) delete state.days[key];
})();
buildWords();
FX.init();
applyLook();
showView(location.hash.slice(1));
renderHeader();
updateLock();
setInterval(() => tick(), 20000);
Store.initRemote();
// テスト用の読み取り口（状態は変えない）
window.__dopa = { get round() { return R; }, get state() { return state; }, optJa: (id) => optJa(BYID.get(id)), get words() { return WORDS; } };
})();
