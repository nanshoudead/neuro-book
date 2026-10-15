/**
 * 写回（docs/specs/workspace/markdown-dialect.md 输出 1–3）：编辑器的文档 → 原文。
 *
 * 1. 分项：没被编辑的块（节点对象还挂着来源、同一块的节点都还在且相邻）写原文；其余顶层节点各自重新写出。顶层的空段落是间隔。
 *    节点有几代来源时（撤销）对全篇选一种切法，见 `itemsOf`。
 * 2. 间隔：前后两块（或文件首尾）这一对在原文对照里登记过、空段落数也没变，写登记的原文；否则按空段落数重新生成。
 * 3. 读回校验：重新写出的块与重新生成的间隔，连同前后各一块读回来，与编辑器里的节点比（`compare.ts`）。对不上时按降级阶梯换
 *    写法；没被编辑、但被这次写出影响了的相邻块（例如没闭合的代码围栏吞掉了后面的新段落）也重新写出。都不行就是写不出。
 * 4. 成功后由调用方在提交被接受时调用 `record`：重新写出的块换成新的来源、全部间隔登记进原文对照。
 *
 * 判断“没被编辑”靠节点对象：ProseMirror 的编辑只替换改动处的节点，其余顶层子节点还是读入时的同一个对象。
 */

import type {Node as PMNode, Schema} from "@tiptap/pm/model";

import type {MarkdownLanguage} from "../language";
import type {WriteOptions} from "../syntax/types";
import {Unrepresentable} from "../syntax/types";
import {equivalent} from "./compare";
import type {Definitions, Gap, SourceMap, SourceUnit} from "./read";
import {END, START, emptiesBetween, emptiesLeading, emptiesTrailing, readBody, recordGap} from "./read";
import {renderBlock} from "./render";
import {splitFrontmatter} from "./source";
import {SENTINEL, stripSentinels} from "./render/escape";
import {follow} from "./render/inline";

export type WriteResult =
    | {readonly ok: true; readonly text: string; readonly record: () => void}
    | {readonly ok: false; readonly code: "unrepresentable"; readonly from: number; readonly to: number; readonly reason: string};

/**
 * 降级阶梯（方言 Spec 输出 3），按顺序试。分开相邻列表的“换符号”是每一项自己的标记（`Item.alternate`），升级时不丢；
 * 相邻未动块的重新写出也不在这里，见 `writeMarkdown`。
 */
const LADDER: ReadonlyArray<Omit<WriteOptions, "alternate">> = [
    {styles: "keep", escape: "minimal", htmlEmphasis: false},
    {styles: "canonical", escape: "minimal", htmlEmphasis: false},
    {styles: "canonical", escape: "full", htmlEmphasis: false},
    {styles: "canonical", escape: "full", htmlEmphasis: true},
];
const FULL_ESCAPE_LEVEL = 2;
/** 列表符号最多轮换几次（无序列表有三种符号）。 */
const MARKER_ROTATIONS = 3;
/** 完全转义之后逐个试撤的候选上限：到上限保留剩下的转义，读得回来，只是不最小。 */
const UNDO_LIMIT = 32;
/** 一个节点最多记几代来源（见 `SourceMap.origins`）。 */
const ORIGIN_HISTORY = 8;

/** 一项：一块原文，或一个要重新写出的顶层节点。 */
interface Item {
    readonly nodes: ReadonlyArray<PMNode>;
    /** 写原文时是它的来源；重新写出时为 null。 */
    unit: SourceUnit | null;
    /** 前面的空段落数。 */
    readonly empties: number;
    readonly from: number;
    readonly to: number;
    /** 重新写出时用到阶梯的第几级（写原文为 -1）。 */
    level: number;
    /** 列表的符号轮换几次（见 `WriteOptions.alternate`）：它和前一块读回合成了一个列表。 */
    alternate: number;
    text: string;
}

const isEmptyParagraph = (node: PMNode): boolean => node.type.name === "paragraph" && node.childCount === 0;

/**
 * 把文档切成项：哪些节点写原文、各用哪一块原文。一个节点可能有几代来源都完整（撤销恢复了旧节点，而其中有的节点后来随邻居
 * 重新写出过），所以对全篇选一种切法：没登记过的间隔最少（同一代的块挨在一起），其次写原文的节点最多。再分不出时
 * 用旧的来源：这时让节点重新写出的起因不在相邻的块（例如引用定义变了），旧的来源若已不适用，依赖上下文的校验会把它改写掉
 * （`dependsOnChangedDefinition`）；用新的则撤销回去时写不回原文的字节。
 */
