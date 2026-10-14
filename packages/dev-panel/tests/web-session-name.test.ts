import {describe, expect, test} from "bun:test";
import {sessionName} from "../src/web/host/format.js";

/** “谁”这一类地方显示的会话名（`host/format.ts` 的 `sessionName`，t17）：标题加短键，短键始终带着。 */
describe("会话名", () => {
    const first = "claude:c38df555-3a36-49c9-bf4f-4027b5da6d32";
    const second = "claude:7a1e0b9c-0000-4000-8000-000000000000";
    const titles = {
        [first]: {text: "接着做 t17", source: "claude-custom" as const},
        [second]: {text: "接着做 t17", source: "claude-ai-title" as const},
    };

    test("有标题时是标题加短键与标题来源；没有标题时只有短键，与原来的写法相同", () => {
        expect(sessionName(first, null, titles)).toEqual({title: "接着做 t17", short: "claude c38df555", source: "claude-custom"});
        expect(sessionName("codex:codex-1", null, titles)).toEqual({title: null, short: "codex codex-1", source: null});
        expect(sessionName("external:bob", "bob", {})).toEqual({title: null, short: "bob", source: null});
    });

    test("同名的两个会话靠短键区分", () => {
        const names = [sessionName(first, null, titles), sessionName(second, null, titles)];
        expect(names.map((name) => name.title)).toEqual(["接着做 t17", "接着做 t17"]);
        expect(new Set(names.map((name) => name.short)).size).toBe(2);
    });

    test("标题表只按自己的键查：不会把原型上的属性当成标题", () => {
        expect(sessionName("constructor", null, {}).title).toBeNull();
    });
});
