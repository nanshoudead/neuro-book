/**
 * Profile 模板：经典 JSX（spike/tsconfig.json 里 jsxFactory 是 h），渲染成系统提示词与消息。
 *
 * 四个节点：History（本轮之前）、Input（本轮输入）、Transcript（本轮其余记录）、Slot（扩展交的内容）。
 * 只写了 History 时，Input 接在它后面、Transcript 接在 Input 后面；Slot 的 `*` 收没有按名字摆的槽。
 */

import type {Entry, Message, RenderFn} from "./kernel.ts";

export type TemplateNode = {type: string | ((props: any) => TemplateNode); props: any; children: TemplateChild[]} | TemplateChild[];
type TemplateChild = TemplateNode | string | number | boolean | null | undefined;

export function h(type: any, props: any, ...children: TemplateChild[]): TemplateNode {
    return {type, props: props ?? {}, children};
}
export const Fragment = "fragment";
export const System = "system";
export const History = "history";
export const Input = "input";
export const Transcript = "transcript";
export const Slot = "slot";
export const User = "user";
export const Assistant = "assistant";
export const Tag = "tag";
export const If = "if";

export function defaultLayout(system: string): TemplateNode {
    return [
        h(System, null, system, h(Slot, {name: "*", stable: true})),
        h(History, null),
        h(Input, null),
        h(Transcript, null),
        h(Slot, {name: "*", volatile: true}),
    ];
}

export interface RenderInput {
    before: Entry[];
    input: Entry | null;
    transcript: Entry[];
    renders: Record<string, RenderFn>;
    contributions: Map<string, string[]>;
    slotDecl: Map<string, {volatile: boolean; ext: string}>;
    tools: string[];
}

type Block =
    | {kind: "system"; parts: TemplateChild[]}
    | {kind: "history" | "input" | "transcript"; render?: Record<string, RenderFn>; filter?: (e: Entry) => boolean}
    | {kind: "slot"; name: string; stable?: boolean; volatile?: boolean}
    | {kind: "fixed"; role: "user" | "assistant"; parts: TemplateChild[]};

/** 把函数组件、Fragment、If 展开成顶层的块。 */
function flatten(node: TemplateChild, tools: string[], out: Block[]): void {
    if (node === null || node === undefined || node === false || node === true) return;
    if (Array.isArray(node)) {
        for (const c of node) flatten(c, tools, out);
        return;
    }
    if (typeof node === "string" || typeof node === "number") throw new Error(`模板顶层不能直接放文字：${String(node).slice(0, 20)}`);
    if (typeof node.type === "function") return flatten(node.type({...node.props, children: node.children}), tools, out);
    switch (node.type) {
        case Fragment: return flatten(node.children, tools, out);
        case If: if (matchesTool(node.props.tool, tools)) flatten(node.children, tools, out); return;
        case System: out.push({kind: "system", parts: node.children}); return;
        case History: case Input: case Transcript: out.push({kind: node.type, render: node.props.render, filter: node.props.filter}); return;
        case Slot: out.push({kind: "slot", name: node.props.name, stable: node.props.stable, volatile: node.props.volatile}); return;
        case User: case Assistant: out.push({kind: "fixed", role: node.type, parts: node.children}); return;
        default: throw new Error(`未知的模板节点 ${String(node.type)}`);
    }
}

function matchesTool(pattern: string, tools: string[]): boolean {
    return pattern.endsWith("*") ? tools.some((t) => t.startsWith(pattern.slice(0, -1))) : tools.includes(pattern);
}

function collectNamedSlots(node: TemplateChild, out: Set<string>): void {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) return node.forEach((c) => collectNamedSlots(c, out));
    if (typeof node.type === "function") return collectNamedSlots(node.type({...node.props, children: node.children}), out);
    if (node.type === Slot && node.props.name !== "*") out.add(node.props.name);
    for (const c of node.children) collectNamedSlots(c, out);
}

function render(e: Entry, renders: Record<string, RenderFn>): Message | null {
    const r = renders[e.type];
    const text = r ? r(e) : defaultText(e);
    if (text === null) return null;
    switch (e.type) {
        case "assistant": return {role: "assistant", content: text, ...(e.data.toolCalls?.length ? {toolCalls: e.data.toolCalls} : {}), origin: e.id};
        case "tool_result": return {role: "tool", content: text, callId: e.data.callId, origin: e.id};
        default: return {role: "user", content: text, origin: e.id};
    }
}

