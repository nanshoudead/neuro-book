/**
 * 书里的问答页（docs/specs/story/viewer.md 的问答页、story/qa.md 的“网页”）：生产构建的网页，真实的 `nbstory serve`，
 * 模型是子进程里的脚本端点（testing/qa-endpoint-server.ts）。要让一轮停在中途时让端点先等着，页面点“停止”或放行。
 *
 * 服务读用例自己的配置（XDG_CONFIG_HOME），密钥是编的假值，只发往本机端点。
 */

import {mkdir, readFile, rm, writeFile} from "node:fs/promises";
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
    {kind: "tools", calls: [{name: "read", args: {from: {chapter: 37, paragraph: 8}, to: {chapter: 37, paragraph: 8}}}], thinking: "先翻到 37 章找地狱猫"},
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
    // 第一个请求（读原文）照常回，第二个（交卷）先等着：这时页面停在运行中。
    await endpoint.hold(1);
    await ask(page, "地狱猫是谁？");

    const card = page.locator("[data-qa-answer]");
    // 受理之后输入框清空（换到新对话的草稿也是新版本）。
    await expect(page.getByRole("textbox", {name: "消息输入框"})).toHaveText("");
    // 运行中：过程逐步列出模型的思考与读原文的那一步，列表里这个对话在运行中。
    await expect(page.getByText("先翻到 37 章找地狱猫").first()).toBeVisible();
    await expect(page.getByText("37.8—37.8").first()).toBeVisible();
    await expect(page.locator("aside").getByText("运行中")).toHaveCount(1);
    await endpoint.release();
    await expect(card).toBeVisible();
    // 结束后整轮过程收成一行摘要。
    // 1 次操作（交卷是结果，不计），模型回了 2 次。
    await expect(page.getByText("过程 · 1 次操作 · 2 次请求").first()).toBeVisible();
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
    // 这一轮记为已停止，刷新后（按记录显示）也是。
    await expect(page.getByText("已停止").first()).toBeVisible();
    await page.reload();
    await expect(page.getByText("已停止").first()).toBeVisible();

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
    // 自己先建一个对话，不靠别的用例留下的。
    await endpoint.script([{kind: "text", text: "手机上的回答"}]);
    await page.goto(`${server.base}/book/fox/qa`);
    await ask(page, "手机上问的");
    await expect(page.getByText("手机上的回答")).toBeVisible();
    // 回到新对话，再从下拉里选回刚才那个。
    await page.locator("[data-qa-page] header").getByRole("button", {name: "新对话"}).click();
    await expect(page.getByText("手机上的回答")).toHaveCount(0);
    await page.locator("[data-qa-switch]").click();
    const first = page.getByRole("dialog").getByRole("button", {name: /手机上问的/u}).first();
    await expect(first).toBeVisible();
    await first.click();
    await expect(page.getByRole("dialog")).toBeHidden();
    await expect(page.getByText("手机上的回答")).toBeVisible();
});

test.describe("设置页", () => {
    const original = () => ({model: {baseUrl: endpoint.url, id: "qa-model", apiKeyEnv: KEY_ENV}});
    test.afterEach(async () => {
        await writeFile(configFile, JSON.stringify(original()));
    });

    test("从书架进入；改模型名保存后写进同一份文件；有没保存的改动时不能测试连接；测试连接通过", async ({page}) => {
        // 打开 `/` 会回到上次读的书，从书里点“回到书架”进书架。
        await page.goto(`${server.base}/book/fox/overview`);
        await page.getByTestId("go-shelf").click();
        await page.getByTestId("go-settings").click();
        await expect(page).toHaveURL(/\/settings$/u);
        await expect(page.getByTestId("settings-page")).toContainText("config.json");

        await endpoint.script([{kind: "text", text: "好"}]);
        await page.getByTestId("settings-test").click();
        await expect(page.getByTestId("settings-tested")).toContainText("通过：qa-model");

        const modelId = page.getByLabel("模型名").first();
        await modelId.fill("qa-model-2");
        await modelId.press("Tab");
        await expect(page.getByTestId("settings-test")).toBeDisabled();
        await page.getByTestId("settings-save").click();
        await expect(page.getByTestId("settings-notice")).toContainText("已保存");
        expect(JSON.parse(await readFile(configFile, "utf8")).model.id).toBe("qa-model-2");
        await expect(page.getByTestId("settings-test")).toBeEnabled();
    });

    test("别处改过再保存：报冲突，重新载入后是别处写的内容；误贴的密钥不收、文件不变", async ({page}) => {
        await page.goto(`${server.base}/settings`);
        const modelId = page.getByLabel("模型名").first();
        await expect(modelId).toHaveValue("qa-model");
        await writeFile(configFile, JSON.stringify({model: {...original().model, id: "changed-by-cli"}}));
        await modelId.fill("from-page");
        await modelId.press("Tab");
        await page.getByTestId("settings-save").click();
        await expect(page.getByTestId("settings-notice")).toContainText("别处");
        await page.getByRole("button", {name: "重新载入"}).click();
        await expect(modelId).toHaveValue("changed-by-cli");

        const pasted = "sk-pasted-in-settings-e2e-0042";
        const keyEnv = page.getByLabel("密钥环境变量").first();
        await keyEnv.fill(pasted);
        await keyEnv.press("Tab");
        await page.getByTestId("settings-save").click();
        await expect(page.getByTestId("settings-notice")).toContainText("没有保存");
        await expect(page.getByTestId("settings-notice")).not.toContainText(pasted);
        expect(await readFile(configFile, "utf8")).not.toContain(pasted);
    });

    test("还没有配置文件：从空的配置开始，填好保存后新建；书里的菜单也能进入", async ({page}) => {
        await rm(configFile);
        await page.goto(`${server.base}/book/fox/overview`);
        await page.getByRole("button", {name: "转生反派萝莉，找茬魔法少女"}).click();
        await page.getByRole("menuitem", {name: "设置"}).click();
        await expect(page.getByTestId("settings-absent")).toBeVisible();
        await page.getByLabel("服务地址").first().fill(endpoint.url);
        await page.getByLabel("模型名").first().fill("new-model");
        const keyEnv = page.getByLabel("密钥环境变量").first();
        await keyEnv.fill(KEY_ENV);
        await keyEnv.press("Tab");
        await page.getByTestId("settings-save").click();
        await expect(page.getByTestId("settings-notice")).toContainText("已保存");
        expect(JSON.parse(await readFile(configFile, "utf8"))).toEqual({model: {baseUrl: endpoint.url, id: "new-model", apiKeyEnv: KEY_ENV}});
    });
});
