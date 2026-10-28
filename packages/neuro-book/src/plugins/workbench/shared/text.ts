/**
 * `nbook.workbench` 的文字引用构造函数（docs/specs/ui/i18n.md 的“目录与键”）。放在 `shared/` 是因为配置项、标题栏菜单的组、
 * 命令的选项这类写在声明里的文字，服务端、项目与浏览器三个位置都要登记；目录本身只在浏览器的构建里（`web/text.ts`），这里只取它的
 * 类型核对键，不引入目录内容。命名空间写成字面量而不取 `descriptor.id`：`plugin.ts` 引用 `shared/contracts.ts`，`contracts.ts`
 * 又要用本文件，取 `descriptor` 会成环、初始化时拿到 undefined；一致性由 `locales.test.ts` 核对。
 */

import {pluginText} from "nbook/shared/plugin-text";
import type {CatalogKey} from "nbook/shared/plugin-text";

import type zhCN from "../locales/zh-CN.json";

/** 本插件命名空间（插件 id `nbook.workbench`）下的文字引用；键按源语言目录核对，写错编译不过。 */
export const workbenchText = pluginText<typeof zhCN>("nbook.workbench");

/** 源语言目录里的键（复数形归到不带后缀的键）。 */
export type WorkbenchTextKey = CatalogKey<typeof zhCN>;
