/**
 * 作者 API 里浏览器一侧的助手（docs/specs/runtime/plugin-api.md 的“作者 API”）：视图、设置页、状态栏条目、选项来源拼出的 id、
 * 缺省值、带的激活事件与已绑定的实现。属性推导与位置核对的反例写在文件末尾，`bun run typecheck`（vue-tsc）检查它们编译不过。
 */

import {describe, expect, it} from "vitest";

import {command} from "./command-helpers";
import {definePlugin} from "./plugin";
import {choices, settingsPage} from "./settings-browser-helpers";
import {statusItem, view} from "./workbench-helpers";

const plugin = definePlugin({id: "acme.hello", version: "1.0.0", locations: ["browser", "server"]});

describe("浏览器一侧的助手", () => {
    it("视图：id 是插件 id 加短名，location 缺省 sidebar、layout 缺省 scroll，文字写一个字符串；implement 带贡献点与 id", () => {
        const panel = view(plugin, {name: "panel", title: "你好", icon: "i-lucide-hand", load: () => import("./testing/GreetingProbe.vue")});
        expect(panel.id).toBe("acme.hello.panel");
        expect(panel.where).toBe("browser");
        expect(panel.contribution).toEqual({capability: "workbench.views", id: "acme.hello.panel", declaration: {title: {"zh-CN": "你好", "en-US": "你好"}, icon: "i-lucide-hand", location: "sidebar", layout: "scroll"}});
        const implemented = panel.implement(() => ({greeting: "hi"}));
        expect(implemented).toMatchObject({capability: "workbench.views", id: "acme.hello.panel"});
        expect(typeof (implemented.implementation as {load?: unknown}).load).toBe("function");
    });

    it("设置页带 onSettingsPage 激活事件，category 缺省 plugins；选项来源带 onSettingsChoices", () => {
        const page = settingsPage(plugin, {name: "main", title: "你好", icon: "i-lucide-hand", load: () => import("./testing/GreetingProbe.vue")});
        expect(page.activationEvents).toEqual(["onSettingsPage:acme.hello.main"]);
        expect(page.contribution.declaration).toMatchObject({category: "plugins", title: {"zh-CN": "你好", "en-US": "你好"}});
        const voices = choices(plugin, {name: "voices"});
        expect(voices.activationEvents).toEqual(["onSettingsChoices:acme.hello.voices"]);
        const source = () => ({status: "ready" as const, items: []});
        expect(voices.implement(source)).toEqual({capability: "settings.choices", id: "acme.hello.voices", implementation: {source}});
    });

    it("状态栏条目：alignment 缺省 right，order、priority 缺省 0；command 收命令助手", () => {
        const say = command(plugin, {name: "say", title: "打招呼", description: "Say hello", effect: "write"});
        const count = statusItem(plugin, {name: "count", title: "次数", command: say});
        expect(count.contribution.declaration).toEqual({title: {"zh-CN": "次数", "en-US": "次数"}, alignment: "right", order: 0, priority: 0, command: {id: "acme.hello.say"}});
        const text = () => "3";
        expect(count.implement({text})).toEqual({capability: "workbench.statusbar-items", id: "acme.hello.count", implementation: {text}});
    });

    it("短名不合规则时抛错", () => {
        expect(() => view(plugin, {name: "Panel", title: "x", icon: "i-lucide-x", load: () => import("./testing/GreetingProbe.vue")})).toThrow("Panel");
    });
});

/** 编译期的反例：不调用，只给类型检查看。 */
export function typeChecks(): void {
    const panel = view(plugin, {name: "panel", title: "x", icon: "i-lucide-x", load: () => import("./testing/GreetingProbe.vue")});
    // @ts-expect-error 组件要的是 greeting
    panel.implement(() => ({greting: "hi"}));
    // @ts-expect-error greeting 要是字符串
    panel.implement(() => ({greeting: 1}));
    panel.implement(() => ({greeting: "hi", count: 1}));
    // 浏览器的助手写进服务端入口。
    // @ts-expect-error 视图只能写进浏览器入口
    plugin.entry({location: "server", contributions: {panel}, activate: () => ({contributions: {panel: panel.implement(() => ({greeting: "hi"}))}})});
    plugin.entry({location: "browser", contributions: {panel}, activate: () => ({contributions: {panel: panel.implement(() => ({greeting: "hi"}))}})});
    // 其它三个浏览器助手同样只能写进浏览器入口。
    const page = settingsPage(plugin, {name: "main", title: "x", icon: "i-lucide-x", load: () => import("./testing/GreetingProbe.vue")});
    const count = statusItem(plugin, {name: "count", title: "x"});
    const voices = choices(plugin, {name: "voices"});
    // @ts-expect-error 设置页只能写进浏览器入口
    plugin.entry({location: "server", contributions: {page}, activate: () => ({contributions: {page: page.implement(() => ({greeting: "hi"}))}})});
    // @ts-expect-error 状态栏条目只能写进浏览器入口
    plugin.entry({location: "server", contributions: {count}, activate: () => ({contributions: {count: count.implement({text: () => "1"})}})});
    // @ts-expect-error 选项来源只能写进浏览器入口
    plugin.entry({location: "server", contributions: {voices}, activate: () => ({contributions: {voices: voices.implement(() => ({status: "ready", items: []}))}})});
}
