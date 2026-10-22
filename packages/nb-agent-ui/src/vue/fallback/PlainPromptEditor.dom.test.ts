import {describe, expect, it} from "vitest";
import {mount} from "@vue/test-utils";

import PlainPromptEditor from "./PlainPromptEditor.vue";

const mountEditor = (props: Record<string, unknown> = {}) => mount(PlainPromptEditor, {props: {draft: {text: "半截", version: 1}, locale: "zh-CN", ...props}});

describe("PlainPromptEditor", () => {
    it("回车发送、Ctrl+回车带 mod；输入法组字的回车不算，WebKit 组字结束后才派发的那次（keyCode 229）也不算", async () => {
        const editor = mountEditor();
        const textarea = editor.get("textarea");
        await textarea.trigger("keydown", {key: "Enter", isComposing: true});
        await textarea.trigger("keydown", {key: "Enter", keyCode: 229});
        expect(editor.emitted("submit")).toBeUndefined();
        await textarea.trigger("keydown", {key: "Enter"});
        await textarea.trigger("keydown", {key: "Enter", ctrlKey: true});
        expect(editor.emitted("submit")).toEqual([[{mod: false}], [{mod: true}]]);
    });

    it("与真编辑器同形的属性不落到 textarea 上（输入历史与函数都不进 DOM）", () => {
        const editor = mountEditor({recall: ["上一条发过的话"], resolveMenu: () => ({items: []}), triggers: ["@"], attachments: []});
        const attributes = Object.keys(editor.get("textarea").attributes());
        expect(attributes.filter((name) => ["recall", "resolve-menu", "triggers", "attachments"].includes(name))).toEqual([]);
    });

    it("换草稿版本时替换正文，同一版本内的变化不覆盖输入", async () => {
        const editor = mountEditor();
        await editor.get("textarea").setValue("改过的");
        await editor.setProps({draft: {text: "宿主给的旧回声", version: 1}});
        expect((editor.get("textarea").element as HTMLTextAreaElement).value).toBe("改过的");
        await editor.setProps({draft: {text: "", version: 2}});
        expect((editor.get("textarea").element as HTMLTextAreaElement).value).toBe("");
    });
});
