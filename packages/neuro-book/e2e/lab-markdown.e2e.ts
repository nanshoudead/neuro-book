/**
 * `nbook.markdown` 交出的组件在真实浏览器里的验收，用真实的 `bun run dev` 里的 Lab 场景：
 * - Markdown 展示器（docs/specs/ui/markdown-display.md 验收场景 1、2）：组件测试（`MarkdownDisplay.dom.test.ts`）证明更新只替换
 *   变了的块；这里证明真实的帧调度下流式能播完，以及长对话改宽度时排版只算看得见的消息。
 * - Composer 的编辑组件（docs/specs/ui/prompt-editor.md 输出 2、4、5、6、7、10）：组件测试里按键与输入是合成的，这里用真实键盘
 *   打字、回车、方向键与退格，粘贴用 Lab 的“模拟”按钮（剪贴板事件）。
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
    // 提示块自己还在追加时内容在变，按输出 6 会被替换；等它后面的一块出现、它不再变了，再记下它的元素。
    await expect(display).toContainText("改写示例", {timeout: 20_000});
    await display.locator(".nb-callout").evaluate((element) => {
        (window as unknown as {__callout: Element}).__callout = element;
    });
    await expect(display.locator(".nb-markdown-display__cursor")).toHaveCount(0, {timeout: 30_000});
    await expect(display).toContainText("写作手册");
    expect(await display.locator(".nb-callout").evaluate((element) => element === (window as unknown as {__callout: Element}).__callout && element.getAttribute("data-callout-folded") === "true")).toBe(true);
});

test("输出 2：普通 Markdown 的粗体、斜体、删除线、四级标题与分割线有各自的样子（应用的全局样式重置清掉了浏览器自带的）", async ({page}) => {
    await page.goto(`${dev.pageUrl}lab?c=MarkdownDisplay&s=plain&vp=1200x900`);
    await expect.poll(() => labState(page)).toMatchObject({ready: true, scene: "plain"});
    const display = page.locator("[data-lab-stage] [data-markdown-display]");
    const style = (selector: string) => display.locator(selector).first().evaluate((element) => {
        const computed = getComputedStyle(element);
        const body = getComputedStyle(element.closest("[data-markdown-display]") ?? element);
        return {weight: Number(computed.fontWeight), bodyWeight: Number(body.fontWeight), style: computed.fontStyle, line: computed.textDecorationLine, border: computed.borderTopWidth};
    });
    const strong = await style("strong");
    expect(strong.weight).toBeGreaterThan(strong.bodyWeight);
    expect((await style("em")).style).toBe("italic");
    expect((await style("del, s")).line).toContain("line-through");
    const heading = await style("h4");
    expect(heading.weight).toBeGreaterThan(heading.bodyWeight);
    expect((await style("hr")).border).not.toBe("0px");
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

const prose = (page: Page) => page.locator("[data-lab-stage] .ProseMirror");
/** 组件交出的文字（与 `change` 的值同一个来源：编辑器的 `getText`）。 */
const promptText = (page: Page) => prose(page).evaluate((element) => (element as HTMLElement & {editor: {getText(options: {blockSeparator: string}): string}}).editor.getText({blockSeparator: "\n"}));

async function openPrompt(page: Page, scene: string): Promise<void> {
    await page.goto(`${dev.pageUrl}lab?c=PromptEditor&s=${scene}&vp=1200x900`);
    await expect.poll(() => labState(page)).toMatchObject({ready: true, scene});
    await expect(prose(page)).toBeVisible();
}

test("PromptEditor 真实按键：手打的技能写完才变小块，退格删整枚；回车发送后正文清空，上方向键调出刚发的一条", async ({page}) => {
    await openPrompt(page, "empty");
    await prose(page).click();
    await page.keyboard.type("$review");
    await expect(prose(page).locator("[data-inline-chip='skill']")).toHaveCount(0);
    await page.keyboard.type("er ");
    await expect(prose(page).locator("[data-inline-chip='skill']")).toHaveCount(1);
    await page.keyboard.press("Escape");
    await page.keyboard.press("Backspace");
    await page.keyboard.press("Backspace");
    await expect(prose(page).locator("[data-inline-chip='skill']")).toHaveCount(0);
    expect(await promptText(page)).toBe("");
    await page.keyboard.type("$writer 看第三章");
    await page.keyboard.press("Enter");
    await expect.poll(() => promptText(page)).toBe("");
    await page.keyboard.press("ArrowUp");
    await expect.poll(() => promptText(page)).toBe("$writer 看第三章");
    await expect(prose(page).locator("[data-inline-chip='skill']")).toHaveCount(1);
});

test("PromptEditor `@` 菜单：打 ` @第一` 出候选，回车确认得到以 `/` 开头的作品根地址，显示为引用小块", async ({page}) => {
    await openPrompt(page, "empty");
    await prose(page).click();
    await page.keyboard.type("看 @第一");
    const option = page.locator("[data-lab-stage] [role='option']", {hasText: "第一章 雨夜"});
    await expect(option).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(option).toHaveCount(0);
    expect(await promptText(page)).toBe("看 [第一章 雨夜](/正文/第一章.md) ");
    await expect(prose(page).locator("[data-inline-chip='reference']")).toContainText("第一章 雨夜");
});

test("PromptEditor 粘贴分档：30 行成为粘贴块，150 行转为文件附件、上传完成后写回附件的写法", async ({page}) => {
    await openPrompt(page, "empty");
    await page.locator("[data-lab-action='paste-medium']").click();
    await expect(page.locator("[data-lab-stage] [data-prompt-paste]")).toHaveCount(1);
    expect(await promptText(page)).toMatch(/^<paste id="1">\nline 001: clock\.tick\(0\);[\s\S]*\n<\/paste>\n$/u);
    await page.locator("[data-lab-action='paste-large']").click();
    await expect(page.locator("[data-lab-stage] [data-prompt-card-state='ready']")).toHaveCount(1, {timeout: 10_000});
    await expect.poll(() => promptText(page)).toContain("[file #2 · paste-2.txt](local://paste-2.txt)");
});
