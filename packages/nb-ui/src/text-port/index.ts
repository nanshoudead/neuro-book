/**
 * 翻译端口（docs/specs/ui/i18n.md）：组件经 `useText()` 取得，把文字值翻成当前语言。
 *
 * 宿主在每个 Vue 根上注入自己的端口（i18next 引擎）；没有宿主时（nb-story 查看器、开发者面板、nb-ui 自己的测试、
 * 单独挂载的树）得到 nb-ui 的缺省端口：语言固定 `zh-CN`，目录是 nb-ui 自带的，翻译用最小实现（输出 8）。
 */

import {inject, readonly, ref} from "vue";
import type {InjectionKey, Ref} from "vue";

import {NB_UI_CATALOGS, uiRef} from "../locales";
import type {NbUiTextKey} from "../locales";
import type {Text, TextParams} from "../text";
import {createMinimalTranslator} from "../text/minimal";

export interface TextPort {
    readonly locale: Readonly<Ref<string>>;
    t(text: Text): string;
    /** 同一段文字在各语言的写法，给命令面板、设置搜索比对用（输出 10）。 */
    variants(text: Text): readonly string[];
}

/**
 * 用 `Symbol.for` 而不是 `Symbol()`：第三方插件经宿主模块表共用 nb-ui，正常只有一份；但开发构建或打包配置出错时
 * 可能出现两份 nb-ui 模块，按名字取的符号仍是同一个，插件组件照样拿得到宿主的端口。
 */
export const TEXT_PORT_KEY: InjectionKey<TextPort> = Symbol.for("nb-ui.text-port") as InjectionKey<TextPort>;

let fallbackPort: TextPort | undefined;

/** nb-ui 的缺省端口：按需建一次，所有没有宿主的组件共用。 */
export function defaultTextPort(): TextPort {
    if (fallbackPort === undefined) {
        const translator = createMinimalTranslator({catalogs: {"nb-ui": NB_UI_CATALOGS}});
        const locale = readonly(ref("zh-CN"));
        fallbackPort = {locale, t: (text) => translator.translate(text, locale.value), variants: (text) => translator.variants(text)};
    }
    return fallbackPort;
}

/** 组件取翻译端口；在 `setup` 里调用。读注入的组件要在同名 `.md` 里声明 `state:inject`。 */
export function useText(): TextPort {
    return inject(TEXT_PORT_KEY, defaultTextPort, true);
}

/**
 * 组件取自己目录（命名空间 `nb-ui`）里的文字；在 `setup` 里调用，同样要在同名 `.md` 里声明 `state:inject`。
 * 返回的函数每次调用都读端口的当前语言，所以放进 `computed` 或模板里，换语言后会更新。
 */
export function useUiText(): (key: NbUiTextKey, params?: TextParams) => string {
    const port = useText();
    return (key, params) => port.t(uiRef(key, params));
}
