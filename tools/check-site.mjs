// 公開前の構成チェック: node tools/check-site.mjs
// - index.html が読むファイルが全部あるか
// - それらがオフライン用の sw.js の保存リスト(CORE)に入っているか
// - manifest のアイコンが全部あるか
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
const exists = (f) => fs.existsSync(path.join(root, f));
const problems = [];

const html = read("index.html");
const local = (u) => u && !/^(https?:)?\/\//.test(u) && !u.startsWith("data:") && !u.startsWith("#");
const refs = [
  ...[...html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)].map((m) => m[1]),
  ...[...html.matchAll(/<link[^>]*\shref="([^"]+)"/g)].map((m) => m[1]),
].filter(local);

const sw = read("sw.js");
const coreSrc = sw.match(/const CORE = \[([\s\S]*?)\];/);
if (!coreSrc) problems.push("sw.js に CORE の配列が見つからない");
const core = coreSrc ? [...coreSrc[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]) : [];

for (const r of refs) {
  if (!exists(r)) problems.push(`index.html が読む ${r} がない`);
  if (core.length && !core.includes(r)) problems.push(`${r} が sw.js の CORE に入っていない（オフラインで欠ける）`);
}
for (const c of core) if (c !== "./" && !exists(c)) problems.push(`sw.js の CORE にある ${c} がない（インストールに失敗する）`);

const manifest = JSON.parse(read("manifest.webmanifest"));
for (const i of manifest.icons || []) if (!exists(i.src)) problems.push(`manifest のアイコン ${i.src} がない`);

if (problems.length) {
  for (const p of problems) console.error("✗ " + p);
  process.exit(1);
}
console.log(`OK: index.html の参照 ${refs.length} 件、オフライン保存 ${core.length} 件、アイコン ${(manifest.icons || []).length} 件`);
