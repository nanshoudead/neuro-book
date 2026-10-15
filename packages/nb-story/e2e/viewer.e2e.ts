/**
 * 查看器的验收（docs/specs/story/viewer.md 验收 1 到 8 与“状态与转换”的时序）：生产构建的网页，真实的 `nbstory serve`，
 * 100 章样例书，本机 Chrome。图画在 WebGL 画布上，读不到点和字：图的数据由核心库的测试覆盖，这里测画布与交互的外部效果。
 */

import {expect, test, type Page} from "@playwright/test";

import {login, makeLibrary, readingState, runCli, startServe, type StoryServer} from "./fixtures";

let server: StoryServer;
let cleanup: () => Promise<void>;

test.beforeAll(async () => {
    const library = await makeLibrary("viewer");
    cleanup = library.cleanup;
    server = await startServe(library.library);
});

test.afterAll(async () => {
    expect(await server.stop()).toBe(0);
    await cleanup();
});

test.beforeEach(async ({context}) => {
    await login(context, server);
});

async function open(page: Page, path: string): Promise<void> {
    await page.goto(`${server.base}${path}`);
    await expect(page.getByTestId("book-frame")).toBeVisible();
}

/** 页面主区与抽屉里的全部文字。 */
async function visibleText(page: Page): Promise<string> {
    return page.locator("body").innerText();
}

test("防剧透（验收 1）：第 7 章时各页没有心月狐与之后的章标题，拨到第 8 章后出现", async ({page}) => {
    for (const path of ["overview", "roster", "secrets"]) {
        await open(page, `/book/fox/${path}?at=7`);
        await expect(page.getByTestId(`page-${path}`)).toBeVisible();
        await page.waitForLoadState("networkidle");
        expect(await visibleText(page)).not.toContain("心月狐");
    }
    await open(page, "/book/fox/source?at=7");
    await expect(page.locator('[data-chapter="8"]')).toHaveText(/未读/u);
    await expect(page.locator('[data-chapter="8"]')).toBeDisabled();
    await page.getByTestId("search-input").locator("input").fill("心月狐");
    await expect(page.getByTestId("search-results")).toContainText("共 0 条");

    await open(page, "/book/fox/secrets?at=8");
    await expect(page.getByTestId("secrets-matrix")).toContainText("心月狐就是苏天晴");
    await open(page, "/book/fox/source?at=8");
    await expect(page.locator('[data-chapter="8"]')).not.toHaveText(/未读/u);
});

test("回到上次（验收 2）：换一个浏览器配置打开回到同一画面；地址写明的部分优先", async ({page, browser}) => {
    await open(page, "/book/fox/relations?at=38.57&perspective=e1-1&entity=e8-2");
    await expect.poll(async () => (await readingState(page.context(), server)).view, {timeout: 10_000}).toEqual(expect.objectContaining({page: "relations", entity: "e8-2", perspective: "e1-1"}));
    expect((await readingState(page.context(), server)).position).toEqual({chapter: 38, paragraph: 57});
    await page.context().close();

    const other = await browser.newContext();
    await login(other, server);
    const next = await other.newPage();
    await next.goto(`${server.base}/book/fox`);
    await expect(next.getByTestId("page-relations")).toBeVisible();
    await expect(next).toHaveURL(/\/book\/fox\/relations\?at=38\.57&perspective=e1-1&entity=e8-2/u);
    await expect(next.getByTestId("card-name")).toHaveText("南嘉鱼");

    await next.goto(`${server.base}/book/fox/roster?at=7`);
    await expect(next.getByTestId("page-roster")).toBeVisible();
    await expect(next.getByTestId("reading-label")).toContainText("第 7 章");
    await other.close();
});

/** 用“在图里找”把镜头移到一个点上：命中的点被移到画布中央。 */
/** 等画布稳定：相隔 300ms 的两次轮询截图相同（WebGL 动画中连着两帧也可能一样，间隔太短会误判）。 */
async function settle(page: Page): Promise<void> {
    const graph = page.getByTestId("relation-graph");
    let previous: Buffer | null = null;
    await expect.poll(async () => {
        const current = await graph.screenshot();
        const same = previous !== null && current.equals(previous);
        previous = current;
        return same;
    }, {intervals: [300]}).toBe(true);
}

/** 用“在图里找”把镜头移到一个点上：命中的点被移到画布中央。 */
async function centerOn(page: Page, name: string): Promise<{x: number; y: number}> {
    const graph = page.getByTestId("relation-graph");
    await settle(page);
    const before = await graph.screenshot();
    await page.getByPlaceholder("在图里找").fill(name);
    await expect.poll(async () => !(await graph.screenshot()).equals(before)).toBe(true);
    await settle(page);
    const box = (await graph.boundingBox())!;
    return {x: box.x + box.width / 2, y: box.y + box.height / 2};
}

