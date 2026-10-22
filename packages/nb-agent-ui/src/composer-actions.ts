/**
 * 输入框的纯逻辑：编辑器发出 submit 时该发什么、模式怎么循环、`/` 命令菜单怎么列。
 * 放在组件外是为了单测能逐条覆盖“空闲、运行中 × 回车、Ctrl/⌘+回车 × 命令”这些组合。
 */
import type {AgentTextKey} from "./messages";
import type {PromptAttachment, PromptMenu, PromptMenuItem} from "./ports";
import type {AgentViewAction, ComposerModeView, ComposerView, SubmitDelivery} from "./types";
import type {ComposerCommandEntry} from "./registry";

export type ComposerSubmission =
    | {kind: "command"; name: string; argsText: string}
    | {kind: "message"; text: string; delivery: SubmitDelivery}
    | null;

/**
 * 发送时按什么方式投递（docs/specs/ui/agent-conversation-view.md“输入框与待处理区”）。命令先于投递方式判定，运行中
 * 照常执行。运行中回车在允许补充说明时为 steer，否则在允许排队时为 followup；Ctrl/⌘+回车（`mod`）只在允许排队时为
 * followup，不退回 steer。都不允许时返回 null：运行中能写不能发。
 */
export function resolveSubmission(input: {
    text: string;
    mod: boolean;
    running: boolean;
    commands: readonly string[];
    deliveries: {steer: boolean; followup: boolean};
}): ComposerSubmission {
    const text = input.text.trim();
    if (text === "") {
        return null;
    }
    const command = /^\/(\S+)(?:\s+([\s\S]*))?$/u.exec(text);
    if (command && input.commands.includes(command[1]!)) {
        return {kind: "command", name: command[1]!, argsText: (command[2] ?? "").trim()};
    }
    if (!input.running) {
        return {kind: "message", text, delivery: "prompt"};
    }
    const {steer, followup} = input.deliveries;
    const delivery: SubmitDelivery | null = input.mod
        ? (followup ? "followup" : null)
        : (steer ? "steer" : followup ? "followup" : null);
    return delivery === null ? null : {kind: "message", text, delivery};
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

/**
 * 有附件挡住发送时的原因：编辑器发出过、还没移除的附件里有失败的（优先，用户要先处理），或有还在上传的。没就绪的附件不在
 * 文字里，这时发送附件就丢了。不在 `states` 里的按上传中算：宿主还没登记它的状态。
 */
export function sendBlockedReason(live: ReadonlySet<string>, states: ReadonlyMap<string, PromptAttachment>): "uploading" | "failed" | null {
    const current = [...live].map((localId) => states.get(localId)?.state ?? "uploading");
    if (current.includes("failed")) return "failed";
    return current.includes("uploading") ? "uploading" : null;
}

/**
 * 只改状态、不需要宿主再动手的输入框 action：草稿回声（只换文字不换版本，编辑器认得这是自己的回声）、模式、模型与思考
 * 档位。其余返回 null，由宿主处理；附件的登记、重试与移除既要改状态又要上传或释放，也不在这里。
 */
export function applyComposerAction(composer: ComposerView, action: AgentViewAction): ComposerView | null {
    switch (action.type) {
        case "composer.draftChanged": return {...composer, draft: {text: action.text, version: composer.draft.version}};
        case "mode.set": return {...composer, mode: action.mode};
        case "model.set": return {...composer, modelKey: action.modelKey};
        case "thinking.set": return {...composer, thinking: action.level};
        default: return null;
    }
}

/**
 * 宿主受理了一次发送或命令：当前草稿原文（编辑器最近一次回声）放到输入历史最前并去重，草稿清空并换版本，视图据此清空
 * 输入框。命令也用草稿原文，不由宿主拿名称与参数拼回去，空白不走样。
 */
export function acceptSubmission(composer: ComposerView): ComposerView {
    const sent = composer.draft.text.trim();
    const recall = sent === "" ? composer.recall : [sent, ...composer.recall.filter((item) => item !== sent)];
    return {...composer, recall, draft: {text: "", version: composer.draft.version + 1}};
}

