/**
 * 书里的问答页（docs/specs/story/viewer.md 的问答页、story/qa.md 的“网页”）：生产构建的网页，真实的 `nbstory serve`，
 * 模型是子进程里的脚本端点（testing/qa-endpoint-server.ts）。要让一轮停在中途时让端点先等着，页面点“停止”或放行。
 *
 * 服务读用例自己的配置（XDG_CONFIG_HOME），密钥是编的假值，只发往本机端点。
 */

import {mkdir, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {expect, test, type Page} from "@playwright/test";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {login, makeLibrary, startQaEndpoint, startServe, type QaEndpoint, type StoryServer} from "./fixtures";

const KEY_ENV = "NBSTORY_E2E_QA_CREDENTIAL";

let root: string;
let endpoint: QaEndpoint;
let server: StoryServer;
let cleanupLibrary: () => Promise<void>;
let configFile: string;

const READ_THEN_ANSWER = [
    {kind: "tools", calls: [{name: "read", args: {from: {chapter: 37, paragraph: 8}, to: {chapter: 37, paragraph: 8}}}]},
    {
        kind: "tools",
        calls: [
            {
                name: "answer",
                args: {
                    conclusion: "读者在 37.8 就知道了",
                    conclusionType: "明说",
                    knowledge: [{who: "读者", state: "知道", how: "旁白点破", refs: ["37.8"]}],
                    explanation: "旁白在 37.8 点破了身份",
                    evidence: ["37.8"],
                    coverage: "第 37 章",
                },
            },
        ],
    },
];

test.beforeAll(async () => {
    root = await createTestTmpRoot("nb-story-e2e-qa", "nb-story e2e qa");
    endpoint = await startQaEndpoint();
    const library = await makeLibrary("qa");
    cleanupLibrary = library.cleanup;
    const configHome = join(root, "xdg");
    await mkdir(join(configHome, "nbstory"), {recursive: true});
    configFile = join(configHome, "nbstory", "config.json");
    await writeFile(configFile, JSON.stringify({model: {baseUrl: endpoint.url, id: "qa-model", apiKeyEnv: KEY_ENV}}));
    server = await startServe(library.library, {XDG_CONFIG_HOME: configHome, [KEY_ENV]: "fake-e2e-qa-credential"});
});

test.afterAll(async () => {
    expect(await server.stop()).toBe(0);
    await endpoint.stop();
    await cleanupLibrary();
    await rm(root, {recursive: true, force: true});
});

test.beforeEach(async ({context}) => {
    await login(context, server);
});

async function ask(page: Page, question: string): Promise<void> {
    const input = page.getByRole("textbox", {name: "消息输入框"});
    await input.click();
    await input.fill(question);
    await input.press("Enter");
}

test("新对话：提问后看到过程与答案卡片；出处在抽屉里打开；刷新后对话还在，能续问", async ({page}) => {
    await endpoint.script(READ_THEN_ANSWER);
    await page.goto(`${server.base}/book/fox/qa?at=38.57`);
    await expect(page.getByText("新对话按你现在的位置 38.57 回答")).toBeVisible();
    await ask(page, "地狱猫是谁？");

    const card = page.locator("[data-qa-answer]");
    // 受理之后输入框清空（换到新对话的草稿也是新版本）。
    await expect(page.getByRole("textbox", {name: "消息输入框"})).toHaveText("");
    await expect(card).toBeVisible();
    await expect(card).toContainText("读者在 37.8 就知道了");
    await expect(card.getByText("明说")).toBeVisible();
    // 地址里记下了这个对话；列表里它不再是运行中。
    await expect(page).toHaveURL(/[?&]c=\d{17}-[0-9a-z]{6}/u);
    await expect(page.locator("aside").getByText("运行中")).toHaveCount(0, {timeout: 2500});

    await card.locator(".answer-foot").getByRole("button", {name: "37.8"}).click();
    await expect(page.getByTestId("drawer")).toContainText("37.8");

    await page.reload();
    await expect(page.locator("[data-qa-answer]")).toContainText("读者在 37.8 就知道了");
    await expect(page.getByRole("button", {name: /地狱猫是谁？/u}).first()).toBeVisible();

    await endpoint.script([{kind: "text", text: "接着说：见 37.110—38.2。"}]);
    await ask(page, "再说说？");
    await expect(page.getByText("接着说：见")).toBeVisible();
    // 跨章的出处：抽屉从起点那一章读到终点那一章，引用的几段高亮。
    await page.locator("[data-qa-page] main, [data-qa-page]").getByText("37.110—38.2").first().click();
    const drawer = page.getByTestId("drawer-source");
    await expect(drawer.locator(".is-cited").first()).toContainText("37.110");
    await expect(drawer.locator(".is-cited").last()).toContainText("38.2");
});

test("运行中：过程逐步出现，点停止后这一轮记为已停止；删除对话要确认，删后列表里没有它", async ({page}) => {
    await endpoint.script([{kind: "tools", calls: [{name: "read", args: {from: {chapter: 37}}}]}, {kind: "text", text: "不会到这里"}]);
    await page.goto(`${server.base}/book/fox/qa?at=38.57`);
    await page.getByRole("button", {name: "新对话"}).first().click();
    await endpoint.hold();
    await ask(page, "要停下的问题");
    const stop = page.locator("[data-qa-stop]");
    await expect(stop).toBeVisible();
    await stop.click();
    await endpoint.release();
    await expect(stop).toBeHidden();
    await expect(page.getByText("要停下的问题").first()).toBeVisible();

    await page.locator("[data-qa-remove]").click();
    await page.getByRole("alertdialog").getByRole("button", {name: "删除"}).click();
    await expect(page).not.toHaveURL(/[?&]c=/u);
    await expect(page.getByRole("button", {name: /要停下的问题/u})).toHaveCount(0);
});

test("没有配置时：写明要先配置并给去设置的链接，不能发送", async ({page}) => {
    await rm(configFile);
    try {
        await page.goto(`${server.base}/book/fox/qa`);
        await expect(page.getByText("还没有配置问答用的模型")).toBeVisible();
        await expect(page.getByRole("link", {name: "去设置"})).toHaveAttribute("href", "/settings");
        await expect(page.getByRole("button", {name: "发送"})).toBeDisabled();
    } finally {
        await writeFile(configFile, JSON.stringify({model: {baseUrl: endpoint.url, id: "qa-model", apiKeyEnv: KEY_ENV}}));
    }
});

test("手机宽度：对话列表收进顶栏的下拉，选中后下拉关上", async ({page}) => {
    await page.setViewportSize({width: 390, height: 844});
    await page.goto(`${server.base}/book/fox/qa`);
    await page.locator("[data-qa-switch]").click();
    const first = page.getByRole("dialog").getByRole("button", {name: /地狱猫是谁？/u}).first();
    await expect(first).toBeVisible();
    await first.click();
    await expect(page.getByRole("dialog")).toBeHidden();
    await expect(page.locator("[data-qa-answer]")).toBeVisible();
});
