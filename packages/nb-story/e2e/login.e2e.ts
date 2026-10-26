/**
 * 登录与会话（docs/specs/story/queries.md 验收 11、F12；docs/specs/story/viewer.md F1）：真实的 `nbstory serve` 与本机 Chrome。
 */

import {expect, test} from "@playwright/test";

import {makeLibrary, startServe} from "./fixtures";

test("新的浏览器配置用登录链接能取页面；第二个浏览器用同一链接也能登录；服务重启后旧会话失效", async ({browser}) => {
    const library = await makeLibrary("login");
    let server = await startServe(library.library);
    try {
        const anonymous = await browser.newContext();
        const plain = await anonymous.newPage();
        const response = await plain.goto(`${server.base}/book/fox/overview`);
        expect(response?.status()).toBe(401);
        await expect(plain.locator("body")).toContainText("登录已失效");
        await anonymous.close();

        const first = await browser.newContext();
        const page = await first.newPage();
        await page.goto(server.login);
        await expect(page.getByTestId("book-frame")).toBeVisible();
        const second = await browser.newContext();
        const other = await second.newPage();
        await other.goto(server.login);
        await expect(other.getByTestId("book-frame")).toBeVisible();
        await second.close();

        expect(await server.stop()).toBe(0);
        server = await startServe(library.library);
        // 旧会话的 Cookie 名带端口：重启后端口不同，换成同一个 Cookie 发到新端口再核对一次 RPC。
        const cookies = await first.cookies();
        const stale = await first.request.post(`${server.base}/api/rpc/books.list`, {data: {}, headers: {cookie: cookies.map(item => `${item.name}=${item.value}`).join("; ")}});
        expect(stale.status()).toBe(401);
        await page.goto(`${server.base}/book/fox/overview`);
        await expect(page.locator("body")).toContainText("登录已失效");
        await page.goto(server.login);
        await expect(page.getByTestId("book-frame")).toBeVisible();
        await first.close();
    } finally {
        await server.stop();
        await library.cleanup();
    }
});
