/**
 * PromptEditor 的引用写法与 nbook 的目标分类往返（docs/specs/ui/prompt-editor.md 场景 4）：文件名里有 `#`、`?`、`%` 时，宿主经
 * `promptReferenceText` 写出的引用读回仍指向同一个作品文件。
 */

import {describe, expect, it} from "vitest";

import {parsePromptText, promptReferenceText} from "@notnotype/nb-markdown/prompt";

import {classifyTarget} from "../shared/targets";
import {nbookTargets} from "./host";

describe("引用写法与作品文件", () => {
    it("场景 4：文件名里有 `#`、`?`、`%` 时，`promptReferenceText` 写出的引用读回仍是同一个文件", () => {
        for (const path of ["设定/第1章#草稿.md", "设定/为什么?.md", "设定/100%20分.md"]) {
            const doc = parsePromptText(promptReferenceText("名", `/${path}`, nbookTargets), {commands: []});
            const token = doc.content?.flatMap((paragraph) => paragraph.content ?? []).find((node) => node.attrs?.kind === "reference");
            expect(classifyTarget(String(token?.attrs?.target ?? ""), null).address).toBe(`project://${path}`);
        }
    });
});
