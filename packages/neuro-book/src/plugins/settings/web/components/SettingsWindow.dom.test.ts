/**
 * SettingsWindow（同名 .md，docs/specs/settings/settings-window.md 输出 1、3、6、7、9、12–14、16、17）：窗口由设置场景的局部
 * 宿主驱动（产品里同一个窗口模型、配置实例与分区注册表，层的拥有者在内存里，同 Lab）。看左栏、标签、通用控件的写入与
 * 失败、层的说明、page 页面在切换标签与离开分区时的寿命、左栏的键盘与关闭。
 */

import {flushPromises, mount} from "@vue/test-utils";
import {afterEach, describe, expect, it, vi} from "vitest";
import {defineComponent, h, onMounted, onUnmounted} from "vue";
import type {PropType} from "vue";

import {createSettingsScene} from "nbook/plugins/lab/web/fixtures/settings-scene/scene-data";
import {createSettingsHost} from "nbook/plugins/lab/web/fixtures/settings-scene/settings-host";
import type {SettingsHost} from "nbook/plugins/lab/web/fixtures/settings-scene/settings-host";
import {SCENE_PROJECT_FILE} from "nbook/plugins/lab/web/fixtures/settings-scene/scene-data";
import {modelsSettings} from "nbook/plugins/lab/web/fixtures/settings-scene/scene-settings";
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
/** 一项的单选：分段控件的选项名在按钮上，单选组的在包着圆钮的 `<label>` 里。 */
const choices = (row: string): HTMLElement[] => all(`[data-settings-row="${row}"] [role="radiogroup"] [role="radio"]`);
const choiceName = (element: HTMLElement): string | undefined => (element.closest("label") ?? element).textContent?.trim();
const segment = (row: string, label: string): HTMLElement => {
    const found = choices(row).find((element) => choiceName(element) === label);
    if (found === undefined) throw new Error(`${row} 没有选项 ${label}`);
    return found;
};
const selected = (row: string): string | undefined => {
    const found = choices(row).find((element) => element.getAttribute("aria-checked") === "true");
    return found === undefined ? undefined : choiceName(found);
};
/** 每一行的控件：行里第一个 `data-nb-widget` 是字段自己的（列表项的控件排在它里面）。 */
const widgetOf = (row: HTMLElement): string | undefined => row.querySelector<HTMLElement>("[data-nb-widget]")?.dataset.nbWidget;


/** 控件的 `aria-describedby` 指向的文字连起来：读屏会念到的说明。 */
function describedText(element: Element): string {
    return (element.getAttribute("aria-describedby") ?? "").split(" ").filter(Boolean).map((id) => document.getElementById(id)?.textContent ?? "").join(" ");
}

