/**
 * 窗口的翻译引擎（docs/specs/ui/i18n.md、docs/specs/runtime/browser-host.md）：宿主在每个浏览器窗口建一个，作为窗口能力交给插件。
 *
 * 当前语言由宿主驱动：设置插件激活前是本地记录的上次界面语言，激活后由设置插件按它的 `locale` 推过来（`setLocale`）。插件
 * 读 `port.locale`，不各自去读设置，所以一个窗口只有一个语言来源。只在浏览器里用：服务端不翻译 `TextRef`。
 */

import {defineServiceKey} from "@notnotype/nb-runtime/services";
import type {ServiceAccess, ServiceKey} from "@notnotype/nb-runtime/services";
import {computed} from "vue";
import type {ComputedRef} from "vue";

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

/**
 * 插件取界面语言的唯一写法：窗口有翻译引擎时读它的端口（设置插件把 `locale` 设置推给它，加载设置快照之前也有本地记录的
 * 上次语言）；没有引擎的测试场地退回设置本身。依赖要声明成 `{key: windowTextKey, required: false}`。
 */
export async function windowLocale(services: Pick<ServiceAccess, "resolve">, fallback: () => string): Promise<ComputedRef<string>> {
    const text = await services.resolve(windowTextKey);
    return text.status === "resolved" ? computed(() => text.instance.port.locale.value) : computed(fallback);
}
