/**
 * 批注（docs/specs/workspace/markdown-dialect.md 输出 11）：行内 `<comment body="意见">正文</comment>`、块（开闭标签各自独占
 * 一行）与分截（每段一截行内批注，同一个 `id`，`body` 只在第一截）。旧写法 `<inline-comment>` 能读，写回成 `<comment>`。
 *
 * 编辑器里的表示：行内与分截都是 `comment` 标记，块是 `commentBlock` 节点。一条批注的各截是同一个标记（属性相同），
 * 所以标记带一个只在内存里的 `key` 区分“意见相同但不是同一条”的批注；它不写进文件，读入时按分组新分配。
 *
 * - 读：每个开标签是一截。整篇读完后按输出 11 的归属规则分组（`resolve`）：带 `body` 的截开一条新批注，没有 `body` 的截归
 *   文件顺序上它之前最近的、同 `id` 的那条，之前没有时归之后第一条，都没有时自成一条（意见为空）。同组的截拿到同样的
 *   `body` 与 `key`。
 * - 写：一条批注在写出时是几段（`prepareWrite` 用编解码器给的写出安排数）：多于一段时每段写同一个 `id`
 *   （没有就分配这个文件里没用过的最小的 `c` 加数字），`body` 只写在第一段。
 * - 上下文：带意见的那一截所在的块被删掉、或者一条批注新跨了块时，没被编辑的块的原文可能缺 `id` 或意见，按
 *   `contextDependents` 重新写出。`id`、`body`、`key` 由跨块的分组决定，读回一个窗口时对不上，读回校验不比较它们。
 */

import {Mark, mergeAttributes, Node} from "@tiptap/core";
import type {CommandProps} from "@tiptap/core";
import type {JSONContent} from "@tiptap/core";
import {Fragment, Slice} from "@tiptap/pm/model";
import type {Mark as PMMark, Node as PMNode} from "@tiptap/pm/model";
import {Plugin, PluginKey} from "@tiptap/pm/state";
import {findWrapping} from "@tiptap/pm/transform";
import type {MarkedExtension, Token, Tokens} from "marked";

import {escapeAttribute, parseAttributes} from "nbook/shared/markdown-dialect";

import {children} from "../core/write";
import {blockTagExtension, closeInline, openTagAt, openTagIndex} from "../tags";
import type {BlockTagToken} from "../tags";
import type {BlockWriter, ContextBlock, MarkdownSyntax, MarkWriter, ReadResolver, TokenReader, WriteContext, WriteTools} from "../types";

declare module "@tiptap/core" {
    interface Commands<ReturnType> {
        comment: {
            setComment: (body: string, id?: string | null) => ReturnType;
            unsetComment: () => ReturnType;
        };
        markdownComment: {
            /**
             * 给选区加一条批注（输出 11 的“新建”）：选区正好是连续的几个完整块（不止一个）时写成块批注；只在一段里时是行内
             * 批注；其余（跨段、起止在段中间）是分截批注，分配这个文件里没用过的最小的 `c` 加数字作 `id`。选区为空时不做。
             */
            addComment: (body: string) => ReturnType;
        };
        commentBlock: {
            setCommentBlock: (body: string, id?: string | null) => ReturnType;
            unsetCommentBlock: () => ReturnType;
        };
    }
}

let keys = 0;
/** 新的 `key`：只在这个页面里唯一即可，不写进文件。 */
export const newCommentKey = (): string => `k${(keys += 1).toString(36)}`;

/** 文档里用过的批注 `id`（行内与块）。 */
function usedIds(doc: PMNode): Set<string> {
    const used = new Set<string>();
    doc.descendants((node) => {
        if (node.type.name === "commentBlock" && typeof node.attrs.id === "string") used.add(node.attrs.id);
        for (const mark of node.marks) if (mark.type.name === "comment" && typeof mark.attrs.id === "string") used.add(mark.attrs.id);
    });
    return used;
}

/** 没用过的最小的 `c` 加数字。 */
function freeId(used: ReadonlySet<string>): string {
    let next = 1;
    while (used.has(`c${next}`)) next += 1;
    return `c${next}`;
}

/**
 * 粘贴进来的批注是新的批注：每条换一个新的 `key`（不与文件里意见相同的批注混成一条）；`id` 与文件里已有的相同时换一个没用过
 * 的（输出 11）。同一次粘贴里同一条批注的几截仍是同一条。
 */
