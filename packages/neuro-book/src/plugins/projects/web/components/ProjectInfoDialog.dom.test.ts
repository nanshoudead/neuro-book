/**
 * ProjectInfoDialog（同名 .md）：新建时的位置行随书名生成文件夹名；主题色用色板；提交交出去掉首尾空白的书名、主题色、
 * 位置与封面变化。校验不在字段下插字：书名空着时确认不可用；服务端的字段错误把字段标红、焦点移过去，原因写在页脚状态行。
 */

import {flushPromises, mount} from "@vue/test-utils";
import {afterEach, describe, expect, it} from "vitest";

import {provideText, testTextPort} from "nbook/shared/testing/text-port";

import {projectsCatalogs} from "../text";
import ProjectInfoDialog from "./ProjectInfoDialog.vue";

/** 注入窗口同款的翻译端口（严格模式，缺键或缺参数直接抛错）。 */
const global = {provide: provideText(testTextPort("zh-CN", {"nbook.projects": projectsCatalogs}))};

const mounted: Array<{unmount(): void}> = [];
afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount();
    document.body.innerHTML = "";
});

type Props = Partial<InstanceType<typeof ProjectInfoDialog>["$props"]>;

/** 窗口经 Teleport 挂到 body 上，所以查 document.body。 */
function open(props: Props = {}) {
    const wrapper = mount(ProjectInfoDialog, {
        global,
        props: {open: true, mode: "create" as const, location: "/home/writer/Documents/NeuroBook", ...props},
        attachTo: document.body,
    });
    mounted.push(wrapper);
    return wrapper;
}

const query = <T extends Element>(selector: string): T => {
    const found = document.body.querySelector<T>(selector);
    if (found === null) throw new Error(`没有 ${selector}`);
    return found;
};
const textOf = (selector: string): string => (document.body.querySelector(selector)?.textContent ?? "").replace(/\s+/g, "");

async function type(selector: string, value: string): Promise<void> {
    const input = query<HTMLInputElement>(selector);
    input.value = value;
    input.dispatchEvent(new Event("input", {bubbles: true}));
    await flushPromises();
}

/** 在遮罩上按下再松开（同一个键）：对话框认的“点空白”。 */
async function clickOverlay(): Promise<void> {
    const overlay = query<HTMLElement>("[data-dialog-overlay]");
    overlay.dispatchEvent(new PointerEvent("pointerdown", {bubbles: true, button: 0}));
    overlay.dispatchEvent(new PointerEvent("pointerup", {bubbles: true, button: 0}));
    await flushPromises();
}

