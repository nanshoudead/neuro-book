/**
 * 同名提示（docs/specs/workbench/editor.md 输出 56）：纯函数，按此刻的标签算。
 */

import {describe, expect, it} from "bun:test";

import {tabHints} from "./tab-hints";
import type {HintSubject} from "./tab-hints";

const names = {root: (scheme: "project" | "user") => (scheme === "project" ? "作品" : "用户资产"), editor: (id: string) => (id === "code" ? "源码" : "富文本")};
const subject = (id: string, address: string, editor = "md"): HintSubject => ({id, address, editor, label: address.slice(address.lastIndexOf("/") + 1)});
const hints = (subjects: ReadonlyArray<HintSubject>) => Object.fromEntries(tabHints(subjects, names));

describe("Spec workbench.editor 输出 56：同名提示", () => {
    it("不同名的没有提示；同名的附最短能区分的上级目录，截断时带 …/", () => {
        expect(hints([subject("a", "project://notes/README.md"), subject("b", "project://drafts/README.md"), subject("c", "project://x.md")])).toEqual({a: "notes", b: "drafts"});
        expect(hints([subject("a", "project://book/one/ch.md"), subject("b", "project://book/two/ch.md")])).toEqual({a: "…/one", b: "…/two"});
        expect(hints([subject("a", "project://a/same/ch.md"), subject("b", "project://b/same/ch.md")])).toEqual({a: "a/same", b: "b/same"});
    });

    it("目录一直到根都相同时附根名；文件在根下时也是根名", () => {
        expect(hints([subject("a", "project://notes/x.md"), subject("b", "user://notes/x.md")])).toEqual({a: "作品/notes", b: "用户资产/notes"});
        expect(hints([subject("a", "project://x.md"), subject("b", "project://dir/x.md")])).toEqual({a: "作品", b: "dir"});
    });

    it("同一个文件的两种编辑器附编辑器名；关掉一个后不再附", () => {
        expect(hints([subject("a", "project://x.md"), subject("b", "project://x.md", "code")])).toEqual({a: "富文本", b: "源码"});
        expect(hints([subject("a", "project://x.md")])).toEqual({});
    });
});
