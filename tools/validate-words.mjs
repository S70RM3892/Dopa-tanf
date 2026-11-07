// 単語データ検証: node tools/validate-words.mjs [words/xxx.js ...]
// 1行 = [見出し, 品詞, 意味(日本語のみ), 他の意味, 例文, 例文中の対象語, 例文の訳, 京大ポイント, 型(任意), 語源(任意), 難度(任意 "1"|"2"|"3")]
// 引数なしなら words/*.js を全部検査する。
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const args = process.argv.slice(2);
const all = args.length
  ? args
  : fs.readdirSync(path.join(root, "words")).filter((f) => f.endsWith(".js")).map((f) => path.join(root, "words", f));
// synonyms.js は語ではなく「誤答にしない近義語の組」なので別に検査する
const SYN_FILE = "synonyms.js";
const files = all.filter((f) => path.basename(f) !== SYN_FILE);
const synFiles = all.filter((f) => path.basename(f) === SYN_FILE);
const ids = new Set();

const POS = new Set(["動", "名", "形", "副", "句", "接", "前", "助"]);
const window = {};
const ctx = vm.createContext({ window });
let errors = 0;
const err = (f, i, msg) => { errors++; console.error(`✗ ${path.basename(f)} #${i + 1}: ${msg}`); };

const seen = new Map();
for (const f of files) {
  const before = (window.DOPA_DATA || []).length;
  try {
    vm.runInContext(fs.readFileSync(f, "utf8"), ctx, { filename: f });
  } catch (e) {
    errors++; console.error(`✗ ${f}: 構文エラー ${e.message}`); continue;
  }
  const decks = (window.DOPA_DATA || []).slice(before);
  if (decks.length !== 1) { err(f, -1, `push は1回だけ (実際 ${decks.length})`); continue; }
  const { tag, rows } = decks[0];
  if (!/^[a-z]+$/.test(tag || "")) err(f, -1, `tag が不正: ${tag}`);
  if (!Array.isArray(rows) || !rows.length) { err(f, -1, "rows が空"); continue; }
  rows.forEach((r, i) => {
    if (!Array.isArray(r) || r.length < 8 || r.length > 11) return err(f, i, `8〜11要素の配列ではない (${Array.isArray(r) ? r.length : typeof r})`);
    if (r.some((x) => typeof x !== "string")) return err(f, i, "全要素が文字列ではない");
    const [w, pos, ja, more, ex, hit, exJa, note, pat = "", root = "", lv = ""] = r;
    if (root.length > 30) err(f, i, `${w}: 語源(root) が長すぎ (${root.length}字 > 30)`);
    if (!["", "1", "2", "3"].includes(lv)) err(f, i, `${w}: 難度(lv) は "1" "2" "3" のどれか (実際 ${lv})`);
    // 4択の選択肢に答えが漏れないよう、意味(ja)に英語を入れない。A/B/O/C/S/V の記号だけは可。
    const latin = ja.replace(/(^|[^A-Za-z])[ABOCSV](?=[^A-Za-z]|$)/g, "$1").match(/[A-Za-z]+/);
    if (latin) err(f, i, `${w}: ja に英語「${latin[0]}」が入っている（答えが選択肢に漏れる）。構文は9番目の「型」へ`);
    if (pat.length > 40) err(f, i, `${w}: 型(pat) が長すぎ (${pat.length}字 > 40)`);
    if (!w.trim()) err(f, i, "w が空");
    for (const p of pos.split("・")) if (!POS.has(p)) err(f, i, `${w}: pos「${pos}」に未知の品詞 ${p}`);
    if (!ja.trim()) err(f, i, `${w}: ja が空`);
    if (ja.length > 28) err(f, i, `${w}: ja が長すぎ (${ja.length}字 > 28)`);
    if (more.length > 40) err(f, i, `${w}: more が長すぎ (${more.length}字 > 40)`);
    if (!/[.?!]$/.test(ex.trim())) err(f, i, `${w}: ex が文末記号で終わっていない`);
    const words = ex.trim().split(/\s+/).length;
    if (words < 6 || words > 24) err(f, i, `${w}: ex の語数 ${words} (6〜24)`);
    const n = ex.split(hit).length - 1;
    if (!hit) err(f, i, `${w}: hit が空`);
    else if (n !== 1) err(f, i, `${w}: hit「${hit}」が ex に ${n} 回出現 (ちょうど1回必要)`);
    if (!/[。！？]$/.test(exJa.trim())) err(f, i, `${w}: exJa が「。」で終わっていない`);
    if (!note.trim()) err(f, i, `${w}: note が空`);
    if (note.length > 70) err(f, i, `${w}: note が長すぎ (${note.length}字 > 70)`);
    ids.add(`${tag}:${w}`);
    const key = w.toLowerCase();
    if (seen.has(key)) err(f, i, `${w}: 重複 (${seen.get(key)})`);
    else seen.set(key, `${path.basename(f)} #${i + 1}`);
  });
  console.log(`${errors ? "…" : "✓"} ${path.basename(f)}: tag=${tag} ${rows.length}語`);
}
for (const f of synFiles) {
  try { vm.runInContext(fs.readFileSync(f, "utf8"), ctx, { filename: f }); }
  catch (e) { errors++; console.error(`✗ ${f}: 構文エラー ${e.message}`); continue; }
  const pairs = window.DOPA_SYN;
  if (!Array.isArray(pairs)) { errors++; console.error(`✗ ${SYN_FILE}: window.DOPA_SYN が配列ではない`); continue; }
  const keys = new Set();
  pairs.forEach((p, i) => {
    if (!Array.isArray(p) || p.length < 2 || typeof p[0] !== "string" || typeof p[1] !== "string") return err(f, i, "[idA, idB] の形ではない");
    if (p[0] === p[1]) err(f, i, `同じ語どうし: ${p[0]}`);
    // 単語の検査対象を絞った実行では、別ファイルの語は見えないので存在確認を飛ばす
    if (!args.length) for (const id of p.slice(0, 2)) if (!ids.has(id)) err(f, i, `存在しない語: ${id}`);
    const k = [p[0], p[1]].sort().join("|");
    if (keys.has(k)) err(f, i, `組が重複: ${p[0]} / ${p[1]}`);
    keys.add(k);
  });
  console.log(`${errors ? "…" : "✓"} ${SYN_FILE}: 近義語 ${pairs.length}組`);
}
console.log(errors ? `\n${errors} 件のエラー` : `\nOK: 合計 ${seen.size} 語`);
process.exit(errors ? 1 : 0);