function pastedComments(slice: Slice, doc: PMNode): Slice {
    const used = usedIds(doc);
    const renamed = new Map<string, {key: string; id: string | null}>();
    const remap = (fragment: Fragment): Fragment => {
        const children: PMNode[] = [];
        fragment.forEach((node) => {
            const marks = node.marks.map((mark) => {
                if (mark.type.name !== "comment") return mark;
                const group = groupOf(mark);
                let next = renamed.get(group);
                if (next === undefined) {
                    const id = typeof mark.attrs.id === "string" && mark.attrs.id !== "" ? mark.attrs.id : null;
                    next = {key: newCommentKey(), id: id !== null && used.has(id) ? freeId(used) : id};
                    if (next.id !== null) used.add(next.id);
                    renamed.set(group, next);
                }
                return mark.type.create({...mark.attrs, ...next});
            });
            children.push(node.isText ? node.mark(marks) : node.copy(remap(node.content)).mark(marks));
        });
        return Fragment.from(children);
    };
    return new Slice(remap(slice.content), slice.openStart, slice.openEnd);
}

export const Comment = Mark.create({
    name: "comment",
    // 最外层：批注常跨着其它格式，在外面时被拆开的次数最少。
    priority: 1100,
    inclusive: false,
    // 两条批注可以盖住同一段文字（`key` 不同就是两个标记）。
    excludes: "",
    addAttributes() {
        return {
            id: {default: null, parseHTML: (element: HTMLElement) => element.getAttribute("id"), renderHTML: (attributes: {id?: string | null}) => (attributes.id ? {id: attributes.id} : {})},
            body: {default: "", parseHTML: (element: HTMLElement) => element.getAttribute("body") ?? "", renderHTML: (attributes: {body?: string}) => ({body: attributes.body ?? ""})},
            key: {default: null, rendered: false},
        };
    },
    parseHTML() {
        return [{tag: "comment"}, {tag: "inline-comment"}];
    },
    renderHTML({HTMLAttributes}) {
        return ["comment", mergeAttributes(HTMLAttributes), 0];
    },
    addCommands() {
        return {
            addComment: (body: string) => ({state, tr, dispatch}: CommandProps) => {
                const {from, to, $from, $to} = state.selection;
                if (from === to) return false;
                if ($from.parent !== $to.parent && $from.parentOffset === 0 && $to.parentOffset === $to.parent.content.size) {
                    const range = $from.blockRange($to);
                    const block = state.schema.nodes.commentBlock;
                    const wrapping = range === null || block === undefined ? null : findWrapping(range, block, {body, id: null});
                    if (range !== null && wrapping !== null) {
                        dispatch?.(tr.wrap(range, wrapping));
                        return true;
                    }
                }
                const id = $from.parent === $to.parent ? null : freeId(usedIds(state.doc));
                dispatch?.(tr.addMark(from, to, this.type.create({body, id, key: newCommentKey()})));
                return true;
            },
            setComment: (body: string, id: string | null = null) => ({commands}) => commands.setMark(this.name, {id, body, key: newCommentKey()}),
            unsetComment: () => ({commands}) => commands.unsetMark(this.name),
        };
    },
    addProseMirrorPlugins() {
        return [new Plugin({key: new PluginKey("nb-comment-paste"), props: {transformPasted: (slice, view) => pastedComments(slice, view.state.doc)}})];
    },
});

export const CommentBlock = Node.create({
    name: "commentBlock",
    group: "block",
    content: "block+",
    defining: true,
    priority: 890,
    addAttributes() {
        return {id: {default: null}, body: {default: ""}};
    },
    parseHTML() {
        return [{
            tag: "div[data-comment-body]",
            getAttrs: (dom) => ({id: (dom as HTMLElement).getAttribute("data-comment-id"), body: (dom as HTMLElement).getAttribute("data-comment-body") ?? ""}),
        }];
    },
    renderHTML({node, HTMLAttributes}) {
        return ["div", mergeAttributes(HTMLAttributes, {class: "nb-comment-block", "data-comment-body": String(node.attrs.body ?? ""), ...(node.attrs.id ? {"data-comment-id": String(node.attrs.id)} : {})}), 0];
    },
    addCommands() {
        return {
            setCommentBlock: (body: string, id: string | null = null) => ({commands}) => commands.wrapIn(this.name, {id, body}),
            unsetCommentBlock: () => ({commands}) => commands.lift(this.name),
        };
    },
});

const NAMES = ["comment", "inline-comment"];

