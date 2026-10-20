import type {Locator, Page} from "@playwright/test";
import {test, expect} from "./fixtures";

/**
 * 弹出列表的一行（w00029 t04）：行高、字号、同心圆角与高亮在真实布局与真实指针下量。nbook 主题下外框 10px、内边距 4px，
 * 项的圆角推出 5px（Task README 决定 3、4）。高亮只认 `data-highlighted`：普通按钮项（右键菜单、手工级联）由 MenuNodes
 * 跟着焦点挂，指针移动会把焦点带过去，所以任何时候最多一项亮着（决定 1）。
 */

async function gotoMenus(page: Page): Promise<void> {
    await page.goto("/acceptance/popup-lists?scene=menus&theme=nbook&colorway=nbook-light");
    await expect(page.locator("#nb-lab-target")).toBeVisible();
}

async function expectRowGeometry(item: Locator): Promise<void> {
    const box = (await item.boundingBox())!;
    const label = (await item.textContent())?.trim();
    expect(box.height, `${label} 的行高`).toBeCloseTo(28, 0);
    await expect(item, `${label} 的字号`).toHaveCSS("font-size", "13px");
    await expect(item, `${label} 的圆角`).toHaveCSS("border-radius", "5px");
}

async function highlightedLabels(page: Page): Promise<string[]> {
    return page.locator("[data-highlighted]").evaluateAll((items) => items.map((item) => item.textContent?.trim() ?? ""));
}

const background = (item: Locator): Promise<string> => item.evaluate((element) => getComputedStyle(element).backgroundColor);

/** 浮层入场时有一段缩放动画（scale 0.96 → 1），量尺寸前等它播完。 */
async function settled(surface: Locator): Promise<void> {
    await expect(surface).toBeVisible();
    await surface.evaluate((element) => Promise.all(element.getAnimations({subtree: true}).map((animation) => animation.finished)));
}

test("下拉菜单：外框 10px、内边距 4px，项高 28px、字 13px、圆角 5px；勾选项的勾与快捷键同时显示", async ({page}) => {
    await gotoMenus(page);
    await page.locator("[data-fixture-dropdown-trigger]").click();
    const menu = page.locator("[data-fixture-dropdown]");
    await settled(menu);
    await expect(menu).toHaveCSS("border-radius", "10px");
    await expect(menu).toHaveCSS("padding-top", "4px");

    const items = menu.locator("[role^='menuitem']");
    await expect(items).toHaveCount(4);
    for (const item of await items.all()) await expectRowGeometry(item);

    const checked = menu.getByRole("menuitemcheckbox", {name: /自动换行/});
    await expect(checked.locator(".i-lucide-check")).toHaveCount(1);
    await expect(checked.locator("[data-menu-shortcut]")).toHaveText("Alt+Z");
    // 同一面板里没勾的项也留出勾选列，名称才对得齐。
    const nameLeft = async (name: RegExp): Promise<number> => (await menu.getByRole("menuitem", {name}).or(menu.getByRole("menuitemcheckbox", {name})).locator(".nb-ui-menu-item__label").boundingBox())!.x;
    expect(await nameLeft(/排序方式/)).toBeCloseTo(await nameLeft(/自动换行/), 0);

    // 手工级联面板在 reka 的菜单内容之外：指针移进去把焦点带过去，菜单不能当成焦点移出而关掉。
    await menu.getByRole("menuitem", {name: /排序方式/}).hover();
    const byName = page.getByRole("menuitemradio", {name: /按名称/});
    await settled(page.locator(".nb-menu-level"));
    await byName.hover();
    expect(await highlightedLabels(page)).toEqual(["按名称"]);
    await expect(menu).toBeVisible();
    await expectRowGeometry(byName);
});