function itemsOf(doc: PMNode, map: SourceMap): {items: Item[]; trailing: number} {
    const children: Array<{node: PMNode; pos: number}> = [];
    doc.forEach((node, pos) => children.push({node, pos}));
    // 内容节点（空段落属于间隔）与它们前面的空段落数。
    const contents: number[] = [];
    const emptiesBefore: number[] = [];
    let empties = 0;
    children.forEach(({node}, index) => {
        if (isEmptyParagraph(node)) {
            empties += 1;
            return;
        }
        contents.push(index);
        emptiesBefore.push(empties);
        empties = 0;
    });
    const trailing = empties;
    /** 从第 k 个内容节点开始的、完整的来源（它的每一部分都按顺序紧挨着在这里），新的在前。 */
    const candidates = contents.map((index) =>
        (map.origins.get((children[index] as {node: PMNode}).node) ?? [])
            .filter((origin) => {
                if (origin.part !== 0) return false;
                const run = children.slice(index, index + origin.unit.size);
                return run.length === origin.unit.size && run.every((child, part) => map.origins.get(child.node)?.some((other) => other.unit === origin.unit && other.part === part) === true);
            })
            .map((origin) => origin.unit),
    );
    const unknown = (before: object | null, after: object | null, between: number): number => (before !== null && after !== null && map.gaps.get(before)?.get(after)?.has(between) === true ? 0 : 1);

    // 从后往前：best[k] 是“前一项的来源为 key（重新写出的为 null）时，从第 k 个内容节点到结尾的最好切法”。
    interface Plan {
        readonly unknown: number;
        readonly covered: number;
        /** 第 k 个内容节点用哪块原文；null 是重新写出。 */
        readonly unit: SourceUnit | null;
    }
    const better = (left: Plan, right: Plan): boolean => left.unknown < right.unknown || (left.unknown === right.unknown && left.covered > right.covered);
    const best: Array<Map<object | null, Plan>> = Array.from({length: contents.length + 1}, () => new Map());
    const previousKeys: Array<Set<object | null>> = Array.from({length: contents.length + 1}, () => new Set());
    previousKeys[0]?.add(START);
    contents.forEach((_, k) => {
        previousKeys[k + 1]?.add(null);
        for (const unit of candidates[k] as SourceUnit[]) previousKeys[k + unit.size]?.add(unit);
    });
    for (let k = contents.length; k >= 0; k -= 1) {
        for (const previous of previousKeys[k] as Set<object | null>) {
            if (k === contents.length) {
                (best[k] as Map<object | null, Plan>).set(previous, {unknown: unknown(previous, END, trailing), covered: 0, unit: null});
                continue;
            }
            const rest = (best[k + 1] as Map<object | null, Plan>).get(null) as Plan;
            // 重新写出的项与前一项之间的间隔总是新生成的。
            let plan: Plan = {unknown: 1 + rest.unknown, covered: rest.covered, unit: null};
            // 候选新的在前：同分时后到的（旧的）替换，写原文与重新写出同分时也写原文。
            for (const unit of candidates[k] as SourceUnit[]) {
                const after = (best[k + unit.size] as Map<object | null, Plan>).get(unit) as Plan;
                const option: Plan = {unknown: unknown(previous, unit, emptiesBefore[k] as number) + after.unknown, covered: unit.size + after.covered, unit};
                if (!better(plan, option)) plan = option;
            }
            (best[k] as Map<object | null, Plan>).set(previous, plan);
        }
    }

    const items: Item[] = [];
    let previous: object | null = START;
    for (let k = 0; k < contents.length; ) {
        const unit: SourceUnit | null = ((best[k] as Map<object | null, Plan>).get(previous) as Plan).unit;
        const index = contents[k] as number;
        const first = children[index] as {node: PMNode; pos: number};
        const size = unit?.size ?? 1;
        const last = children[index + size - 1] as {node: PMNode; pos: number};
        const nodes = children.slice(index, index + size).map((child) => child.node);
        items.push({nodes, unit, empties: emptiesBefore[k] as number, from: first.pos, to: last.pos + last.node.nodeSize, level: unit === null ? 0 : -1, alternate: 0, text: unit?.raw ?? ""});
        previous = unit;
        k += size;
    }
    return {items, trailing};
}