describe("ProjectInfoDialog", () => {
    it("打开时焦点在书名，书名的标签仍关联着输入框；没改过时点空白关闭，改过之后点空白不关、Esc 照常关闭", async () => {
        const wrapper = open();
        await flushPromises();
        const title = query<HTMLInputElement>("input[data-project-title], [data-project-title] input");
        expect(document.activeElement).toBe(title);
        expect(query<HTMLLabelElement>(`label[for="${title.id}"]`).textContent).toContain("书名");

        await clickOverlay();
        expect(wrapper.emitted("cancel")).toHaveLength(1);

        await type("input[data-project-title], [data-project-title] input", "长夜行");
        await clickOverlay();
        expect(wrapper.emitted("cancel")).toHaveLength(1);
        title.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true, cancelable: true}));
        await flushPromises();
        expect(wrapper.emitted("cancel")).toHaveLength(2);
    });

    it("新建：文件夹名随书名作路径后缀；“浏览…”发 browse-location；提交带位置、书名与色板的颜色", async () => {
        const wrapper = open();
        await flushPromises();
        expect(document.body.querySelector("[data-project-folder]")).toBeNull();
        await type("[data-project-title] input, input[data-project-title]", "  长夜行  ");
        expect(textOf("[data-project-folder]")).toBe("/长夜行");
        query<HTMLButtonElement>("[data-project-browse]").click();
        expect(wrapper.emitted("browse-location")).toHaveLength(1);
        query<HTMLElement>("[data-project-color] [data-color-swatch='#b8423a']").click();
        await flushPromises();
        query<HTMLButtonElement>("[data-project-confirm]").click();
        await flushPromises();
        expect(wrapper.emitted("submit")?.[0]).toEqual([{title: "长夜行", description: "", color: "#b8423a", parent: "/home/writer/Documents/NeuroBook", cover: {kind: "keep"}}]);
    });

    it("书名空着时确认不可用、回车也不提交；服务端的字段错误把字段标红并聚焦，原因只在页脚状态行；编辑时没有位置行", async () => {
        const wrapper = open();
        await flushPromises();
        const confirm = query<HTMLButtonElement>("[data-project-confirm]");
        expect(confirm.disabled).toBe(true);
        query<HTMLFormElement>("[data-project-info]").dispatchEvent(new Event("submit", {cancelable: true}));
        await flushPromises();
        expect(wrapper.emitted("submit")).toBeUndefined();
        await type("input[data-project-title], [data-project-title] input", "   ");
        expect(confirm.disabled).toBe(true);
        await type("input[data-project-title], [data-project-title] input", "长夜行");
        expect(confirm.disabled).toBe(false);
        expect(textOf("[data-dialog-status]")).toBe("");

        await wrapper.setProps({fieldErrors: {location: "作品目录不可用：目录不可读写"}});
        await flushPromises();
        const location = query<HTMLInputElement>("input[data-project-location-input], [data-project-location-input] input");
        expect(location.getAttribute("aria-invalid")).toBe("true");
        expect(document.activeElement).toBe(location);
        expect(textOf("[data-dialog-status]")).toContain("作品目录不可用");
        // 表单里看得见的地方没有这句（读屏用的隐藏元素除外）：字段下不插字，表单不重排。
        const shown = [...document.querySelectorAll("[data-project-info] *")].filter((element) => element.children.length === 0 && !element.classList.contains("sr-only") && (element.textContent ?? "").includes("作品目录不可用"));
        expect(shown).toEqual([]);
        // 先卸载再清 body：Teleport 的锚点还在时清掉会让卸载找不到节点。
        mounted.splice(0).forEach((entry) => entry.unmount());
        document.body.innerHTML = "";

        open({mode: "edit", initial: {title: "北方以北", description: "", color: null, coverSrc: null}});
        await flushPromises();
        expect(document.body.querySelector("[data-project-location]")).toBeNull();
        expect(query<HTMLButtonElement>("[data-project-confirm]").textContent?.trim()).toBe("保存");
    });

    it("封面：类型不对或超过 5 MB 时在本地拒绝，原因写在页脚状态行；通过的随提交交出；“移除封面”交出 remove", async () => {
        const wrapper = open({mode: "edit", initial: {id: "a", title: "甲", description: "", color: null, coverSrc: "data:image/png;base64,"}});
        await flushPromises();
        expect(document.body.querySelector("[data-book-cover] img")).not.toBeNull();
        const input = query<HTMLInputElement>("[data-project-cover-input]");
        const setFiles = (file: File): void => {
            Object.defineProperty(input, "files", {value: [file], configurable: true});
            input.dispatchEvent(new Event("change", {bubbles: true}));
        };
        setFiles(new File([new Uint8Array(10)], "x.svg", {type: "image/svg+xml"}));
        await flushPromises();
        expect(textOf("[data-dialog-status]")).toContain("PNG");
        setFiles(new File([new Uint8Array(10)], "y.png", {type: "image/png"}));
        await flushPromises();
        expect(textOf("[data-dialog-status]")).toBe("");
        query<HTMLButtonElement>("[data-project-confirm]").click();
        await flushPromises();
        expect(wrapper.emitted("submit")?.[0]?.[0]).toMatchObject({title: "甲", parent: null, cover: {kind: "set", file: expect.any(File)}});

        query<HTMLButtonElement>("[data-project-cover-remove]").click();
        await flushPromises();
        expect(document.body.querySelector("[data-book-cover] img")).toBeNull();
        query<HTMLButtonElement>("[data-project-confirm]").click();
        await flushPromises();
        expect(wrapper.emitted("submit")?.[1]?.[0]).toMatchObject({cover: {kind: "remove"}});
    });
});
