/**
 * 生效工具集：新会话按 Profile 声明、登记表与禁用策略算出，恢复会话按快照重建
 * （docs/specs/agent/harness.md 输出 1 到 4）。
 */

import type {LocalTool, ProfileDefinition} from "@notnotype/nb-profile";
import type {JsonValue} from "@notnotype/nb-session";
import {HarnessError} from "../errors.js";
import {completeDeclaration, frozenCopy, type PluginToolDeclaration, type RegisteredTool, type ToolDeclaration, type ToolImpl} from "./registry.js";
import type {ToolRegistry} from "./registry.js";

/** 宿主给的禁用策略；harness 不读配置文件。 */
export interface ToolPolicy {
    /** 对所有 Profile 禁用的工具 id。 */
    readonly disabled?: readonly string[];
    /** 按 Profile key 禁用的工具 id。 */
    readonly disabledByProfile?: Readonly<Record<string, readonly string[]>>;
}

/** Profile 自带的工具：声明与实现写在 Profile 里，提供方是 `profile:<key>`。 */
export interface LocalToolDefinition extends LocalTool {
    readonly declaration: PluginToolDeclaration;
    readonly impl: ToolImpl;
}

export function defineTool(tool: PluginToolDeclaration & {readonly execute: ToolImpl["execute"]; readonly releaseSession?: ToolImpl["releaseSession"]}): LocalToolDefinition {
    const {execute, releaseSession, ...declaration} = tool;
    return {
        kind: "local-tool",
        id: tool.id,
        declaration,
        impl: releaseSession === undefined ? {execute} : {execute, releaseSession},
    };
}

function isLocalToolDefinition(item: unknown): item is LocalToolDefinition {
    return typeof item === "object" && item !== null && (item as LocalTool).kind === "local-tool" && "declaration" in item && "impl" in item;
}

function localEntry(profile: ProfileDefinition, tool: LocalToolDefinition): RegisteredTool {
    const declaration = frozenCopy(completeDeclaration(tool.declaration, `profile:${profile.manifest.key}`, profile.manifest.version));
    return {declaration, handle: {resolve: () => tool.impl}};
}

function disabledFor(profile: ProfileDefinition, policy: ToolPolicy): ReadonlySet<string> {
    return new Set([...(policy.disabled ?? []), ...(policy.disabledByProfile?.[profile.manifest.key] ?? [])]);
}

function checkNames(tools: readonly RegisteredTool[]): void {
    const byName = new Map<string, string>();
    for (const {declaration} of tools) {
        const other = byName.get(declaration.name);
        if (other !== undefined) {
            throw new HarnessError("tool_name_conflict", `工具 ${other} 与 ${declaration.id} 给模型看的名字都是 ${declaration.name}`, {
                name: declaration.name,
                tools: [other, declaration.id],
            });
        }
        byName.set(declaration.name, declaration.id);
    }
}

/** 新会话：必需 ∪（可选 ∩ 已登记 − 已禁用）；必需的没登记或被禁用报 `tool_unavailable`，撞名报 `tool_name_conflict`。 */
export function resolveEffectiveTools(profile: ProfileDefinition, registry: ToolRegistry, policy: ToolPolicy = {}): RegisteredTool[] {
    const disabled = disabledFor(profile, policy);
    const tools: RegisteredTool[] = [];
    for (const item of profile.tools) {
        if (isLocalToolDefinition(item)) {
            if (disabled.has(item.id)) throw unavailable(profile, item.id, "disabled", `profile:${profile.manifest.key}`);
            tools.push(localEntry(profile, item));
            continue;
        }
        if (item.kind === "local-tool") throw new HarnessError("profile_invalid", `工具 ${item.id} 不是 defineTool 的结果`, {tool: item.id});
        const required = item.kind === "tool-ref";
        const id = item.kind === "optional" ? item.ref.id : item.id;
        const registered = registry.get(id);
        if (registered === undefined || disabled.has(id)) {
            if (required) throw unavailable(profile, id, registered === undefined ? "unregistered" : "disabled", registered?.declaration.provider ?? null);
            continue;
        }
        tools.push(registered);
    }
    checkNames(tools);
    return tools;
}

function unavailable(profile: ProfileDefinition, tool: string, reason: "unregistered" | "disabled", provider: string | null): HarnessError {
    const why = reason === "unregistered" ? "没有登记" : "被禁用";
    return new HarnessError("tool_unavailable", `Profile ${profile.manifest.key} 需要的工具 ${tool} ${why}`, {profile: profile.manifest.key, tool, reason, provider});
}

/** 声明的规范化 JSON，用于和快照逐字段比对。 */
export function declarationJson(declaration: ToolDeclaration): JsonValue {
    return JSON.parse(JSON.stringify(declaration)) as JsonValue;
}

/** 对象键排好序的 JSON：只比字段与值，不比属性先后；数组的顺序照旧算数。 */
function canonical(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
    if (typeof value === "object" && value !== null) {
        const entries = Object.entries(value).filter(([, child]) => child !== undefined).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
        return `{${entries.map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`).join(",")}}`;
    }
    return JSON.stringify(value);
}

function sameDeclaration(snapshot: JsonValue, current: ToolDeclaration): boolean {
    return canonical(snapshot) === canonical(current);
}

/**
 * 恢复会话：按快照里的声明重建，实现向登记表与 Profile 取。声明与快照不一致、或必需工具已不在登记表里时报
 * `session_incompatible`；快照里的可选工具后来没了，声明照旧给模型，调用时得到 `plugin-unavailable`（输出 4、6）。
 */
export function restoreEffectiveTools(snapshotTools: readonly JsonValue[], profile: ProfileDefinition, registry: ToolRegistry): RegisteredTool[] {
    const items = new Map(profile.tools.map((item) => [item.kind === "optional" ? item.ref.id : item.id, item] as const));
    const tools: RegisteredTool[] = [];
    for (const entry of snapshotTools) {
        const declaration = entry as unknown as ToolDeclaration;
        const item = items.get(declaration.id);
        if (item === undefined) throw incompatible(`快照里的工具 ${declaration.id} 已不在 Profile 声明里`, declaration.id);
        if (isLocalToolDefinition(item)) {
            const local = localEntry(profile, item);
            if (!sameDeclaration(entry, local.declaration)) throw incompatible(`Profile 自带工具 ${declaration.id} 的声明变了`, declaration.id);
            tools.push(local);
            continue;
        }
        const registered = registry.get(declaration.id);
        if (registered === undefined) {
            if (item.kind === "tool-ref") throw incompatible(`必需工具 ${declaration.id} 已不在登记表里`, declaration.id);
            tools.push({declaration, handle: {resolve: () => null}});
            continue;
        }
        if (!sameDeclaration(entry, registered.declaration)) throw incompatible(`工具 ${declaration.id} 的声明与快照不一致`, declaration.id);
        tools.push(registered);
    }
    return tools;
}

function incompatible(message: string, tool: string): HarnessError {
    return new HarnessError("session_incompatible", message, {tool});
}
