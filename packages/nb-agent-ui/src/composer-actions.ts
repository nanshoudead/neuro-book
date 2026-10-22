/**
 * 输入框的纯逻辑：编辑器发出 submit 时该发什么、模式怎么循环、`/` 命令菜单怎么列。
 * 放在组件外是为了单测能逐条覆盖“空闲、运行中 × 回车、Ctrl/⌘+回车 × 命令”这些组合。
 */
import type {AgentTextKey} from "./messages";
import type {PromptMenu, PromptMenuItem} from "./ports";
import type {ComposerModeView, SubmitDelivery} from "./types";
import type {ComposerCommandEntry} from "./registry";

export type ComposerSubmission =
    | {kind: "command"; name: string; argsText: string}
    | {kind: "message"; text: string; delivery: SubmitDelivery}
    | null;

/**
 * 正文去掉首尾空白后为空时不发送。以 `/名称` 开头且名称是登记的命令时执行命令；
 * 否则按普通消息发送：空闲时是 prompt，运行中回车是 steer、Ctrl/⌘+回车是 followup。
 */
export function resolveSubmission(input: {text: string; mod: boolean; running: boolean; commands: readonly string[]}): ComposerSubmission {
    const text = input.text.trim();
    if (text === "") {
        return null;
    }
    const command = /^\/(\S+)(?:\s+([\s\S]*))?$/u.exec(text);
    if (command && input.commands.includes(command[1]!)) {
        return {kind: "command", name: command[1]!, argsText: (command[2] ?? "").trim()};
    }
    const delivery: SubmitDelivery = !input.running ? "prompt" : input.mod ? "followup" : "steer";
    return {kind: "message", text, delivery};
}

/** 下一种模式；当前模式不在列表里时回到第一种。少于两种模式时没有可切换的。 */
export function nextMode(modes: readonly ComposerModeView[], current: string): string | null {
    if (modes.length < 2) {
        return null;
    }
    const index = modes.findIndex((mode) => mode.key === current);
    return modes[(index + 1) % modes.length]!.key;
}

/**
 * `/` 位于正文开头时的菜单：登记的命令按名称过滤，名称以查询开头的排在前面。
 * 说明与参数提示由调用方翻译好传进来（ViewText 要 i18n 运行时）。
 */
export function commandMenu(
    commands: ReadonlyArray<Pick<ComposerCommandEntry, "id" | "name"> & {description: string; argsHint: string | null}>,
    query: string,
    labels: {title: string; empty: string},
): PromptMenu {
    const needle = query.toLowerCase();
    const ranked = commands
        .filter((command) => command.name.toLowerCase().includes(needle))
        .sort((a, b) => Number(!a.name.toLowerCase().startsWith(needle)) - Number(!b.name.toLowerCase().startsWith(needle)));
    const items = ranked.map((command): PromptMenuItem => ({
        id: `command:${command.id}`,
        label: `/${command.name}`,
        description: command.argsHint === null ? command.description : `${command.description} · ${command.argsHint}`,
        iconClass: "i-lucide-square-slash",
        insertText: `/${command.name}`,
    }));
    return {title: labels.title, items, emptyText: labels.empty};
}

/** 常见思考档位在本包文字表里的键；其他取值原样显示。 */
export const THINKING_LEVEL_KEYS: Readonly<Record<string, AgentTextKey>> = {
    off: "composer.thinking.off",
    minimal: "composer.thinking.minimal",
    low: "composer.thinking.low",
    medium: "composer.thinking.medium",
    high: "composer.thinking.high",
    xhigh: "composer.thinking.xhigh",
    max: "composer.thinking.max",
};
