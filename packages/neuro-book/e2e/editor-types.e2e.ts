/**
 * 按文件类型选编辑器在真实 Chrome 中的验收（docs/specs/workbench/editor.md 场景 22–24、26，workbench/image-viewer.md、
 * workbench/html-preview.md 的验收）：生产构建的后端与前端，项目 `book` 先登记好，文件在真实目录里。预览页在真实的沙箱
 * iframe 里运行，外网地址由 Playwright 的路由接住，不真的出网。等页面上可观察的变化，不按时长等待。
 */

import {randomUUID} from "node:crypto";
import {mkdir, rm, writeFile} from "node:fs/promises";
import {dirname, join} from "node:path";

import {expect, test} from "@playwright/test";
import type {Frame, Page} from "@playwright/test";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {startProductServer} from "./fixtures";
import type {ProductServer} from "./fixtures";

/** 3×2 的红色 PNG 与 5×4 的半透明蓝色 PNG。 */
const PNG_3X2 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAYAAACddGYaAAAAEUlEQVR4nGP4z8DwH4YZkDkAm34L9XKwuTwAAAAASUVORK5CYII=", "base64");
const PNG_5X4 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAUAAAAECAYAAABGM/VAAAAAEUlEQVR4nGNgaPjfgIEpEwQAeXAn7UGteVgAAAAASUVORK5CYII=", "base64");

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><circle cx="10" cy="10" r="8" fill="red"/></svg>`;

/**
 * 预览页：相对引用的样式、图片、模块脚本与 `fetch`，页内锚点，以及几条越界的尝试，结果都记在 `<body>` 的 data 属性上。
 * `__RPC__`、`__ORIGIN__` 在服务端起来之后换成真实的端口与应用源。
 */
const PAGE = `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="style.css"></head><body>
<h1 id="title">预览标题</h1>
<img id="img" src="img/a.png" alt="">
<p><a id="jump" href="#end">跳到末尾</a></p>
<div style="height:3000px"></div><p id="end">末尾</p>
<script type="module" src="./m.js"></script>
<script>
var mark = function (key, value) { document.body.dataset[key] = value; };
fetch("data.json").then(function (r) { return r.json(); }).then(function (d) { mark("fetch", d.ok ? "ok" : "bad"); }, function () { mark("fetch", "fail"); });
try { void parent.document.title; mark("parent", "open"); } catch (e) { mark("parent", "denied"); }
document.addEventListener("securitypolicyviolation", function (e) { if (e.blockedURI.indexOf("net.example") >= 0) mark("net", "blocked"); });
fetch("https://net.example/x").then(function () { mark("net", "ok"); }, function () { if (!document.body.dataset.net) mark("net", "failed"); });
fetch("__ORIGIN__/api/runtime/health", {method: "POST", mode: "no-cors"}).then(function () { mark("post", "sent"); }, function () { mark("post", "blocked"); });
try { var ws = new WebSocket("ws://127.0.0.1:__RPC__/"); ws.onopen = function () { mark("rpc", "open"); }; ws.onerror = function () { mark("rpc", "refused"); }; } catch (e) { mark("rpc", "refused"); }
</script></body></html>
`;

let tmp = "";
let projectDir = "";
let stateRoot = "";
let server: ProductServer;

test.beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-e2e", "editor-types");
    projectDir = join(tmp, "Book");
    stateRoot = join(tmp, "state");
    const id = randomUUID();
    const files: Record<string, string | Uint8Array> = {
        ".nbook/project.json": JSON.stringify({schema: 1, id}),
        "img/a.png": PNG_3X2,
        "img/b.svg": SVG,
        // 2 MB 的 PDF：超过正文上限，按扩展名就知道是二进制，不读。
        "docs/manual.pdf": new Uint8Array(2 * 1024 * 1024).fill(0x25),
        // GBK 编码的“你好”：不是 UTF-8。
        "notes/gbk.txt": new Uint8Array([0xc4, 0xe3, 0xba, 0xc3]),
        "site/style.css": "#title { color: rgb(1, 2, 3); }\n",
        "site/m.js": "document.body.dataset.module = \"ok\";\n",
        "site/data.json": "{\"ok\": true}\n",
        "site/img/a.png": PNG_3X2,
    };
    for (const [path, content] of Object.entries(files)) {
        await mkdir(dirname(join(projectDir, path)), {recursive: true});
        await writeFile(join(projectDir, path), content);
    }
    await mkdir(join(stateRoot, "user"), {recursive: true});
    await writeFile(join(stateRoot, "projects.json"), JSON.stringify({schema: 1, projects: [{id, name: "book", path: projectDir}]}));
    server = await startProductServer(stateRoot);
    const bootstrap = await (await fetch(new URL("/api/runtime/browser-bootstrap", server.url))).json() as {rpc: {port: number}};
    await writeFile(join(projectDir, "site/index.html"), PAGE.replace("__RPC__", String(bootstrap.rpc.port)).replace("__ORIGIN__", new URL(server.url).origin));
});

test.afterAll(async () => {
    expect(await server.stop()).toBe(0);
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

const item = (page: Page, address: string) => page.locator(`[data-explorer-row="${address}"]`);
const labels = (page: Page) => page.locator("[data-editor-group-active] [data-editor-tab-label]");
const status = (page: Page, id: string) => page.locator(`[data-workbench-status-bar] [data-workbench-item="${id}"]`);
const activeGroup = (page: Page) => page.locator("[data-editor-group-active]");

async function open(page: Page): Promise<void> {
    await page.goto(new URL("/?project=book", server.url).href);
    await expect(page.locator("[data-workbench-root]")).toHaveAttribute("data-rpc-state", "online");
    await expect(page.locator("[data-editor-area]")).toBeVisible();
}

/** 在资源管理器里展开一个顶层目录。 */
async function expand(page: Page, address: string): Promise<void> {
    if (await item(page, address).getAttribute("aria-expanded") !== "true") await item(page, address).click();
}

async function runCommand(page: Page, title: string): Promise<void> {
    const combobox = page.getByRole("combobox", {name: "输入命令，或输入 : 跳到某一行"});
    await expect(async () => {
        await page.keyboard.press("Control+Shift+P");
        await expect(combobox).toBeFocused({timeout: 500});
    }).toPass();
    await combobox.fill(title);
    await page.getByRole("option", {name: new RegExp(title, "u")}).first().click();
}

/** 预览 iframe 的框架：从当前挂着的那个元素取（换令牌、重建时是新的框架）。 */
async function previewFrame(page: Page, nth = 0): Promise<Frame> {
    const element = page.locator("[data-html-preview-frame]").nth(nth);
    await expect(element).toBeVisible();
    const frame = await (await element.elementHandle())?.contentFrame();
    if (frame === null || frame === undefined) throw new Error("预览 iframe 没有框架");
    return frame;
}

test("图片：png 与 svg 以图片查看器显示，状态栏有尺寸与大小；外部改写后显示新图；svg 可用源码编辑器重新打开；2 MB 的 pdf 与 GBK 文本说明不能打开", async ({page}) => {
    await open(page);
    await expand(page, "project://img");
    await item(page, "project://img/a.png").dblclick();
    const viewer = activeGroup(page).locator("[data-image-viewer]");
    await expect(viewer).toHaveAttribute("data-image-viewer-phase", "shown");
    await expect(status(page, "nbook.editor.editor-status")).toContainText("3 × 2");
    await expect(status(page, "nbook.editor.word-count")).toHaveCount(0);

    await writeFile(join(projectDir, "img/a.png"), PNG_5X4);
    await expect(status(page, "nbook.editor.editor-status")).toContainText("5 × 4");

    // 单击图片在适应与 100% 之间切换：小图适应时也是 100%，放大一次后再看比例。
    await viewer.focus();
    await page.keyboard.press("=");
    await expect(status(page, "nbook.editor.editor-status")).toContainText("125%");
    await page.keyboard.press("0");
    await expect(status(page, "nbook.editor.editor-status")).toContainText("100%");

    await item(page, "project://img/b.svg").dblclick();
    await expect(activeGroup(page).locator("[data-image-viewer]")).toHaveAttribute("data-image-viewer-phase", "shown");
    await expect(status(page, "nbook.editor.editor-status")).toContainText("40 × 20");
    await runCommand(page, "用其它编辑器重新打开");
    await expect(page.getByRole("option", {name: /图片查看器/u})).toBeVisible();
    await page.getByRole("option", {name: /源码编辑器/u}).click();
    await expect(activeGroup(page).locator("[data-editor-kind=\"nbook.editor.code\"] .view-lines")).toContainText("<svg");

    await expand(page, "project://docs");
    await item(page, "project://docs/manual.pdf").dblclick();
    await expect(activeGroup(page).locator("[data-editor-unavailable=\"binary\"]")).toContainText("不能在这里打开");

    await expand(page, "project://notes");
    await item(page, "project://notes/gbk.txt").dblclick();
    await expect(activeGroup(page).locator("[data-editor-failure]")).toContainText("不是 UTF-8 文本");
    await expect(activeGroup(page).locator("[data-editor-failure]").getByRole("button")).toHaveCount(0);

    // 图片标签上关闭照常可用（活动的编辑器不要求文本文档）。
    await item(page, "project://img/a.png").click();
    await expect(labels(page).filter({hasText: "a.png"})).toHaveCount(1);
    await activeGroup(page).locator("[data-image-viewer]").focus();
    await page.keyboard.press("Control+w");
    await expect(labels(page).filter({hasText: "a.png"})).toHaveCount(0);
});

test("HTML 预览：标题栏打开预览；相对引用的样式、图片、模块脚本与 fetch 都生效，锚点页内滚动；沙箱拿不到应用；默认不联网，打开开关后可以；侧边预览随未保存的正文更新；关掉后令牌作废", async ({page}) => {
    const blockedPosts: number[] = [];
    page.on("response", (response) => {
        if (response.url().endsWith("/api/runtime/health") && response.request().method() === "POST") blockedPosts.push(response.status());
    });
    await page.route("https://net.example/**", (route) => route.fulfill({status: 200, body: "ok", headers: {"Access-Control-Allow-Origin": "*"}}));
    await open(page);
    await expand(page, "project://site");
    await item(page, "project://site/index.html").dblclick();
    await expect(activeGroup(page).locator("[data-editor-kind=\"nbook.editor.code\"] .view-lines")).toContainText("预览标题");

    await activeGroup(page).getByRole("button", {name: "打开预览"}).click();
    // 新窗口第一次打开作品时还有欢迎页：只看这个文件的两个标签。
    await expect(labels(page).filter({hasText: "index.html"})).toHaveText(["index.html", "预览 index.html"]);
    let frame = await previewFrame(page);
    await expect(frame.locator("#title")).toHaveCSS("color", "rgb(1, 2, 3)");
    await expect.poll(() => frame.locator("#img").evaluate((element) => (element as HTMLImageElement).naturalWidth)).toBe(3);
    const body = frame.locator("body");
    await expect(body).toHaveAttribute("data-module", "ok");
    await expect(body).toHaveAttribute("data-fetch", "ok");
    await expect(body).toHaveAttribute("data-parent", "denied");
    await expect(body).toHaveAttribute("data-net", "blocked");
    await expect(body).toHaveAttribute("data-post", "blocked");
    expect(blockedPosts).toEqual([]);
    await frame.locator("#jump").click();
    await expect.poll(() => frame.evaluate(() => [location.href, window.scrollY > 0])).toEqual(["about:srcdoc", true]);

    // 打开联网：外网请求放行；向应用端口的写请求得到 403；连 RPC 被拒。
    await activeGroup(page).getByRole("button", {name: "允许联网"}).click();
    frame = await previewFrame(page);
    await expect(frame.locator("body")).toHaveAttribute("data-net", "ok");
    await expect(frame.locator("body")).toHaveAttribute("data-rpc", "refused");
    await expect.poll(() => blockedPosts).toContain(403);
    const base = await frame.evaluate(() => document.baseURI);
    expect((await fetch(new URL("data.json", base))).status).toBe(200);

    // 切到源码标签：预览的 iframe 被移除。
    await labels(page).filter({hasText: /^index\.html$/u}).click();
    await expect(page.locator("[data-html-preview-frame]")).toHaveCount(0);

    // 在侧边打开预览：在源码里输入、不保存，停手后右侧的预览更新。
    await activeGroup(page).getByRole("button", {name: "更多操作"}).click();
    await page.getByRole("menuitem", {name: "在侧边打开预览"}).click();
    await expect(page.locator("[data-editor-group]")).toHaveCount(2);
    await page.locator("[data-editor-group]").first().locator("[data-editor-tab-label]").filter({hasText: /^index\.html$/u}).click();
    const code = page.locator("[data-editor-group-active] [data-editor-kind=\"nbook.editor.code\"] .monaco-editor");
    await code.click();
    await page.keyboard.press("Control+End");
    await page.keyboard.insertText("<p id=\"added\">新段</p>");
    frame = await previewFrame(page);
    await expect(frame.locator("#added")).toHaveText("新段");

    // 关掉两个预览标签：令牌作废。
    for (const group of await page.locator("[data-editor-group]").all()) {
        const preview = group.locator("[data-editor-tab]").filter({hasText: "预览 index.html"});
        if (await preview.count() === 0) continue;
        // 关闭按钮与标签是兄弟元素，按标签 id 找。
        const id = await preview.getAttribute("data-editor-tab");
        await group.locator(`[data-editor-tab-close="${id ?? ""}"]`).click();
    }
    await expect(page.locator("[data-html-preview-frame]")).toHaveCount(0);
    await expect.poll(async () => (await fetch(new URL("data.json", base))).status).toBe(404);
});
