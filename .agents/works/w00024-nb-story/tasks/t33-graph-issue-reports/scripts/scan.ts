/**
 * t33 的 P 组（程序扫描）：不调模型，只按规则在截至第 N 章的图里找可疑的地方。既是对照组，也是金标的候选来源（候选要回原文
 * 核实后才进金标，见 plan.md 的“金标”）。
 *
 *   bun scan.ts [图文件] [--through 30] [--json 输出文件]
 *
 * 图文件缺省是 .local 下拷来的 graph-164.json。只看 `at` 在第 N 章及之前的记录与称呼。
 */

import {writeFile} from "node:fs/promises";
import {join} from "node:path";

import {allGeneric, isGenericName} from "../../../../../../packages/nb-story/src/core/generic-names";

const REPO = join(import.meta.dir, "../../../../../..");
const DEFAULT_GRAPH = join(REPO, ".local/agent/works/w00024-nb-story/tasks/t33-graph-issue-reports/data/graph-164.json");

// 照抄 packages/nb-story/src/ingest/reconcile.ts 的 IDENTITY_HINT（那边没有导出）：只认揭示身份时的说法。
const IDENTITY_HINT = /真名|真实身份|本名|真身|变身后的|原来就是|其实就是|竟是|竟然是|居然是|就是[^，。！？]{0,4}(?:本人|自己)/u;
// identity 说法的文字里应当出现的词：是、就是、账号、名字、身份、化名……都没有时，多半是把别的事记成了身份。
const IDENTITY_WORDS = /是|账号|名字|昵称|身份|化名|马甲|真名|本名|自称|署名/u;

type At = {chapter: number; paragraph: number};
type Name = {text: string; at: At};
type Entity = {id: string; kind: string; label: string; at: At; names: Name[]};
type Statement = {id: string; text: string; family: string; about: string[]; at: At; source: {evidence: {chapter: number; from: number; to: number}[]}};
type Graph = {entities: Entity[]; statements: Statement[]; sources: {chapter: number; paragraphs: string[]}[]};

export interface Candidate {
    rule: string;
    records: string[];
    detail: string;
}

export function scan(graph: Graph, through: number): Candidate[] {
    const upTo = (at: At) => at.chapter <= through;
    const entities = graph.entities.filter(entity => upTo(entity.at)).map(entity => ({...entity, names: entity.names.filter(name => upTo(name.at))}));
    const statements = graph.statements.filter(statement => upTo(statement.at));
    const out: Candidate[] = [];
    const show = (entity: Entity) => `${entity.id}（${entity.kind}，${entity.names.map(name => name.text).join("/") || "无称呼"}｜${entity.label}）`;

    // 1. 称呼全是泛称的人物、马甲、组织。
    for (const entity of entities) {
        if (["person", "persona", "group"].includes(entity.kind) && allGeneric(entity.names)) out.push({rule: "全泛称", records: [entity.id], detail: show(entity)});
    }
    // 2. 没有任何 identity 说法相连的马甲。
    const linked = new Set(statements.filter(statement => statement.family === "identity").flatMap(statement => statement.about));
    for (const entity of entities) {
        if (entity.kind === "persona" && !linked.has(entity.id)) out.push({rule: "马甲没连", records: [entity.id], detail: show(entity)});
    }
    // 3. identity 说法的文字不像在说身份。
    for (const statement of statements) {
        if (statement.family === "identity" && !IDENTITY_WORDS.test(statement.text)) out.push({rule: "身份说法不像身份", records: [statement.id], detail: statement.text});
    }
    // 4. 同一个非泛称的称呼挂在两个对象上。
    const owners = new Map<string, string[]>();
    for (const entity of entities) for (const name of new Set(entity.names.map(item => item.text))) {
        if (isGenericName(name) || name.length < 2) continue;
        owners.set(name, [...(owners.get(name) ?? []), entity.id]);
    }
    for (const [name, ids] of owners) if (ids.length > 1) out.push({rule: "称呼重名", records: ids, detail: `“${name}”挂在 ${ids.join("、")}`});
    // 5. 原文里像在揭示身份、出现两个已知称呼，却没有 identity 说法引用这一段。
    const identityParas = new Set(statements.filter(statement => statement.family === "identity").flatMap(statement => statement.source.evidence.flatMap(range => Array.from({length: range.to - range.from + 1}, (_, offset) => `${range.chapter}.${range.from + offset}`))));
    const known = [...new Set(entities.flatMap(entity => entity.names.map(name => name.text)))].filter(name => name.length >= 2 && !isGenericName(name));
    for (const source of graph.sources) {
        if (source.chapter > through) break;
        source.paragraphs.forEach((text, index) => {
            const key = `${source.chapter}.${index + 1}`;
            if (!IDENTITY_HINT.test(text) || identityParas.has(key)) return;
            const hits = known.filter(name => text.includes(name));
            if (new Set(hits).size >= 2) out.push({rule: "像揭示身份", records: [], detail: `${key} ${text.slice(0, 80)}（称呼：${hits.join("、")}）`});
        });
    }
    return out;
}

if (import.meta.main) {
    const args = process.argv.slice(2);
    const option = (flag: string) => {
        const index = args.indexOf(flag);
        return index >= 0 ? args.splice(index, 2)[1] : undefined;
    };
    const through = Number(option("--through") ?? 30);
    const jsonOut = option("--json");
    const graph = (await Bun.file(args[0] ?? DEFAULT_GRAPH).json()) as Graph;
    const candidates = scan(graph, through);
    const counts = new Map<string, number>();
    for (const item of candidates) counts.set(item.rule, (counts.get(item.rule) ?? 0) + 1);
    console.log(`截至第 ${through} 章：${candidates.length} 条候选（${[...counts].map(([rule, count]) => `${rule} ${count}`).join("，")}）`);
    for (const item of candidates) console.log(`[${item.rule}] ${item.detail}`);
    if (jsonOut) await writeFile(jsonOut, JSON.stringify(candidates, null, 2));
}
