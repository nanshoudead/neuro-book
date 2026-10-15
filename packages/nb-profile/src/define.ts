/**
 * Profile 定义：一个 Agent 的身份、初始输入、需要的工具与上下文（docs/specs/agent/harness.md “输入与前置条件”的 Profile 一节）。
 *
 * nb-profile 不依赖 OMP：工具引用只是带稳定 id 的句柄，Profile 自带的工具由 nb-harness 的 `defineTool` 造出，
 * 这里只认它的 `kind` 与 `id`，执行与校验都在 harness。
 */

import type {Static, TSchema} from "typebox";
import {Value} from "typebox/value";
import type {ProfileNode} from "./nodes.js";

/** 带 `code` 的 Profile 合同错误；调用方按 `code` 分支，不按文字。 */
export class ProfileError extends Error {
    constructor(
        readonly code: "profile_invalid" | "invalid_initial",
        message: string,
        readonly details: readonly string[] = [],
    ) {
        super(message);
        this.name = "ProfileError";
    }
}

export interface ProfileManifest {
    readonly key: string;
    readonly version: string;
    readonly name: string;
    readonly description: string;
}

/** 提供方导出的工具引用：只含稳定 id；`P` 只给类型用，不在运行时存在。 */
export interface ToolRef<P = unknown> {
    readonly kind: "tool-ref";
    readonly id: string;
    readonly __params?: P;
}

export interface OptionalToolRef {
    readonly kind: "optional";
    readonly ref: ToolRef;
}

/** Profile 自带的工具：nb-harness 的 `defineTool` 返回它的子类型。 */
export interface LocalTool {
    readonly kind: "local-tool";
    readonly id: string;
}

export type ToolSetItem = ToolRef | OptionalToolRef | LocalTool;

export function toolRef<P = unknown>(id: string): ToolRef<P> {
    if (id.trim() === "") throw new ProfileError("profile_invalid", "工具 id 不能为空");
    return {kind: "tool-ref", id};
}

/** 把一个工具引用标为可选：没登记或被禁用时这个会话不给它，`<If tool>` 包着的段落一并去掉。 */
export function optional(ref: ToolRef): OptionalToolRef {
    return {kind: "optional", ref};
}

/** 工具项的 id。 */
export function toolSetItemId(item: ToolSetItem): string {
    return item.kind === "optional" ? item.ref.id : item.id;
}

/** 收集工具项；同一个 Profile 里同一 id 只能出现一次。 */
export function toolset(...items: readonly ToolSetItem[]): readonly ToolSetItem[] {
    const seen = new Set<string>();
    for (const item of items) {
        const id = toolSetItemId(item);
        if (seen.has(id)) throw new ProfileError("profile_invalid", `工具重复声明：${id}`);
        seen.add(id);
    }
    return items;
}

export interface ProfileContext<I> {
    readonly initial: I;
    /** 本会话的生效工具集（工具 id）。 */
    readonly tools: ReadonlySet<string>;
    /** 会话历史的原样，形状由宿主定。 */
    readonly history: readonly unknown[];
}

export interface ProfileDefinition<S extends TSchema = TSchema> {
    readonly kind: "profile-definition";
    readonly manifest: ProfileManifest;
    readonly initialSchema: S;
    readonly tools: readonly ToolSetItem[];
    context(ctx: ProfileContext<Static<S>>): ProfileNode;
    /** 按 `initialSchema` 校验初始输入；不合时抛 `invalid_initial`。 */
    parseInitial(value: unknown): Static<S>;
}

export function defineProfile<S extends TSchema>(definition: {
    readonly manifest: ProfileManifest;
    readonly initialSchema: S;
    readonly tools: readonly ToolSetItem[];
    readonly context: (ctx: ProfileContext<Static<S>>) => ProfileNode;
}): ProfileDefinition<S> {
    const {manifest} = definition;
    for (const field of ["key", "version", "name", "description"] as const) {
        if (typeof manifest[field] !== "string" || manifest[field].trim() === "") {
            throw new ProfileError("profile_invalid", `Profile 的 manifest.${field} 不能为空`);
        }
    }
    // 再走一遍重复检查：调用方可能没经 toolset() 直接给数组。
    toolset(...definition.tools);
    return {
        kind: "profile-definition",
        manifest,
        initialSchema: definition.initialSchema,
        tools: definition.tools,
        context: definition.context,
        parseInitial(value) {
            if (Value.Check(definition.initialSchema, value)) return value as Static<S>;
            const details = [...Value.Errors(definition.initialSchema, value)].map((error) => `${error.instancePath || "/"} ${error.message}`);
            throw new ProfileError("invalid_initial", `初始输入不合 Profile ${manifest.key} 的 initialSchema`, details);
        },
    };
}

export function isProfileDefinition(value: unknown): value is ProfileDefinition {
    if (typeof value !== "object" || value === null) return false;
    const candidate = value as Partial<ProfileDefinition>;
    return candidate.kind === "profile-definition" && typeof candidate.context === "function" && Array.isArray(candidate.tools);
}
