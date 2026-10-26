/**
 * 查看器的真实浏览器验收（`bun run test:e2e`，docs/specs/story/viewer.md 的验收与 Smoke）：本机 Chrome
 * （`channel: "chrome"`），不下载 Playwright 自带的浏览器。Playwright 由 Node 运行（Bun 下启动浏览器时 CDP 握手会超时）。
 * 被测的 `nbstory serve` 由各用例自己启动与停止。
 */

import {tmpdir} from "node:os";
import {join} from "node:path";

import {defineConfig} from "@playwright/test";

export default defineConfig({
    testDir: ".",
    testMatch: "*.e2e.ts",
    workers: 1,
    retries: 0,
    timeout: 90_000,
    expect: {timeout: 15_000},
    reporter: [["list"]],
    outputDir: join(tmpdir(), "neuro-book", "playwright", "nb-story"),
    use: {channel: "chrome", headless: true, trace: "retain-on-failure", screenshot: "only-on-failure", viewport: {width: 1440, height: 900}, launchOptions: {ignoreDefaultArgs: ["--hide-scrollbars"]}},
});
