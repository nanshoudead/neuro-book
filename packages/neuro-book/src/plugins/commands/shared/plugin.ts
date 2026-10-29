/**
 * `nbook.commands`：一份定义含服务端与浏览器两个入口，代码相同，每个实例的入口各自持有一份命令表。
 *
 * 命令只经贡献点 `commands.definitions` 登记：贡献撤回（入口停止、插件禁用）时命令随之离开命令表，
 * 内核也替命令表保证同一 id 只有一条贡献。命令服务因此不提供命令式登记。
 */

import {diagnosticsKey} from "@notnotype/nb-runtime/diagnostics";
import type {DiagnosticsService} from "@notnotype/nb-runtime/diagnostics";
import type {RuntimeLocation} from "@notnotype/nb-runtime/lifecycle";
import {defineEntry, provideService} from "@notnotype/nb-runtime/plugins";
import {provideRemote} from "@notnotype/nb-runtime/remote";
import type {RemoteProvision} from "@notnotype/nb-runtime/remote";
import type {ContributionDescriptor, ContributionHandle, ContributionReceiver, PluginDefinition, PluginEntryDefinition} from "@notnotype/nb-runtime/plugins";
import {isTextRef, resolveLocaleMap} from "@notnotype/nb-ui/text";
import type {Text} from "@notnotype/nb-ui/text";

import {publicStateKey} from "nbook/plugins/state/shared/contracts";
import type {PublicStateDeclaration, PublicStateService} from "nbook/plugins/state/shared/contracts";
import {displayLocale, settingsKey} from "nbook/plugins/settings/shared/contracts";
import {textOf} from "nbook/shared/localized-text";
import type {DisplayLocale, TextResolver} from "nbook/shared/localized-text";
import {windowTextKey} from "nbook/shared/window-text-key";

import {descriptor} from "../plugin";
import type {ContextKeySource} from "./context-keys";
import {COMMANDS_POINT, commandServiceKey, commandsRemoteContract, completeCommandDeclaration} from "./contracts";
import type {CommandDeclaration, CommandImplementation, CommandResult, CommandService, Release} from "./contracts";
import {commandDeclarationProblems, createCommandRegistry, effectiveAgentExposure} from "./registry";
import type {CommandRegistry} from "./registry";

/**
 * 产品命令表的上下文键是公开状态里的布尔键（docs/specs/workbench/commands.md 的“when 读公开状态”）：`when` 引用的
 * 键要是本运行位置入口声明的、已被接受的布尔公开键，否则命令不可用；求值只读本实例。
 */
const REASONS = {
    undeclared: {"zh-CN": "when 引用的 {key} 不是本运行位置声明的公开键", "en-US": "{key} in when is not a public key declared at this location"},
    notBoolean: {"zh-CN": "when 引用的 {key} 不是布尔公开键", "en-US": "{key} in when is not a boolean public key"},
    notTrue: {"zh-CN": "{key} 不为 true", "en-US": "{key} is not true"},
} as const;

/**
 * 不满足的原因按求值时的显示语言给出（docs/specs/workbench/commands.md“可用性求值”）；已记下的诊断保留当时的文字。服务端也
 * 求值，没有翻译端口，所以原因写成语言映射、先按语言取一份再代入键名。
 */
function reasonOf(template: (typeof REASONS)[keyof typeof REASONS], key: string, locale: DisplayLocale): string {
    return resolveLocaleMap(template, locale).replaceAll("{key}", key);
}

function keyProblem(key: string, declaration: PublicStateDeclaration | null, locale: DisplayLocale): string | null {
    if (declaration === null) return reasonOf(REASONS.undeclared, key, locale);
    return declaration.type === "boolean" ? null : reasonOf(REASONS.notBoolean, key, locale);
}

/**
 * 贡献点的校验只看这一条声明（runtime.plugins 输出第 23 条）；`when` 引用的键是否存在在求值时判断，所以键的拥有者
 * 晚登记、先撤销都不改变这条命令能否登记。
 */
function validateCommandContribution(contribution: ContributionDescriptor): string | null {
    const problems = commandDeclarationProblems(contribution.id, contribution.plugin, contribution.declaration);
    return problems.length === 0 ? null : problems.join("；");
}

/**
 * 声明里的原因按此刻的语言取成字符串（docs/specs/state/public-state.md 输出 1）。文字引用只有窗口的翻译端口翻得了：
 * 服务端与没有窗口引擎的场地不翻译它，返回 null，由调用方退回通用原因。
 */
function reasonText(reason: Text, locale: DisplayLocale, translate: TextResolver["t"] | null): string | null {
    if (!isTextRef(reason)) return textOf(reason, locale);
    return translate === null ? null : translate(reason);
}

/** 命令表的键来源：本实例的公开状态。未就绪按 false，原因取声明的 reason。 */
function publicStateKeys(state: PublicStateService, locale: () => DisplayLocale, translate: TextResolver["t"] | null): ContextKeySource {
    return {
        problem: (key) => keyProblem(key, state.declaration(key), locale()),
        evaluate: (key) => {
            const read = state.read(key);
            if (read.status === "ready" && read.value === true) return {matches: true};
            const declaration = state.declaration(key);
            const declared = declaration?.type === "boolean" && declaration.reason !== undefined ? reasonText(declaration.reason, locale(), translate) : null;
            return {matches: false, reason: declared ?? reasonOf(REASONS.notTrue, key, locale())};
        },
    };
}

