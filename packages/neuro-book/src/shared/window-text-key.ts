/**
 * 窗口翻译引擎的服务键与接口（docs/specs/ui/i18n.md）：单放一个模块，不引 Vue，两端共用的插件（例如 `nbook.commands`）把它声明成
 * 可选依赖时，服务端不必加载 Vue。取端口与界面语言的写法在 `window-text.ts`。
 */

import {defineServiceKey} from "@notnotype/nb-runtime/services";
import type {ServiceKey} from "@notnotype/nb-runtime/services";

import type {Catalog} from "@notnotype/nb-ui/text";
import type {TextPort} from "@notnotype/nb-ui/text-port";

export interface WindowText {
    readonly port: TextPort;
    /**
     * 切换当前语言；不在宿主语言集合里的标签被忽略。`remember` 为 true 表示值来自用户设置（不是缺省值），宿主把它记成
     * 下次启动用的本地记录。
     */
    setLocale(tag: string, options?: {readonly remember?: boolean}): void;
    /** 登记一个命名空间的目录；同一命名空间再登记时先整个注销旧的（不做浅合并）。`source` 是它的源语言。 */
    register(ns: string, catalogs: Readonly<Record<string, Catalog>>, source: string): void;
    unregister(ns: string): void;
}

export const windowTextKey: ServiceKey<WindowText> = defineServiceKey<WindowText>("nbook/window-text");