test("右键菜单：悬停与方向键都只亮一项；危险项高亮也是中性叠色；子菜单里移动时展开它的父项保持高亮", async ({page}) => {
    await gotoMenus(page);
    await page.locator("[data-fixture-context-area]").click({button: "right"});
    const panel = page.locator("[data-menu-panel]");
    await settled(panel);
    for (const item of await panel.locator(":scope > .nb-menu-level-content > [role^='menuitem']").all()) await expectRowGeometry(item);

    const create = panel.getByRole("menuitem", {name: /新建/});
    const remove = panel.getByRole("menuitem", {name: /删除/});
    await create.hover();
    expect(await highlightedLabels(page)).toEqual(["新建Ctrl+N"]);
    const neutral = await background(create);
    expect(neutral, "高亮有底色").not.toBe("rgba(0, 0, 0, 0)");

    await page.keyboard.press("ArrowDown");
    expect(await highlightedLabels(page)).toEqual(["更多"]);

    await remove.hover();
    expect(await highlightedLabels(page)).toEqual(["删除"]);
    expect(await background(remove), "危险项高亮与其它项同一底色").toBe(neutral);

    const more = panel.getByRole("menuitem", {name: /更多/});
    await more.hover();
    const sub = page.locator("[data-menu-level='0']");
    await expect(sub).toBeVisible();
    await sub.getByRole("menuitem", {name: "子一"}).hover();
    expect(await highlightedLabels(page)).toEqual(["子一"]);
    await expect(more).toHaveAttribute("aria-expanded", "true");
    expect(await background(more), "展开了子菜单的父项保持高亮").toBe(neutral);
});

test("菜单栏：手工级联里的普通按钮项在悬停时高亮", async ({page}) => {
    await gotoMenus(page);
    await page.locator("[data-fixture-menubar]").getByRole("menuitem", {name: "文件"}).click();
    const exportItem = page.getByRole("menuitem", {name: /导出/});
    await exportItem.hover();
    const markdown = page.getByRole("menuitem", {name: "Markdown"});
    await settled(page.locator(".nb-menu-level"));
    await markdown.hover();
    expect(await highlightedLabels(page)).toEqual(["Markdown"]);
    await expectRowGeometry(markdown);
});

test("Select：单行项 28px、带说明的项由内容撑高；选中只画左侧的勾，底色不变", async ({page}) => {
    await page.goto("/acceptance/popup-lists?scene=select&theme=nbook&colorway=nbook-light");
    await page.locator("[data-fixture-select]").click();
    const listbox = page.getByRole("listbox");
    await settled(listbox);

    const markdown = page.getByRole("option", {name: /Markdown/});
    const text = page.getByRole("option", {name: /纯文本/});
    await expectRowGeometry(markdown);
    const textBox = (await text.boundingBox())!;
    expect(textBox.height, "带说明的项比一档行高高").toBeGreaterThan(28);
    await expect(text).toHaveCSS("border-radius", "5px");

    await expect(text.locator(".i-lucide-check")).toHaveCount(1);
    await expect(markdown.locator(".i-lucide-check")).toHaveCount(0);
    // reka 打开时把焦点与高亮放在选中项上；把指针移到别的项，选中项就只剩勾。
    await markdown.hover();
    expect(await highlightedLabels(page)).toEqual(["Markdown"]);
    expect(await background(text), "选中项不另画底色").toBe("rgba(0, 0, 0, 0)");
    await expect(text, "选中项不加粗").toHaveCSS("font-weight", "400");
});

test("QuickPick：项 28px、带说明的项由内容撑高；高亮跟着指针移动，只亮一项", async ({page}) => {
    await page.goto("/acceptance/popup-lists?scene=quick-pick&theme=nbook&colorway=nbook-light");
    const panel = page.locator("[data-fixture-quick-pick]");
    await settled(panel);
    await expect(panel).toHaveCSS("border-radius", "10px");

    const open = page.getByRole("option", {name: /打开项目/});
    const chapter = page.getByRole("option", {name: /新建章节/});
    const settings = page.getByRole("option", {name: /设置/});
    await expectRowGeometry(open);
    await expectRowGeometry(settings);
    expect((await chapter.boundingBox())!.height, "带说明的项比一档行高高").toBeGreaterThan(28);
    expect(await highlightedLabels(page)).toEqual(["打开项目Ctrl+O"]);

    await settings.hover();
    expect(await highlightedLabels(page)).toEqual(["设置"]);
    await expect(page.getByRole("combobox"), "指针移动不夺走输入框的焦点").toBeFocused();
});
