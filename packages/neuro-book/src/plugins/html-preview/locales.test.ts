/**
 * `nbook.html-preview` 的消息目录（docs/specs/ui/i18n.md 的“目录与键”）。
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
import {htmlPreviewCatalogs, htmlPreviewText} from "./web/text";

const LEGACY: Readonly<Record<string, {readonly "zh-CN": string; readonly "en-US": string}>> = {
    "editors.html.title": {"zh-CN": "HTML 预览", "en-US": "HTML Preview"},
    "categories.preview": {"zh-CN": "HTML 预览", "en-US": "HTML Preview"},
    "commands.nbook.editor.toggle-preview-network.title": {"zh-CN": "预览：允许联网", "en-US": "Preview: Allow Network Access"},
    "state.active.reason": {"zh-CN": "活动的不是 HTML 预览", "en-US": "The active editor is not an HTML preview"},
    "titleItems.network": {"zh-CN": "允许联网", "en-US": "Allow Network Access"},
    "failures.notProject": {"zh-CN": "只能预览作品里的文件。", "en-US": "Only files in the work can be previewed."},
    "failures.no-project": {"zh-CN": "这个窗口没有打开作品，预览读不到文件。", "en-US": "No work is open in this window, so the preview cannot read files."},
    "failures.closed": {"zh-CN": "作品已经关闭，预览读不到它的文件。", "en-US": "The work is closed, so the preview cannot read its files."},
    "failures.unreachable": {"zh-CN": "暂时连不上服务端，预览打不开。", "en-US": "Cannot reach the server, so the preview cannot be opened."},
    "retry": {"zh-CN": "重试", "en-US": "Retry"},
};

const CATALOGS = {"zh-CN": zhCN, "en-US": enUS} as const;

describe("nbook.html-preview 的目录", () => {
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
        expect(htmlPreviewText("retry").ns).toBe(descriptor.id);
        expect(htmlPreviewCatalogs.source).toBe("zh-CN");
    });
});
