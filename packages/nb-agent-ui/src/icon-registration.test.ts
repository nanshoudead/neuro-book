/**
 * 图标名有效性兜底，规则同 nb-ui 的 `src/icon-registration.test.ts`：@iconify/tailwind4 预生成模式下，写错或已被
 * lucide 改名的图标类不报错、只静默渲染成空白；运行时拼接的类名宿主的 @source 扫描不到。本包的图标也写在内置登记的
 * `.ts` 里，所以 `.vue` 与 `.ts` 都扫。
 */

import {describe, expect, it} from "bun:test";
import {readdirSync, readFileSync} from "node:fs";
import {createRequire} from "node:module";
import {join} from "node:path";

type LucideIconSet = {
    icons: Record<string, unknown>;
    aliases?: Record<string, unknown>;
};

function sources(directory: string): string[] {
    return readdirSync(directory, {withFileTypes: true}).flatMap((entry) => {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) return sources(path);
        return /\.(?:ts|vue)$/u.test(entry.name) && !entry.name.endsWith(".test.ts") ? [path] : [];
    });
}

describe("图标名", () => {
    it("源码里的 i-lucide-* 都在 @iconify-json/lucide 里", () => {
        const require = createRequire(import.meta.url);
        const iconSet = JSON.parse(readFileSync(require.resolve("@iconify-json/lucide/icons.json"), "utf8")) as LucideIconSet;
        const used = new Set(sources(import.meta.dir).flatMap((file) => [...readFileSync(file, "utf8").matchAll(/i-lucide-([a-z0-9-]+)/gu)].map((match) => match[1]!)));
        const unresolved = [...used].filter((name) => !Object.hasOwn(iconSet.icons, name) && !Object.hasOwn(iconSet.aliases ?? {}, name));
        expect(unresolved).toEqual([]);
    });

    it("图标类名不在运行时拼接", () => {
        const dynamic = sources(import.meta.dir).filter((file) => /`i-lucide-\$\{|["']i-lucide-["']\s*\+/u.test(readFileSync(file, "utf8")));
        expect(dynamic).toEqual([]);
    });
});
