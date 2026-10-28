/**
 * `pluginText`（docs/specs/ui/i18n.md 的“目录与键”）：引用带上绑定的命名空间，键按源语言目录的类型核对，复数形归到不带后缀
 * 的键。编译期的反例由 `bun run typecheck` 检查它们编译不过。
 */

import {describe, expect, it} from "bun:test";

import {pluginText} from "./plugin-text";

const source = {
    status: {ready: "就绪", files_one: "{{count}} 个文件", files_other: "{{count}} 个文件"},
    title: "你好",
} as const;

describe("pluginText", () => {
    it("引用带上绑定的命名空间与参数", () => {
        const text = pluginText<typeof source>("acme.hello");
        expect(text("status.ready")).toEqual({kind: "text", ns: "acme.hello", key: "status.ready"});
        expect(text("status.files", {count: 2})).toEqual({kind: "text", ns: "acme.hello", key: "status.files", params: {count: 2}});
        expect(text("title")).toEqual({kind: "text", ns: "acme.hello", key: "title"});
    });

    it("不给目录类型时任何键都收", () => {
        expect(pluginText("acme.hello")("anything.goes").key).toBe("anything.goes");
    });
});

// 编译期反例：目录里没有的键、复数形的后缀、只写到中间一层。
const typed = pluginText<typeof source>("acme.hello");
// @ts-expect-error 目录里没有这个键
void typed("status.missing");
// @ts-expect-error 复数形写不带后缀的键
void typed("status.files_one");
// @ts-expect-error 中间一层不是文字
void typed("status");
