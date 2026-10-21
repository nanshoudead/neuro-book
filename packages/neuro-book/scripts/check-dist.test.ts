/**
 * 生产产物检查：用临时目录里的合成产物验证判定，真实产物由 `bun run build` 的最后一步检查。
 */

import {afterAll, beforeAll, describe, expect, it} from "bun:test";
import {mkdir, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {scanDist} from "./check-dist";

let tmp = "";
let sequence = 0;

beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-dist", "check-dist");
});

afterAll(async () => {
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

async function dist(files: Record<string, string>): Promise<string> {
    sequence += 1;
    const root = join(tmp, `dist-${String(sequence)}`);
    for (const [path, text] of Object.entries(files)) {
        await mkdir(join(root, path, ".."), {recursive: true});
        await writeFile(join(root, path), text);
    }
    return root;
}

const product = {
    "web/index.html": "<div id=app></div>",
    "web/assets/index-abc.js": "const a = \"nbook.workbench\"; h(\"main\", {\"data-workbench-root\": \"\"});",
    "server/main.js": "const id = \"nbook.http\"; console.log(`Listening on ${url}`);",
};

describe("生产产物检查", () => {
    it("只有产品代码时通过", async () => {
        expect(await scanDist(await dist(product), ["/home/someone/repo"])).toEqual({forbidden: [], missing: []});
    });

    it("查出开发插件的代码与本机路径，报出所在文件", async () => {
        const root = await dist({...product, "web/assets/lab-xyz.js": "export default {id: \"nbook.lab\"};", "server/main.js": `${product["server/main.js"]} "/home/someone/repo/src"`});
        expect((await scanDist(root, ["/home/someone/repo"])).forbidden).toEqual(["web/assets/lab-xyz.js: nbook.lab", "server/main.js: /home/someone/repo"]);
    });

    it("产品代码误引了 nb-ui 的 lab-sources：组件文档原文进了包，按 frontmatter 拦下", async () => {
        const root = await dist({...product, "web/assets/index-abc.js": `${product["web/assets/index-abc.js"]} const docs = {"controls/Button.md": "---\\n标签: []\\n---\\n\\n# Button"};`});
        expect((await scanDist(root, [])).forbidden).toEqual(["web/assets/index-abc.js: 标签: ["]);
    });

    it("首屏的脚本里有 Markdown 的编辑内核或解析器时报出；按需加载的 chunk 里有不算（workspace.markdown-syntaxes 输出 2）", async () => {
        const root = await dist({
            ...product,
            "web/index.html": "<script type=\"module\" src=\"/assets/index-abc.js\"></script><link rel=\"modulepreload\" href=\"/assets/shared-1.js\">",
            "web/assets/shared-1.js": "throw new RangeError(\"Invalid content for node \" + name);",
            "web/assets/MarkdownControl-2.js": "throw new Error(\"marked(): input parameter is undefined or null\");",
        });
        expect((await scanDist(root, [])).forbidden).toEqual(["web/assets/shared-1.js（首屏）: Invalid content for node"]);
    });

    it("样式分层（ADR 0028）：不分层的元素、通配选择器与层的先后颠倒时报出；层里的、带类或 :root 的、:where() 之外带类的、浏览器私有伪元素不报", async () => {
        const root = await dist({
            ...product,
            "web/assets/ok.css": "@layer theme,base,components,utilities;@layer base{*{margin:0}html{color:red}}.nb-host-page{padding:0}:root{--x:1}:where(.a) .b{color:red}@keyframes spin{from{opacity:0}to{opacity:1}}::-ms-clear{display:none}",
            "web/assets/bad.css": "@layer theme,utilities,base;*,::before{margin:0}html{scrollbar-gutter:stable}:where(.a){color:red}",
        });
        expect((await scanDist(root, [])).forbidden).toEqual([
            "web/assets/bad.css: 样式层的先后是 theme, utilities, base，应为 theme, base, utilities",
            "web/assets/bad.css: 不分层的低特异性规则 *（放进 @layer base）",
            "web/assets/bad.css: 不分层的低特异性规则 ::before（放进 @layer base）",
            "web/assets/bad.css: 不分层的低特异性规则 html（放进 @layer base）",
            "web/assets/bad.css: 不分层的低特异性规则 :where(.a)（放进 @layer base）",
        ]);
    });

    it("缺少产品标记时报告，扫描空目录或别处的输出不会误判通过", async () => {
        const root = await dist({"web/index.html": "", "server/main.js": "Listening on"});
        expect((await scanDist(root, [])).missing).toEqual(["web: nbook.workbench", "web: data-workbench-root", "server: nbook.http"]);
    });
});
