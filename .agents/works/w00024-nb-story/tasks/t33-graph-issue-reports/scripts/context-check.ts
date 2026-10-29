/**
 * t33 的截断核对（plan.md 的“上下文与已有记录”）：用最终图直接渲染第 k 章的“已有记录”，与把图截到第 k-1 章之后再渲染，
 * 逐行比较，列出不同的行。2026-10-28 在本样本上跑出的唯一差别是秘密的“相关说法”列出了后面章节的说法编号，所以实验一律
 * 用截断后的图（`truncate`），不直接渲染最终图。
 *
 *   bun context-check.ts [图文件] [--from 18] [--to 30]
 *
 * 截断按位置逐层去掉：顶层记录看 `at`（段落块看 `chapter`，整理产物看 `through`），对象的称呼、疑问的更新、秘密引用的说法、
 * 说法的前提也按位置去掉。它只能说明“直接渲染”与“截断后渲染”一致，不能证明二者都等于真实抽取时的 prior（合并历史从
 * 最终图里恢复不出来）；本样本的合并另行核对过，见 plan.md。
 */

import {join} from "node:path";

import {renderContext} from "../../../../../../packages/nb-story/src/ingest/context";
import type {Dataset} from "../../../../../../packages/nb-story/src/core/dataset";

const REPO = join(import.meta.dir, "../../../../../..");
export const DEFAULT_GRAPH = join(REPO, ".local/agent/works/w00024-nb-story/tasks/t33-graph-issue-reports/data/graph-164.json");

type Positioned = {at?: {chapter: number}; chapter?: number; through?: number};
const chapterOf = (item: Positioned): number => item.at?.chapter ?? item.chapter ?? item.through ?? 0;

/** 把图截到第 `through` 章：之后的记录、称呼、更新与引用都去掉。 */
export function truncate(graph: Dataset, through: number): Dataset {
    const keep = <T>(items: T[]) => items.filter(item => chapterOf(item as Positioned) <= through);
    const copy = structuredClone(graph) as unknown as Record<string, unknown>;
    for (const [key, value] of Object.entries(copy)) {
        if (Array.isArray(value) && key !== "sources") copy[key] = keep(value);
    }
    const truncated = copy as unknown as Dataset;
    truncated.sources = graph.sources.filter(source => source.chapter <= through);
    const statementIds = new Set(truncated.statements.map(statement => statement.id));
    for (const entity of truncated.entities) entity.names = entity.names.filter(name => name.at.chapter <= through);
    for (const question of truncated.questions) question.updates = (question.updates ?? []).filter(update => update.at.chapter <= through);
    for (const secret of truncated.secrets) secret.statements = secret.statements.filter(id => statementIds.has(id));
    for (const statement of truncated.statements) statement.premises = statement.premises.filter(id => statementIds.has(id));
    truncated.through = {chapter: through, paragraph: graph.sources.find(source => source.chapter === through)?.paragraphs.length ?? 1};
    return truncated;
}

if (import.meta.main) {
    const args = process.argv.slice(2);
    const option = (flag: string, fallback: number) => {
        const index = args.indexOf(flag);
        return index >= 0 ? Number(args.splice(index, 2)[1]) : fallback;
    };
    const from = option("--from", 18), to = option("--to", 30);
    const graph = (await Bun.file(args[0] ?? DEFAULT_GRAPH).json()) as Dataset;
    let failed = 0;
    for (let chapter = from; chapter <= to; chapter++) {
        const source = graph.sources.find(item => item.chapter === chapter)!;
        const focus = {text: source.paragraphs.join("\n")};
        const direct = renderContext(graph, chapter - 1, focus);
        const cut = renderContext(truncate(graph, chapter - 1), chapter - 1, focus);
        const same = direct === cut;
        if (!same) failed++;
        console.log(`第 ${chapter} 章：${same ? "相同" : "不同"}（${direct.length} 字）`);
        if (!same) {
            const kept = new Set(cut.split("\n")), shown = new Set(direct.split("\n"));
            for (const line of direct.split("\n")) if (!kept.has(line)) console.log(`  只在直接渲染里：${line}`);
            for (const line of cut.split("\n")) if (!shown.has(line)) console.log(`  只在截断后里：${line}`);
        }
    }
    // 全书扫描（C 组）用的不裁剪的渲染，也核对一次。
    const whole = renderContext(graph, to) === renderContext(truncate(graph, to), to);
    console.log(`截至第 ${to} 章的完整记录：${whole ? "相同" : "不同"}`);
    if (failed || !whole) process.exit(1);
}
