/**
 * 组件取文字（docs/specs/ui/i18n.md）：读宿主注入的翻译端口，本包目录的键绑定命名空间 `nb-markdown`、按源语言目录核对。
 *
 * 端口从哪来，按先后：
 * 1. 宿主注入的端口（nb-ui 的 `TEXT_PORT_KEY`）。宿主要登记本包目录（`@notnotype/nb-markdown/locales`），语言以它为准，
 *    根组件的 `locale` 属性不起作用。
 * 2. 没有注入时，根组件（`MarkdownDisplay`、`PromptEditor`、`PromptTextView`）按自己的 `locale`（缺省 zh-CN）建 nb-ui 的
 *    缺省端口并 provide：子组件与嵌套的 nb-ui 控件拿到同一个。
 * 3. 零件脱离根组件单独挂载、上面也没有注入时，用 nb-ui 的缺省端口，语言 zh-CN。
 *
 * 缺省端口的目录是所有已导入共享包登记的（nb-ui 的 `registerDefaultCatalog`）：本模块导入时登记本包目录。所以本包的组件嵌在
 * 别的共享包的根组件下面（对话视图里的展示器与输入框）、上面没有宿主时，读到外层建的缺省端口也翻得出本包的键。登记放在这里、
 * 不放进 `../locales`：那里是给编辑器装饰等普通 DOM 取键引用的纯数据模块，宿主也从那里取目录，不该有登记这一副作用。
 *
 * 编辑器的节点视图与展示器的静态视图是普通 DOM，用 Vue 的 `render()` 挂组件，挂上的组件没有父组件、inject 只看它的
 * `appContext`。所以建视图的组件在 `setup` 里用 `markdownViewContext` 取一个带着端口的上下文交给视图：挂组件时设到 vnode
 * 上，普通 DOM 的文字（小块的悬停提示、HTML 卡片的按钮）用 `markdownTextIn` 从它取端口。
 */

import {getCurrentInstance} from "vue";
import type {AppContext, Ref} from "vue";

import {isTextRef} from "@notnotype/nb-ui/text";
import type {TextParams} from "@notnotype/nb-ui/text";
import {defaultTextPort, provideDefaultText, registerDefaultCatalog, TEXT_PORT_KEY, useText} from "@notnotype/nb-ui/text-port";
import type {TextPort} from "@notnotype/nb-ui/text-port";

import {fillBraces} from "../locale";
import type {MarkdownLocale, MarkdownText} from "../locale";
import {markdownRef, NB_MARKDOWN_CATALOGS, NB_MARKDOWN_NAMESPACE, NB_MARKDOWN_SOURCE_LOCALE} from "../locales";
import type {MarkdownTextKey} from "../locales";

registerDefaultCatalog(NB_MARKDOWN_NAMESPACE, NB_MARKDOWN_CATALOGS, NB_MARKDOWN_SOURCE_LOCALE);

export interface MarkdownTextApi {
    /** 当前语言。 */
    readonly locale: Readonly<Ref<MarkdownLocale>>;
    /** 取文字用的端口；`markdownViewContext` 把它带进普通 DOM 上挂的组件。 */
    readonly port: TextPort;
    /** 本包目录里的一条。 */
    t(key: MarkdownTextKey, params?: TextParams): string;
    /**
     * 宿主给的文字（例如 `imageMissing`）。`params` 是组件补的参数：`TextRef` 合进它的参数由端口代入；字符串与语言映射
     * 照旧按单花括号 `{name}` 代入。
     */
    text(value: MarkdownText, params?: Readonly<Record<string, string | number>>): string;
}

function textApi(port: TextPort): MarkdownTextApi {
    return {
        locale: port.locale,
        port,
        t: (key, params) => port.t(markdownRef(key, params)),
        text(value, params) {
            if (isTextRef(value)) return port.t(params === undefined ? value : {...value, params: {...value.params, ...params}});
            return fillBraces(port.t(value), params ?? {});
        },
    };
}

/**
 * 根组件在 `setup` 里调用：有注入的端口就用它；没有时按 `locale` 建缺省端口并 provide 给子树（nb-ui 的 `provideDefaultText`）。
 * 返回提供方自己用的文字函数（Vue 的 `inject` 只看祖先，提供方自己调用 `useMarkdownText` 拿不到它 provide 的端口）。
 */
export function provideMarkdownText(locale: () => MarkdownLocale | undefined): MarkdownTextApi {
    return textApi(provideDefaultText(locale));
}

/** 组件在 `setup` 里调用。读注入的组件要在同名 `.md` 里声明 `state:inject`。 */
export function useMarkdownText(): MarkdownTextApi {
    return textApi(useText());
}

/**
 * 给普通 DOM 上用 `render()` 挂的组件的上下文：当前组件所在应用的上下文，`provides` 里加上 `text` 的端口。在建视图的组件的
 * `setup` 里调用；`text` 缺省是 `useMarkdownText()`，根组件传 `provideMarkdownText` 的返回值。
 *
 * 只带端口，不带组件这一级的其它 provide：挂上的组件（`MarkdownImage`）只读端口，别的经属性给；组件实例上的 `provides`
 * 不是 Vue 的公开接口。
 */
export function markdownViewContext(text: MarkdownTextApi = useMarkdownText()): AppContext {
    const instance = getCurrentInstance();
    if (instance === null) throw new Error("markdownViewContext must be called inside a component's setup");
    const app = instance.appContext;
    // 原型链接上应用级的 provide（Vue 自己也是这样逐级遮盖的），不复制。
    const provides = Object.create(app.provides) as Record<string | symbol, unknown>;
    provides[TEXT_PORT_KEY as symbol] = text.port;
    return {...app, provides};
}

/** 普通 DOM 的文字：取 `markdownViewContext` 带着的端口；没有上下文时用 nb-ui 的缺省端口（zh-CN）。 */
export function markdownTextIn(context: AppContext | null | undefined): MarkdownTextApi {
    const port = context?.provides[TEXT_PORT_KEY as symbol] as TextPort | undefined;
    return textApi(port ?? defaultTextPort());
}
