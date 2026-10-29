/**
 * `nbook.projects` 的消息目录（docs/specs/ui/i18n.md 的“目录与键”）。目录随前端构建：`web/plugins.ts` 的
 * `builtinPluginCatalogs` 登记它，窗口挂载界面前登记进翻译引擎，命名空间是插件 id。服务端不翻译文字引用，所以只有浏览器入口
 * 用这里；带类型的取文字函数在 `shared/text.ts`。
 */

import type {PluginCatalogs} from "nbook/shared/convention-keys";
import {PROJECTS_TEXT_NAMESPACE} from "../shared/text";
import {usePluginText} from "nbook/shared/use-plugin-text";

import enUS from "../locales/en-US.json";
import zhCN from "../locales/zh-CN.json";

export const projectsCatalogs: PluginCatalogs = {source: "zh-CN", catalogs: {"zh-CN": zhCN, "en-US": enUS}};

/** 组件里取文字：`const text = useProjectsText();`，之后用 `text(键, 参数)`。命名空间与 `shared/text.ts` 的同名函数一致。 */
export const useProjectsText = (): ReturnType<typeof usePluginText<typeof zhCN>> => usePluginText<typeof zhCN>(PROJECTS_TEXT_NAMESPACE);
