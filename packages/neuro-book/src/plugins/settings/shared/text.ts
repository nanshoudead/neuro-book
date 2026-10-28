/**
 * `nbook.settings` 的文字引用构造函数（docs/specs/ui/i18n.md 的“目录与键”）。放在 `shared/` 是因为配置项、分区与命令这类
 * 写在声明里的文字，服务端、项目与浏览器三个位置都要登记，`shared/contracts.ts` 也要用；目录本身只在浏览器的构建里
 * （`web/text.ts`），这里只取它的类型核对键，不引入目录内容。设置窗口与设置页的排版组件在 `nbook/ui/settings/`，那里不能引
 * 本目录（共享前端组件只引 `ui/` 与 `shared/`），用 `nbook/ui/settings/text.ts` 里的同命名空间引用。
 */

import {pluginText} from "nbook/shared/plugin-text";
import type {CatalogKey} from "nbook/shared/plugin-text";

import type zhCN from "../locales/zh-CN.json";

/** 本插件命名空间（插件 id `nbook.settings`，由 `locales.test.ts` 核对）下的文字引用；键按源语言目录核对，写错编译不过。 */
export const settingsText = pluginText<typeof zhCN>("nbook.settings");

/** 源语言目录里的键（复数形归到不带后缀的键）。 */
export type SettingsTextKey = CatalogKey<typeof zhCN>;