/** 全篇的引用定义（顶层的原样块里的 `[标签]: 地址`）：写出时判断 `[注]` 要不要转义，读回时预置进词法器。 */
const DEFINITION = /^ {0,3}\[((?:\\.|[^\]\\])+)\]:[ \t]*\n?[ \t]*(<[^>\n]*>|\S+)(?:[ \t]+(?:"([^"]*)"|'([^']*)'|\(([^)]*)\)))?[ \t]*$/u;

/**
 * 全篇的引用定义：同名的取全篇第一条（Markdown 的规则）。`skip` 里的节点（读回的窗口里的定义）：标签的第一条定义在窗口里时
 * 不预置这个标签，让窗口里的定义自己生效；预置了，窗口里的那条反倒成了“重复的”被丢掉。
 */
function definitionsOf(doc: PMNode, skip: ReadonlySet<PMNode> = new Set()): Definitions {
    const first = new Map<string, {node: PMNode; href: string; title: string | null}>();
    doc.forEach((node) => {
        if (node.type.name !== "rawBlock") return;
        const matched = DEFINITION.exec(String(node.attrs.raw ?? ""));
        if (matched === null) return;
        const label = (matched[1] as string).trim().toLowerCase().replace(/\s+/gu, " ");
        if (!first.has(label)) first.set(label, {node, href: (matched[2] as string).replace(/^<|>$/gu, ""), title: matched[3] ?? matched[4] ?? matched[5] ?? null});
    });
    const definitions: Record<string, {href: string; title: string | null}> = {};
    for (const [label, {node, href, title}] of first) if (!skip.has(node)) definitions[label] = {href, title};
    return definitions;
}

/** 重新写出的文字换成原文的换行符；原样内容里自带的 `\r\n` 不动。 */
const withEol = (text: string, eol: "\n" | "\r\n"): string => (eol === "\n" ? text : text.replace(/(?<!\r)\n/gu, "\r\n"));

