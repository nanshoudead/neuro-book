/** docs/specs/runtime/browser-host.md 输出 8：上次界面语言的本地记录。 */

import {describe, expect, it} from "bun:test";

import {HOST_LOCALE_KEY, readLocaleHint, writeLocaleHint} from "./locale-hint";
import type {LocaleHintStorage} from "./locale-hint";
import {createTextEngine} from "./text-engine";

function memory(): LocaleHintStorage & {readonly items: Map<string, string>} {
    const items = new Map<string, string>();
    return {items, getItem: (key) => items.get(key) ?? null, setItem: (key, value) => void items.set(key, value)};
}

describe("界面语言的本地记录", () => {
    it("读回写下的语言；不在宿主语言集合里、或存储不可用时当作没有", () => {
        const storage = memory();
        expect(readLocaleHint(() => storage)).toBe(null);
        writeLocaleHint(() => storage, "en-US", () => undefined);
        expect(readLocaleHint(() => storage)).toBe("en-US");
        storage.items.set(HOST_LOCALE_KEY, "ja-JP");
        expect(readLocaleHint(() => storage)).toBe(null);
        expect(readLocaleHint(() => {
            throw new Error("denied");
        })).toBe(null);
    });

    it("引擎只在 remember 时交出语言，缺省值不记", () => {
        const remembered: string[] = [];
        const text = createTextEngine({locale: "zh-CN", remember: (tag) => remembered.push(tag)});
        text.setLocale("zh-CN");
        text.setLocale("en-US", {remember: true});
        expect(remembered).toEqual(["en-US"]);
        expect(text.port.locale.value).toBe("en-US");
    });
});
