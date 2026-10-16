/** profile 树的子节点：节点、字符串、空值或它们的数组。 */
export type ProfileChild = ProfileNode | string | null | undefined | false | readonly ProfileChild[];

/** profile DSL 的节点：`kind` 决定渲染语义，`props` 保存声明参数，`children` 是树的子节点。 */
export interface ProfileNode {
    readonly kind: string;
    readonly props: Readonly<Record<string, unknown>>;
    readonly children: readonly ProfileChild[];
}

/**
 * 渲染出的一条消息：Profile 里静态写的文字消息，或宿主交来的一条历史消息的原样。
 * nb-profile 不认识历史消息的形状（harness 交的是 OMP 的 AgentMessage），只按顺序搬运。
 */
export type RenderedMessage<H> =
    | {readonly kind: "text"; readonly role: "user" | "assistant"; readonly text: string}
    | {readonly kind: "history"; readonly message: H};

export interface ProfileRenderInput<H> {
    /** 会话历史，按先后排好；`HistorySet` 原样展开它。 */
    readonly history: readonly H[];
    /** 本会话的生效工具集（工具 id）；`<If tool>` 按它判断。 */
    readonly tools: ReadonlySet<string>;
    readonly now?: () => Date;
}

export interface RenderedProfile<H> {
    readonly systemPrompt: readonly string[];
    readonly messages: readonly RenderedMessage<H>[];
}

function normalizeChildren(children: ProfileChild | readonly ProfileChild[] | undefined): readonly ProfileChild[] {
    if (children === undefined) return [];
    return Array.isArray(children) ? (children as readonly ProfileChild[]) : [children as ProfileChild];
}

function createNode(kind: string, props: Readonly<Record<string, unknown>> = {}): ProfileNode {
    return {kind, props, children: normalizeChildren(props.children as ProfileChild | readonly ProfileChild[] | undefined)};
}

export function Fragment(props: {readonly children?: ProfileChild | readonly ProfileChild[]}): ProfileNode {
    return createNode("Fragment", props);
}

export function ProfilePrompt(props: {readonly children?: ProfileChild | readonly ProfileChild[]}): ProfileNode {
    return createNode("ProfilePrompt", props);
}

export function System(props: {readonly children?: ProfileChild | readonly ProfileChild[]}): ProfileNode {
    return createNode("System", props);
}

export function HistorySet(props: {readonly children?: ProfileChild | readonly ProfileChild[]} = {}): ProfileNode {
    return createNode("HistorySet", props);
}

export function AppendingSet(props: {readonly children?: ProfileChild | readonly ProfileChild[]}): ProfileNode {
    return createNode("AppendingSet", props);
}

export function Message(props: {readonly role?: "user" | "assistant"; readonly children?: ProfileChild | readonly ProfileChild[]}): ProfileNode {
    return createNode("Message", props);
}

export function AIMessage(props: {readonly children?: ProfileChild | readonly ProfileChild[]}): ProfileNode {
    return createNode("AIMessage", props);
}

export function Reminder(props: {readonly children?: ProfileChild | readonly ProfileChild[]}): ProfileNode {
    return createNode("Reminder", props);
}

/** 条件段落：`when` 是布尔条件，`tool` 是工具 id（在生效工具集里才渲染）；二者恰给一个。 */
export type IfProps =
    | {readonly when: boolean; readonly tool?: undefined; readonly children?: ProfileChild | readonly ProfileChild[]}
    | {readonly tool: string; readonly when?: undefined; readonly children?: ProfileChild | readonly ProfileChild[]};

export function If(props: IfProps): ProfileNode {
    const hasWhen = typeof props.when === "boolean";
    const hasTool = typeof props.tool === "string" && props.tool !== "";
    if (hasWhen === hasTool) throw new Error("If 要恰好给 when 或 tool 中的一个");
    return createNode("If", props);
}

/** 运行时可识别的节点判定（供 loader 校验默认导出）。 */
export function isProfileNode(value: unknown): value is ProfileNode {
    if (typeof value !== "object" || value === null) return false;
    const candidate = value as ProfileNode;
    return typeof candidate.kind === "string" && Array.isArray(candidate.children);
}
