/**
 * SDK 的公开面闭包（docs/specs/runtime/plugin-api.md 的“边界与兼容”）：从三个入口出发，按运行时的导入（含动态导入与 `.vue`
 * 文件里的导入）走到的应用源文件，也就是 SDK 包里随构建期实现一起分发的那些。导出的名字由 `sdk.test.ts` 与 `plugin-sdk/pack.test.ts`
 * 钉住；这里钉住名字背后连带分发的实现，新文件进入闭包时这里失败，评审时看一眼它是不是有意公开的，不是的话改成从叶子模块取。
 * 导入按语法树读（`src/testing/source-imports.ts`），与 `architecture.test.ts` 同一份。
 */

import {describe, expect, it} from "bun:test";
import {readFileSync, statSync} from "node:fs";
import {dirname, join, normalize, relative} from "node:path";

import {sourceImports} from "nbook/testing/source-imports";

const SRC = join(import.meta.dir, "..");

/** 应用源码里的导入目标；包名与 node 内置返回 null。 */
function resolveInSrc(specifier: string, from: string): string | null {
    const base = specifier.startsWith("nbook/") ? join(SRC, specifier.slice("nbook/".length)) : specifier.startsWith(".") ? normalize(join(dirname(from), specifier)) : null;
    if (base === null) return null;
    const found = [base, `${base}.ts`, `${base}.vue`, join(base, "index.ts")].find((candidate) => statSync(candidate, {throwIfNoEntry: false})?.isFile() === true);
    if (found !== undefined) return found;
    throw new Error(`${relative(SRC, from)} 导入的 ${specifier} 找不到`);
}

function closure(entries: ReadonlyArray<string>): string[] {
    const seen = new Set<string>();
    const stack = [...entries];
    while (stack.length > 0) {
        const file = stack.pop()!;
        if (seen.has(file)) continue;
        seen.add(file);
        // 运行时的导入：`import type`、`export type` 不带出实现，不算。
        for (const use of sourceImports(file, readFileSync(file, "utf8"))) {
            if (use.typeOnly) continue;
            const target = resolveInSrc(use.specifier, file);
            if (target !== null) stack.push(target);
        }
    }
    return [...seen].map((file) => relative(SRC, file)).filter((file) => !file.startsWith("sdk/")).sort();
}

describe("SDK 的公开面闭包", () => {
    it("三个入口连带公开的应用源文件", () => {
        // 命令插件的快捷键与菜单经它的合同模块再导出（别的插件按规则只能从合同模块取），所以跟着命令点进来。
        expect(closure(["index.ts", "browser.ts", "components.ts"].map((file) => join(SRC, "sdk", file)))).toEqual([
            "plugins/commands/shared/contracts.ts",
            "plugins/commands/shared/keybinding.ts",
            "plugins/commands/shared/menus.ts",
            "plugins/settings/shared/contracts.ts",
            "plugins/settings/shared/sections.ts",
            "plugins/settings/web/page-contribution.ts",
            "plugins/state/shared/contracts.ts",
            "plugins/storage/shared/contracts.ts",
            "plugins/workbench/shared/items.ts",
            "plugins/workbench/shared/views.ts",
            "plugins/workbench/web/view-contribution.ts",
            "shared/host.ts",
            "shared/localized-text.ts",
            "shared/settings.ts",
            "shared/storage.ts",
            "shared/store/persisted.ts",
            "shared/store/public.ts",
            "shared/store/store.ts",
            "ui/bound-component.ts",
            "ui/settings/HighlightedText.vue",
            "ui/settings/SettingsPageActions.vue",
            "ui/settings/SettingsPageList.vue",
            "ui/settings/SettingsRow.vue",
            "ui/settings/SettingsSaveBar.vue",
            "ui/settings/highlight.ts",
            "ui/settings/page-chrome.ts",
            "ui/settings/row-state.ts",
            "ui/settings/setting-text.ts",
            "ui/settings/settings-page.ts",
        ]);
    });
});