interface CommentToken extends Tokens.Generic {
    readonly id: string | null;
    /** 没有 `body` 属性（分截的后几截）为 null。 */
    readonly body: string | null;
    readonly tokens: Token[];
}

const tokenizer: MarkedExtension = {
    extensions: [
        {
            name: "commentInline",
            level: "inline",
            start: (src: string) => openTagIndex(src, NAMES),
            tokenizer(src: string): CommentToken | undefined {
                const open = openTagAt(src, NAMES);
                if (open === null) return undefined;
                const close = closeInline(src, open.name, open.length);
                if (close === null) return undefined;
                return {
                    type: "commentInline",
                    raw: src.slice(0, close.end),
                    id: emptyToNull(open.attributes.get("id")),
                    body: open.attributes.get("body") ?? null,
                    tokens: this.lexer.inlineTokens(src.slice(open.length, close.start)),
                };
            },
        },
        blockTagExtension("commentBlock", "comment", () => true),
    ],
};

function emptyToNull(value: string | undefined): string | null {
    const trimmed = value?.trim() ?? "";
    return trimmed === "" ? null : trimmed;
}

/** 一截在读入时的属性：同一截的各个节点共用这一个对象，分组时就地改。 */
interface Segment {
    id: string | null;
    body: string | null;
    key: string | null;
}

const readInline: Readonly<Record<string, TokenReader>> = {
    commentInline: (token, context) => {
        const value = token as CommentToken;
        const segment: Segment = {id: value.id, body: value.body, key: null};
        return context.mark("comment", context.inline(value.tokens), segment as unknown as Record<string, unknown>);
    },
};

const read: Readonly<Record<string, TokenReader>> = {
    commentBlock: (token, context) => {
        const value = token as unknown as BlockTagToken;
        return [{type: "commentBlock", attrs: {id: emptyToNull(value.open.attributes.get("id")), body: value.open.attributes.get("body") ?? ""}, content: context.blocks(value.tokens)}];
    },
};

/** 按文件顺序收集各截（同一截的节点共用一个属性对象，按对象去重）。 */
function segmentsOf(blocks: ReadonlyArray<ReadonlyArray<JSONContent>>): Segment[] {
    const seen = new Set<object>();
    const segments: Segment[] = [];
    const visit = (node: JSONContent): void => {
        for (const mark of node.marks ?? []) {
            if (mark.type !== "comment" || mark.attrs === undefined || seen.has(mark.attrs)) continue;
            seen.add(mark.attrs);
            segments.push(mark.attrs as unknown as Segment);
        }
        for (const child of node.content ?? []) visit(child);
    };
    for (const block of blocks) for (const node of block) visit(node);
    return segments;
}

/** 分组（输出 11 的归属规则），见文件头。 */
const resolve: ReadResolver = (blocks) => {
    const latest = new Map<string, Segment>();
    const waiting = new Map<string, Segment[]>();
    const join = (segment: Segment, head: Segment): void => {
        segment.body = head.body;
        segment.key = head.key;
    };
    for (const segment of segmentsOf(blocks)) {
        if (segment.body !== null) {
            segment.key = newCommentKey();
            if (segment.id !== null) {
                latest.set(segment.id, segment);
                for (const earlier of waiting.get(segment.id) ?? []) join(earlier, segment);
                waiting.delete(segment.id);
            }
            continue;
        }
        const head = segment.id === null ? undefined : latest.get(segment.id);
        if (head !== undefined) join(segment, head);
        else if (segment.id !== null) waiting.set(segment.id, [...(waiting.get(segment.id) ?? []), segment]);
        else join(segment, {id: null, body: "", key: newCommentKey()});
    }
    // 只有没有意见的截：同一个 `id` 的合成一条，意见为空。
    for (const group of waiting.values()) {
        const head: Segment = {id: null, body: "", key: newCommentKey()};
        for (const segment of group) join(segment, head);
    }
};

/** 一条批注（属性相同的标记）的身份。 */
const groupOf = (mark: PMMark): string => JSON.stringify([mark.attrs.id ?? null, mark.attrs.body ?? "", mark.attrs.key ?? null]);

/** 写出时一条批注的安排：用的 `id`（不需要为 null）、第一段在哪里、一共几段。 */
interface Plan {
    readonly id: string | null;
    readonly first: {readonly parent: PMNode; readonly offset: number};
    readonly runs: number;
}

/** 各文本块里批注开标签的位置（按写出的顺序），由编解码器按写出时的安排算出（`WriteTools.openings`）。 */
type Openings = ReadonlyMap<PMNode, ReadonlyArray<{readonly mark: PMMark; readonly offset: number}>>;

