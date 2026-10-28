/**
 * 应用命令（docs/specs/workbench/commands.md 的“命令目录（应用）”）：重新载入与打开文档站。都经宿主的整页导航能力执行，
 * 命令结果只说明请求已经发出；离开保护（编辑器的 beforeunload）照常生效，用户取消时页面不变。
 */

import {Type} from "typebox";

import type {CommandImplementation, WrittenCommandDeclaration} from "nbook/plugins/commands/shared/contracts";
import type {TextResolver} from "nbook/shared/localized-text";
import type {WindowNavigation} from "nbook/shared/host";

import {workbenchText} from "../../shared/text";

export const RELOAD_COMMAND = "nbook.app.reload";
export const DOCUMENTATION_COMMAND = "nbook.help.documentation";

/** 用户文档站（GitHub Pages，`vitepress` 的 base 是 `/neuro-book/`）。 */
export const DOCUMENTATION_URL = "https://notnotype.github.io/neuro-book/";

const NO_ARGS = Type.Object({}, {additionalProperties: false});

export const APP_COMMAND_DECLARATIONS = {
    [RELOAD_COMMAND]: {
        category: workbenchText("categories.view"),
        description: "Reload this window. The address, and so the open project, stays the same; unsaved text triggers the browser's leave prompt.",
        args: NO_ARGS,
        effect: "read",
        // 整页重新加载会打断 Agent 自己所在的窗口。
        expose: {agent: "never"},
    },
    [DOCUMENTATION_COMMAND]: {
        category: workbenchText("categories.help"),
        description: "Open the NeuroBook user documentation in a new browser tab.",
        args: NO_ARGS,
        effect: "read",
        // 新标签页只对人有用。
        expose: {agent: "never"},
    },
} as const satisfies Readonly<Record<string, WrittenCommandDeclaration>>;

export function appCommands(navigation: WindowNavigation, text: TextResolver): {readonly [K in keyof typeof APP_COMMAND_DECLARATIONS]: CommandImplementation} {
    return {
        [RELOAD_COMMAND]: {
            run: () => {
                navigation.reloadDocument();
                return {ok: true, value: null};
            },
        },
        [DOCUMENTATION_COMMAND]: {
            run: () => (navigation.openExternal(DOCUMENTATION_URL) === "opened" ? {ok: true, value: null} : {ok: false, code: "unavailable", reason: text.t(workbenchText("appCommands.blocked"))}),
        },
    };
}
