/**
 * `nbook.markdown` 的消息目录与带类型的文字引用（docs/specs/ui/i18n.md 的“目录与键”）。目录随前端构建：`web/plugins.ts` 的
 * `builtinPluginCatalogs` 登记它，窗口挂载界面前登记进翻译引擎，命名空间是插件 id。目前只有交给 nb-markdown 的宿主文字
 * （`host.ts` 的图片说明），由 nb-markdown 的组件经注入的端口翻译。
 */

import type {PluginCatalogs} from "nbook/shared/convention-keys";
import {pluginText} from "nbook/shared/plugin-text";
import type {CatalogKey} from "nbook/shared/plugin-text";

import enUS from "../locales/en-US.json";
import zhCN from "../locales/zh-CN.json";
import {descriptor} from "../plugin";

export const markdownCatalogs: PluginCatalogs = {source: "zh-CN", catalogs: {"zh-CN": zhCN, "en-US": enUS}};

/** 本插件命名空间下的文字引用；键按源语言目录核对，写错编译不过。 */
export const markdownText = pluginText<typeof zhCN>(descriptor.id);

/** 源语言目录里的键（复数形归到不带后缀的键）。 */
export type MarkdownPluginTextKey = CatalogKey<typeof zhCN>;