/** 只交出查询与执行：登记只能经贡献点，撤回才能由内核记账。 */
function serviceOf(registry: CommandRegistry): CommandService {
    return {
        get: (id) => registry.get(id),
        list: () => registry.list(),
        isEnabled: (id) => registry.isEnabled(id),
        execute: (id, args, invocation) => registry.execute(id, args, invocation),
        onDidChange: (listener) => registry.onDidChange(listener),
        onDidExecute: (listener) => registry.onDidExecute(listener),
    };
}

type CommandHandle = ContributionHandle<CommandDeclaration, CommandImplementation>;

function receiverOf(registry: CommandRegistry, diagnostics: DiagnosticsService): ContributionReceiver<CommandDeclaration, CommandImplementation, {release: Release | null}> {
    // 每次执行都经 implementation() 取实现：贡献撤回后不会再调到旧实现。
    const run = (handle: CommandHandle) => async (args: unknown): Promise<CommandResult<unknown>> => {
        try {
            return await handle.implementation().run(args);
        } catch (error) {
            diagnostics.record({level: "error", event: "commands.run-failed", message: `命令 ${handle.id} 执行时抛出异常`, error, source: {plugin: handle.plugin}});
            throw error;
        }
    };
    return {
        prepare: () => ({release: null}),
        // 贡献方发布后才进命令表：prepare 之后它的激活还可能失败撤回。
        published(handle, prepared) {
            const registered = registry.register({id: handle.id, source: handle.plugin, declaration: handle.declaration, run: run(handle)});
            // 登记时的校验与贡献点的 validate 是同一份，id 唯一又由内核保证，走到这里说明两者不一致。
            if (!registered.ok) {
                diagnostics.record({level: "error", event: "commands.registry", message: `命令 ${handle.id} 通过了贡献校验却没能登记：${registered.reason}`, source: {plugin: handle.plugin}});
                return;
            }
            prepared.release = registered.value;
        },
        revoke(_handle, prepared) {
            prepared.release?.();
            prepared.release = null;
        },
    };
}

/**
 * 窗口里的命令表交给服务端（`nbook.commands/remote`）：列出与执行都按本窗口此刻的公开状态；执行以调用方插件的
 * Agent 身份走同一条执行管线，`expose.agent` 为 `never` 的命令不列出、执行为 `not-exposed`。
 */
function remoteCommands(registry: CommandRegistry): RemoteProvision<typeof commandsRemoteContract> {
    return provideRemote(commandsRemoteContract, (consumer) => ({
        methods: {
            list: async () => ({
                ok: true,
                value: registry.list().flatMap((command) => {
                    const agent = effectiveAgentExposure(command.expose);
                    if (agent === "never") return [];
                    const enabled = registry.isEnabled(command.id);
                    return [{
                        id: command.id,
                        source: command.source,
                        title: command.title,
                        category: command.category ?? null,
                        description: command.description,
                        args: command.args,
                        effect: command.effect,
                        agent,
                        available: enabled.ok && enabled.value,
                        reason: enabled.ok ? null : enabled.reason,
                    }];
                }),
            }),
            execute: async ({id, args}) => ({ok: true, value: await registry.execute(id, args, {source: "agent", callerId: consumer.plugin ?? consumer.instanceId})}),
        },
    }));
}

/** 命令表在 activate 里建：每个实例的入口各一份，常量本身不持有状态。 */
function commandsEntry(location: RuntimeLocation): PluginEntryDefinition {
    const browser = location === "browser";
    return defineEntry({
        id: location,
        location,
        // 窗口的翻译端口只用来翻公开状态原因里的文字引用；服务端没有它。
        dependencies: [{key: diagnosticsKey}, {key: publicStateKey}, {key: settingsKey}, {key: windowTextKey, required: false}],
        provides: [commandServiceKey],
        receives: [COMMANDS_POINT],
        remoteProvides: browser ? [commandsRemoteContract] : [],
        activate: async (context) => {
            const diagnostics = context.services.require(diagnosticsKey);
            const settings = context.services.require(settingsKey);
            const windowText = await context.services.resolve(windowTextKey);
            const translate = windowText.status === "resolved" ? (text: Text) => windowText.instance.port.t(text) : null;
            const registry = createCommandRegistry({
                contextKeys: publicStateKeys(context.services.require(publicStateKey), () => displayLocale(settings), translate),
                report: (error) => {
                    diagnostics.record({level: "warn", event: "commands.registry", message: error.message, source: {plugin: descriptor.id}});
                },
            });
            return {
                services: [provideService(commandServiceKey, serviceOf(registry))],
                receivers: {[COMMANDS_POINT]: receiverOf(registry, diagnostics)},
                // 只有窗口把命令表交给服务端；按位置整段加上 remote，类型才能与按位置的 remoteProvides 对上。
                ...(browser ? {remote: [remoteCommands(registry)]} : {}),
            };
        },
    });
}

export const commandsPlugin: PluginDefinition = {
    id: descriptor.id,
    contributionPoints: [{id: COMMANDS_POINT, implementation: "required", complete: completeCommandDeclaration, validate: validateCommandContribution}],
    entries: [commandsEntry("server"), commandsEntry("browser")],
};
