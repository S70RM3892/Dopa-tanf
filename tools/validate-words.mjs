// 単語データ検証: node tools/validate-words.mjs [words/xxx.js ...]
// 引数なしなら words/*.js を全部検査する。
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const args = process.argv.slice(2);
const files = args.length
  ? args
  : fs.readdirSync(path.join(root, "words")).filter((f) => f.endsWith(".js")).map((f) => path.join(root, "words", f));

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
    if (!Array.isArray(r) || r.length !== 8) return err(f, i, `8要素の配列ではない (${Array.isArray(r) ? r.length : typeof r})`);
    if (r.some((x) => typeof x !== "string")) return err(f, i, "全要素が文字列ではない");
    const [w, pos, ja, more, ex, hit, exJa, note] = r;
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
    const key = w.toLowerCase();
    if (seen.has(key)) err(f, i, `${w}: 重複 (${seen.get(key)})`);
    else seen.set(key, `${path.basename(f)} #${i + 1}`);
  });
  console.log(`${errors ? "…" : "✓"} ${path.basename(f)}: tag=${tag} ${rows.length}語`);
}
console.log(errors ? `\n${errors} 件のエラー` : `\nOK: 合計 ${seen.size} 語`);
process.exit(errors ? 1 : 0);
