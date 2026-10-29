/**
 * 窗口的翻译引擎（docs/specs/ui/i18n.md、docs/specs/runtime/browser-host.md）：宿主在每个浏览器窗口建一个，作为窗口能力交给插件。
 *
 * 当前语言由宿主驱动：设置插件激活前是本地记录的上次界面语言，激活后由设置插件按它的 `locale` 推过来（`setLocale`）。插件
 * 读 `port.locale`，不各自去读设置，所以一个窗口只有一个语言来源。只在浏览器里用：服务端不翻译 `TextRef`。
 */

import type {ServiceAccess} from "@notnotype/nb-runtime/services";
import {computed} from "vue";
import type {ComputedRef} from "vue";

import {createMinimalTranslator} from "@notnotype/nb-ui/text/minimal";
import type {TextPort} from "@notnotype/nb-ui/text-port";

import {windowTextKey} from "nbook/shared/window-text-key";

export {windowTextKey} from "nbook/shared/window-text-key";
export type {WindowText} from "nbook/shared/window-text-key";

/**
 * 插件取界面语言的唯一写法：窗口有翻译引擎时读它的端口（设置插件把 `locale` 设置推给它，加载设置快照之前也有本地记录的
 * 上次语言）；没有引擎的测试场地退回设置本身。依赖要声明成 `{key: windowTextKey, required: false}`。
 */
export async function windowLocale(services: Pick<ServiceAccess, "resolve">, fallback: () => string): Promise<ComputedRef<string>> {
    const text = await services.resolve(windowTextKey);
    return text.status === "resolved" ? computed(() => text.instance.port.locale.value) : computed(fallback);
}

/**
 * 插件取翻译端口的写法：有窗口引擎就是它的端口，没有（只装插件的测试场地）时按设置里的语言解析语言映射与字符串，
 * `TextRef` 显示键名。依赖要声明成 `{key: windowTextKey, required: false}`。
 */
export async function windowTextPort(services: Pick<ServiceAccess, "resolve">, fallback: () => string): Promise<TextPort> {
    const text = await services.resolve(windowTextKey);
    if (text.status === "resolved") return text.instance.port;
    const locale = computed(fallback);
    const translator = createMinimalTranslator({catalogs: {}});
    return {locale, t: (value) => translator.translate(value, locale.value), variants: translator.variants};
}
