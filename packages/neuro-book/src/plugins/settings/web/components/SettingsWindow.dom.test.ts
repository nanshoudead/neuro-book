/**
 * SettingsWindow（同名 .md，docs/specs/settings/settings-window.md 输出 1、3、6、7、9、12–14、16、17）：窗口由设置场景的局部
 * 宿主驱动（产品里同一个窗口模型、配置实例与分区注册表，层的拥有者在内存里，同 Lab）。看左栏、标签、通用控件的写入与
 * 失败、层的说明、page 页面在切换标签与离开分区时的寿命、左栏的键盘与关闭。
 */

import {flushPromises, mount} from "@vue/test-utils";
import {afterEach, describe, expect, it} from "vitest";
import {defineComponent, h, onMounted, onUnmounted} from "vue";
import type {PropType} from "vue";

import {createSettingsScene} from "nbook/plugins/lab/web/fixtures/settings-scene/scene-data";
import {createSettingsHost} from "nbook/plugins/lab/web/fixtures/settings-scene/settings-host";
import type {SettingsHost} from "nbook/plugins/lab/web/fixtures/settings-scene/settings-host";
import {SCENE_PROJECT_FILE} from "nbook/plugins/lab/web/fixtures/settings-scene/scene-data";
import type {SettingsWindowSceneId} from "nbook/plugins/lab/web/fixtures/settings-scene/scene-settings";
import type {NotificationInput} from "nbook/plugins/workbench/shared/contracts";
import {appearanceSetting, themeSetting} from "nbook/plugins/workbench/shared/contracts";
import type {SettingDefinition} from "nbook/shared/settings";

import type {SettingsPageContext} from "../contracts";
import type {SettingsWindow as SettingsWindowModel} from "../settings-window";
import SettingsWindow from "./SettingsWindow.vue";

const cleanup: Array<() => void> = [];
afterEach(() => {
    for (const dispose of cleanup.splice(0)) dispose();
    document.body.innerHTML = "";
});

function render(model: SettingsWindowModel) {
    const wrapper = mount(SettingsWindow, {props: {window: model}, attachTo: document.body});
    cleanup.push(() => wrapper.unmount());
    return wrapper;
}

async function scene(id: SettingsWindowSceneId) {
    const notices: NotificationInput[] = [];
    const created = createSettingsScene(id, (input) => notices.push(input), () => undefined);
    cleanup.push(() => created.host.dispose());
    created.open();
    const wrapper = render(created.host.window);
    await flushPromises();
    return {...created, notices, wrapper};
}

const all = (selector: string): HTMLElement[] => [...document.body.querySelectorAll<HTMLElement>(selector)];
const one = (selector: string): HTMLElement => {
    const found = document.body.querySelector<HTMLElement>(selector);
    if (found === null) throw new Error(`没有 ${selector}`);
    return found;
};
const navIds = (): string[] => all("[data-settings-nav]").map((element) => element.dataset.settingsNav ?? "");
/** 分段控件里文字为 `label` 的一段。 */
const segment = (row: string, label: string): HTMLElement => {
    const found = all(`[data-settings-row="${row}"] button[role="radio"]`).find((button) => button.textContent?.trim() === label);
    if (found === undefined) throw new Error(`${row} 没有选项 ${label}`);
    return found;
};
const selected = (row: string): string | undefined => all(`[data-settings-row="${row}"] button[role="radio"]`).find((button) => button.getAttribute("aria-checked") === "true")?.textContent?.trim();

