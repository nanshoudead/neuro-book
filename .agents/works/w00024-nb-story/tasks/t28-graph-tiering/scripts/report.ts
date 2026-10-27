/** 把两遍标注做成给人看的静态页：artifacts/report/index.html（用法：bun report.ts）。 */
import {mkdir, readFile, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {smallDataset} from "../../../../../../packages/nb-story/testing/sample";

const ROOT = join(import.meta.dir, "..");
const d = await smallDataset(20, "report");
const a: Record<string, number> = JSON.parse(await readFile(join(ROOT, "evidences", "tiers-run-1.json"), "utf8")).tiers;
const b: Record<string, number> = JSON.parse(await readFile(join(ROOT, "evidences", "tiers-run-2.json"), "utf8")).tiers;

type Row = {id: string; kind: "对象" | "说法" | "情节"; sub: string; chapter: number; text: string; t1?: number; t2?: number};
const rows: Row[] = [
    ...d.entities.map((e: any) => ({id: e.id, kind: "对象" as const, sub: e.kind, chapter: e.at.chapter, text: `${e.label}${e.names.length ? `（${e.names.slice(0, 3).map((n: any) => n.text).join("、")}）` : ""}`})),
    ...d.statements.map((s: any) => ({id: s.id, kind: "说法" as const, sub: s.family, chapter: s.at.chapter, text: s.text})),
    ...d.episodes.map((x: any) => ({id: x.id, kind: "情节" as const, sub: "情节", chapter: x.at.chapter, text: `${x.title}：${x.summary}`})),
].map(r => ({...r, t1: a[r.id], t2: b[r.id]}));

const esc = (s: string) => s.replace(/[&<>]/gu, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;"})[c]!);
const badge = (r: Row) => {
    const same = r.t1 === r.t2;
    return `<span class="b t${r.t1}" title="第一遍">${r.t1 ?? "–"}</span><span class="b t${r.t2} ${same ? "" : "diff"}" title="第二遍${same ? "" : "，和第一遍不一致"}">${r.t2 ?? "–"}</span>`;
};
const line = (r: Row) => `<li class="row" data-t1="${r.t1}" data-t2="${r.t2}">${badge(r)}<span class="k">${r.kind}·${esc(r.sub)}</span><span class="tx">${esc(r.text)}</span><span class="id">${r.id}</span></li>`;
const ok = rows.filter(r => r.t1 && r.t2);
const pick = (pred: (r: Row) => boolean, n: number, step = 1) => ok.filter(pred).filter((_, i) => i % step === 0).slice(0, n);
const section = (title: string, note: string, list: Row[]) => `<section><h2>${title}</h2><p class="note">${note}</p><ul>${list.map(line).join("")}</ul></section>`;

const chapters = [1, 8, 15].map(ch => {
    const list = rows.filter(r => r.chapter === ch && r.kind !== "对象").sort((x, y) => (x.kind === "情节" ? -1 : 1) - (y.kind === "情节" ? -1 : 1));
    return `<section class="chap"><h2>第 ${ch} 章的记录（${list.length} 条）</h2><input type="radio" name="f${ch}" id="r0-${ch}" checked><label for="r0-${ch}">全部</label><input type="radio" name="f${ch}" id="r2-${ch}"><label for="r2-${ch}">只留 1、2 级</label><input type="radio" name="f${ch}" id="r1-${ch}"><label for="r1-${ch}">只留 1 级</label><ul class="f f${ch}">${list.map(line).join("")}</ul></section>`;
}).join("");
const filterCss = [1, 8, 15].map(ch => `#r2-${ch}:checked ~ ul.f${ch} li[data-t1="3"]{display:none}#r1-${ch}:checked ~ ul.f${ch} li:not([data-t1="1"]){display:none}`).join("\n");

const total = ok.length;
const same = ok.filter(r => r.t1 === r.t2).length;
const html = `<!doctype html><html lang="zh"><meta charset="utf-8"><title>t28 记录分级：模型是怎么标的</title>
<style>
body{font:14px/1.6 system-ui,"Noto Sans CJK SC",sans-serif;max-width:980px;margin:24px auto;padding:0 16px;color:#222}
h1{font-size:20px}h2{font-size:16px;margin:26px 0 4px}.note{color:#666;margin:0 0 8px}
ul{list-style:none;padding:0;margin:0}.row{display:flex;gap:8px;align-items:baseline;padding:4px 0;border-bottom:1px solid #eee}
.b{display:inline-block;width:20px;text-align:center;border-radius:4px;color:#fff;font-weight:600;flex:none}
.t1{background:#c0392b}.t2{background:#e0a030}.t3{background:#8a98a8}.diff{outline:2px solid #222}
.k{flex:none;width:96px;color:#777;font-size:12px}.tx{flex:1}.id{flex:none;color:#aaa;font-size:11px}
table{border-collapse:collapse}td,th{border:1px solid #ddd;padding:4px 10px;text-align:right}th:first-child,td:first-child{text-align:left}
.chap label{margin:0 14px 0 3px;cursor:pointer}.chap ul{margin-top:8px}
${filterCss}
</style>
<h1>记录分级：模型是怎么标的</h1>
<p>样例书前 20 章，427 条记录（对象、说法、情节），gpt-6-luna 独立标了两遍。每条记录前面两个方块是两遍的级别：<span class="b t1">1</span>主线必需、<span class="b t2">2</span>有用、<span class="b t3">3</span>琐碎；<span class="b t3 diff">黑框</span>表示这一遍和第一遍不一致。提示词只给了这三句定义和“1 级应当是少数”，没有别的标准。</p>
<table><tr><th></th><th>1 级</th><th>2 级</th><th>3 级</th></tr>
<tr><td>第一遍</td>${[1, 2, 3].map(t => `<td>${ok.filter(r => r.t1 === t).length}</td>`).join("")}</tr>
<tr><td>第二遍</td>${[1, 2, 3].map(t => `<td>${ok.filter(r => r.t2 === t).length}</td>`).join("")}</tr></table>
<p>两遍完全一致 ${((same / total) * 100).toFixed(0)}%（${same}/${total}）。</p>
<h2>一、按章看：同一章的记录，分别只留 1 级、1+2 级是什么样</h2>
<p class="note">点选项切换。这就是“默认只显示高等级”时人会看到的东西。</p>
${chapters}
${section("二、两遍都标 1 级的（节选）", "模型认为主线必需。", pick(r => r.t1 === 1 && r.t2 === 1, 14, 3))}
${section("三、两遍都标 3 级的（节选）", "模型认为琐碎。", pick(r => r.t1 === 3 && r.t2 === 3, 14, 2))}
${section("四、两遍差两级的（1 对 3）", "最不稳的一类：同一条记录一遍说主线必需，一遍说琐碎。", pick(r => Math.abs(r.t1! - r.t2!) === 2, 14))}
${section("五、两遍差一级的（节选）", "边界上的记录，在 1/2 或 2/3 之间摇摆。", pick(r => Math.abs(r.t1! - r.t2!) === 1, 16, 5))}
<p class="note">数据：<code>evidences/tiers-run-1.json</code>、<code>tiers-run-2.json</code>；本页由 <code>scripts/report.ts</code> 生成。</p>
</html>`;
await mkdir(join(ROOT, "artifacts", "report"), {recursive: true});
await writeFile(join(ROOT, "artifacts", "report", "index.html"), html);
console.log("写好", html.length, "字节");
