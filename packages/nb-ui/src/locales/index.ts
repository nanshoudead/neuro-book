/**
 * nb-ui 自带的目录（docs/specs/ui/i18n.md）。写成 `.ts` 模块而不是 JSON：消费方（nb-story、开发者面板等）没开
 * `resolveJsonModule`，从包源码导入 JSON 会让它们的类型检查失败。宿主在引导时按包名 `nb-ui` 登记这份目录。
 */

import type {Catalog} from "../text";
import enUS from "./en-US";
import zhCN from "./zh-CN";

export const NB_UI_NAMESPACE = "nb-ui";

export const NB_UI_CATALOGS: Readonly<Record<string, Catalog>> = {"zh-CN": zhCN, "en-US": enUS};
