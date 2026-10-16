/**
 * Markdown 展示器在真实浏览器里的验收（docs/specs/ui/markdown-display.md 验收场景 1、2）：真实的 `bun run dev` 里的 Lab
 * 场景。组件测试（`MarkdownDisplay.dom.test.ts`）证明更新只替换变了的块；这里证明真实的帧调度下流式能播完，以及长对话
 * 改宽度时排版只算看得见的消息。
 */

import {rm} from "node:fs/promises";
import {join} from "node:path";

import {expect, test} from "@playwright/test";
import type {Page} from "@playwright/test";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import type {LabDebugState} from "nbook/plugins/lab/shared/debug-api";

import {startDevSession} from "./fixtures";
import type {DevSession} from "./fixtures";

let tmp = "";
let dev: DevSession;

test.beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-e2e", "lab-markdown");
    dev = await startDevSession(join(tmp, "state"));
});

test.afterAll(async () => {
    dev.child.kill("SIGTERM");
    expect(await dev.exit).toBe(0);
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

const labState = (page: Page) => page.evaluate(() => (window as unknown as {__nbLab?: {state(): LabDebugState}}).__nbLab?.state() ?? null);

test("场景 1：流式播到结束，提示块的元素始终是同一个、保持折叠，结束后去掉光标", async ({page}) => {
    await page.goto(`${dev.pageUrl}lab?c=MarkdownDisplay&s=streaming&vp=1200x900`);
    await expect.poll(() => labState(page)).toMatchObject({ready: true, scene: "streaming"});
    const display = page.locator("[data-lab-stage] [data-markdown-display]");
    await expect(display.locator(".nb-callout")).toHaveCount(1, {timeout: 20_000});
    await display.locator(".nb-callout").evaluate((element) => {
        (window as unknown as {__callout: Element}).__callout = element;
    });
    await expect(display.locator(".nb-markdown-display__cursor")).toHaveCount(0, {timeout: 30_000});
    await expect(display).toContainText("写作手册");
    expect(await display.locator(".nb-callout").evaluate((element) => element === (window as unknown as {__callout: Element}).__callout && element.getAttribute("data-callout-folded") === "true")).toBe(true);
});

test("场景 2：100 条消息的长对话，宽度来回改 40 次，每次改完强制布局的耗时中位数在 5 毫秒以内", async ({page}) => {
    await page.goto(`${dev.pageUrl}lab?c=MarkdownDisplay&s=conversation&vp=1200x900`);
    await expect.poll(() => labState(page)).toMatchObject({ready: true, scene: "conversation"});
    await expect.poll(() => page.evaluate(() => [...document.querySelectorAll("[data-lab-stage] [data-markdown-display]")].filter((element) => element.childElementCount > 0).length), {timeout: 30_000}).toBe(100);
    const median = await page.evaluate(() => {
        const list = document.querySelector("[data-lab-stage] [data-markdown-display]")?.parentElement;
        if (list === null || list === undefined) throw new Error("没有找到消息列表");
        const times: number[] = [];
        for (let index = 0; index < 40; index += 1) {
            const start = performance.now();
            list.style.width = index % 2 === 0 ? "520px" : "760px";
            void list.offsetHeight;
            times.push(performance.now() - start);
        }
        return times.sort((a, b) => a - b)[20] as number;
    });
    expect(median).toBeLessThan(5);
});