interface Prepared {
    readonly plans: ReadonlyMap<string, Plan>;
    readonly openings: Openings;
}

/**
 * 写前准备：每条批注的段数、第一段在哪里、用的 `id`。没有 `id` 的分截批注要分配一个：各截原文里已经写着同一个 `id`（上一次
 * 写回分配的，编辑器里还没有）并且没被别的批注占用时沿用它，否则取这个文件里没用过的最小的 `c` 加数字。沿用上一次的，
 * 别处新出现一条分截批注时，已经写好的这条不会被挤到下一个数字而整条重写。
 */
function prepareWrite(doc: PMNode, blocks: ReadonlyArray<ContextBlock>, tools: WriteTools): Prepared {
    const used = new Set<string>();
    const found: Array<{group: string; mark: PMMark; parent: PMNode; offset: number}> = [];
    const openings = new Map<PMNode, ReadonlyArray<{readonly mark: PMMark; readonly offset: number}>>();
    doc.descendants((node) => {
        if (node.type.name === "commentBlock" && typeof node.attrs.id === "string") used.add(node.attrs.id);
        if (!node.isTextblock) return true;
        // 没有批注的文本块不用排：写出的安排要整理整块内容，跳过它们省下大部分工夫。
        let marked = false;
        node.forEach((child) => {
            marked ||= child.marks.some((mark) => mark.type.name === "comment");
        });
        if (!marked) return false;
        const comments = tools.openings(node).filter(({mark}) => mark.type.name === "comment");
        openings.set(node, comments);
        for (const {mark, offset} of comments) {
            if (typeof mark.attrs.id === "string") used.add(mark.attrs.id);
            found.push({group: groupOf(mark), mark, parent: node, offset});
        }
        return false;
    });
    const counts = new Map<string, number>();
    for (const {group} of found) counts.set(group, (counts.get(group) ?? 0) + 1);
    const ownId = (mark: PMMark): string | null => (typeof mark.attrs.id === "string" && mark.attrs.id !== "" ? mark.attrs.id : null);
    // 原文里沿用的 `id`：一条没有 `id` 的分截批注，各截都在原文里、写着同一个 `id`。
    const reserved = new Map<string, string>();
    for (const [group, runs] of rawRuns(blocks, openings).groups) {
        const first = runs[0]?.tag?.id ?? null;
        if (first === null || used.has(first) || [...reserved.values()].includes(first)) continue;
        if (runs.every((run) => run.tag?.id === first)) reserved.set(group, first);
    }
    const plans = new Map<string, Plan>();
    let next = 1;
    for (const {group, mark, parent, offset} of found) {
        if (plans.has(group)) continue;
        const runs = counts.get(group) as number;
        let id = ownId(mark);
        if (id === null && runs > 1) {
            id = reserved.get(group) ?? null;
            if (id === null) {
                while (used.has(`c${next}`) || [...reserved.values()].includes(`c${next}`)) next += 1;
                id = `c${next}`;
            }
            used.add(id);
        }
        plans.set(group, {id, first: {parent, offset}, runs});
    }
    return {plans, openings};
}

/** 一段批注的开标签上写什么。 */
function tagOf(mark: PMMark, prepared: Prepared | undefined, run: {readonly parent: PMNode; readonly offset: number}): {readonly id: string | null; readonly body: string | null} {
    const body = String(mark.attrs.body ?? "");
    const plan = prepared?.plans.get(groupOf(mark));
    if (plan === undefined) return {id: typeof mark.attrs.id === "string" && mark.attrs.id !== "" ? mark.attrs.id : null, body: body === "" ? null : body};
    const first = plan.first.parent === run.parent && plan.first.offset === run.offset;
    return {id: plan.id, body: first && body !== "" ? body : null};
}

const openTag = (tag: {readonly id: string | null; readonly body: string | null}): string =>
    `<comment${tag.id === null ? "" : ` id="${escapeAttribute(tag.id)}"`}${tag.body === null ? "" : ` body="${escapeAttribute(tag.body)}"`}>`;

const writeMark: Readonly<Record<string, MarkWriter>> = {
    comment: {
        open: (mark, context, run) => openTag(tagOf(mark, context.prepared<Prepared>("comment"), run)),
        close: () => "</comment>",
    },
};

