/**
 * 行的图标（docs/specs/workbench/files-explorer.md 的“行的样子”）：映射到的名字都在生成的图标表里。
 */

import {describe, expect, it} from "bun:test";

import {CATPPUCCIN_ICONS} from "nbook/ui/file-icons/catppuccin";
import {fileIconOf} from "./file-icons";
import type {IconSubject} from "./file-icons";

const file = (name: string): IconSubject => ({kind: "file", name, folder: null, expanded: false, node: false, body: false});
const folder = (name: string, extra: Partial<IconSubject> = {}): IconSubject => ({kind: "directory", name, folder: "plain", expanded: false, node: false, body: false, ...extra});

describe("Spec workbench.files-explorer 行的样子：图标", () => {
    it("文件按扩展名（不区分大小写），认不出的与没有扩展名的用通用文件", () => {
        expect(["第三章.md", "索引.json", "灯塔.PNG", "设定.yml", "清单.xml", "README", ".gitignore", "a.unknown"].map((name) => fileIconOf(file(name))))
            .toEqual(["markdown", "json", "image", "yaml", "xml", "file", "file", "file"]);
    });

    it("目录按文件夹类型与常见名字，展开与收起各一个；节点有正文用 Markdown", () => {
        expect(fileIconOf(folder("正文"))).toBe("folder");
        expect(fileIconOf(folder("正文", {expanded: true}))).toBe("folder-open");
        expect(fileIconOf(folder("图片"))).toBe("folder-images");
        expect(fileIconOf(folder("Images", {expanded: true}))).toBe("folder-images-open");
        expect(fileIconOf(folder("人物.content", {folder: "content"}))).toBe("folder-content");
        expect(fileIconOf(folder("story.binder", {folder: "binder", expanded: true}))).toBe("folder-docs-open");
        expect(fileIconOf(folder("shen-yu", {node: true, body: true}))).toBe("markdown");
        expect(fileIconOf(folder("lin-xiao", {node: true, expanded: true}))).toBe("folder-content-open");
    });

    it("映射用到的图标都在生成的表里", () => {
        const subjects = [
            ...Object.keys({md: 0, txt: 0, json: 0, yaml: 0, toml: 0, xml: 0, csv: 0, pdf: 0, png: 0, svg: 0, mp3: 0, mp4: 0, ttf: 0, zip: 0, db: 0, html: 0, css: 0, js: 0, ts: 0}).map((ext) => file(`a.${ext}`)),
            ...["a", "图片", "资料", "音频", "视频", "字体", "配置"].flatMap((name) => [folder(name), folder(name, {expanded: true})]),
            folder("x.content", {folder: "content"}), folder("x.content", {folder: "content", expanded: true}),
            folder("x.binder", {folder: "binder"}), folder("x.binder", {folder: "binder", expanded: true}),
        ];
        for (const subject of subjects) expect(Object.hasOwn(CATPPUCCIN_ICONS, fileIconOf(subject))).toBe(true);
    });
});
