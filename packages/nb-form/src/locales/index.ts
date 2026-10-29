/**
 * nb-form 自带的目录（docs/specs/ui/i18n.md）。写成 `.ts` 模块而不是 JSON：消费方（nb-story 等）没开
 * `resolveJsonModule`，从包源码导入 JSON 会让它们的类型检查失败。
 *
 * 注入翻译端口的宿主在引导时按命名空间 `nb-form`、源语言 `zh-CN` 登记这份目录；没有宿主注入时，本包的 Vue 层用它与
 * nb-ui 的目录建缺省端口（`src/vue/text.ts`）。
 */

import type {Catalog} from "@notnotype/nb-ui/text";

import enUS from "./en-US";
import zhCN from "./zh-CN";

export const NB_FORM_NAMESPACE = "nb-form";

/** 源语言；宿主登记目录时用。 */
export const NB_FORM_SOURCE_LOCALE = "zh-CN";

export const NB_FORM_CATALOGS: Readonly<Record<string, Catalog>> = {"zh-CN": zhCN, "en-US": enUS};