export function writeMarkdown(doc: PMNode, map: SourceMap, language: MarkdownLanguage, schema: Schema): WriteResult {
    const {items, trailing} = itemsOf(doc, map);
    const eol = map.eol;
    // 整篇没有内容（只有空段落：没有块就没有间隔，几个空段落都读成一个）：读入时就没有块的，写原文的空白；否则写空正文（输出 2）。
    if (items.length === 0) {
        const text = map.prefix + (map.emptyBody ?? "");
        return {ok: true, text, record: () => undefined};
    }
    const definitions = definitionsOf(doc);
    const labels = new Map(Object.entries(definitions).map(([label, value]) => [label, value.href]));
    const emphasis = new Set([...language.markWriters].filter(([, writer]) => writer.emphasis === true).map(([type]) => type));

    /** 第 i 项之前的间隔（i 等于项数时是结尾）：登记过就用登记的原文，否则重新生成。 */
    const gapAt = (index: number): {gap: Gap; kept: boolean} => {
        const before = index === 0 ? START : items[index - 1]?.unit ?? null;
        const after = index === items.length ? END : items[index]?.unit ?? null;
        const empties = index === items.length ? trailing : (items[index] as Item).empties;
        if (before !== null && after !== null) {
            const known = map.gaps.get(before)?.get(after)?.get(empties);
            if (known !== undefined) return {gap: known, kept: true};
        }
        if (index === 0) return {gap: {raw: eol.repeat(empties), empties}, kept: false};
        // 结尾：`k` 个空段落是 `k` 个空行加文件末尾的换行；没有空段落时按原文末尾有没有换行。
        if (index === items.length) return {gap: {raw: empties === 0 ? (map.finalNewline ? eol : "") : eol.repeat(empties + 1), empties}, kept: false};
        return {gap: {raw: eol.repeat(empties + 2), empties}, kept: false};
    };
    let gaps = items.map((_, index) => gapAt(index)).concat([gapAt(items.length)]);

    const render = (item: Item): boolean => {
        try {
            item.text = renderBlock(language, item.nodes[0] as PMNode, {...(LADDER[item.level] as Omit<WriteOptions, "alternate">), alternate: item.alternate}, labels);
            return true;
        } catch (error) {
            if (error instanceof Unrepresentable) return false;
            throw error;
        }
    };

    /**
     * 读回窗口 [first, last]：开头、结尾的间隔只在窗口挨着文件首尾时带上。返回第一个对不上的项（都对上为 -1），以及读回的块
     * 是不是比预期少（有块被前一块吞了：两个列表合成一个、缩进代码被读进列表项……）。
     */
    const check = (first: number, last: number, override?: {index: number; text: string}): {item: number; absorbed: boolean} => {
        const parts: string[] = [];
        const expected: Array<{node: PMNode; item: number}> = [];
        const empty = schema.nodes.paragraph!.create();
        const pushEmpties = (count: number, item: number): void => {
            for (let n = 0; n < count; n += 1) expected.push({node: empty, item});
        };
        if (first === 0) {
            parts.push((gaps[0] as {gap: Gap}).gap.raw);
            pushEmpties(emptiesLeading((gaps[0] as {gap: Gap}).gap.raw), 0);
        }
        for (let index = first; index <= last; index += 1) {
            const item = items[index] as Item;
            if (index > first) {
                const gap = (gaps[index] as {gap: Gap}).gap.raw;
                parts.push(gap);
                pushEmpties(emptiesBetween(gap), index);
            }
            parts.push(stripSentinels(override?.index === index ? override.text : item.text));
            for (const node of item.nodes) expected.push({node, item: index});
        }
        if (last === items.length - 1) {
            const gap = (gaps[items.length] as {gap: Gap}).gap.raw;
            parts.push(gap);
            pushEmpties(emptiesTrailing(gap), last);
        }
        // 窗口外的引用定义预置进词法器；窗口里的不预置，让 `marked` 照常读它们（预置了同名的，窗口里的会被当成重复的丢掉）。
        const inside = new Set(items.slice(first, last + 1).flatMap((item) => item.nodes));
        const read = readBody(language, schema, "", parts.join(""), definitionsOf(doc, inside)).doc;
        const count = Math.max(read.childCount, expected.length);
        for (let at = 0; at < count; at += 1) {
            const want = expected[at];
            if (want === undefined) return {item: last, absorbed: false};
            if (at >= read.childCount) return {item: want.item, absorbed: true};
            // 没被编辑的块（写原文）只比结构：它的写法就是原文，编辑器里记着的写法可能是上一次规范写法写出前的。
            const level = (items[want.item] as Item).level;
            const styles = level === 0 ? "keep" : "canonical";
            if (!equivalent(want.node, read.child(at), {styles, emphasis, derived: language.derivedAttrs, markless: language.marklessInline, follow})) return {item: want.item, absorbed: read.childCount < expected.length};
        }
        return {item: -1, absorbed: false};
    };
    const mismatch = (first: number, last: number, override?: {index: number; text: string}): number => check(first, last, override).item;

    // 要校验的项：重新写出的，以及挨着重新生成的间隔的。连在一起的几项合成一个窗口，两头各多带一块。
    const windows = (): Array<[number, number]> => {
        const marked = new Set<number>();
        items.forEach((item, index) => {
            if (item.unit === null || dependsOnChangedDefinition(item, definitions)) marked.add(index);
        });
        gaps.forEach(({kept}, index) => {
            if (kept) return;
            if (index > 0) marked.add(index - 1);
            if (index < items.length) marked.add(index);
        });
        const sorted = [...marked].sort((left, right) => left - right);
        const out: Array<[number, number]> = [];
        for (let at = 0; at < sorted.length; at += 1) {
            let end = at;
            while (end + 1 < sorted.length && (sorted[end + 1] as number) <= (sorted[end] as number) + 2) end += 1;
            out.push([Math.max(0, (sorted[at] as number) - 1), Math.min(items.length - 1, (sorted[end] as number) + 1)]);
            at = end;
        }
        return out;
    };
    const rerenderGaps = (): void => {
        gaps = items.map((_, index) => gapAt(index)).concat([gapAt(items.length)]);
    };
    /** 把一项升到阶梯的某一级（写原文的项先改成重新写出）；升不上去（写法抛 `Unrepresentable`）就继续往上。 */
    const raise = (item: Item, level: number): void => {
        if (item.unit !== null) {
            item.unit = null;
            rerenderGaps();
        }
        item.level = Math.max(item.level, level);
        while (!render(item) && item.level < LADDER.length - 1) item.level += 1;
    };
    /**
     * 窗口里读不回来时，按方言 Spec 输出 3 的阶梯整体推进，每一步作用于窗口里的全部候选项，推进后再校验，过了就停。
     * 只会越来越保守，不会来回震荡。
     */
    interface Failure {
        readonly item: Item;
        /** 出问题的项前后的项（合并可能发生在任一边：两个列表之间的空段落被吞掉时，报出的是后一个列表）。 */
        readonly previous: Item | undefined;
        readonly next: Item | undefined;
        readonly absorbed: boolean;
    }
    const steps: ReadonlyArray<(window: ReadonlyArray<Item>, failure: Failure) => void> = [
        (window) => window.forEach((item) => item.unit === null && item.level < 1 && raise(item, 1)),
        // 两个同组的列表读回合成了一个：换其中一个的符号（方言 Spec 输出 3），换成与它前后两个都不同的。优先换重新写出的那个，
        // 两个都重新写出时换后一个。只动真的合并了的那一对。
        (_window, failure) => {
            if (!failure.absorbed) return;
            const pair = [[failure.item, failure.next], [failure.previous, failure.item]].find(([left, right]) => left !== undefined && right !== undefined && listFamily(right.nodes[0]) !== null && listFamily(left.nodes.at(-1)) === listFamily(right.nodes[0]));
            if (pair === undefined) return;
            const [left, right] = pair as [Item, Item];
            const family = listFamily(right.nodes[0]);
            const target = left.unit === null && right.unit !== null ? left : right;
            // 三种符号都试过了：合并另有原因，不再换（否则状态一直在变，循环要跑满上限）。
            if (target.alternate >= MARKER_ROTATIONS) return;
            const index = items.indexOf(target);
            const around = [items[index - 1], items[index + 1]].filter((other) => other !== undefined && listFamily(other.nodes.at(-1)) === family).map((other) => markerOf(other as Item));
            for (let times = target.alternate + 1; times <= MARKER_ROTATIONS; times += 1) {
                target.alternate = times;
                raise(target, target.unit === null ? target.level : 0);
                if (!around.includes(markerOf(target))) return;
            }
        },
        // 没被编辑的块自己读不回来（被这次写出影响了，例如没闭合的代码围栏吞掉了后面的新段落）：重新写出它；它吞掉了后一块时
        // 后一块也重新写出（例如缩进代码被读进前面的列表项）。保持原写法：规范写法会把相邻列表各自的符号都改回 `-`。
        (_window, failure) => {
            const rewritable = (item: Item | undefined): item is Item => item !== undefined && item.unit !== null && item.nodes[0]?.type.name !== "rawBlock" && item.nodes.length === 1;
            if (rewritable(failure.item)) raise(failure.item, 0);
            if (failure.absorbed && rewritable(failure.next)) raise(failure.next, 0);
        },
        (window) => window.forEach((item) => item.unit === null && raise(item, FULL_ESCAPE_LEVEL)),
        (window) => window.forEach((item) => item.unit === null && raise(item, LADDER.length - 1)),
    ];
    // 第 0 级写不出（例如没有表头的表格）就往上试；最高一级仍写不出由校验报告。
    for (const item of items) if (item.unit === null) raise(item, 0);
    // 推进过的项可能让别的间隔重新生成、窗口变大：直到所有窗口都读得回来。每一轮至少有一项升了级，所以有上限。
    let lastState = "";
    for (let round = 0; ; round += 1) {
        const failing = windows().map(([first, last]) => ({first, last, ...check(first, last)})).find((window) => window.item >= 0);
        if (failing === undefined) break;
        let failed = failing.item;
        let absorbed = failing.absorbed;
        for (let step = 0; failed >= 0 && step < steps.length; step += 1) {
            (steps[step] as (window: ReadonlyArray<Item>, failure: Failure) => void)(items.slice(failing.first, failing.last + 1), {item: items[failed] as Item, previous: items[failed - 1], next: items[failed + 1], absorbed});
            ({item: failed, absorbed} = check(failing.first, failing.last));
        }
        // 这一遍有项升了级或换了符号就再来一遍（例如几个相邻列表要依次换符号）；没有变化、或轮数用完才是写不出。
        const state = items.map((item) => `${item.unit === null ? "r" : "u"}${item.level}.${item.alternate}`).join(",");
        if (failed >= 0 && (state === lastState || round > items.length * steps.length)) {
            const item = items[failed] as Item;
            return unrepresentable(item, item.unit === null ? "各级写法都读不回来" : "前面没闭合的原样内容吞掉了后面的内容");
        }
        lastState = state;
    }

    // 完全转义的块：从后往前逐个试撤转义，撤了还读得回来就撤（输出 4 的“最小”）。
    items.forEach((item, index) => {
        if (item.level < FULL_ESCAPE_LEVEL || !item.text.includes(SENTINEL)) return;
        const positions: number[] = [];
        for (let at = item.text.indexOf(SENTINEL); at >= 0; at = item.text.indexOf(SENTINEL, at + 1)) positions.push(at);
        for (const position of positions.reverse().slice(0, UNDO_LIMIT)) {
            const candidate = item.text.slice(0, position) + item.text.slice(position + 2);
            if (mismatch(Math.max(0, index - 1), Math.min(items.length - 1, index + 1), {index, text: candidate}) < 0) item.text = candidate;
        }
        item.text = stripSentinels(item.text);
    });

    // 正文开头不能被读成 frontmatter：原文没有 frontmatter 时，开头的 `---`（挪到最前面的分割线）会和后面的 `---` 配成一对。
    const first = items[0] as Item;
    const assemble = (): string => {
        const parts: string[] = [map.prefix];
        items.forEach((item, index) => parts.push((gaps[index] as {gap: Gap}).gap.raw, item.unit === null ? withEol(item.text, eol) : item.text));
        parts.push((gaps[items.length] as {gap: Gap}).gap.raw);
        return parts.join("");
    };
    if (splitFrontmatter(assemble()).prefix !== map.prefix) {
        if (first.nodes[0]?.type.name !== "horizontalRule") return unrepresentable(first, "正文开头会被读成 frontmatter");
        first.unit = null;
        first.text = "***";
        rerenderGaps();
    }
    const texts = items.map((item) => (item.unit === null ? withEol(item.text, eol) : item.text));
    const out: string[] = [map.prefix];
    items.forEach((_, index) => out.push((gaps[index] as {gap: Gap}).gap.raw, texts[index] as string));
    out.push((gaps[items.length] as {gap: Gap}).gap.raw);
    return {
        ok: true,
        text: out.join(""),
        record: () => {
            const units = items.map((item, index) => item.unit ?? {raw: texts[index] as string, size: item.nodes.length});
            units.forEach((unit, index) => (items[index] as Item).nodes.forEach((node, part) => {
                const known = map.origins.get(node) ?? [];
                if (known[0]?.unit === unit) return;
                // 同一个节点反复被重新写出时来源会一直加：只留最近的几代。
                map.origins.set(node, [{unit, part}, ...known].slice(0, ORIGIN_HISTORY));
            }));
            for (let index = 0; index <= items.length; index += 1) {
                recordGap(map, index === 0 ? START : (units[index - 1] as SourceUnit), index === items.length ? END : (units[index] as SourceUnit), (gaps[index] as {gap: Gap}).gap);
            }
        },
    };
}