test("关系图（验收 3）：拖动一个点不打开人物卡；点一下打开；打开认知层后图照常", async ({page}) => {
    await open(page, "/book/fox/relations?at=38&perspective=reader");
    await expect(page.getByTestId("relation-graph").locator("canvas").first()).toBeVisible();
    const center = await centerOn(page, "花铃");
    await page.mouse.move(center.x, center.y);
    await page.mouse.down();
    await page.mouse.move(center.x + 60, center.y + 40, {steps: 8});
    await page.mouse.up();
    await expect(page.getByTestId("entity-card")).toHaveCount(0);
    // 松手后马上再点会被 Sigma 当成双击（放大镜头）：等画布稳定（超过双击间隔）再点。
    await settle(page);
    await page.mouse.click(center.x + 60, center.y + 40);
    await expect(page.getByTestId("card-name")).toHaveText("花铃");
    await page.locator('[data-layer="know"]').click();
    await expect(page.locator('[data-layer="know"]')).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("page-error")).toHaveCount(0);
});

test("收起抽屉后重画（验收 4）：画布铺满主区", async ({page}) => {
    await open(page, "/book/fox/relations?at=38&entity=e1-1&tab=relations");
    await expect(page.getByTestId("entity-card")).toBeVisible();
    const graph = page.getByTestId("relation-graph");
    const before = (await graph.boundingBox())!.width;
    await page.getByTestId("entity-card").getByRole("button", {name: "关闭"}).click();
    await expect(page.getByTestId("entity-card")).toHaveCount(0);
    await expect.poll(async () => (await graph.boundingBox())!.width).toBeGreaterThan(before + 200);
    const width = (await graph.boundingBox())!.width;
    await expect.poll(async () => (await graph.locator("canvas").first().boundingBox())!.width).toBeCloseTo(width, 0);
});

test("视角（验收 5）：苏天晴视角下南嘉鱼与地狱猫不合并；读者视角下猫娘魔法少女与南嘉鱼可能是同一人", async ({page}) => {
    await open(page, "/book/fox/relations?at=38&perspective=e1-1");
    await expect(page.getByTestId("perspective-banner")).toContainText("地狱猫与南嘉鱼");
    await open(page, "/book/fox/relations?at=38&perspective=reader");
    await expect(page.getByTestId("perspective-banner")).toHaveCount(0);
    // 猫娘魔法少女是主要人物：点它打开人物卡的关系页签，身份连接写在列表里。
    const center = await centerOn(page, "猫娘魔法少女");
    await page.mouse.click(center.x, center.y);
    await expect(page.getByTestId("card-relations").getByTestId("identity")).toContainText("可能是同一人");
});

test("长列表（验收 6）：第 100 章苏天晴的记录 1 秒内出首屏，筛选与搜索 1 秒内更新，滚到底取到全部", async ({page}) => {
    await open(page, "/book/fox/overview?at=100");
    const started = Date.now();
    await page.goto(`${server.base}/book/fox/roster?at=100&entity=e1-1&tab=records`);
    await expect(page.getByTestId("record").first()).toBeVisible();
    // 计时含整页导航与外壳的取数，比 Spec 的“从打开记录页签起”更严。
    expect(Date.now() - started).toBeLessThan(1000);

    let t = Date.now();
    await page.getByRole("radio", {name: "不知道"}).click();
    await expect(page.getByTestId("record").first()).toContainText("不知道");
    expect(Date.now() - t).toBeLessThan(1000);

    t = Date.now();
    await page.getByTestId("entity-card").getByPlaceholder("按字搜").fill("南嘉鱼");
    await expect(page.getByTestId("record").first()).toContainText("南嘉鱼");
    expect(Date.now() - t).toBeLessThan(1000);

    await page.getByRole("radio", {name: "全部"}).click();
    await page.getByTestId("entity-card").getByPlaceholder("按字搜").fill("");
    const total = Number((await page.getByRole("radio", {name: /他知道的/u}).innerText()).match(/\d+/u)![0]);
    const list = page.getByTestId("entity-card").locator(".story-scroll-y");
    await expect.poll(async () => {
        await list.evaluate(element => element.scrollTo(0, element.scrollHeight));
        return page.getByTestId("record").count();
    }, {timeout: 30_000}).toBe(total);
});