describe("SettingsWindow", () => {
    it("左栏三组、组间分隔线；绑定作品时有“用户 | 本作品”，没绑定没有；外观分区按小组画控件", async () => {
        await scene("user");
        expect(navIds()).toEqual(["nbook.appearance", "example.models.main", "example.snippets.main", "other", "file"]);
        expect(all("[data-settings-nav-separator]")).toHaveLength(2);
        expect(one("[data-settings-nav-current]").dataset.settingsNav).toBe("nbook.appearance");
        expect(document.body.querySelector("[data-settings-tabs]")).not.toBeNull();
        expect(one("[data-settings-section='nbook.appearance']").textContent).toContain("界面的主题、明暗与语言");
        expect(all("[data-settings-group]").map((group) => group.dataset.settingsGroup)).toEqual(["ui", "language"]);
        expect(selected(appearanceSetting.key)).toBe("跟随系统");
        // 分段控件与单选组拿不到 `<label for>` 的名字，经 aria-labelledby 指向行的标题。
        const appearance = one(`[data-settings-row="${appearanceSetting.key}"]`);
        expect(document.getElementById(appearance.querySelector("[role='radiogroup']")!.getAttribute("aria-labelledby")!)?.textContent).toContain("明暗");
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
        expect(one("[data-settings-excluded]").textContent).toBe("界面语言仅可在用户设置中修改");
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

    it("“其它”分区：开关、下拉、数字、单行输入与字符串列表（宽排法、可编辑）、生效时机的标注；数字框回车提交，不合 schema 的值被拒、回到实际值", async () => {
        const {host, notices} = await scene("other");
        host.window.select("other");
        await flushPromises();
        expect(all("[data-settings-row]").map(widgetOf)).toEqual(["select", "switch", "number", "switch", "text", "select", "string-list"]);
        const tags = one("[data-settings-row='example.notes/tags']");
        expect(tags.querySelector("[data-settings-row-wide] [data-nb-widget='string-list']")).not.toBeNull();
        // 控件的名字是行的标题（`<label for>` 指向它），说明经 aria-describedby 接上。
        const autosave = one("[data-settings-row='example.notes/autosave']");
        const control = document.getElementById(autosave.querySelector("label")!.htmlFor)!;
        expect(autosave.contains(control)).toBe(true);
        expect(control.getAttribute("aria-describedby")?.split(" ")).toContain(autosave.querySelector("p")!.id);
        // applies 不是 now 时标题后标注生效时机，不进控件的名字、接进说明；now 不标。
        const described = (row: string) => (one(`[data-settings-row='${row}'] #${CSS.escape((one(`[data-settings-row='${row}'] label`) as HTMLLabelElement).htmlFor)}`).getAttribute("aria-describedby") ?? "").split(" ").map((id) => document.getElementById(id)?.textContent ?? "");
        expect(one("[data-settings-row='example.notes/interval'] label").textContent).toBe("保存间隔（秒）");
        const heading = (row: string) => one(`[data-settings-row='${row}'] label`).parentElement!.textContent;
        expect(heading("example.notes/interval")).toContain("下次会话生效");
        expect(described("example.notes/interval")).toContain("下次会话生效");
        expect(heading("example.notes/tags")).toContain("重启后生效");
        expect(heading("example.notes/autosave")).not.toContain("生效");
        const input = one("[data-settings-row='example.notes/interval'] input") as HTMLInputElement;
        input.value = "1000";
        input.dispatchEvent(new Event("input"));
        input.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", bubbles: true}));
        await flushPromises();
        expect(notices[0]?.message).toContain("保存间隔（秒）：这个值不能用");
        expect(input.value).toBe("120");
        // 不是数：不写，行里写出原因；改好后原因消失。
        input.dispatchEvent(new FocusEvent("focusin", {bubbles: true}));
        input.value = "abc";
        input.dispatchEvent(new Event("input"));
        input.dispatchEvent(new FocusEvent("focusout", {bubbles: true}));
        await flushPromises();
        // 原因收在标题后的图标里（出错的色调），读屏文字经 aria-describedby 接到控件上。
        const interval = one("[data-settings-row='example.notes/interval']");
        expect(interval.querySelector("[data-settings-row-reason]")?.getAttribute("data-tone")).toBe("error");
        expect(interval.querySelector("[data-settings-row-reasons]")?.textContent).toMatch(/^未保存：/u);
        expect(described("example.notes/interval").some((text) => text.startsWith("未保存："))).toBe(true);
        expect(host.user.values()).toMatchObject({"example.notes/interval": 120});
        input.dispatchEvent(new FocusEvent("focusin", {bubbles: true}));
        input.value = "90";
        input.dispatchEvent(new Event("input"));
        input.dispatchEvent(new FocusEvent("focusout", {bubbles: true}));
        await flushPromises();
        expect(host.user.values()).toMatchObject({"example.notes/interval": 90});
        expect(document.body.querySelector("[data-settings-row='example.notes/interval'] [data-settings-row-reason]")).toBeNull();
        expect(document.body.querySelector("[data-settings-row='example.notes/interval'] [data-settings-row-reasons]")).toBeNull();

        // 字符串列表加一项：空项不合 schema，先留在行里、不写，写出原因；填好失焦后整个数组写进这一层。
        (tags.querySelector("[data-nb-list-add]") as HTMLButtonElement).click();
        await flushPromises();
        expect(host.user.values()["example.notes/tags"]).toBeUndefined();
        expect(tags.querySelector("[data-settings-row-reasons]")?.textContent).toMatch(/^未保存：.*第 4 项/u);
        const added = [...tags.querySelectorAll<HTMLInputElement>("[data-nb-list-item] input")].at(-1)!;
        expect(document.activeElement).toBe(added);
        added.dispatchEvent(new FocusEvent("focusin", {bubbles: true}));
        added.value = "对白";
        added.dispatchEvent(new Event("input"));
        added.dispatchEvent(new FocusEvent("focusout", {bubbles: true}));
        await flushPromises();
        expect(host.user.values()).toMatchObject({"example.notes/tags": ["人物", "地点", "伏笔", "对白"]});
        expect(tags.querySelector("[data-settings-row-reasons]")).toBeNull();

        // 删一项时写入失败：发通知，项回来，焦点留在列表里（不掉到页面上）。
        host.user.failWrites("write-failed");
        const remove = tags.querySelector<HTMLButtonElement>("[aria-label='删除：第 2 项']")!;
        remove.focus();
        remove.click();
        await flushPromises();
        expect([...tags.querySelectorAll<HTMLInputElement>("[data-nb-list-item] input")].map((element) => element.value)).toEqual(["人物", "地点", "伏笔", "对白"]);
        expect(notices.at(-1)?.title).toBe("设置没有保存");
        expect(tags.contains(document.activeElement)).toBe(true);
        expect(tags.querySelector("[aria-live='polite']")?.textContent).toBe("刚才的改动没有生效");
    });

    it("动态选项：列出提供者给的选项，当前值不在选项里时照常显示并标“已不存在”", async () => {
        const {host} = await scene("choices");
        const row = one("[data-settings-row='example.notes/template']");
        const trigger = row.querySelector<HTMLElement>("[data-nb-widget='select'] button, [data-nb-widget='select'] [role='combobox']")!;
        expect(row.querySelector("[data-settings-row-reason]")?.getAttribute("data-tone")).toBe("warning");
        // 字段自己的警告由控件念（aria-describedby），行不再写一份读屏文字，免得念两遍。
        expect(describedText(trigger)).toContain("已不存在");
        expect(row.querySelector("[data-settings-row-reasons]")).toBeNull();
        expect(trigger.hasAttribute("disabled")).toBe(false);
        expect(host.window.options()["example.notes.templates"]).toBeDefined();
        const items = host.window.options()["example.notes.templates"];
        const value = typeof items === "function" ? items() : (items as {value: unknown}).value;
        expect(value).toMatchObject({status: "ready", items: [{value: "diary"}, {value: "scene"}, {value: "character"}]});
    });

    it("动态选项：提供者按需激活时先显示加载中、停用，交付后可选；提供者的入口失败时停用并在行里写原因", async () => {
        await scene("choices-lazy");
        const row = () => one("[data-settings-row='example.notes/template']");
        const control = () => row().querySelector<HTMLElement>("[data-nb-widget='select'] button, [data-nb-widget='select'] [role='combobox']")!;
        expect(control().hasAttribute("disabled") || control().getAttribute("aria-disabled") === "true").toBe(true);
        await vi.waitFor(() => expect(control().hasAttribute("disabled")).toBe(false), {timeout: 3_000});
        expect(row().textContent).not.toContain("已不存在");
        cleanup.splice(0).forEach((dispose) => dispose());
        document.body.innerHTML = "";

        await scene("choices-unavailable");
        expect(row().querySelector("[data-settings-row-reason]")?.getAttribute("data-tone")).toBe("muted");
        expect(describedText(control())).toContain("无法加载选项：模板库读不到：权限不足");
        expect(row().querySelector("[data-settings-row-reasons]")).toBeNull();
        expect(control().hasAttribute("disabled")).toBe(true);
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

describe("搜索与未保存保护（输出 21、22）", () => {
    it("Mod+F 在窗口里聚焦搜索框；搜到的项可以直接改；框里有字时 Esc 只清空、回到原分区，空了再按才关窗口", async () => {
        const {host} = await scene("other");
        one("[data-settings-nav-current]").dispatchEvent(new KeyboardEvent("keydown", {key: "f", code: "KeyF", ctrlKey: true, bubbles: true, cancelable: true}));
        const input = one("[data-settings-search] input, input[data-settings-search]") as HTMLInputElement;
        expect(document.activeElement).toBe(input);
        input.value = "落款";
        input.dispatchEvent(new Event("input"));
        await flushPromises();
        expect(all("[data-settings-row]").map((row) => row.dataset.settingsRow)).toEqual(["example.notes/signature"]);
        expect(document.body.querySelector("[data-settings-nav-current]")?.getAttribute("aria-current")).toBeNull();
        const signature = one("[data-settings-row='example.notes/signature'] input") as HTMLInputElement;
        signature.dispatchEvent(new FocusEvent("focusin", {bubbles: true}));
        signature.value = "——雾港";
        signature.dispatchEvent(new Event("input"));
        signature.dispatchEvent(new FocusEvent("focusout", {bubbles: true}));
        await flushPromises();
        expect(host.user.values()).toMatchObject({"example.notes/signature": "——雾港"});
        input.value = "没有这样的设置";
        input.dispatchEvent(new Event("input"));
        await flushPromises();
        expect(one("[data-settings-no-results]").textContent).toBe("没有找到设置");
        const escape = new KeyboardEvent("keydown", {key: "Escape", bubbles: true, cancelable: true});
        input.dispatchEvent(escape);
        await flushPromises();
        expect(escape.defaultPrevented).toBe(true);
        expect(host.window.query.value).toBe("");
        expect(one("[data-settings-section]").dataset.settingsSection).toBe("other");
        expect(host.window.open.value).toBe(true);
    });

    it("换搜索词时搜索结果里留着的不合格值丢掉，回来不复活", async () => {
        const {host} = await scene("other");
        host.window.search("常用标签");
        await flushPromises();
        const tags = () => one("[data-settings-row='example.notes/tags']");
        (tags().querySelector("[data-nb-list-add]") as HTMLButtonElement).click();
        await flushPromises();
        expect(tags().querySelector("[data-settings-row-reasons]")).not.toBeNull();
        host.window.search("常用标签 ");
        await flushPromises();
        host.window.search("常用");
        await flushPromises();
        expect(tags().querySelector("[data-settings-row-reasons]")).toBeNull();
        expect(tags().querySelectorAll("[data-nb-list-item]")).toHaveLength(3);
    });

    it("page 命中给“打开”，点了清空搜索并切到这个分区", async () => {
        const {host} = await scene("other");
        host.window.search("片段");
        await flushPromises();
        const hit = one("[data-settings-page-hit='example.snippets.main'] button");
        expect(hit.getAttribute("aria-label")).toBe("打开：常用片段");
        hit.click();
        await flushPromises();
        expect([host.window.query.value, host.window.section.value]).toEqual(["", "example.snippets.main"]);
    });

    it("页面报了未保存：点左栏别的分区先弹确认；继续编辑留在原处、焦点回到点的位置；放弃后切过去", async () => {
        let context: SettingsPageContext | null = null;
        const Dirty = defineComponent({
            name: "DirtyPage",
            props: {context: {type: Object as PropType<SettingsPageContext>, required: true}},
            setup(props) {
                context = props.context;
                return () => h("p", {"data-dirty-page": ""}, "草稿");
            },
        });
        const created = createSettingsHost({
            settings: [{plugin: "nbook.workbench", definition: themeSetting as SettingDefinition<unknown>}],
            sections: [{id: "x.page.main", plugin: "x.page", kind: "page", declaration: {title: {"zh-CN": "页面", "en-US": "Page"}, icon: "i-lucide-square", category: "plugins"}}],
            notify: () => undefined,
            report: () => undefined,
        });
        cleanup.push(() => created.dispose());
        created.publish("x.page.main", async () => Dirty);
        created.window.openWindow({section: "x.page.main"});
        render(created.window);
        await flushPromises();
        context!.dirty(true);
        const other = one("[data-settings-nav='other']");
        other.focus();
        other.click();
        await flushPromises();
        const dialog = one("[role='alertdialog']");
        expect(dialog.textContent).toContain("放弃未保存的改动？");
        expect(created.window.section.value).toBe("x.page.main");
        [...dialog.querySelectorAll("button")].find((button) => button.textContent?.trim() === "继续编辑")!.click();
        await vi.waitFor(() => expect(document.body.querySelector("[role='alertdialog']")).toBeNull());
        await vi.waitFor(() => expect(document.activeElement).toBe(other));
        expect(created.window.unsaved.value).toBe(true);
        other.click();
        await flushPromises();
        [...one("[role='alertdialog']").querySelectorAll("button")].find((button) => button.textContent?.trim() === "放弃")!.click();
        await flushPromises();
        expect(created.window.section.value).toBe("other");
        expect(created.window.unsaved.value).toBe(false);
        expect(document.body.querySelector("[data-dirty-page]")).toBeNull();
    });
});

describe("设置文件视图（输出 23）", () => {
    const area = (): HTMLTextAreaElement => one("[data-settings-file-text]") as HTMLTextAreaElement;
    const type = async (value: string): Promise<void> => {
        area().value = value;
        area().dispatchEvent(new Event("input"));
        await flushPromises();
    };
    const button = (label: string): HTMLButtonElement => {
        const found = all("[data-settings-file] button").find((element) => element.textContent?.trim() === label);
        if (found === undefined) throw new Error(`没有按钮 ${label}`);
        return found as HTMLButtonElement;
    };

    it("显示这一层文件的全文（注释、没有声明的键都在）；改了才有“保存”“放弃改动”；保存后写进这一层、列表同步", async () => {
        const {host} = await scene("file");
        await vi.waitFor(() => expect(one("[data-settings-file]").dataset.settingsFileState).toBe("ready"));
        expect(area().value).toContain("// 主题跟着 macOS");
        expect(area().value).toContain("retired.plugin/flag");
        expect(document.getElementById(one("[data-settings-file] label").getAttribute("for")!)).toBe(area());
        expect(button("保存").disabled).toBe(true);
        expect(document.body.querySelector("[data-settings-file-unsaved]")).toBeNull();
        await type(area().value.replace("120", "90"));
        expect(one("[data-settings-file-unsaved]").textContent).toBe("有没保存的改动");
        expect(host.window.unsaved.value).toBe(true);
        button("保存").click();
        await flushPromises();
        expect(host.user.values()).toMatchObject({"example.notes/interval": 90});
        expect(host.user.text()).toContain("retired.plugin/flag");
        expect(button("保存").disabled).toBe(true);
        expect(document.activeElement).toBe(area());
        expect(host.window.unsaved.value).toBe(false);
        await type("{}");
        button("放弃改动").click();
        await flushPromises();
        expect(area().value).toBe(host.user.text());
    });

    it("文本不合格：不写，在框下写出行与列、标出错；别处改过：有改动时只提示，保存被拒为冲突，“重新读取”换成新文本", async () => {
        const {host} = await scene("file");
        await vi.waitFor(() => expect(one("[data-settings-file]").dataset.settingsFileState).toBe("ready"));
        await type("{\n  \"a\": 1\n  \"b\": 2\n}");
        (one("[data-settings-file-text]") as HTMLElement).dispatchEvent(new KeyboardEvent("keydown", {key: "s", code: "KeyS", ctrlKey: true, bubbles: true, cancelable: true}));
        await flushPromises();
        expect(one("[data-settings-file-error]").textContent).toContain("第 3 行第 3 列");
        expect(area().getAttribute("aria-invalid")).toBe("true");
        expect(area().getAttribute("aria-describedby")?.split(" ")).toContain(one("[data-settings-file-error]").id);
        // 光标放到出错的地方（第 3 行第 3 列）。
        expect(area().selectionStart).toBe("{\n  \"a\": 1\n  ".length);
        // 改了文本，出错的标记随之去掉。
        await type("{\n  \"a\": 1,\n  \"b\": 2\n}");
        expect(document.body.querySelector("[data-settings-file-error]")).toBeNull();
        expect(area().getAttribute("aria-invalid")).not.toBe("true");
        await type("{\n  \"a\": 1\n  \"b\": 2\n}");
        expect(host.user.values()).toMatchObject({"example.notes/interval": 120});

        host.user.setText("{\"example.notes/interval\": 300}");
        await flushPromises();
        expect(one("[data-settings-file-changed]").textContent).toContain("文件在别处改过了");
        expect(area().value).toContain("\"b\": 2");
        await type("{\"example.notes/interval\": 60}");
        button("保存").click();
        await flushPromises();
        expect(one("[data-settings-file-error]").textContent).toContain("文件在别处改过了");
        expect(host.user.values()).toMatchObject({"example.notes/interval": 300});
        all("[data-settings-file-error] button")[0]!.click();
        await flushPromises();
        expect(area().value).toBe("{\"example.notes/interval\": 300}");
        // 没有改动时别处又改了：直接换成新文本。
        host.user.setText("{\"example.notes/interval\": 30}");
        await flushPromises();
        expect(area().value).toBe("{\"example.notes/interval\": 30}");
    });

    it("Tab 插入两个空格，Esc 之后的 Tab 照常移走焦点；有改动时离开先确认", async () => {
        const {host} = await scene("file");
        await vi.waitFor(() => expect(one("[data-settings-file]").dataset.settingsFileState).toBe("ready"));
        area().focus();
        area().setSelectionRange(0, 0);
        const tab = new KeyboardEvent("keydown", {key: "Tab", bubbles: true, cancelable: true});
        area().dispatchEvent(tab);
        await flushPromises();
        expect(tab.defaultPrevented).toBe(true);
        expect(area().value.startsWith("  // 我的设置")).toBe(true);
        area().dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true, cancelable: true}));
        const next = new KeyboardEvent("keydown", {key: "Tab", bubbles: true, cancelable: true});
        area().dispatchEvent(next);
        expect(next.defaultPrevented).toBe(false);
        host.window.select("nbook.appearance");
        expect(host.window.leaving.value).toEqual({kind: "section", id: "nbook.appearance"});
    });

    it("层文件无效：说明里有“打开设置文件”，打开看到坏的文本，修好保存后说明消失", async () => {
        const {host} = await scene("user-invalid");
        one("[data-settings-open-file]").click();
        await flushPromises();
        expect(host.window.section.value).toBe("file");
        await vi.waitFor(() => expect(one("[data-settings-file]").dataset.settingsFileState).toBe("ready"));
        expect(area().value.trim().endsWith("}")).toBe(false);
        await type("{\"nbook.workbench/appearance\": \"dark\"}");
        button("保存").click();
        await flushPromises();
        expect(host.window.layerNotice.value).toBeNull();
        expect(document.body.querySelector("[data-settings-layer-notice]")).toBeNull();
    });
});

describe("Lab“模型服务”：page 分区的草稿、未保存保护与动态选项", () => {
    const providers = (host: SettingsHost) => host.user.values()["example.models/providers"] as ReadonlyArray<{readonly id: string; readonly name: string}> | undefined;
    const fill = async (input: HTMLInputElement, value: string): Promise<void> => {
        input.dispatchEvent(new FocusEvent("focusin", {bubbles: true}));
        input.value = value;
        input.dispatchEvent(new Event("input"));
        input.dispatchEvent(new FocusEvent("focusout", {bubbles: true}));
        await flushPromises();
    };
    const detailInputs = (): HTMLInputElement[] => all("[data-sample-models-detail] input") as HTMLInputElement[];
    /** 页内列表的条目标题（第二行是接口地址）。 */
    const listTitles = (): Array<string | undefined> => all("[data-sample-models] [data-settings-page-list-item]").map((element) => element.querySelector(".settings-page-list__title")?.textContent?.trim());
    /** 按标题点列表里的一项。 */
    const pick = async (title: string): Promise<void> => {
        const item = all("[data-sample-models] [data-settings-page-list-item]").find((element) => element.querySelector(".settings-page-list__title")?.textContent?.trim() === title);
        if (item === undefined) throw new Error(`列表里没有 ${title}`);
        item.click();
        await flushPromises();
    };
    const action = (label: string): HTMLButtonElement => {
        const found = all("[data-sample-models-actions] button").find((element) => element.textContent?.trim() === label);
        if (found === undefined) throw new Error(`没有按钮 ${label}`);
        return found as HTMLButtonElement;
    };

    it("打开分区时才激活入口；列出已保存的服务商；默认模型的选项来自它们", async () => {
        const {host} = await scene("page-fill");
        await vi.waitFor(() => expect(document.body.querySelector("[data-sample-models]")).not.toBeNull());
        expect(listTitles()).toEqual(["常规", "DeepSeek", "本地 Ollama"]);
        const source = host.window.options()["example.models.models"];
        const value = typeof source === "function" ? source() : (source as {value: unknown}).value;
        expect(value).toMatchObject({status: "ready", items: [{value: "deepseek/deepseek-chat"}, {value: "deepseek/deepseek-reasoner"}, {value: "local/qwen3:8b"}]});
        expect(one("[data-settings-row='example.models/defaultModel']").textContent).not.toContain("已不存在");
    });

    it("改动先进草稿、报未保存；新加的一项没填好时保存被拒并写出原因；填好保存后整组写进用户层", async () => {
        const {host} = await scene("page-fill");
        await vi.waitFor(() => expect(document.body.querySelector("[data-sample-models]")).not.toBeNull());
        // 停在“常规”、没有改动时没有操作行：那两项即时写入。
        expect(document.body.querySelector("[data-sample-models-actions]")).toBeNull();
        (one("[data-sample-models-add]") as HTMLButtonElement).click();
        await flushPromises();
        expect(host.window.unsaved.value).toBe(true);
        expect(providers(host)).toHaveLength(2);
        action("保存").click();
        await flushPromises();
        expect(one("[data-sample-models-failure]").textContent).toMatch(/^还没保存：/u);
        expect(providers(host)).toHaveLength(2);
        const [id, name, baseUrl, timeout] = detailInputs();
        await fill(id!, "openai");
        await fill(name!, "OpenAI");
        await fill(baseUrl!, "https://api.openai.com/v1");
        await fill(timeout!, "30");
        action("保存").click();
        await flushPromises();
        expect(providers(host)?.map((provider) => provider.id)).toEqual(["deepseek", "local", "openai"]);
        expect(host.window.unsaved.value).toBe(false);
        expect(action("保存").disabled).toBe(true);
    });

    it("删掉默认模型所在的服务商并保存：默认模型照常显示、标“已不存在”；放弃改动回到已保存的值", async () => {
        const {host} = await scene("page-fill");
        await vi.waitFor(() => expect(document.body.querySelector("[data-sample-models]")).not.toBeNull());
        await pick("DeepSeek");
        (all("[data-sample-models] button").find((element) => element.getAttribute("aria-label") === "删除：DeepSeek") as HTMLButtonElement).click();
        await flushPromises();
        expect(listTitles()).toEqual(["常规", "本地 Ollama"]);
        action("放弃改动").click();
        await flushPromises();
        expect(listTitles()).toEqual(["常规", "DeepSeek", "本地 Ollama"]);
        expect(host.window.unsaved.value).toBe(false);
        await pick("DeepSeek");
        (all("[data-sample-models] button").find((element) => element.getAttribute("aria-label") === "删除：DeepSeek") as HTMLButtonElement).click();
        await flushPromises();
        action("保存").click();
        await flushPromises();
        expect(providers(host)?.map((provider) => provider.id)).toEqual(["local"]);
        expect(host.user.values()["example.models/defaultModel"]).toBe("deepseek/deepseek-chat");
        expect(one("[data-settings-row='example.models/defaultModel']").textContent).toContain("已不存在");
    });

    it("有未保存的改动时切到别的分区：先弹确认；放弃后离开，回来时是已保存的值", async () => {
        const {host} = await scene("page-fill");
        await vi.waitFor(() => expect(document.body.querySelector("[data-sample-models]")).not.toBeNull());
        await pick("DeepSeek");
        await fill(detailInputs()[1]!, "深度求索");
        expect(host.window.unsaved.value).toBe(true);
        one("[data-settings-nav='nbook.appearance']").click();
        await flushPromises();
        [...one("[role='alertdialog']").querySelectorAll("button")].find((button) => button.textContent?.trim() === "放弃")!.click();
        await flushPromises();
        expect(host.window.section.value).toBe("nbook.appearance");
        host.window.select("example.models.main");
        await vi.waitFor(() => expect(document.body.querySelector("[data-sample-models]")).not.toBeNull());
        expect(listTitles()[1]).toBe("DeepSeek");
        expect(host.window.unsaved.value).toBe(false);
    });

    it("一家服务商里有解析不了的输入：列表标出这一家；切到别家时这段输入随字段丢掉，回来是原值、不再算未保存", async () => {
        const {host} = await scene("page-fill");
        await vi.waitFor(() => expect(document.body.querySelector("[data-sample-models]")).not.toBeNull());
        await pick("DeepSeek");
        await fill(detailInputs()[3]!, "abc");
        expect(host.window.unsaved.value).toBe(true);
        const edited = () => all("[data-sample-models] [data-settings-page-list-item]").filter((element) => element.querySelector("[data-sample-models-edited]") !== null).map((element) => element.querySelector(".settings-page-list__title")?.textContent?.trim());
        expect(edited()).toEqual(["DeepSeek"]);
        await pick("本地 Ollama");
        await pick("DeepSeek");
        expect(detailInputs()[3]!.value).toBe("60");
        expect(host.window.unsaved.value).toBe(false);
        expect(edited()).toEqual([]);
    });

    it("没有改动时别处在最前面加了一家：草稿跟上，选中的仍是原来那家", async () => {
        const {host} = await scene("page-fill");
        await vi.waitFor(() => expect(document.body.querySelector("[data-sample-models]")).not.toBeNull());
        await pick("本地 Ollama");
        // 配置服务给的是只读值，写回去要一份可改的。
        const before = host.service("example.models").get(modelsSettings.providers).map(({models, ...rest}) => ({...rest, ...(models === undefined ? {} : {models: [...models]})}));
        await host.service("example.models").update(modelsSettings.providers, [{id: "other", name: "别处加的", baseUrl: "https://example.com", timeout: 10}, ...before], {layer: "user"});
        await flushPromises();
        expect(listTitles()).toEqual(["常规", "别处加的", "DeepSeek", "本地 Ollama"]);
        expect(one("[data-sample-models] h3").textContent?.trim()).toBe("本地 Ollama");
        expect(detailInputs()[1]!.value).toBe("本地 Ollama");
    });
});

describe("实现审查补的用例（Sonnet 第 1、2、9、10、13 条，第 5 条的样板）", () => {
    const area = (): HTMLTextAreaElement => one("[data-settings-file-text]") as HTMLTextAreaElement;
    const key = (target: Element, init: KeyboardEventInit): KeyboardEvent => {
        const event = new KeyboardEvent("keydown", {bubbles: true, cancelable: true, ...init});
        target.dispatchEvent(event);
        return event;
    };
    const ready = () => vi.waitFor(() => expect(one("[data-settings-file]").dataset.settingsFileState).toBe("ready"));

    it("设置文件文本框里第一次 Esc 不关窗口（只放开 Tab），再按一次才交给窗口；文本框里的 Mod+F 留给浏览器", async () => {
        const {host} = await scene("file");
        await ready();
        area().focus();
        expect(key(area(), {key: "f", code: "KeyF", ctrlKey: true}).defaultPrevented).toBe(false);
        expect(document.activeElement).toBe(area());
        expect(key(area(), {key: "Escape"}).defaultPrevented).toBe(true);
        await flushPromises();
        expect(host.window.open.value).toBe(true);
        // 按了别的键之后 Tab 又是插空格；紧接着的第二次 Esc 才交给窗口。
        key(area(), {key: "Escape"});
        await flushPromises();
        expect(host.window.open.value).toBe(false);
    });

    it("CRLF 的文件：文本框里是归一后的换行，Tab 插在光标处；保存后整个文件仍是 CRLF", async () => {
        const {host} = await scene("file");
        await ready();
        host.user.setText("{\r\n    \"example.notes/interval\": 120\r\n}\r\n");
        await flushPromises();
        expect(area().value).toBe("{\n    \"example.notes/interval\": 120\n}\n");
        area().focus();
        area().setSelectionRange(2, 2);
        key(area(), {key: "Tab"});
        await flushPromises();
        expect(area().value).toBe("{\n      \"example.notes/interval\": 120\n}\n");
        all("[data-settings-file] button").find((element) => element.textContent?.trim() === "保存")!.click();
        await flushPromises();
        expect(host.user.text()).toBe("{\r\n      \"example.notes/interval\": 120\r\n}\r\n");
    });

    it("放弃确认框里按 Esc 等于“继续编辑”；从搜索框起手的放弃之后焦点回到搜索框", async () => {
        const {host} = await scene("file");
        await ready();
        await (async () => {
            area().value = "{}";
            area().dispatchEvent(new Event("input"));
            await flushPromises();
        })();
        const search = one("[data-settings-search] input") as HTMLInputElement;
        search.focus();
        search.value = "语言";
        search.dispatchEvent(new Event("input"));
        await flushPromises();
        expect(host.window.leaving.value).toEqual({kind: "search", query: "语言"});
        key(one("[role='alertdialog']"), {key: "Escape"});
        await vi.waitFor(() => expect(host.window.leaving.value).toBeNull());
        expect(host.window.query.value).toBe("");
        expect(host.window.unsaved.value).toBe(true);
        await vi.waitFor(() => expect(document.body.querySelector("[role='alertdialog']")).toBeNull());

        search.focus();
        search.value = "语言";
        search.dispatchEvent(new Event("input"));
        await flushPromises();
        [...one("[role='alertdialog']").querySelectorAll("button")].find((button) => button.textContent?.trim() === "放弃")!.click();
        await flushPromises();
        expect(host.window.query.value).toBe("语言");
        await vi.waitFor(() => expect(document.activeElement).toBe(one("[data-settings-search] input")));
    });

    it("模型服务：有改动时别处改了服务商，提示并停用“保存”；“仍然保存”盖掉别处的改动", async () => {
        const {host} = await scene("page-fill");
        await vi.waitFor(() => expect(document.body.querySelector("[data-sample-models]")).not.toBeNull());
        all("[data-sample-models] [data-settings-page-list-item]")[1]!.click();
        await flushPromises();
        const name = (all("[data-sample-models-detail] input") as HTMLInputElement[])[1]!;
        name.dispatchEvent(new FocusEvent("focusin", {bubbles: true}));
        name.value = "深度求索";
        name.dispatchEvent(new Event("input"));
        name.dispatchEvent(new FocusEvent("focusout", {bubbles: true}));
        await flushPromises();
        await host.service("example.models").update(modelsSettings.providers, [{id: "other", name: "别处加的", baseUrl: "https://example.com", timeout: 10}], {layer: "user"});
        await flushPromises();
        expect(one("[data-sample-models-changed]").textContent).toContain("别处改过了");
        const save = all("[data-sample-models-actions] button").find((element) => element.textContent?.trim() === "保存") as HTMLButtonElement;
        expect(save.disabled).toBe(true);
        (all("[data-sample-models-changed] button").find((element) => element.textContent?.trim() === "仍然保存") as HTMLButtonElement).click();
        await flushPromises();
        expect((host.user.values()["example.models/providers"] as ReadonlyArray<{readonly name: string}>).map((provider) => provider.name)).toEqual(["深度求索", "本地 Ollama"]);
        expect(document.body.querySelector("[data-sample-models-changed]")).toBeNull();
    });
});

describe("实现审查补的用例（omp 第 1、5 条）", () => {
    const area = (): HTMLTextAreaElement => one("[data-settings-file-text]") as HTMLTextAreaElement;

    it("读取进行中文件又变了：读回来的已经过时，读完再读一次，显示最新的文本", async () => {
        const {host} = await scene("other");
        const release = host.user.holdReads();
        host.window.select("file");
        await flushPromises();
        expect(one("[data-settings-file]").dataset.settingsFileState).toBe("loading");
        host.user.setText("{\"example.notes/interval\": 45}");
        release();
        await vi.waitFor(() => expect(area().value).toBe("{\"example.notes/interval\": 45}"));
    });

    it("连不上期间别处改了文件：恢复连接后重新订阅，没有改动时换成新文本", async () => {
        const {host} = await scene("file");
        await vi.waitFor(() => expect(one("[data-settings-file]").dataset.settingsFileState).toBe("ready"));
        host.user.setUnreachable(true);
        await vi.waitFor(() => expect(host.window.layerNotice.value?.kind).toBe("unavailable"));
        host.user.setText("{\"example.notes/interval\": 15}");
        host.user.setUnreachable(false);
        await vi.waitFor(() => expect(host.window.layerNotice.value).toBeNull());
        await vi.waitFor(() => expect(area().value).toBe("{\"example.notes/interval\": 15}"));
    });
});

describe("实现审查补的用例（omp 第 4 条）", () => {
    it("页面就绪后关窗再开：重新挂上的页面拿到新的上下文，在它上面报未保存照常生效", async () => {
        const contexts: SettingsPageContext[] = [];
        const Page = defineComponent({
            name: "ContextPage",
            props: {context: {type: Object as PropType<SettingsPageContext>, required: true}},
            setup(props) {
                contexts.push(props.context);
                return () => h("p", {"data-context-page": ""}, "页面");
            },
        });
        const created = createSettingsHost({
            settings: [{plugin: "nbook.workbench", definition: themeSetting as SettingDefinition<unknown>}],
            sections: [{id: "x.page.main", plugin: "x.page", kind: "page", declaration: {title: {"zh-CN": "页面", "en-US": "Page"}, icon: "i-lucide-square", category: "plugins"}}],
            notify: () => undefined,
            report: () => undefined,
        });
        cleanup.push(() => created.dispose());
        created.publish("x.page.main", async () => Page);
        created.window.openWindow({section: "x.page.main"});
        render(created.window);
        await vi.waitFor(() => expect(contexts).toHaveLength(1));
        created.window.close();
        await flushPromises();
        created.window.openWindow({});
        await vi.waitFor(() => expect(contexts).toHaveLength(2));
        expect(contexts[1]).not.toBe(contexts[0]);
        contexts[0]!.dirty(true);
        expect(created.window.unsaved.value).toBe(false);
        contexts[1]!.dirty(true);
        expect(created.window.unsaved.value).toBe(true);
    });
});
