/**
 * 工具登记表：每个工具分可冻结的声明与可撤回的调用句柄两部分（docs/specs/agent/harness.md 术语一节）。
 *
 * 声明会被复制进会话快照，会话内不变；实现每次调用时经句柄取得、不缓存，所以撤回后已在运行的会话
 * 也拿不到旧实现（可扩展应用平台提案 P1、P11）。
 */

import type {AgentToolResult, AgentToolUpdateCallback} from "@oh-my-pi/pi-agent-core";
import type {JsonValue} from "@notnotype/nb-session";

/** 工具的声明；整份 JSON 写进会话快照，恢复会话时逐字段比对。 */
export interface ToolDeclaration {
    /** 稳定 id，带命名空间（`builtin.read`、`story.search`）。 */
    readonly id: string;
    /** 给模型看的名字；同一会话里不能重复。 */
    readonly name: string;
    readonly description: string;
    /** 参数的 JSON Schema（TypeBox 的 schema 对象本身就是）。 */
    readonly parameters: {readonly [key: string]: JsonValue};
    /** 提供方：插件名、`builtin`，或 Profile 自带工具的 `profile:<key>`。 */
    readonly provider: string;
    readonly version: string;
    /** 收尾工具：调用成功即结束这次运行（输出 13 到 16）。 */
    readonly finish: boolean;
    /**
     * 下面三项是 OMP 在调用 `execute` 之前就要读的调度与参数协议，必须随声明冻结：同一批调用能否并行
     * （edit 必须 `exclusive`）、参数是否严格校验、自定义参数语法（hashline 的 Lark 语法）。
     */
    readonly concurrency: "shared" | "exclusive";
    readonly strict: boolean;
    readonly customFormat?: JsonValue;
}

/** 一次工具调用拿到的本会话数据（输出 5）。 */
export interface ToolExecutionContext {
    readonly sessionId: string;
    readonly toolCallId: string;
    readonly initial: unknown;
    readonly signal: AbortSignal;
}

export interface ToolImpl {
    execute(args: Record<string, unknown>, context: ToolExecutionContext, onUpdate?: AgentToolUpdateCallback): Promise<AgentToolResult>;
    /** 会话关闭时调用，释放按会话保存的状态（例如读写文件工具的快照存储）。 */
    releaseSession?(sessionId: string): void;
}

/** 调用句柄：返回 null 表示已撤回。 */
export interface ToolHandle {
    resolve(): ToolImpl | null;
}

export interface RegisteredTool {
    readonly declaration: ToolDeclaration;
    readonly handle: ToolHandle;
}

/** 一次登记的凭据：撤回只对这一次登记生效，同 id 后来的登记不受影响。 */
export interface Registration {
    readonly id: string;
}

export interface ToolRegistry {
    /** 声明会被复制并冻结；同 id 已有有效登记时抛错。 */
    register(declaration: ToolDeclaration, impl: ToolImpl): Registration;
    has(id: string): boolean;
    /** 撤回这次登记：之后它的句柄返回 null，在途调用经 `onRevoke` 收到中止；已被撤回或已被替换时什么也不做。 */
    revoke(registration: Registration): void;
    get(id: string): RegisteredTool | undefined;
    /** 订阅撤回；返回解除函数。 */
    onRevoke(listener: (id: string) => void): () => void;
}

/** 深复制一份 JSON 数据并冻结：会话快照与执行用的是同一份，宿主之后改原对象影响不到会话（输出 3）。 */
export function frozenCopy<T>(value: T): T {
    const copy = structuredClone(value);
    const freeze = (node: unknown): void => {
        if (typeof node !== "object" || node === null || Object.isFrozen(node)) return;
        Object.freeze(node);
        for (const child of Object.values(node)) freeze(child);
    };
    freeze(copy);
    return copy;
}

interface Entry extends Registration {
    readonly declaration: ToolDeclaration;
    impl: ToolImpl | null;
}

export function createToolRegistry(): ToolRegistry {
    const entries = new Map<string, Entry>();
    const listeners = new Set<(id: string) => void>();
    return {
        register(declaration, impl) {
            if (entries.has(declaration.id)) throw new Error(`工具已登记：${declaration.id}`);
            const entry: Entry = {id: declaration.id, declaration: frozenCopy(declaration), impl};
            entries.set(declaration.id, entry);
            return entry;
        },
        has(id) {
            return entries.has(id);
        },
        revoke(registration) {
            const entry = entries.get(registration.id);
            if (entry !== registration || entry.impl === null) return;
            entry.impl = null;
            entries.delete(entry.id);
            for (const listener of [...listeners]) listener(entry.id);
        },
        get(id) {
            const entry = entries.get(id);
            if (entry === undefined) return undefined;
            return {declaration: entry.declaration, handle: {resolve: () => entry.impl}};
        },
        onRevoke(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
    };
}

/** 插件与 Profile 写的声明：提供方与版本由登记方补上；调度字段有缺省（`shared`、不严格）。 */
export type PluginToolDeclaration = Omit<ToolDeclaration, "provider" | "version" | "concurrency" | "strict" | "finish"> &
    Partial<Pick<ToolDeclaration, "concurrency" | "strict" | "finish">>;

export function completeDeclaration(declaration: PluginToolDeclaration, provider: string, version: string): ToolDeclaration {
    return {
        ...declaration,
        provider,
        version,
        finish: declaration.finish ?? false,
        concurrency: declaration.concurrency ?? "shared",
        strict: declaration.strict ?? false,
    };
}

/** 插件只能贡献工具；`unregister` 撤回它登记的全部工具。 */
export interface HarnessPlugin {
    readonly name: string;
    readonly version: string;
    readonly tools: readonly {readonly declaration: PluginToolDeclaration; readonly impl: ToolImpl}[];
}

/** 一次性登记插件的全部工具：先检查再登记，失败时什么都不留下；`unregister` 幂等，只撤回这次登记的工具。 */
export function registerPlugin(registry: ToolRegistry, plugin: HarnessPlugin): {unregister(): void} {
    if (plugin.name.trim() === "") throw new Error("插件 name 不能为空");
    const ids = plugin.tools.map((tool) => tool.declaration.id);
    const duplicate = ids.find((id, index) => ids.indexOf(id) !== index);
    if (duplicate !== undefined) throw new Error(`插件 ${plugin.name} 的工具 id 重复：${duplicate}`);
    const taken = ids.find((id) => registry.has(id));
    if (taken !== undefined) throw new Error(`工具已登记：${taken}`);
    const registrations = plugin.tools.map((tool) => registry.register(completeDeclaration(tool.declaration, plugin.name, plugin.version), tool.impl));
    return {
        unregister() {
            for (const registration of registrations) registry.revoke(registration);
        },
    };
}
