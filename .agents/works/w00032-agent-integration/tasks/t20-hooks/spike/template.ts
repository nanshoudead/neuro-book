/**
 * Profile 模板（第二版）：经典 JSX（spike/tsconfig.json 里 jsxFactory 是 h），渲染成块。
 *
 * 节点：
 * - 容器 `<System>`、`<User>`、`<Assistant>`：每个子节点是一段，段与段之间空一行；
 * - 行内 `<P>`、`<Tag>`：子节点直接相连（`默认叙事人称：{x}` 不会被拆成两段）；
 * - `<History>`、`<Input>`、`<Transcript>`：取日志的三段，只接受 `filter`；渲染写在 Profile 上；
 * - `<Slot name>`：扩展交的内容；`*` 必须写 stable 或 volatile。
 * 只写了 History 时，Input 接在它后面、Transcript 接在 Input 后面。
 */

import type {Block, Entry, Message} from "./api.ts";
import type {Diagnostic} from "./kernel.ts";

type Child = Node | string | number | boolean | null | undefined | Child[];
export interface Node {
    type: string | ((props: any) => Child);
    props: any;
    children: Child[];
}

export function h(type: any, props: any, ...children: Child[]): Node {
    return {type, props: props ?? {}, children};
}
export const Fragment = "fragment";
export const System = "system";
export const User = "user-message";
export const Assistant = "assistant-message";
export const P = "p";
export const Tag = "tag";
export const If = "if";
export const History = "history";
export const Input = "input";
export const Transcript = "transcript";
export const Slot = "slot";

export function defaultLayout(system: string): Child {
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
    renders: Record<string, (e: Entry) => string | null>;
    slots: Map<string, {volatile: boolean; ext: string; texts: string[]}>;
    tools: string[];
}

type Top =
    | {kind: "system" | "user" | "assistant"; children: Child[]}
    | {kind: "history" | "input" | "transcript"; filter?: (e: Entry) => boolean}
    | {kind: "slot"; name: string; stable?: boolean; volatile?: boolean};

const matchesTool = (pattern: string, tools: string[]) => (pattern.endsWith("*") ? tools.some((t) => t.startsWith(pattern.slice(0, -1))) : tools.includes(pattern));

function expand(c: Child, tools: string[]): Child[] {
    if (c === null || c === undefined || c === false || c === true) return [];
    if (Array.isArray(c)) return c.flatMap((x) => expand(x, tools));
    if (typeof c !== "object") return [c];
    if (typeof c.type === "function") return expand(c.type({...c.props, children: c.children}), tools);
    if (c.type === Fragment) return expand(c.children, tools);
    if (c.type === If) return matchesTool(c.props.tool, tools) ? expand(c.children, tools) : [];
    return [c];
}

function nodeProps(n: Node): void {
    if ((n.type === History || n.type === Input || n.type === Transcript) && n.props.render) throw new Error(`<${n.type}> 不接受 render：渲染写在 Profile 的 render 上，事件从本轮挪进历史时才不变样`);
    if (n.type === Slot && n.props.name === "*" && !n.props.stable && !n.props.volatile) throw new Error(`<Slot name="*" /> 要写 stable 或 volatile`);
}

