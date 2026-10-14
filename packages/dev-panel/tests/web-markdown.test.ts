import {describe, expect, test} from "bun:test";
import {JSDOM} from "jsdom";

/**
 * Markdown 渲染的清洗与外站图片（`host/markdown.ts`，t15 阶段 4 第 4 批审查第 1、7 条）。DOMPurify 在模块求值时取全局的 `window`，
 * 所以先装 jsdom 的 window 与 document，再动态导入被测模块。用的是真的 DOMPurify 与 marked。
 *
 * 不用 happy-dom：DOMPurify 3.4 经 `Node.prototype` 的 `nodeName` getter 取标签名，happy-dom 那里固定返回空串；它的 NodeIterator
 * 在当前节点被移除后也不再往下走，移除元素之后的节点不会被清洗。清洗器的安全测试要跑在合规范的 DOM 上。
 *
 * jsdom 的类型用旁边的 `web-jsdom.d.ts`，不装 `@types/jsdom`：它装进仓库根的 node_modules 后，vitest 类型声明里的
 * `import 'jsdom'` 解析到它，它又引用 lib `dom`，把浏览器的 DOM 类型带进 packages/neuro-book 的类型检查，与 Bun 的
 * WebSocket、Blob 等类型冲突。等 vitest 不再从类型声明里引用 jsdom，或 `@types/jsdom` 不再引用 lib `dom` 时，可以改回装它。
 */
const dom = new JSDOM("<!doctype html><html><body></body></html>", {url: "http://127.0.0.1:4490/"});
Object.assign(globalThis, {window: dom.window, document: dom.window.document});
const {renderMarkdown} = await import("../src/web/host/markdown.js");

const context = {checkoutKey: "main", path: "README.md", artifactBase: "http://127.0.0.1:4491/a/prefix"};
const render = (text: string) => {
    const holder = dom.window.document.createElement("div");
    holder.innerHTML = renderMarkdown(text, context);
    return holder;
};

describe("外站图片", () => {
    test("单独的换成链接（新标签页、只给 http 与 https），套在链接里的换成文字、外层链接还在，没有链接套链接", () => {
        const html = render("![徽章](https://img.shields.io/badge/x.svg)\n\n[![许可](https://img.shields.io/badge/l.svg)](https://example.com/license)");
        const links = [...html.querySelectorAll("a.nbdev-external-image")];
        expect(links.map((link) => [link.getAttribute("href"), link.getAttribute("target"), link.getAttribute("rel"), link.textContent])).toEqual([
            ["https://img.shields.io/badge/x.svg", "_blank", "noopener noreferrer", "外站图片：徽章（img.shields.io）"],
        ]);
        expect([...html.querySelectorAll("a span.nbdev-external-image")].map((span) => [span.parentElement?.getAttribute("href"), span.textContent])).toEqual([["https://example.com/license", "外站图片：许可（img.shields.io）"]]);
        expect(html.querySelectorAll("a a").length).toBe(0);
        expect(html.querySelectorAll("img").length).toBe(0);
    });

    test("作者自己写的记号属性不生效：javascript:、伪造的外站地址都不会变成链接", () => {
        const html = render('<img data-nbdev-external="javascript:alert(1)" alt="x">\n\n<img src="./a.png" data-nbdev-external="https://evil.example/p.png" alt="y">\n\n<img src="javascript:alert(2)" alt="z">');
        expect(html.querySelectorAll(".nbdev-external-image").length).toBe(0);
        expect([...html.querySelectorAll("[href], [src]")].map((node) => node.getAttribute("href") ?? node.getAttribute("src"))).toEqual([]);
        expect(html.querySelectorAll("[data-nbdev-external]").length).toBe(0);
        expect(html.innerHTML).not.toContain("javascript:");
    });

    test("srcset 与 <picture><source> 里的外站候选去掉；data: 图片与 .agents/works/ 下的图片照旧", () => {
        const html = render([
            '<img src="data:image/png;base64,AAAA" srcset="https://cdn.example/a.png 2x" alt="d">',
            '<picture><source media="(prefers-color-scheme: dark)" srcset="https://cdn.example/dark.png"><img src="https://cdn.example/light.png" alt="logo"></picture>',
            "![证据](.agents/works/w00001-seed/shot.png)",
        ].join("\n\n"));
        const data = html.querySelector('img[alt="d"]')!;
        expect([data.getAttribute("src"), data.hasAttribute("srcset")]).toEqual(["data:image/png;base64,AAAA", false]);
        expect(html.querySelector("source")?.hasAttribute("srcset") ?? false).toBe(false);
        expect(html.querySelector("picture a.nbdev-external-image")?.textContent).toBe("外站图片：logo（cdn.example）");
        expect(html.querySelector('img[alt="证据"]')?.getAttribute("src")).toBe("http://127.0.0.1:4491/a/prefix/main/.agents/works/w00001-seed/shot.png");
    });
});
