/**
 * t28 (a)：不用模型，用程序信号给记录算等级。
 *
 *   bun program-tier.ts            在样例书（100 章图）上算，和模型对前 20 章的两遍标注比较；西游记 100 回出示例页
 *
 * 信号（全书算完后看的，所以带“后文怎么用它”的事后信息，这是模型抽取当时拿不到的）：
 * 类别先验、涉及对象的后文活跃度、被别的记录引用的次数（确认关系、秘密、别人知情）、涉及对象多少。
 */
import {readFile, writeFile, mkdir} from "node:fs/promises";
import {gunzipSync} from "node:zlib";
import {join} from "node:path";

const ROOT = join(import.meta.dir, "..");
const NB = join(ROOT, "../../../../../packages/nb-story");

type Rec = {id: string; kind: "说法" | "对象" | "情节"; sub: string; chapter: number; text: string; score: number; tier: number; why: string; ev?: number};

const FAM: Record<string, number> = {identity: 3, rule: 2, goal: 2, event: 1.5, social: 1.5, possession: 1, kinship: 1, membership: 1, trait: 1, other: 0.5, attitude: 0, location: 0};
const log1 = (x: number) => Math.log(1 + x);

function compute(d: any): Rec[] {
    const total = new Map<string, number>();
    const byCh = new Map<string, Map<number, number>>();
    for (const m of d.mentions) {
        total.set(m.entity, (total.get(m.entity) ?? 0) + 1);
        const c = byCh.get(m.entity) ?? new Map<number, number>();
        c.set(m.at.chapter, (c.get(m.at.chapter) ?? 0) + 1);
        byCh.set(m.entity, c);
    }
    // 主角（出场最多的几个对象）几乎出现在每条说法里，后文活跃度没有区分度：算说法的活跃度时不计它们。
    const hubs = new Set([...total].sort((x, y) => y[1] - x[1]).slice(0, 3).map(([id]) => id));
    const later = (e: string, ch: number) => [...(byCh.get(e) ?? [])].filter(([c]) => c > ch).reduce((s, [, n]) => s + n, 0);
    const refs = new Map<string, number>();
    const bump = (id: string, n = 1) => refs.set(id, (refs.get(id) ?? 0) + n);
    for (const s of d.statements) for (const r of s.rel ?? []) bump(r.to);
    for (const s of d.secrets) for (const id of s.statements ?? []) bump(id, 2);
    const holders = new Map<string, Set<string>>();
    for (const k of d.knowledge) if (!k.derived) (holders.get(k.about) ?? holders.set(k.about, new Set()).get(k.about)!).add(k.who);
    for (const [id, who] of holders) bump(id, who.size);
    // 事件本身的“后文回响”：说法里的 4 字词组（不含对象名）如果不太常见、又在之后的章里再次出现，说明这件事被后文提起。
    // “叫她们吃饭”这类日常小事的词组都很常见、后文不会再提；“强化药A”“每日任务”这类设定会反复出现。
    const names = new Set<string>(); for (const e of d.entities) for (const n of e.names ?? []) if (n.text) names.add(n.text);
    const gramChapters = new Map<string, Set<number>>();
    const grams = (text: string): string[] => { const out: string[] = []; const t = text.replace(/[^\u4e00-\u9fa5A-Za-z0-9]/g, ""); for (let i = 0; i + 4 <= t.length; i += 1) out.push(t.slice(i, i + 4)); return out; };
    for (const src of d.sources) for (const para of src.paragraphs) for (const g of new Set(grams(para))) (gramChapters.get(g) ?? gramChapters.set(g, new Set()).get(g)!).add(src.chapter);
    const echo = (text: string, ch: number): number => {
        let n = 0;
        for (const g of new Set(grams(text))) {
            if ([...names].some(name => name.includes(g) || g.includes(name))) continue;
            const chs = gramChapters.get(g);
            // 词组出现在 2 到 12 个章（太常见的不算），且有出现在本章之后的章。
            if (chs !== undefined && chs.size >= 2 && chs.size <= 12 && [...chs].some(c => c > ch)) n += 1;
        }
        return n;
    };
    const out: Rec[] = [];
    for (const s of d.statements) {
        const about: string[] = s.about ?? [];
        const heat = Math.max(0, ...about.filter(e => !hubs.has(e)).map(e => later(e, s.at.chapter)));
        const r = refs.get(s.id) ?? 0;
        const ec = echo(s.text, s.at.chapter);
        const score = (FAM[s.family] ?? 0.5) + 0.4 * log1(heat) + 1.5 * log1(r) + 1.0 * log1(ec) + (about.length >= 2 ? 0.5 : 0);
        out.push({id: s.id, kind: "说法", sub: s.family, chapter: s.at.chapter, text: s.text, score, tier: 0, ev: r >= 1 || ec >= 3 ? 2 : ec >= 1 ? 1 : 0, why: `类别${s.family}、涉及对象后文出场${heat}次、事件词组后文回响${ec}个、被引用${r}次`});
    }
    for (const e of d.entities) {
        const chs = byCh.get(e.id)?.size ?? 0;
        const score = log1(total.get(e.id) ?? 0) * 1.2 + log1(chs) * 1.5;
        out.push({id: e.id, kind: "对象", sub: e.kind, chapter: e.at.chapter, text: e.label, score, tier: 0, why: `共出场${total.get(e.id) ?? 0}次、跨${chs}章`});
    }
    const arcSize = new Map<string, number>(); for (const a of d.arcs) for (const ep of a.episodes) arcSize.set(ep, Math.max(arcSize.get(ep) ?? 0, a.episodes.length));
    for (const x of d.episodes) {
        const heat = Math.max(0, ...(x.who ?? []).map((e: any) => total.get(typeof e === "string" ? e : e.entity ?? e.id) ?? 0));
        const score = log1(heat) + log1(arcSize.get(x.id) ?? 0) * 1.5;
        out.push({id: x.id, kind: "情节", sub: "情节", chapter: x.at.chapter, text: `${x.title}：${x.summary ?? ""}`, score, tier: 0, why: `参与者最高出场${heat}次、所属主线${arcSize.get(x.id) ?? 0}个情节`});
    }
    // 每种记录内部按分位数定级：前 25% 为 1，接着 40% 为 2，其余 35% 为 3。
    for (const kind of ["说法", "对象", "情节"] as const) {
        const list = out.filter(r => r.kind === kind).sort((a, b) => b.score - a.score);
        list.forEach((r, i) => (r.tier = i < list.length * 0.25 ? 1 : i < list.length * 0.65 ? 2 : 3));
    }
    return out;
}

