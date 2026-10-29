/**
 * `nbook.image-viewer` 的消息目录（docs/specs/ui/i18n.md 的“目录与键”）。
 *
 * 防止迁移改错文字：`LEGACY` 是迁移前（提交 f880309da）代码里的双语字面量，按迁移后的键原样抄下，占位符还是旧的
 * `{name}` 写法。目录里的每个键都要在表里、表里的每个键都要在目录里，值换成 `{{name}}` 后逐字相同。以后有意改文字时，
 * 同一次改动里同步改这张表。
 */

import {describe, expect, it} from "bun:test";

import {flattenCatalog} from "@notnotype/nb-ui/text";

import {descriptor} from "./plugin";
import enUS from "./locales/en-US.json";
import zhCN from "./locales/zh-CN.json";
import {imageViewerCatalogs, imageViewerText} from "./web/text";

const LEGACY: Readonly<Record<string, {readonly "zh-CN": string; readonly "en-US": string}>> = {
    "editors.image.title": {"zh-CN": "图片查看器", "en-US": "Image Viewer"},
    "loading": {"zh-CN": "正在读取…", "en-US": "Reading…"},
    "retry": {"zh-CN": "重试", "en-US": "Retry"},
    "failures.not-found": {"zh-CN": "{name} 不在了。", "en-US": "{name} no longer exists."},
    "failures.generation-gone": {"zh-CN": "作品已经关闭，读不到 {name}。", "en-US": "The work is closed; {name} cannot be read."},
    "failures.too-large": {"zh-CN": "{name} 太大，不能在这里显示。", "en-US": "{name} is too large to show here."},
    "failures.undecodable": {"zh-CN": "无法显示这个图片：{name}。", "en-US": "This image cannot be shown: {name}."},
    "failures.no-project": {"zh-CN": "只能显示作品里的文件。", "en-US": "Only files in the work can be shown."},
    "failures.failed": {"zh-CN": "读不到 {name}（{reason}）。", "en-US": "Cannot read {name} ({reason})."},
};

const CATALOGS = {"zh-CN": zhCN, "en-US": enUS} as const;

describe("nbook.image-viewer 的目录", () => {
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

    it("取文字函数的命名空间是插件 id，目录以中文为源语言", () => {
        expect(imageViewerText("retry").ns).toBe(descriptor.id);
        expect(imageViewerCatalogs.source).toBe("zh-CN");
    });
});
