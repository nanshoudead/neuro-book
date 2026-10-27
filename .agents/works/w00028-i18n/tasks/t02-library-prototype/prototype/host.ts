/**
 * 原型：宿主侧的 i18next 装配。每个插件用自己的 id 当命名空间，激活时 `registerPlugin`、停用时 `unregisterPlugin`。
 * 不进产品代码，只回答 w00028 t02 的问题。
 */

import i18next, {type i18n} from "i18next";

/** 一个插件带的目录：语言 -> 该插件的消息。 */
export type PluginCatalogs = Readonly<Record<string, Record<string, unknown>>>;

export async function createHostI18n(options: {readonly language: string; readonly fallback?: readonly string[]; readonly separators?: boolean}): Promise<i18n> {
    const instance = i18next.createInstance();
    await instance.init({
        lng: options.language,
        // 回退链：用户语言 -> 同语种（i18next 自动处理 zh-TW -> zh）-> 这里列的语言
        fallbackLng: options.fallback ? [...options.fallback] : ["zh-CN"],
        // 资源全部由插件运行期登记，init 时是空的
        resources: {},
        // 不设默认命名空间：每个键都必须写 `<ns>:`，防止插件之间靠“默认命名空间”撞键
        defaultNS: false,
        // 界面是 Vue 模板渲染，Vue 自己转义；i18next 再转义会把 `&` 变成 `&amp;`
        interpolation: {escapeValue: false},
        // 缺键时返回键本身（默认行为）；原型里额外记下来，便于测试观察
        ...(options.separators === false ? {nsSeparator: "::", keySeparator: false as const} : {}),
    });
    return instance;
}

export function registerPlugin(instance: i18n, pluginId: string, catalogs: PluginCatalogs): void {
    for (const [language, messages] of Object.entries(catalogs)) {
        // addResourceBundle 即使 deep=false 也是浅合并（`{...旧, ...新}`），旧键会残留；
        // 重复激活（热重载）要整体替换，所以先 remove 再 add
        instance.removeResourceBundle(language, pluginId);
        instance.addResourceBundle(language, pluginId, messages);
    }
}

export function unregisterPlugin(instance: i18n, pluginId: string, languages: readonly string[]): void {
    for (const language of languages) instance.removeResourceBundle(language, pluginId);
}