const rank = (xs: number[]) => xs.map(x => xs.filter(y => y < x).length + (xs.filter(y => y === x).length - 1) / 2);
function spearman(x: number[], y: number[]): number {
    const rx = rank(x), ry = rank(y), mx = rx.reduce((s, v) => s + v, 0) / rx.length, my = ry.reduce((s, v) => s + v, 0) / ry.length;
    return rx.reduce((s, v, i) => s + (v - mx) * (ry[i]! - my), 0) / Math.sqrt(rx.reduce((s, v) => s + (v - mx) ** 2, 0) * ry.reduce((s, v) => s + (v - my) ** 2, 0));
}

/**
 * 先验（模型抽取当时给的级别）加后验（程序事后算的证据）合并成一个等级。规则透明：
 *   后验证据强（被引用，或事件词组在后文回响 3 个以上）：先验 1 → 1，先验 2 → 1，先验 3 → 2（伏笔候选：当时看着琐碎，后来被提起）；
 *   有一点证据（回响 1 到 2 个）：先验 1 → 1，先验 2 → 2，先验 3 → 3；
 *   没有后验证据：先验 1 → 2（待证实：模型当时认为重要，后文没有再提），先验 2 → 2，先验 3 → 3。
 */
function combine(prior: number, ev: number): number {
    if (ev === 2) return prior === 3 ? 2 : 1;
    if (ev === 1) return prior;
    return prior === 1 ? 2 : prior;
}
const esc = (s: string) => s.replace(/[&<>]/gu, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;"})[c]!);
const row = (r: Rec, extra = "") => `<li class="row" data-t="${r.tier}"><span class="b t${r.tier}">${r.tier}</span>${extra}<span class="k">${r.kind}·${esc(r.sub)}</span><span class="tx">${esc(r.text)}</span><span class="why">${esc(r.why)}</span></li>`;

async function main(): Promise<void> {
    const sample = JSON.parse(gunzipSync(await readFile(join(NB, "tests/fixtures/sample-100ch.json.gz"))).toString("utf8"));
    const xyj = JSON.parse(await readFile(join(NB, "examples/journey-to-the-west/xiyouji-graph.json"), "utf8"));
    const sampleRecs = compute(sample);
    const a = JSON.parse(await readFile(join(ROOT, "evidences/tiers-run-1.json"), "utf8")).tiers as Record<string, number>;
    const b = JSON.parse(await readFile(join(ROOT, "evidences/tiers-run-2.json"), "utf8")).tiers as Record<string, number>;
    const both = sampleRecs.filter(r => a[r.id] && b[r.id] && r.chapter <= 20);
    const stats: string[] = [];
    for (const kind of ["说法", "对象", "情节", "全部（各类分别排序后合算，仅参考）"] as const) {
        const list = kind.startsWith("全部") ? both : both.filter(r => r.kind === kind);
        const m = list.map(r => (a[r.id]! + b[r.id]!) / 2);
        const rho = spearman(list.map(r => r.score), m.map(x => -x));
        const rhoModel = spearman(list.map(r => -a[r.id]!), list.map(r => -b[r.id]!));
        const same = list.filter(r => r.tier === a[r.id]).length / list.length;
        const hidden = list.filter(r => r.tier === 3);
        const shown = list.filter(r => r.tier === 1);
        const safeHide = hidden.filter(r => !(a[r.id] === 1 && b[r.id] === 1)).length / Math.max(1, hidden.length);
        const goodTop = shown.filter(r => !(a[r.id] === 3 && b[r.id] === 3)).length / Math.max(1, shown.length);
        stats.push(`<tr><td>${kind}</td><td>${list.length}</td><td>${rho.toFixed(2)}</td><td>${rhoModel.toFixed(2)}</td><td>${(same * 100).toFixed(0)}%</td><td>${(safeHide * 100).toFixed(0)}%</td><td>${(goodTop * 100).toFixed(0)}%</td></tr>`);
    }
    // 程序和模型差别最大的说法：程序 1 级、模型两遍都 3 级，反之。
    const progHigh = both.filter(r => r.kind === "说法" && r.tier === 1 && a[r.id] === 3 && b[r.id] === 3).slice(0, 10);
    const modelHigh = both.filter(r => r.kind === "说法" && r.tier === 3 && a[r.id] === 1 && b[r.id] === 1).slice(0, 10);
    const modelRow = (r: Rec) => row(r, `<span class="b m${a[r.id]}" title="模型第一遍">${a[r.id]}</span><span class="b m${b[r.id]}" title="模型第二遍">${b[r.id]}</span>`);
    const stm = both.filter(r => r.kind === "说法");
    const priorOf = (r: Rec) => a[r.id]!;
    const cell = (p: number, ev: number) => stm.filter(r => priorOf(r) === p && r.ev === ev);
    const matrix = `<table><tr><th>先验（模型）＼后验证据</th><th>没有</th><th>有一点</th><th>强</th></tr>${[1, 2, 3].map(p => `<tr><td>${p} 级</td>${[0, 1, 2].map(ev => `<td>${cell(p, ev).length} → ${combine(p, ev)} 级</td>`).join("")}</tr>`).join("")}</table>`;
    const combinedRow = (r: Rec) => row({...r, tier: combine(priorOf(r), r.ev!)} as Rec, `<span class="b m${priorOf(r)}" title="先验（模型第一遍）">${priorOf(r)}</span>`);
    const combo = (p: number, ev: number, n: number) => `<ul>${cell(p, ev).slice(0, n).map(combinedRow).join("")}</ul>`;
    const xyjRecs = compute(xyj);
    const dist = (recs: Rec[]) => [1, 2, 3].map(t => recs.filter(r => r.tier === t).length).join(" / ");
    const chapters = [1, 14, 27, 51].map(ch => {
        const list = xyjRecs.filter(r => r.chapter === ch && r.kind !== "对象").sort((x, y) => (x.kind === "情节" ? 0 : 1) - (y.kind === "情节" ? 0 : 1) || y.score - x.score);
        return `<section class="chap"><h2>西游记第 ${ch} 回（${list.length} 条，按分数从高到低）</h2><input type="radio" name="f${ch}" id="r0-${ch}" checked><label for="r0-${ch}">全部</label><input type="radio" name="f${ch}" id="r2-${ch}"><label for="r2-${ch}">只留 1、2 级</label><input type="radio" name="f${ch}" id="r1-${ch}"><label for="r1-${ch}">只留 1 级</label><ul class="f f${ch}">${list.map(r => row(r)).join("")}</ul></section>`;
    }).join("");
    const cssF = [1, 14, 27, 51].map(ch => `#r2-${ch}:checked ~ ul.f${ch} li[data-t="3"]{display:none}#r1-${ch}:checked ~ ul.f${ch} li:not([data-t="1"]){display:none}`).join("\n");
    const ents = xyjRecs.filter(r => r.kind === "对象").sort((x, y) => y.score - x.score);
    const entTable = (list: Rec[]) => `<ul>${list.map(r => row(r)).join("")}</ul>`;
    if (process.env.DEBUG_ID) for (const r of sampleRecs.filter(x => x.id === process.env.DEBUG_ID)) console.log(r.id, "程序级", r.tier, r.why, "分", r.score.toFixed(2));
    const html = `<!doctype html><html lang="zh"><meta charset="utf-8"><title>t28 程序算的等级</title><style>
body{font:14px/1.6 system-ui,"Noto Sans CJK SC",sans-serif;max-width:1000px;margin:24px auto;padding:0 16px;color:#222}h1{font-size:20px}h2{font-size:16px;margin:26px 0 4px}h3{font-size:14px;margin:14px 0 2px}.note{color:#666;margin:0 0 8px}
ul{list-style:none;padding:0;margin:0}.row{display:flex;gap:8px;align-items:baseline;padding:4px 0;border-bottom:1px solid #eee}
.b{display:inline-block;width:20px;text-align:center;border-radius:4px;color:#fff;font-weight:600;flex:none}.t1{background:#c0392b}.t2{background:#e0a030}.t3{background:#8a98a8}.m1,.m2,.m3{outline:2px solid #2c6;color:#fff}.m1{background:#c0392b}.m2{background:#e0a030}.m3{background:#8a98a8}
.k{flex:none;width:90px;color:#777;font-size:12px}.tx{flex:1}.why{flex:none;width:260px;color:#999;font-size:11px}table{border-collapse:collapse}td,th{border:1px solid #ddd;padding:4px 10px;text-align:right}th:first-child,td:first-child{text-align:left}
.chap label{margin:0 14px 0 3px;cursor:pointer}.chap ul{margin-top:8px}${cssF}</style>
<h1>不用模型，程序算的等级</h1>
<p>程序信号：<b>类别先验</b>（身份、规则、目标、事件偏重要，态度、地点偏次要）、<b>后文活跃度</b>（说法涉及的对象在之后的章里还出场多少次）、<b>被引用次数</b>（被别的说法确认、被秘密收录、被别的角色知情）、涉及对象的多少。每一种记录内按分数分位定级：前 25% 为 1 级，接着 40% 为 2 级，其余为 3 级。不调用任何模型。</p>
<p class="note">“后文”信息是模型在抽取当时拿不到的：整本抽完之后才能算。所以程序等级是“事后补算”，新增章节后要重算。</p>
<h2>一、和模型的对照（样例书前 20 章，427 条）</h2>
<table><tr><th>记录</th><th>条数</th><th>程序分与模型平均级别的 Spearman</th><th>模型两遍之间 Spearman（上限参照）</th><th>程序级与模型第一遍完全一致</th><th>程序 3 级（要被隐藏的）里，模型两遍都没标 1 级的</th><th>程序 1 级里，模型两遍都没标 3 级的</th></tr>${stats.join("")}</table>
<p class="note">上一轮只用类别和对象出场热度的粗打分是 0.33。这一版第一次把主角的出场算进“后文活跃度”时没有区分度（涉及主角的说法后文出场都上千，Spearman 仍只有 0.35），改成不计出场最多的三个主角、只看其余对象后，说法升到 0.45。</p>
<h2>二、程序标 1 级、模型两遍都标 3 级的说法（节选）</h2><p class="note">方块左边是程序等级，右边带绿框的两个是模型两遍。</p><ul>${progHigh.map(modelRow).join("")}</ul>
<h2>三、程序标 3 级、模型两遍都标 1 级的说法（节选）</h2><ul>${modelHigh.map(modelRow).join("")}</ul>
<h2>四、先验加后验：两种信息合起来</h2>
<p>先验是模型在抽取当时给的（一般准，但黑盒），后验是程序事后算的证据（透明、可核对，但不一定准）。合并规则写得出来：证据强则升（先验琐碎的也升到 2，当作“伏笔候选”）；没有证据的先验 1 级降到 2（“待证实”）；其余沿用先验。下面是前 20 章 320 条说法按（先验×后验）分格的条数与合并后的级别，再按格举例（每个方块：左绿框是先验，右是合并后）。</p>
${matrix}
<h3>先验 3 级、后验证据强（升到 2：伏笔候选）</h3>${combo(3, 2, 8)}
<h3>先验 1 级、没有后验证据（降到 2：待证实）</h3>${combo(1, 0, 8)}
<h3>先验 3 级、没有后验证据（保持 3：确实琐碎，例如“叫她们吃饭”）</h3>${combo(3, 0, 8)}
<h2>五、西游记 100 回图上的实际样子（只有程序后验）</h2><p class="note">分布（1/2/3）：说法 ${dist(xyjRecs.filter(r => r.kind === "说法"))}；对象 ${dist(xyjRecs.filter(r => r.kind === "对象"))}；情节 ${dist(xyjRecs.filter(r => r.kind === "情节"))}。点选项切换只看高等级。右边灰字是这条的得分依据。</p>
${chapters}
<h2>六、对象：最重要的 25 个 / 最不重要的 25 个</h2>${entTable(ents.slice(0, 25))}<p class="note">……</p>${entTable(ents.slice(-25))}
</html>`;
    await mkdir(join(ROOT, "artifacts", "program"), {recursive: true});
    await writeFile(join(ROOT, "artifacts", "program", "index.html"), html);
    console.log(stats.map(s => s.replace(/<\/t[dh]><t[dh]>/g, " | ").replace(/<[^>]*>/g, "")).join("\n"));
    console.log("西游记分布 说法", dist(xyjRecs.filter(r => r.kind === "说法")));
}
await main();