/** 列表写出来的符号（无序的 `-`、`*`、`+`，有序的分隔符），从写出的文字取。 */
function markerOf(item: Item): string {
    return /^\s*(?:\d+([.)])|([-*+]))/u.exec(item.text)?.slice(1).find((part) => part !== undefined) ?? "";
}

/**
 * 依赖上下文的块：没被编辑，但它依赖的引用定义没了或地址变了（引用式链接、引用式图片）。它要列入校验，读不回来时按阶梯改写
 * （改成行内链接）。
 */
function dependsOnChangedDefinition(item: Item, definitions: Definitions): boolean {
    let changed = false;
    const reference = (style: unknown, text: string): string | null => {
        const value = style as {style?: string; label?: string} | null;
        if (value?.style === "reference") return (value.label ?? "").trim().toLowerCase();
        if (value?.style === "collapsed" || value?.style === "shortcut") return text.trim().toLowerCase();
        return null;
    };
    for (const node of item.nodes) {
        node.descendants((child) => {
            for (const mark of child.marks) {
                if (mark.type.name !== "link") continue;
                const label = reference(mark.attrs.markdown, child.textContent);
                if (label !== null && definitions[label]?.href !== mark.attrs.href) changed = true;
            }
            if (child.type.name === "image") {
                const label = reference(child.attrs.markdown, "");
                if (label !== null && definitions[label]?.href !== child.attrs.src) changed = true;
            }
        });
    }
    return changed;
}

/** 会读成同一个列表的几类：无序列表与任务列表（符号相同就合并），有序列表。不是列表为 null。 */
function listFamily(node: PMNode | undefined): "bullet" | "ordered" | null {
    switch (node?.type.name) {
        case "bulletList":
        case "taskList":
            return "bullet";
        case "orderedList":
            return "ordered";
        default:
            return null;
    }
}

function unrepresentable(item: Item, reason: string): WriteResult {
    return {ok: false, code: "unrepresentable", from: item.from, to: item.to, reason};
}
