/**
 * InlineChip（同名 .md）：小块的图标、色调、悬停提示与键盘交互。
 */

import {mount} from "@vue/test-utils";
import {describe, expect, it} from "vitest";

import InlineChip from "./InlineChip.vue";

type ChipProps = InstanceType<typeof InlineChip>["$props"];
const chip = (props: Omit<ChipProps, "locale"> & {readonly locale?: ChipProps["locale"]}) => mount(InlineChip, {props: {locale: "zh-CN", ...props}});

describe("InlineChip", () => {
    it("引用按目标分类取图标（方言 Spec 输出 27）：作品里的文件用文件图标，附件、外部、其它各有图标", () => {
        const work = chip({kind: "reference", label: "林雪", target: "/设定/林雪.md"});
        expect(work.find("svg[data-file-icon]").attributes("data-icon")).toBe("markdown");
        expect(work.attributes("title")).toBe("引用：林雪 · /设定/林雪.md");
        expect(work.classes()).toContain("nb-chip--work");
        expect(chip({kind: "reference", label: "截图", target: "local://截图.png"}).find(".i-lucide-paperclip").exists()).toBe(true);
        expect(chip({kind: "reference", label: "官网", target: "https://example.com"}).find(".i-lucide-globe").exists()).toBe(true);
        expect(chip({kind: "reference", label: "旧章", target: "chapter://c1"}).classes()).toContain("nb-chip--other");
        // 相对地址按所在文件解析：给了 `base` 才是作品里的文件。
        expect(chip({kind: "reference", label: "图", target: "a.png", base: "project://正文/第一章.md"}).find("svg[data-file-icon]").exists()).toBe(true);
    });

    it("附件只显示编号；上传中转圈，失败用危险色并在提示里写原因", () => {
        expect(chip({kind: "image", number: 2}).text()).toBe("#2");
        const uploading = chip({kind: "file", label: "a.txt", number: 3, state: "uploading"});
        expect(uploading.find(".nb-chip__spinner").exists()).toBe(true);
        expect(uploading.attributes("title")).toBe("文件 #3：a.txt，正在上传");
        const failed = chip({kind: "image", number: 1, state: "failed", error: "太大"});
        expect(failed.classes()).toContain("nb-chip--failed");
        expect(failed.attributes("title")).toBe("图片 #1，上传失败：太大");
    });

    it("界面语言换了，提示跟着换", async () => {
        const wrapper = chip({kind: "skill", label: "reviewer"});
        expect(wrapper.attributes("title")).toBe("技能：reviewer");
        await wrapper.setProps({locale: "en-US"});
        expect(wrapper.attributes("title")).toBe("Skill: reviewer");
    });

    it("interactive 时是可聚焦的按钮，回车与空格发出 activate；不 interactive 时不可聚焦", async () => {
        const wrapper = chip({kind: "command", label: "plan", interactive: true});
        expect([wrapper.attributes("role"), wrapper.attributes("tabindex")]).toEqual(["button", "0"]);
        await wrapper.trigger("keydown", {key: "Enter"});
        await wrapper.trigger("keydown", {key: " "});
        await wrapper.trigger("click");
        expect(wrapper.emitted("activate")).toHaveLength(3);
        const plain = chip({kind: "command", label: "plan"});
        expect(plain.attributes("tabindex")).toBeUndefined();
        await plain.trigger("keydown", {key: "Enter"});
        expect(plain.emitted("activate")).toBeUndefined();
    });
});