test("宽度（验收 7）：宽屏与平板下各页无横向溢出；手机宽度能显示", async ({page}) => {
    const pages = ["overview", "relations", "book-graph", "roster", "secrets", "ledger", "questions", "timeline", "episodes", "source", "stats"];
    for (const width of [1440, 900]) {
        await page.setViewportSize({width, height: 900});
        for (const name of pages) {
            await open(page, `/book/fox/${name}?at=38&entity=e1-1`);
            await expect(page.getByTestId(`page-${name}`)).toBeVisible();
            await page.waitForLoadState("networkidle");
            const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
            expect(overflow, `${name} @${width}`).toBeLessThanOrEqual(0);
        }
    }
    await page.setViewportSize({width: 390, height: 844});
    for (const name of pages) {
        await open(page, `/book/fox/${name}?at=38`);
        await expect(page.getByTestId(`page-${name}`)).toBeVisible();
    }
});

test("记录标记与段落概要（验收 8）", async ({page}) => {
    await open(page, "/book/fox/roster?at=38&entity=e1-1&tab=records");
    await page.getByRole("radio", {name: /关于他的/u}).click();
    await expect(page.getByTestId("entity-card")).toContainText("角色的说法");
    await open(page, "/book/fox/source?at=38.57");
    await page.getByTestId("toggle-beats").click();
    await expect(page.getByTestId("beat").first()).toBeVisible();
    await expect(page.locator('[data-testid="beat"][data-from="48"]')).toHaveCount(0);
    await expect(page.getByTestId("read-line")).toBeVisible();
});

test("时序：旧位置的请求晚到也不显示到新位置；地址里还不存在的对象被去掉并提示；抽屉跨宽度档内容不变", async ({page}) => {
    await open(page, "/book/fox/stats?at=30");
    await expect(page.getByTestId("visible-stats")).toBeVisible();
    // 第 7 章的统计请求压住 1.5 秒，期间拨到第 8 章：最后显示的必须是第 8 章的数字。
    await page.route("**/api/rpc/book.stats", async route => {
        const body = route.request().postDataJSON() as {at?: {chapter: number}};
        if (body.at?.chapter === 7) await new Promise(resolve => setTimeout(resolve, 1500)); // test-lint-allow fixed-wait: 人为延后一个真实请求的返回
        await route.continue();
    });
    const expected8 = await (await page.context().request.post(`${server.base}/api/rpc/book.stats`, {data: {book: "fox", at: {chapter: 8}}})).json() as {visible: {statements: number}};
    await page.goto(`${server.base}/book/fox/stats?at=7`);
    await expect(page.getByTestId("reading-label")).toContainText("第 7 章");
    await page.getByRole("button", {name: "下一章"}).click();
    await expect(page.getByTestId("reading-label")).toContainText("第 8 章");
    await expect(page.getByTestId("visible-stats")).toContainText(String(expected8.visible.statements));
    await page.waitForTimeout(2000); // test-lint-allow fixed-wait: 等压住的旧请求返回，再确认它没有覆盖新位置
    await expect(page.getByTestId("visible-stats")).toContainText(String(expected8.visible.statements));
    await page.unroute("**/api/rpc/book.stats");

    await open(page, "/book/fox/roster?at=7&entity=e33-1");
    await expect(page.getByTestId("notice")).toContainText("还没出现");
    await expect(page.getByTestId("entity-card")).toHaveCount(0);

    await page.setViewportSize({width: 1440, height: 900});
    await open(page, "/book/fox/roster?at=38&entity=e12-5");
    await expect(page.getByTestId("card-name")).toHaveText("花铃");
    await page.setViewportSize({width: 900, height: 900});
    await expect(page.getByTestId("drawer-scrim")).toBeVisible();
    await expect(page.getByTestId("card-name")).toHaveText("花铃");
});

test("页面隐藏时立即保存：变化后马上关掉页面，重新读到最新位置", async ({page}) => {
    await open(page, "/book/fox/overview?at=20");
    await expect.poll(async () => (await readingState(page.context(), server)).position).toEqual({chapter: 20});
    await page.getByRole("button", {name: "下一章"}).click();
    await expect(page.getByTestId("reading-label")).toContainText("第 21 章");
    await page.close({runBeforeUnload: true});
    await expect.poll(async () => (await readingState(page.context(), server)).position).toEqual({chapter: 21});
});

test("命令行给出的查看器地址打开到同一人物卡与阅读位置（cli-skill 验收 3）", async ({page}) => {
    const run = await runCli(["card", "苏天晴", "--at", "38", "--library", server.library]);
    const url = /查看器：(\S+)$/u.exec(run.stdout.trim())![1]!;
    expect(url).not.toContain("token");
    await page.goto(url);
    await expect(page.getByTestId("card-name")).toHaveText("苏天晴");
    await expect(page.getByTestId("reading-label")).toContainText("第 38 章");
});