function defaultText(e: Entry): string {
    if (e.type === "user" || e.type === "assistant" || e.type === "tool_result" || e.type === "steer") return e.data.text ?? "";
    // 扩展注入的对话事件没有自己的 render 时，包成 system-reminder
    return `<system-reminder>${e.data.text ?? JSON.stringify(e.data)}</system-reminder>`;
}

export function renderTemplate(tree: TemplateNode, ri: RenderInput): {system: string; messages: Message[]; diagnostics: string[]} {
    const blocks: Block[] = [];
    flatten(tree, ri.tools, blocks);
    const diagnostics: string[] = [];
    // 只写了 History：Input 接在它后面；没写 Transcript：接在 Input（或包含 Input 的固定消息）后面
    const hasInput = (b: Block) => b.kind === "input" || (b.kind === "fixed" && containsInput(b.parts));
    if (!blocks.some(hasInput)) {
        const hi = blocks.findIndex((b) => b.kind === "history");
        if (hi >= 0) blocks.splice(hi + 1, 0, {kind: "input"});
        else blocks.push({kind: "input"});
    }
    if (!blocks.some((b) => b.kind === "transcript")) {
        const ii = blocks.findIndex(hasInput);
        blocks.splice(ii >= 0 ? ii + 1 : blocks.length, 0, {kind: "transcript"});
    }

    const named = new Set<string>();
    collectNamedSlots(tree, named);
    const placed = new Set<string>();
    const slotText = (name: string, stable?: boolean, volatile?: boolean): {text: string; names: string[]} => {
        const names = name === "*"
            ? [...ri.contributions.keys()].filter((n) => !named.has(n) && (volatile ? ri.slotDecl.get(n)?.volatile : !ri.slotDecl.get(n)?.volatile) && (stable || volatile))
            : [name];
        for (const n of names) placed.add(n);
        return {text: names.flatMap((n) => ri.contributions.get(n) ?? []).join("\n\n"), names};
    };
    const inline = (parts: TemplateChild[]): string => parts.map((p): string => {
        if (p === null || p === undefined || p === false || p === true) return "";
        if (typeof p === "string" || typeof p === "number") return String(p);
        if (Array.isArray(p)) return inline(p);
        if (typeof p.type === "function") return inline([p.type({...p.props, children: p.children})]);
        switch (p.type) {
            case Fragment: return inline(p.children);
            case If: return matchesTool(p.props.tool, ri.tools) ? inline(p.children) : "";
            case Tag: return `<${p.props.name}>\n${inline(p.children)}\n</${p.props.name}>`;
            case Slot: return slotText(p.props.name, p.props.stable, p.props.volatile).text;
            case Input: return ri.input ? (render(ri.input, {...ri.renders, ...(p.props.render ?? {})})?.content ?? "") : "";
            default: throw new Error(`${String(p.type)} 不能写在文字里`);
        }
    }).filter((s) => s !== "").join("\n\n");

    let system = "";
    const messages: Message[] = [];
    for (const b of blocks) {
        if (b.kind === "system") system += (system ? "\n\n" : "") + inline(b.parts);
        else if (b.kind === "fixed") {
            const content = inline(b.parts);
            if (content) messages.push({role: b.role, content, origin: containsInput(b.parts) && ri.input ? `fixed+${ri.input.id}` : "fixed"});
        } else if (b.kind === "slot") {
            const {text, names} = slotText(b.name, b.stable, b.volatile);
            if (text) messages.push({role: "user", content: text, origin: `slot:${names.join(",")}`});
        } else {
            const list = b.kind === "history" ? ri.before : b.kind === "input" ? (ri.input ? [ri.input] : []) : ri.transcript;
            const renders = {...ri.renders, ...(b.render ?? {})};
            for (const e of list) {
                if (b.filter && !b.filter(e)) continue;
                const m = render(e, renders);
                if (m) messages.push(m);
            }
        }
    }
    for (const n of ri.contributions.keys()) if (!placed.has(n)) diagnostics.push(`Profile 没留槽 ${n}，${ri.slotDecl.get(n)?.ext ?? "?"} 交的内容被丢弃`);
    return {system, messages, diagnostics};
}

function containsInput(parts: TemplateChild[]): boolean {
    return parts.some((p) => p && typeof p === "object" && (Array.isArray(p) ? containsInput(p) : p.type === Input || containsInput(p.children ?? [])));
}
