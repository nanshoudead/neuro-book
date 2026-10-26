/**
 * SettingsSaveBar（同名 .md，settings-window.md“给页面用的组件”）：没有改动时按钮停用、不写字；有改动时写缺省或自定义的
 * 文字、按钮可用；保存中停用；点按钮发出事件，停用时不发。外观与位置由 Component Lab 的截图看。
 */

import {mount} from "@vue/test-utils";
import {afterEach, describe, expect, it} from "vitest";

import SettingsSaveBar from "./SettingsSaveBar.vue";

const mounted: Array<{unmount(): void}> = [];
afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount();
});

function bar(props: {readonly dirty: boolean; readonly busy?: boolean; readonly canSave?: boolean; readonly message?: string; readonly locale?: "zh-CN" | "en-US"}) {
    const wrapper = mount(SettingsSaveBar, {props: {locale: "zh-CN", busy: false, ...props}, attachTo: document.body});
    mounted.push(wrapper);
    return wrapper;
}

/** 组件发出的 `save`、`discard` 各发了几次（test-utils 的 `emitted()` 还会记根元素上冒泡的原生 `click`，不算）。 */
const counts = (wrapper: ReturnType<typeof bar>) => ({save: wrapper.emitted("save")?.length ?? 0, discard: wrapper.emitted("discard")?.length ?? 0});

const buttons = (wrapper: ReturnType<typeof bar>) => {
    const found = wrapper.findAll("button");
    return {discard: found.find((button) => button.text() === "放弃更改" || button.text() === "Discard Changes")!, save: found.find((button) => button.text() === "保存" || button.text() === "Save")!};
};

describe("没有改动", () => {
    it("两个按钮一直在、都停用，不写文字，点了不发事件", async () => {
        const wrapper = bar({dirty: false});
        const {discard, save} = buttons(wrapper);
        expect([discard.attributes("disabled"), save.attributes("disabled")]).toEqual(["", ""]);
        expect(wrapper.find("[data-settings-save-bar-note]").exists()).toBe(false);
        await discard.trigger("click");
        await save.trigger("click");
        expect(counts(wrapper)).toEqual({save: 0, discard: 0});
    });

    it("自定义文字在没有改动时也不显示", () => {
        expect(bar({dirty: false, message: "还没保存：缺一项"}).find("[data-settings-save-bar-note]").exists()).toBe(false);
    });
});

describe("有改动", () => {
    it("缺省写“有未保存的更改”，两个按钮可用，点了各发各的事件", async () => {
        const wrapper = bar({dirty: true});
        expect(wrapper.get("[data-settings-save-bar-note]").text()).toBe("有未保存的更改");
        const {discard, save} = buttons(wrapper);
        expect([discard.attributes("disabled"), save.attributes("disabled")]).toEqual([undefined, undefined]);
        await save.trigger("click");
        await discard.trigger("click");
        expect(counts(wrapper)).toEqual({save: 1, discard: 1});
    });

    it("自定义文字取代缺省的文字；英文界面里按钮与缺省文字都是英文", () => {
        expect(bar({dirty: true, message: "还没保存：缺一项"}).get("[data-settings-save-bar-note]").text()).toBe("还没保存：缺一项");
        const english = bar({dirty: true, locale: "en-US"});
        expect(english.get("[data-settings-save-bar-note]").text()).toBe("Unsaved changes");
        expect(buttons(english).save.exists()).toBe(true);
    });

    it("保存中：文字照旧，两个按钮停用，点了不发事件", async () => {
        const wrapper = bar({dirty: true, busy: true});
        const {discard, save} = buttons(wrapper);
        expect(wrapper.get("[data-settings-save-bar-note]").text()).toBe("有未保存的更改");
        expect([discard.attributes("disabled"), save.attributes("disabled")]).toEqual(["", ""]);
        await save.trigger("click");
        expect(counts(wrapper)).toEqual({save: 0, discard: 0});
    });

    it("不能保存时（例如这一层连不上）：只停用“保存”，放弃照常可用", async () => {
        const wrapper = bar({dirty: true, canSave: false});
        const {discard, save} = buttons(wrapper);
        expect(save.attributes("disabled")).toBe("");
        expect(discard.attributes("disabled")).toBeUndefined();
        await save.trigger("click");
        await discard.trigger("click");
        expect(counts(wrapper)).toEqual({save: 0, discard: 1});
    });
});