describe("SettingsWindow", () => {
    it("左栏三组、组间分隔线；绑定作品时有“用户 | 本作品”，没绑定没有；外观分区按小组画控件", async () => {
        await scene("user");
        expect(navIds()).toEqual(["nbook.appearance", "example.models.main", "example.snippets.main", "other"]);
        expect(all("[data-settings-nav-separator]")).toHaveLength(2);
        expect(one("[data-settings-nav-current]").dataset.settingsNav).toBe("nbook.appearance");
        expect(document.body.querySelector("[data-settings-tabs]")).not.toBeNull();
        expect(one("[data-settings-section='nbook.appearance']").textContent).toContain("界面的主题、明暗与语言");
        expect(all("[data-settings-group]").map((group) => group.dataset.settingsGroup)).toEqual(["ui", "language"]);
        expect(selected(appearanceSetting.key)).toBe("跟随系统");
        cleanup.splice(0).forEach((dispose) => dispose());
        document.body.innerHTML = "";

        await scene("unbound");
        expect(document.body.querySelector("[data-settings-tabs]")).toBeNull();
    });

    it("改值经窗口模型写当前标签那一层；本作品标签下只允许用户层的项不列出，末尾说明", async () => {
        const {host} = await scene("user");
        segment(appearanceSetting.key, "深色").click();
        await flushPromises();
        expect(host.user.values()).toMatchObject({"nbook.workbench/appearance": "dark"});
        expect(selected(appearanceSetting.key)).toBe("深色");

        const tabs = all("[data-settings-tabs] button[role='radio']");
        tabs.find((button) => button.textContent?.trim() === "本作品")?.click();
        await flushPromises();
        expect(host.window.layer.value).toBe("project");
        expect(document.body.querySelector("[data-settings-row='nbook.settings/locale']")).toBeNull();
        expect(one("[data-settings-excluded]").textContent).toBe("界面语言只能在用户设置里改");
        expect(one(`[data-settings-row="${themeSetting.key}"]`).dataset.settingsRowState).toBe("inherit");
    });

    it("写入失败：发通知，控件回到层里的实际值；结果未知另有提示", async () => {
        const {host, notices} = await scene("write-failed");
        expect(selected(themeSetting.key)).toBe("macOS");
        segment(themeSetting.key, "NeuroBook").click();
        await flushPromises();
        expect(notices).toEqual([{tone: "warning", title: "设置没有保存", message: "主题：写不进设置文件（场景让写入失败）"}]);
        expect(selected(themeSetting.key)).toBe("macOS");
        host.user.failWrites("unknown-outcome");
        segment(themeSetting.key, "NeuroBook").click();
        await flushPromises();
        expect(notices[1]).toEqual({tone: "warning", title: "设置可能没有保存", message: "主题：可能没有保存，以设置文件为准"});
    });

    it("层文件无效：分区顶部说明带文件路径，控件停用；层连不上另有说明；恢复后说明消失", async () => {
        const {host} = await scene("project-invalid");
        expect(one("[data-settings-layer-notice='invalid']").textContent).toContain("设置文件有错误，修好前这里不能保存");
        expect(one("[data-settings-layer-notice='invalid']").textContent).toContain(SCENE_PROJECT_FILE);
        expect(one(`[data-settings-row="${appearanceSetting.key}"]`).dataset.settingsRowBlocked).toBe("");
        host.project?.setInvalid(null);
        await flushPromises();
        expect(document.body.querySelector("[data-settings-layer-notice]")).toBeNull();
        host.project?.setUnreachable(true);
        await flushPromises();
        expect(one("[data-settings-layer-notice='unavailable']").textContent).toContain("暂时连不上，不能保存");
    });

    it("“其它”分区：开关、下拉、数字、单行输入与只读项（宽排法）、生效时机的标注；数字框回车提交，不合 schema 的值被拒、回到实际值", async () => {
        const {host, notices} = await scene("other");
        host.window.select("other");
        await flushPromises();
        expect(all("[data-settings-control]").map((control) => control.dataset.settingsControl)).toEqual(["switch", "number", "switch", "text", "select", "readonly"]);
        expect(one("[data-settings-row='example.notes/tags']").querySelector("[data-settings-row-wide] [data-settings-control='readonly']")).not.toBeNull();
        // applies 不是 now 时标题后标注生效时机；now 不标。
        expect(one("[data-settings-row='example.notes/interval'] label").textContent).toContain("下次会话生效");
        expect(one("[data-settings-row='example.notes/tags'] label").textContent).toContain("重启后生效");
        expect(one("[data-settings-row='example.notes/autosave'] label").textContent).not.toContain("生效");
        const input = one("[data-settings-row='example.notes/interval'] input") as HTMLInputElement;
        input.value = "1000";
        input.dispatchEvent(new Event("input"));
        input.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", bubbles: true}));
        await flushPromises();
        expect(notices[0]?.message).toContain("保存间隔（秒）：这个值不能用");
        expect(input.value).toBe("120");
        input.value = "90";
        input.dispatchEvent(new Event("input"));
        input.dispatchEvent(new FocusEvent("focusout", {bubbles: true}));
        await flushPromises();
        expect(host.user.values()).toMatchObject({"example.notes/interval": 90});
    });

    it("左栏：上下键切到上一个、下一个可用分区，焦点跟着走；关闭按钮关窗口", async () => {
        const {host} = await scene("project");
        one("[data-settings-nav-current]").focus();
        one("[data-settings-nav-current]").dispatchEvent(new KeyboardEvent("keydown", {key: "ArrowDown", bubbles: true}));
        await flushPromises();
        // 模型服务只在用户设置里，本作品标签下停用、被跳过。
        expect(host.window.section.value).toBe("example.snippets.main");
        expect(document.activeElement).toBe(one("[data-settings-nav-current]"));
        expect(one("[data-settings-nav='example.models.main']").hasAttribute("disabled")).toBe(true);
        one("[data-settings-nav-current]").dispatchEvent(new KeyboardEvent("keydown", {key: "Home", bubbles: true}));
        await flushPromises();
        expect(host.window.section.value).toBe("nbook.appearance");
        one("button[aria-label='关闭']").click();
        await flushPromises();
        expect(host.window.open.value).toBe(false);
    });
});

