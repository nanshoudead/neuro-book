/**
 * `nbook.editor` 的文字引用构造函数（docs/specs/ui/i18n.md 的“目录与键”）。放在 `shared/` 是因为设置声明、公开状态的原因这类
 * 写在声明里的文字，服务端、项目与浏览器三个位置都要登记；目录本身只在浏览器的构建里（`web/text.ts`），这里只取它的类型核对
 * 键，不引入目录内容。
 */

import {pluginText} from "nbook/shared/plugin-text";
import type {CatalogKey} from "nbook/shared/plugin-text";

import type zhCN from "../locales/zh-CN.json";

/** 本插件命名空间（插件 id `nbook.editor`，由 `locales.test.ts` 核对）下的文字引用；键按源语言目录核对，写错编译不过。 */
/** 命名空间 = 插件 id；写字面量是因为取 `descriptor` 会成环（见上）。浏览器端的 `useXxxText` 也用它，不另写一份。 */
export const EDITOR_TEXT_NAMESPACE = "nbook.editor";
export const editorText = pluginText<typeof zhCN>(EDITOR_TEXT_NAMESPACE);

/** 源语言目录里的键（复数形归到不带后缀的键）。 */
export type EditorTextKey = CatalogKey<typeof zhCN>;