export function renderTemplate(tree: Child, ri: RenderInput): {system: Block[]; messages: Message[]; diagnostics: Diagnostic[]} {
    const diagnostics: Diagnostic[] = [];
    const tops: Top[] = [];
    for (const c of expand(tree, ri.tools)) {
        if (typeof c !== "object" || c === null || Array.isArray(c)) throw new Error(`模板顶层不能直接放文字：${String(c).slice(0, 20)}`);
        nodeProps(c);
        switch (c.type) {
            case System: tops.push({kind: "system", children: c.children}); break;
            case User: tops.push({kind: "user", children: c.children}); break;
            case Assistant: tops.push({kind: "assistant", children: c.children}); break;
            case History: case Input: case Transcript: tops.push({kind: c.type, filter: c.props.filter}); break;
            case Slot: tops.push({kind: "slot", name: c.props.name, stable: c.props.stable, volatile: c.props.volatile}); break;
            default: throw new Error(`<${String(c.type)}> 不能放在模板顶层`);
        }
    }
    const containsInput = (cs: Child[]): boolean => expand(cs, ri.tools).some((x) => typeof x === "object" && x !== null && !Array.isArray(x) && (x.type === Input || containsInput(x.children)));
    const hasInput = (t: Top) => t.kind === "input" || ((t.kind === "user" || t.kind === "assistant") && containsInput(t.children));
    if (!tops.some(hasInput)) {
        const hi = tops.findIndex((t) => t.kind === "history");
        if (hi >= 0) tops.splice(hi + 1, 0, {kind: "input"});
        else tops.push({kind: "input"});
    }
    if (!tops.some((t) => t.kind === "transcript")) {
        const ii = tops.findIndex(hasInput);
        tops.splice(ii + 1, 0, {kind: "transcript"});
    }

    // 按名字摆的槽先认领，剩下的由 * 按档位收
    const named = new Set<string>();
    const walk = (cs: Child[]) => {
        for (const x of expand(cs, ri.tools)) {
            if (typeof x !== "object" || x === null || Array.isArray(x)) continue;
            if (x.type === Slot && x.props.name !== "*") named.add(x.props.name);
            walk(x.children);
        }
    };
    walk(tops.flatMap((t) => ("children" in t ? t.children : [])));
    for (const t of tops) if (t.kind === "slot" && t.name !== "*") named.add(t.name);
    const placed = new Set<string>();
    const slotBlocks = (name: string, stable: boolean | undefined, volatile: boolean | undefined, inSystem: boolean): Block[] => {
        const names = name === "*" ? [...ri.slots.keys()].filter((n) => !named.has(n) && (volatile ? ri.slots.get(n)!.volatile : stable && !ri.slots.get(n)!.volatile)) : [name];
        const out: Block[] = [];
        for (const n of names) {
            const s = ri.slots.get(n);
            if (!s) continue;
            placed.add(n);
            if (inSystem && s.volatile) diagnostics.push({level: "warn", code: "volatile-in-system", ext: s.ext, message: `${s.ext} 的槽 ${n} 每次请求都会变，被放进了系统提示词：整段缓存失效`});
            if (s.texts.length) out.push({text: s.texts.join("\n\n"), origin: `slot:${n}`});
        }
        return out;
    };
    const renderEntry = (e: Entry): Message | null => {
        const r = ri.renders[e.type];
        const text = r ? r(e) : defaultText(e);
        if (text === null) return null;
        const block = {text, origin: e.id};
        if (e.type === "assistant") return {role: "assistant", content: [block], ...((e.data as any).toolCalls?.length ? {toolCalls: (e.data as any).toolCalls} : {})};
        if (e.type === "tool_result") return {role: "tool", content: [block], callId: (e.data as any).callId};
        return {role: "user", content: [block]};
    };
    // 行内：子节点直接相连
    const inline = (cs: Child[]): string => expand(cs, ri.tools).map((x): string => {
        if (typeof x !== "object" || x === null || Array.isArray(x)) return String(x);
        nodeProps(x);
        if (x.type === P) return inline(x.children);
        if (x.type === Tag) return `<${x.props.name}>\n${inline(x.children)}\n</${x.props.name}>`;
        if (x.type === Input) return ri.input ? (renderEntry(ri.input)?.content[0]!.text ?? "") : "";
        if (x.type === Slot) return slotBlocks(x.props.name, x.props.stable, x.props.volatile, false).map((b) => b.text).join("\n\n");
        throw new Error(`<${String(x.type)}> 不能写在行内`);
    }).join("");
    // 容器：每个子节点一段；Slot、Input 单独成块，保留来源
    const container = (cs: Child[], inSystem: boolean): Block[] => {
        const blocks: Block[] = [];
        let paras: string[] = [];
        const flush = () => {
            if (paras.length) blocks.push({text: paras.join("\n\n"), origin: "fixed"});
            paras = [];
        };
        for (const x of expand(cs, ri.tools)) {
            if (typeof x === "object" && x !== null && !Array.isArray(x) && x.type === Slot) {
                nodeProps(x);
                flush();
                blocks.push(...slotBlocks(x.props.name, x.props.stable, x.props.volatile, inSystem));
            } else if (typeof x === "object" && x !== null && !Array.isArray(x) && x.type === Input) {
                flush();
                if (ri.input) blocks.push({text: renderEntry(ri.input)?.content[0]!.text ?? "", origin: ri.input.id});
            } else {
                const t = inline([x]);
                if (t.trim()) paras.push(t.trim());
            }
        }
        flush();
        return blocks;
    };

    const system: Block[] = [];
    const messages: Message[] = [];
    for (const t of tops) {
        if (t.kind === "system") system.push(...container(t.children, true));
        else if (t.kind === "user" || t.kind === "assistant") {
            const content = container(t.children, false);
            if (content.length) messages.push({role: t.kind, content});
        } else if (t.kind === "slot") {
            const content = slotBlocks(t.name, t.stable, t.volatile, false);
            if (content.length) messages.push({role: "user", content});
        } else {
            const part = t as Extract<Top, {kind: "history" | "input" | "transcript"}>;
            const list = part.kind === "history" ? ri.before : part.kind === "input" ? (ri.input ? [ri.input] : []) : ri.transcript;
            for (const e of list) {
                if (part.filter && !part.filter(e)) continue;
                const m = renderEntry(e);
                if (m) messages.push(m);
            }
        }
    }
    for (const [n, s] of ri.slots) if (!placed.has(n) && s.texts.length) diagnostics.push({level: "warn", code: "slot-unplaced", ext: s.ext, message: `Profile 没留槽 ${n}（${s.volatile ? "会变" : "稳定"}），${s.ext} 交的内容被丢弃`});
    return {system, messages, diagnostics};
}

function defaultText(e: Entry): string {
    const d = e.data as any;
    if (e.type === "user" || e.type === "assistant" || e.type === "tool_result" || e.type === "steer") return d.text ?? "";
    // 扩展注入的对话事件没有自己的 render 时，包成 system-reminder
    return `<system-reminder>${d.text ?? JSON.stringify(d)}</system-reminder>`;
}
