/**
 * 网页导入与抽取进度（docs/specs/story/viewer.md 验收 9，输出 36 到 39）：生产构建的网页，真实的 `nbstory serve`，
 * 模型是子进程里的回放端点（录下的 w00005 t34 前 10 章回复）。要让任务停在某一步时关上那一步的闸门，请求先等着，
 * 开闸后照常回放。
 *
 * 服务与命令行读用例自己的配置（XDG_CONFIG_HOME），密钥是编的假值，只发往本机端点。
 */

import {spawn} from "node:child_process";
import {mkdir, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {expect, test} from "@playwright/test";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {login, sampleSourceText, startReplay, startServe, type ReplayServer, type StoryServer} from "./fixtures";

const CLI = join(import.meta.dirname, "..", "src", "cli.ts");
const KEY_ENV = "NBSTORY_E2E_INGEST_CREDENTIAL";

let root: string;
let replay: ReplayServer;
let server: StoryServer;
let env: Record<string, string>;
let file: string;

test.beforeAll(async () => {
    root = await createTestTmpRoot("nb-story-e2e-ingest", "nb-story e2e ingest");
    replay = await startReplay();
    const configHome = join(root, "xdg");
    await mkdir(join(configHome, "nbstory"), {recursive: true});
    await writeFile(join(configHome, "nbstory", "config.json"), JSON.stringify({model: {baseUrl: replay.url, id: "replay-model", apiKeyEnv: KEY_ENV, price: {input: 1, output: 4, currency: "CNY"}}}));
    env = {XDG_CONFIG_HOME: configHome, [KEY_ENV]: "fake-e2e-ingest-credential"};
    file = join(root, "灰烬.txt");
    await writeFile(file, await sampleSourceText(10));
    server = await startServe(join(root, "library"), env);
});

test.afterAll(async () => {
    expect(await server.stop()).toBe(0);
    await replay.stop();
    await rm(root, {recursive: true, force: true});
});

test.beforeEach(async ({context}) => {
    await login(context, server);
});

test.setTimeout(240_000);

test("导入页预览、开始、进度页；第 1 章提交后能打开，第 2 章提交时徽标提示更新；停止与继续；命令行运行时没有停止按钮", async ({page}) => {
    await replay.close("2/beats");

    // 书架没有书：点“导入原文”进导入页，选文件后预览写明新书 10 章。
    await page.goto(server.base);
    await page.getByTestId("go-import").click();
    await expect(page).toHaveURL(/\/import$/u);
    const previews: string[] = [];
    page.on("request", request => {
        if (request.url().endsWith("/api/rpc/ingest.preview")) previews.push(request.url());
    });
    await page.getByTestId("import-file").setInputFiles(file);
    await expect(page.getByTestId("import-title")).toHaveValue("灰烬");
    const plan = page.getByTestId("import-plan");
    await expect(plan).toHaveAttribute("data-action", "new");
    await expect(plan).toContainText("切出 10 章");
    await expect(plan).toContainText("抽取模型 replay-model");
    const id = ((await page.getByTestId("import-id").textContent()) ?? "").replace(/（由书名得到）$/u, "");
    expect(id).not.toBe("");
    // 选一次文件只预览一次（书名由选文件设上，不再因书名变化重新预览）。
    await page.waitForLoadState("networkidle");
    expect(previews).toHaveLength(1);

    // 开始后进入进度页，显示当前章与步骤；第 1 章提交后可以打开书。
    await page.getByTestId("import-start").click();
    await expect(page).toHaveURL(new RegExp(`/ingest/${id}$`, "u"));
    await expect(page.getByTestId("ingest-steps")).toBeVisible();
    await expect(page.getByTestId("ingest-count")).toHaveAttribute("data-committed", "1", {timeout: 60_000});
    await expect(page.getByTestId("ingest-current")).toContainText("第 2 章");

    // 书架上这本书可以点开；打开后停在第 1 章（抽到这里），顶栏有抽取徽标。
    await page.goto(server.base);
    const row = page.locator(`[data-testid="shelf-row"][data-book="${id}"]`);
    await expect(row.getByTestId("ingest-badge")).toHaveAttribute("data-state", "running");
    // 整行都能点开（不只是书名）。
    await row.click();
    await expect(page.getByTestId("book-frame")).toBeVisible();
    await expect(page.getByTestId("reading-label")).toContainText("全部读完");
    await expect(page.getByTestId("ingest-pill")).toContainText("抽取中 1 / 10");
    await page.locator('nav[aria-label="页面"] [data-page="roster"]').click();
    await expect(page.getByTestId("page-roster")).toBeVisible();
    const before = await page.getByTestId("page-roster").innerText();

    // 第 2 章提交：徽标提示更新，点之前人物页不变；点了之后换成新数据，阅读位置不变（还在第 1 章，能往后拨了）。
    await replay.close("3/beats");
    await replay.open("2/beats");
    await expect(page.getByTestId("ingest-update")).toContainText("第 2 章已抽完", {timeout: 60_000});
    expect(await page.getByTestId("page-roster").innerText()).toBe(before);
    await expect(page.getByTestId("reading-end")).toHaveCount(0);
    await page.getByTestId("ingest-update").click();
    await expect(page.getByTestId("ingest-pill")).toContainText("抽取中 2 / 10");
    await expect(page).toHaveURL(/at=1(&|$)/u);
    await expect(page.getByTestId("reading-end")).toBeVisible();
    await page.getByTestId("reading-end").click();
    await expect(page).toHaveURL(/at=2(&|$)/u);
    await expect(page.getByTestId("page-roster")).not.toHaveText(before);

    // 原文页往下读到一半时第 3 章提交：点了更新，正在读的位置不跳（内容在后台重取、回来后替换，不先清空）。
    await page.locator('nav[aria-label="页面"] [data-page="source"]').click();
    const scroller = page.getByTestId("page-source").locator("div.story-scroll-y.flex-1");
    await expect(scroller).toBeVisible();
    await scroller.evaluate(element => (element.scrollTop = 1200));
    await replay.close("4/beats");
    await replay.open("3/beats");
    await expect(page.getByTestId("ingest-update")).toContainText("第 3 章已抽完", {timeout: 60_000});
    await page.getByTestId("ingest-update").click();
    await expect(page.getByTestId("ingest-pill")).toContainText("抽取中 3 / 10");
    await page.waitForLoadState("networkidle");
    expect(await scroller.evaluate(element => element.scrollTop)).toBe(1200);

    // 进度页：停止后显示已停下，继续后接着抽（第 4 章的闸门还关着，任务等在那里）。
    await page.getByTestId("ingest-pill").click();
    await expect(page).toHaveURL(new RegExp(`/ingest/${id}$`, "u"));
    await page.getByTestId("ingest-stop").click();
    await expect(page.getByTestId("ingest-stopped")).toContainText("手动停下了", {timeout: 30_000});
    await page.getByTestId("ingest-resume").click();
    await expect(page.getByTestId("ingest-current")).toContainText("第 4 章");
    await page.getByTestId("ingest-stop").click();
    await expect(page.getByTestId("ingest-stopped")).toBeVisible({timeout: 30_000});

    // 改由命令行运行：进度页显示命令行抽取中、没有停止按钮；导入页对同一本书开始得到就地的说明。
    const child = spawn("bun", [CLI, "ingest", "--book", id, "--library", server.library], {stdio: ["ignore", "pipe", "pipe"], env: {...process.env, ...env}});
    const exited = new Promise<void>(resolve => child.on("exit", () => resolve()));
    try {
        await expect(page.getByTestId("ingest-badge")).toHaveAttribute("data-state", "cli", {timeout: 30_000});
        await expect(page.getByTestId("ingest-stop")).toHaveCount(0);
        await expect(page.getByTestId("ingest-current")).toContainText("在运行它的终端里按 Ctrl-C");

        await page.goto(`${server.base}/import`);
        await page.getByTestId("import-file").setInputFiles(file);
        await expect(page.getByTestId("import-plan")).toHaveAttribute("data-action", "resume");
        await page.getByTestId("import-start").click();
        await expect(page.getByTestId("import-start-error")).toContainText("正在抽取");
    } finally {
        child.kill("SIGINT");
        await exited;
    }

    // 手机宽度（输出 40）：两页都没有横向溢出；进度页的四格排成两列，章明细只留章、用时、费用。
    await page.setViewportSize({width: 390, height: 844});
    const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    await page.goto(`${server.base}/ingest/${id}`);
    await expect(page.getByTestId("ingest-chapters")).toBeVisible();
    expect(await overflow()).toBeLessThanOrEqual(0);
    expect(await page.getByTestId("ingest-tiles").evaluate(element => getComputedStyle(element).gridTemplateColumns.split(" ").length)).toBe(2);
    await expect(page.getByTestId("ingest-chapters").locator("th")).toHaveText(["章", "用时", "费用"]);
    await page.goto(`${server.base}/import`);
    await page.getByTestId("import-file").setInputFiles(file);
    await expect(page.getByTestId("import-plan")).toBeVisible();
    expect(await overflow()).toBeLessThanOrEqual(0);
});

test("新书关掉数值与秘密（ingest.md 输出 18）：进度页写明设置；书里没有这两页，直接地址与存下的状态都落到总览并提示；总览、统计、全书图里没有对应项", async ({page}) => {
    await replay.close("2/beats");
    const quiet = join(root, "静水.txt");
    await writeFile(quiet, await sampleSourceText(3));
    await page.goto(`${server.base}/import`);
    await page.getByTestId("import-file").setInputFiles(quiet);
    await expect(page.getByTestId("import-plan")).toHaveAttribute("data-action", "new");
    const id = ((await page.getByTestId("import-id").textContent()) ?? "").replace(/（由书名得到）$/u, "");
    await page.getByTestId("import-ledger").click();
    await page.getByTestId("import-secrets").click();
    await page.getByTestId("import-start").click();
    await expect(page).toHaveURL(new RegExp(`/ingest/${id}$`, "u"));
    await expect(page.getByTestId("ingest-features")).toHaveText("不记数值、秘密");
    await expect(page.getByTestId("ingest-count")).toHaveAttribute("data-committed", "1", {timeout: 60_000});

    // 导入页对这本已有的书：没有开关，只写保存的设置。
    await page.goto(`${server.base}/import`);
    await page.getByTestId("import-file").setInputFiles(quiet);
    await expect(page.getByTestId("import-plan")).toHaveAttribute("data-action", "resume");
    await expect(page.getByTestId("import-features")).toHaveCount(0);
    await expect(page.getByTestId("import-saved-features")).toContainText("不记数值、秘密");

    // 直接地址：落到总览并提示，地址改写成总览。
    await page.goto(`${server.base}/book/${id}/ledger`);
    await expect(page.getByTestId("page-overview")).toBeVisible();
    await expect(page.getByTestId("notice")).toContainText("这本书没有记录数值");
    await expect(page).toHaveURL(new RegExp(`/book/${id}/overview`, "u"));
    const nav = page.locator('nav[aria-label="页面"]');
    await expect(nav.locator('[data-page="roster"]')).toBeVisible();
    await expect(nav.locator('[data-page="secrets"]')).toHaveCount(0);
    await expect(nav.locator('[data-page="ledger"]')).toHaveCount(0);
    await expect(page.getByTestId("page-overview")).not.toContainText("身份秘密");
    await expect(page.getByTestId("page-overview")).not.toContainText("秘密矩阵");

    // 存下的状态停在秘密页（例如开关之前存的）：打开时同样落到总览。先离开书页：离开时它会把自己的状态存一次，
    // 等那次保存落定再写，免得被它盖掉。
    await page.goto(server.base);
    await expect.poll(async () => ((await (await page.request.post(`${server.base}/api/rpc/reading.get`, {data: {book: id}})).json()) as {view: {page?: string} | null}).view?.page).toBe("overview");
    const saved = await page.request.post(`${server.base}/api/rpc/reading.set`, {data: {book: id, position: {chapter: 1}, view: {page: "secrets", entity: null, tab: null, perspective: "reader"}}});
    expect(saved.ok()).toBe(true);
    await page.goto(`${server.base}/book/${id}`);
    await expect(page.getByTestId("notice")).toContainText("这本书没有记录秘密");
    await expect(page.getByTestId("page-overview")).toBeVisible();

    // 同一本书里改地址（后退、手改）指向关掉的页：也落到总览。
    await nav.locator('[data-page="stats"]').click();
    await expect(page.getByTestId("visible-stats")).toBeVisible();
    await expect(page.getByTestId("visible-stats")).not.toContainText("数值流水");
    await expect(page.getByTestId("visible-stats")).not.toContainText("秘密");
    await expect(page.getByTestId("stats-charts")).not.toContainText("数值");
    await page.evaluate(path => {
        history.pushState({}, "", path);
        dispatchEvent(new PopStateEvent("popstate"));
    }, `/book/${id}/secrets`);
    await expect(page.getByTestId("page-overview")).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/book/${id}/overview`, "u"));

    await nav.locator('[data-page="book-graph"]').click();
    await expect(page.getByTestId("page-book-graph")).toBeVisible();
    // 类型开关在“按关联”的排布里。
    await page.getByTestId("page-book-graph").getByText("按关联").click();
    await expect(page.getByTestId("page-book-graph").locator(".story-chip", {hasText: "悬念"})).toBeVisible();
    await expect(page.getByTestId("page-book-graph").locator(".story-chip", {hasText: "秘密"})).toHaveCount(0);

    await page.goto(`${server.base}/ingest/${id}`);
    await page.getByTestId("ingest-stop").click();
    await expect(page.getByTestId("ingest-stopped")).toBeVisible({timeout: 30_000});
    await replay.open("2/beats");
});

test("导入页：不是 UTF-8 的文件就地说明只收 UTF-8", async ({page}) => {
    const gbk = join(root, "旧书.txt");
    await writeFile(gbk, Buffer.from([0xb5, 0xda, 0xd2, 0xbb, 0xd5, 0xc2, 0x0a, 0xd5, 0xfd, 0xce, 0xc4]));
    await page.goto(`${server.base}/import`);
    await page.getByTestId("import-file").setInputFiles(gbk);
    await expect(page.getByTestId("import-file-error")).toContainText("只收 UTF-8");
    await expect(page.getByTestId("import-start")).toHaveCount(0);
});
