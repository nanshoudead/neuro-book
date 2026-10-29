/**
 * 加载页的界面语言（runtime.browser-host 启动序列第 1 步、输出 8）：内联脚本在第一帧前读宿主记下的语言，设 `<html lang>`
 * 与加载页的读屏名。脚本不能 import，两种语言的文字写在脚本里：这里核对两份 index.html 一致，读的键就是宿主写的键，
 * 文字与宿主目录 `nbook.host` 的 `loading.label` 一致，并在 happy-dom 里执行它。第一帧的实际表现由 e2e 验证。
 */

import {readFileSync} from "node:fs";
import {join} from "node:path";

import {afterEach, beforeEach, describe, expect, it} from "vitest";

import {HOST_LOCALES} from "nbook/shared/host-locales";

import enUS from "../locales/en-US.json";
import zhCN from "../locales/zh-CN.json";
import {HOST_LOCALE_KEY, writeLocaleHint} from "./locale-hint";

const WEB = join(import.meta.dirname, "..");
const CATALOGS: Record<string, {readonly loading: {readonly label: string}}> = {"zh-CN": zhCN, "en-US": enUS};

function inlineScript(file: string): string {
    const html = readFileSync(join(WEB, file), "utf8");
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/gu)].map((match) => match[1] ?? "");
    const script = scripts.find((source) => source.includes("nbook.host-locale"));
    if (script === undefined) throw new Error(`${file} 里没有读界面语言的内联脚本`);
    return script;
}

const root = document.documentElement;

function loadingPage(): HTMLElement {
    document.body.innerHTML = '<div id="app"><main data-browser-host-status="loading" aria-label="正在启动 NeuroBook"></main></div>';
    return document.body.querySelector("main") as HTMLElement;
}

function runInlineScript(): void {
    new Function(inlineScript("index.html"))();
}

beforeEach(() => {
    window.localStorage.clear();
    root.lang = "zh-CN";
});

afterEach(() => {
    document.body.innerHTML = "";
    root.lang = "zh-CN";
});

describe("加载页的界面语言", () => {
    it("两份 index.html 的内联脚本一字不差，读的键就是宿主写的键", () => {
        expect(inlineScript("testing/index.html")).toBe(inlineScript("index.html"));
        expect(inlineScript("index.html")).toContain(`"${HOST_LOCALE_KEY}"`);
    });

    it("宿主记下的每种界面语言：脚本设 <html lang> 与读屏名，读屏名与宿主目录一致", () => {
        for (const locale of HOST_LOCALES) {
            const page = loadingPage();
            writeLocaleHint(() => window.localStorage, locale.tag, (message) => {
                throw new Error(message);
            });
            runInlineScript();
            expect(root.lang).toBe(locale.tag);
            expect(page.getAttribute("aria-label")).toBe(CATALOGS[locale.tag]?.loading.label);
        }
    });

    it("没有记录、记录不在宿主语言集合里或存储读不出：什么都不改，保持 zh-CN", () => {
        const page = loadingPage();
        runInlineScript();
        window.localStorage.setItem(HOST_LOCALE_KEY, "ja-JP");
        runInlineScript();
        window.localStorage.setItem(HOST_LOCALE_KEY, "toString");
        runInlineScript();
        expect(root.lang).toBe("zh-CN");
        expect(page.getAttribute("aria-label")).toBe("正在启动 NeuroBook");
    });

    it("脚本运行时加载页还没解析到：文档解析完补上读屏名", () => {
        window.localStorage.setItem(HOST_LOCALE_KEY, "en-US");
        Object.defineProperty(document, "readyState", {configurable: true, get: () => "loading"});
        try {
            runInlineScript();
            expect(root.lang).toBe("en-US");
            const page = loadingPage();
            document.dispatchEvent(new Event("DOMContentLoaded"));
            expect(page.getAttribute("aria-label")).toBe(enUS.loading.label);
        } finally {
            Reflect.deleteProperty(document, "readyState");
        }
    });
});