describe("page 页面的寿命（输出 6）", () => {
    function counting() {
        const counts = {mounted: 0, unmounted: 0, loads: 0};
        const Page = defineComponent({
            name: "CountingPage",
            props: {context: {type: Object as PropType<SettingsPageContext>, required: true}},
            setup(props) {
                onMounted(() => void (counts.mounted += 1));
                onUnmounted(() => void (counts.unmounted += 1));
                return () => h("p", {"data-page-layer": ""}, props.context.layer.value);
            },
        });
        return {counts, Page};
    }

    function pageHost(): SettingsHost {
        const created = createSettingsHost({
            settings: [{plugin: "nbook.workbench", definition: themeSetting as SettingDefinition<unknown>}],
            sections: [
                {id: "x.page.main", plugin: "x.page", kind: "page", declaration: {title: {"zh-CN": "页面", "en-US": "Page"}, icon: "i-lucide-square", category: "plugins"}},
            ],
            project: {},
            notify: () => undefined,
            report: () => undefined,
        });
        cleanup.push(() => created.dispose());
        return created;
    }

    it("切换标签时页面不重建、拿到新的层；离开分区时卸载，回到分区时用同一份组件定义重新创建", async () => {
        const {counts, Page} = counting();
        const created = pageHost();
        created.publish("x.page.main", async () => {
            counts.loads += 1;
            return Page;
        });
        created.window.openWindow({section: "x.page.main"});
        render(created.window);
        await flushPromises();
        expect(one("[data-page-layer]").textContent).toBe("user");
        all("[data-settings-tabs] button[role='radio']").find((button) => button.textContent?.trim() === "本作品")?.click();
        await flushPromises();
        expect(one("[data-page-layer]").textContent).toBe("project");
        expect(counts).toEqual({mounted: 1, unmounted: 0, loads: 1});
        // 主题指向这里没有的外观分区，落在“其它”。
        one("[data-settings-nav='other']").click();
        await flushPromises();
        expect(counts.unmounted).toBe(1);
        one("[data-settings-nav='x.page.main']").click();
        await flushPromises();
        expect(counts).toEqual({mounted: 2, unmounted: 1, loads: 1});
    });

    it("交付状态原位呈现：入口失败给“重试”，重试后交付并显示页面；渲染出错给“重试”重建", async () => {
        let crash = true;
        const Fragile = defineComponent({name: "FragilePage", setup: () => () => {
            if (crash) throw new Error("页面出错了");
            return h("p", {"data-page-ok": ""}, "好了");
        }});
        const created = pageHost();
        created.entry("x.page.main", "failed", "读不到片段库");
        created.onRetry(async () => {
            created.publish("x.page.main", async () => Fragile);
            return {status: "activated"};
        });
        created.window.openWindow({section: "x.page.main"});
        render(created.window);
        await flushPromises();
        expect(one("[data-settings-page-state='entry-failed']").textContent).toContain("读不到片段库");
        one("[data-settings-page-retry-entry]").click();
        await flushPromises();
        expect(one("[data-settings-page-state='render-failed']").textContent).toContain("页面出错了");
        crash = false;
        one("[data-settings-page-retry-render]").click();
        await flushPromises();
        expect(document.body.querySelector("[data-page-ok]")).not.toBeNull();
    });
});
