/**
 * `nbook` 的状态根取值（docs/specs/runtime/cli.md 的“状态根”）：三个平台的缺省与取值顺序。平台与环境按参数给，不读真实
 * 环境；真实进程里的缺省位置由 `cli.test.ts` 在临时主目录下覆盖。
 */

import {describe, expect, it} from "bun:test";

import {defaultStateRoot, resolveStateRoot} from "./state-root";

describe("平台缺省", () => {
    it("Linux：XDG_DATA_HOME 下的 neuro-book；没设或不是绝对路径时用 ~/.local/share", () => {
        expect(defaultStateRoot("linux", {}, "/home/a")).toBe("/home/a/.local/share/neuro-book");
        expect(defaultStateRoot("linux", {XDG_DATA_HOME: "/data"}, "/home/a")).toBe("/data/neuro-book");
        expect(defaultStateRoot("linux", {XDG_DATA_HOME: "relative/data"}, "/home/a")).toBe("/home/a/.local/share/neuro-book");
        expect(defaultStateRoot("linux", {XDG_DATA_HOME: "  "}, "/home/a")).toBe("/home/a/.local/share/neuro-book");
    });

    it("macOS：~/Library/Application Support/NeuroBook", () => {
        expect(defaultStateRoot("darwin", {XDG_DATA_HOME: "/data"}, "/Users/a")).toBe("/Users/a/Library/Application Support/NeuroBook");
    });

    it("Windows：%LOCALAPPDATA%\\NeuroBook；没有时用主目录下的 AppData\\Local", () => {
        expect(defaultStateRoot("win32", {LOCALAPPDATA: "C:\\Users\\a\\AppData\\Local"}, "C:\\Users\\a")).toBe("C:\\Users\\a\\AppData\\Local\\NeuroBook");
        expect(defaultStateRoot("win32", {}, "C:\\Users\\a")).toBe("C:\\Users\\a\\AppData\\Local\\NeuroBook");
    });
});

describe("取值顺序", () => {
    const base = {platform: "linux" as const, home: "/home/a", cwd: "/work"};

    it("--state-root 优先于 NBOOK_STATE_ROOT，后者优先于平台缺省；相对路径按当前目录", () => {
        expect(resolveStateRoot({...base, option: "mine", env: {NBOOK_STATE_ROOT: "/env"}})).toBe("/work/mine");
        expect(resolveStateRoot({...base, option: undefined, env: {NBOOK_STATE_ROOT: "/env"}})).toBe("/env");
        expect(resolveStateRoot({...base, option: undefined, env: {}})).toBe("/home/a/.local/share/neuro-book");
    });

    it("环境变量的空串算没给；--state-root 的空串报用法错误，不回落到缺省", () => {
        expect(resolveStateRoot({...base, option: undefined, env: {NBOOK_STATE_ROOT: " "}})).toBe("/home/a/.local/share/neuro-book");
        expect(() => resolveStateRoot({...base, option: " ", env: {}})).toThrow(expect.objectContaining({code: "usage", exitCode: 2}));
    });
});
