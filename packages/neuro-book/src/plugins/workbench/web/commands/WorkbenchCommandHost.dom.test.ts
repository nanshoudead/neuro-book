/**
 * 页面上的命令宿主（workbench.commands 场景 13 的组件半边）：挂载后按 `Ctrl+Shift+P` 打开面板；卸载后快捷键不再响应，
 * 面板槽位断开；快捷键执行的命令失败时经 `notify` 弹警告。用真实的命令表与工作台的面板入口命令；产品页上的整条接线由 `src/web/mount.dom.test.ts` 覆盖。
 */

import {mount} from "@vue/test-utils";
import {afterEach, describe, expect, it, vi} from "vitest";
import {nextTick, ref} from "vue";

import {Type} from "typebox";

import {contextTable} from "nbook/plugins/commands/shared/context-keys";
import {createCommandRegistry} from "nbook/plugins/commands/shared/registry";
import type {DisplayLocale} from "nbook/shared/localized-text";

import type {NotificationInput} from "../../shared/contracts";
import {OPEN_COMMANDS_DECLARATION, OPEN_COMMANDS_ID, PaletteSlot} from "./open-commands";
import WorkbenchCommandHost from "./WorkbenchCommandHost.vue";

afterEach(() => {
    document.body.innerHTML = "";
});

function shortcut(): KeyboardEvent {
    const event = new KeyboardEvent("keydown", {key: "P", ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true});
    document.body.dispatchEvent(event);
    return event;
}

describe("WorkbenchCommandHost", () => {
    it("挂载后快捷键打开面板；卸载后快捷键不再拦截，面板命令得到 unavailable", async () => {
        const reported: string[] = [];
        const registry = createCommandRegistry({contextKeys: contextTable({}), report: (error) => reported.push(error.message)});
        const slot = new PaletteSlot();
        const registered = registry.register({id: OPEN_COMMANDS_ID, source: "nbook.workbench", declaration: OPEN_COMMANDS_DECLARATION, run: () => slot.command.run({})});
        expect(registered.ok).toBe(true);

        const wrapper = mount(WorkbenchCommandHost, {
            props: {commands: registry, attach: (host) => slot.attach(host), report: (error: Error) => reported.push(error.message), locale: ref<DisplayLocale>("zh-CN")},
            attachTo: document.body,
        });
        await nextTick();
        expect(shortcut().defaultPrevented).toBe(true);
        await vi.waitFor(() => expect(document.body.querySelector('[role="combobox"]')).not.toBeNull());

        wrapper.unmount();
        await nextTick();
        expect(document.body.querySelector('[role="combobox"]')).toBeNull();
        expect(shortcut().defaultPrevented).toBe(false);
        expect(await registry.execute(OPEN_COMMANDS_ID)).toEqual({ok: false, code: "unavailable", reason: "当前页面没有命令面板"});
        expect(reported).toEqual([]);
    });

    it("快捷键执行的命令失败：弹一条警告，标题是命令名、正文是原因；stale-target 不弹", async () => {
        const registry = createCommandRegistry({contextKeys: contextTable({}), report: () => undefined});
        const declaration = (title: string, keybinding: string) => ({title: {"zh-CN": title, "en-US": title}, description: title, args: Type.Object({}, {additionalProperties: false}), effect: "read" as const, keybinding});
        registry.register({id: "nbook.app.broken", source: "nbook.test", declaration: declaration("坏命令", "Mod+Shift+K"), run: () => ({ok: false, code: "execution-error", reason: "磁盘满了"})});
        registry.register({id: "nbook.app.stale", source: "nbook.test", declaration: declaration("过期命令", "Mod+Shift+J"), run: () => ({ok: false, code: "stale-target", reason: "目标已换"})});
        const notices: NotificationInput[] = [];
        const reported: string[] = [];
        const slot = new PaletteSlot();
        const wrapper = mount(WorkbenchCommandHost, {
            props: {commands: registry, attach: (host) => slot.attach(host), report: (error: Error) => reported.push(error.message), locale: ref<DisplayLocale>("zh-CN"), notify: (input: NotificationInput) => notices.push(input)},
            attachTo: document.body,
        });
        await nextTick();
        document.body.dispatchEvent(new KeyboardEvent("keydown", {key: "J", ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true}));
        document.body.dispatchEvent(new KeyboardEvent("keydown", {key: "K", ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true}));
        await vi.waitFor(() => expect(notices).toEqual([{tone: "warning", title: "坏命令没有完成", message: "磁盘满了"}]));
        // 诊断照记，两条失败都在。
        expect(reported).toHaveLength(2);
        wrapper.unmount();
    });
});