const writeBlock: Readonly<Record<string, BlockWriter>> = {
    commentBlock: (node, context: WriteContext) => {
        const open = openTag({id: typeof node.attrs.id === "string" && node.attrs.id !== "" ? node.attrs.id : null, body: node.attrs.body === "" ? null : String(node.attrs.body)});
        const body = children(node, context);
        return body.length === 0 ? `${open}\n</comment>` : `${open}\n${body.join("\n\n")}\n</comment>`;
    },
};

const OPEN_TAGS = /<(?:comment|inline-comment)(?=[\s>])((?:"[^"]*"|'[^']*'|[^>"'])*)>/giu;

/** 一块里按出现先后的批注开标签：块批注是 null，各段批注是它的分组。 */
function openingsOf(nodes: ReadonlyArray<PMNode>, openings: Openings): Array<string | null> {
    const found: Array<string | null> = [];
    const visit = (node: PMNode): void => {
        if (node.type.name === "commentBlock") found.push(null);
        if (node.isTextblock) {
            for (const {mark} of openings.get(node) ?? []) found.push(groupOf(mark));
            return;
        }
        node.forEach(visit);
    };
    nodes.forEach(visit);
    return found;
}

/** 一截在原文里的开标签（重新写出的块里的截为 null）。 */
interface RawRun {
    readonly block: number;
    readonly tag: {readonly id: string | null; readonly body: string | null} | null;
}

/**
 * 各条批注的各截在原文里的开标签：原文里批注开标签的个数与节点对不上的块（判断不了）放进 `unknown`。
 */
function rawRuns(blocks: ReadonlyArray<ContextBlock>, openings: Openings): {readonly groups: ReadonlyMap<string, ReadonlyArray<RawRun>>; readonly unknown: ReadonlySet<number>} {
    const groups = new Map<string, RawRun[]>();
    const unknown = new Set<number>();
    blocks.forEach((block, index) => {
        const found = openingsOf(block.nodes, openings);
        if (found.length === 0) return;
        const tags = block.raw === null ? null : [...block.raw.matchAll(OPEN_TAGS)].map((matched) => {
            const attributes = parseAttributes(matched[1] as string);
            return {id: emptyToNull(attributes.get("id")), body: attributes.get("body") ?? null};
        });
        if (tags !== null && tags.length !== found.length) {
            unknown.add(index);
            return;
        }
        found.forEach((group, at) => {
            if (group !== null) groups.set(group, [...(groups.get(group) ?? []), {block: index, tag: tags === null ? null : (tags[at] as RawRun["tag"])}]);
        });
    });
    return {groups, unknown};
}

/**
 * 没被编辑的块里哪些要重新写出（输出 11）。按整条批注判断：
 *
 * - 有一截在重新写出的块里：这条批注涉及的块都重新写出，各截按 `tagOf` 统一写（意见只在第一截）。只重写一部分会出现两截
 *   都带意见（读回成两条）或者都不带。
 * - 各截都在没被编辑的块里：原文里各截的 `id` 都是现在要用的、并且有一截带着这条意见，读回来仍是这一条，原样保留；否则
 *   （例如带意见的那一截所在的块被删掉）这条批注涉及的块都重新写出。
 *
 * 原文里开标签的个数与节点对不上的块（判断不了）直接重新写出。
 */
function contextDependents(blocks: ReadonlyArray<ContextBlock>, prepared: unknown): Set<number> {
    const {plans, openings} = prepared as Prepared;
    const {groups, unknown} = rawRuns(blocks, openings);
    const dependents = new Set(unknown);
    for (const [group, runs] of groups) {
        const plan = plans.get(group);
        const body = (JSON.parse(group) as [unknown, string])[1];
        const kept = plan !== undefined && runs.every((run) => run.tag !== null && (plan.runs === 1 || run.tag.id === plan.id)) && (body === "" || runs.some((run) => run.tag?.body === body));
        if (!kept) for (const run of runs) if (blocks[run.block]?.raw !== null) dependents.add(run.block);
    }
    return dependents;
}

export const commentSyntax: MarkdownSyntax = {
    name: "comment",
    extensions: [Comment, CommentBlock],
    marked: [tokenizer],
    read,
    readInline,
    resolve,
    writeMark,
    writeBlock,
    prepareWrite,
    contextDependents,
    contextAttrs: {comment: ["id", "body", "key"]},
    blockTags: ["comment"],
    inlineTags: NAMES,
    openTagAtLineEnd: `comment(?:\\s(?:"[^"\\n]*"|'[^'\\n]*'|[^>"'\\n])*)?`,
};
