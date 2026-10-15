import type {ProfileChild, ProfileNode, ProfileRenderInput, RenderedMessage, RenderedProfile} from "./nodes.js";

/** 连续空行折叠成一个空行，并去掉首尾空白。 */
function collapseBlankLines(text: string): string {
    return text.replace(/\n{3,}/gu, "\n\n").trim();
}

/** `If` 节点此刻是否成立：`when` 看布尔值，`tool` 看生效工具集。 */
function ifHolds(node: ProfileNode, tools: ReadonlySet<string>): boolean {
    if (typeof node.props.tool === "string") return tools.has(node.props.tool);
    return node.props.when === true;
}

/** 把一棵子树的文本子节点按换行拼接成段落（`If` 在拼接阶段同样生效）。 */
export function collectText(children: readonly ProfileChild[], tools: ReadonlySet<string> = new Set()): string {
    const parts: string[] = [];
    const walk = (nodes: readonly ProfileChild[]): void => {
        for (const child of nodes) {
            if (child === null || child === undefined || child === false) continue;
            if (typeof child === "string") {
                parts.push(child);
                continue;
            }
            if (Array.isArray(child)) {
                walk(child as readonly ProfileChild[]);
                continue;
            }
            const node = child as ProfileNode;
            if (node.kind === "If" && !ifHolds(node, tools)) continue;
            walk(node.children);
        }
    };
    walk(children);
    return collapseBlankLines(parts.join("\n"));
}

/**
 * 渲染 profile 树：`System`/`Reminder` 段落进 `systemPrompt`，消息类节点按文档顺序进 `messages`，
 * `HistorySet` 把宿主交来的历史原样展开（docs/specs/agent/harness.md 输出 7、8）。
 * 纯函数：不读环境、不读文件、不改输入。
 */
export function renderProfile<H>(node: ProfileNode, input: ProfileRenderInput<H>): RenderedProfile<H> {
    const systemPrompt: string[] = [];
    const messages: RenderedMessage<H>[] = [];

    const walkAll = (children: readonly ProfileChild[]): void => {
        for (const child of children) {
            if (child === null || child === undefined || child === false) continue;
            if (typeof child === "string") continue;
            if (Array.isArray(child)) {
                walkAll(child as readonly ProfileChild[]);
                continue;
            }
            walk(child as ProfileNode);
        }
    };

    const walk = (current: ProfileNode): void => {
        switch (current.kind) {
            case "ProfilePrompt":
            case "Fragment":
            case "AppendingSet":
                walkAll(current.children);
                return;
            case "System":
            case "Reminder": {
                const text = collectText(current.children, input.tools);
                if (text !== "") systemPrompt.push(text);
                return;
            }
            case "HistorySet":
                for (const message of input.history) messages.push({kind: "history", message});
                return;
            case "Message":
                messages.push({kind: "text", role: current.props.role === "assistant" ? "assistant" : "user", text: collectText(current.children, input.tools)});
                return;
            case "AIMessage":
                messages.push({kind: "text", role: "assistant", text: collectText(current.children, input.tools)});
                return;
            case "If":
                if (ifHolds(current, input.tools)) walkAll(current.children);
                return;
            default:
                walkAll(current.children);
                return;
        }
    };

    walk(node);
    return {systemPrompt, messages};
}
