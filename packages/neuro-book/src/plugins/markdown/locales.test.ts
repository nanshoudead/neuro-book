/**
 * `nbook.markdown` 的消息目录（docs/specs/ui/i18n.md 的“目录与键”）。
 *
 * 防止迁移改错文字：`LEGACY` 是迁移前（提交 8cbf36165）代码里的双语字面量（`web/host.ts` 的 `NBOOK_IMAGE_MISSING`），按迁移后的
 * 键原样抄下，占位符还是旧的 `{name}` 写法。目录里的每个键都要在表里、表里的每个键都要在目录里，值换成 `{{name}}` 后逐字
 * 相同。以后有意改文字时，同一次改动里同步改这张表。
 */

import {describe, expect, it} from "bun:test";

import {flattenCatalog} from "@notnotype/nb-ui/text";

import {descriptor} from "./plugin";
import enUS from "./locales/en-US.json";
import zhCN from "./locales/zh-CN.json";
import {markdownCatalogs, markdownText} from "./web/text";

const LEGACY: Readonly<Record<string, {readonly "zh-CN": string; readonly "en-US": string}>> = {
    "image.missing": {"zh-CN": "{name}（不在作品里，不显示）", "en-US": "{name} (not in the work, not shown)"},
};

const CATALOGS = {"zh-CN": zhCN, "en-US": enUS} as const;

describe("nbook.markdown 的目录", () => {
    it("每个键的文字与迁移前的字面量逐字相同（占位符从 {name} 换成 {{name}}），两边的键一一对应", () => {
        for (const [locale, catalog] of Object.entries(CATALOGS)) {
            const flat = flattenCatalog(catalog);
            expect({locale, keys: Object.keys(flat).sort()}).toEqual({locale, keys: Object.keys(LEGACY).sort()});
            for (const [key, value] of Object.entries(flat)) {
                const legacy = LEGACY[key]![locale as keyof typeof CATALOGS].replace(/\{(\w+)\}/gu, "{{$1}}");
                expect({locale, key, value}).toEqual({locale, key, value: legacy});
            }
        }
    });

    it("文字引用的命名空间是插件 id，目录以中文为源语言", () => {
        expect(markdownText("image.missing").ns).toBe(descriptor.id);
        expect(markdownCatalogs.source).toBe("zh-CN");
    });
});
