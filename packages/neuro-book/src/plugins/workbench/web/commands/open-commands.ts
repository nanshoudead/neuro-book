/**
 * 工作台贡献的命令 `nbook.quick-open.open-commands`（默认键位 `Mod+Shift+P`），与给其它插件的选择服务。
 *
 * 命令实现与选择服务随工作台激活交出，面板却挂在页面上：页面的命令宿主挂载时接入槽位、卸载时断开。没有页面宿主的
 * 文档（例如 Lab）里执行它只得到 `unavailable`，选择得到 `unavailable`；那里也不挂键位分发，快捷键不会走到这里。
 */

import {Type} from "typebox";

import type {CommandImplementation, Release, WrittenCommandDeclaration} from "nbook/plugins/commands/shared/contracts";

import type {QuickPick} from "../../shared/contracts";
import {workbenchText} from "../../shared/text";
import type {PaletteHost} from "./palette-host";

export const OPEN_COMMANDS_ID = "nbook.quick-open.open-commands";

/** 没有页面宿主时命令与选择共用的原因。 */
const NO_PALETTE = workbenchText("palette.unavailable");

export const OPEN_COMMANDS_DECLARATION: WrittenCommandDeclaration = {
    description: "Open the command palette.",
    args: Type.Object({}, {additionalProperties: false}),
    effect: "read",
    keybinding: "Mod+Shift+P",
    // 面板入口本身不进面板候选；只从键位或按钮进入。
    expose: {human: false, agent: "never"},
};

/** 当前页面的面板。同一时刻只有一个页面宿主；后接入的替换先前的，旧宿主断开时不影响新的。 */
export class PaletteSlot {
    #current: PaletteHost | null = null;

    attach(host: PaletteHost): Release {
        this.#current = host;
        return () => {
            if (this.#current === host) this.#current = null;
        };
    }

    readonly command: CommandImplementation = {
        run: () => {
            if (this.#current === null) return {ok: false, code: "unavailable", reason: NO_PALETTE};
            this.#current.openPalette("commands");
            return {ok: true, value: null};
        },
    };

    readonly quickPick: QuickPick = {
        pick: (request) => (this.#current === null ? Promise.resolve({kind: "unavailable", reason: NO_PALETTE}) : this.#current.openPick(request)),
    };
}
