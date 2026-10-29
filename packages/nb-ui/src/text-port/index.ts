/**
 * 翻译端口（docs/specs/ui/i18n.md）：组件经 `useText()` 取得，把文字值翻成当前语言。
 *
 * 宿主在每个 Vue 根上注入自己的端口（i18next 引擎）；没有宿主时（nb-story 查看器、开发者面板、nb-ui 自己的测试、
 * 单独挂载的树）得到缺省端口：目录是所有已导入的共享包登记的（`registerDefaultCatalog`），翻译用最小实现（输出 8）。
 *
 * 缺省端口的目录不按包分开：共享包互相嵌套（对话视图里放 Markdown 展示器、表单里放 Markdown 编辑器）而上面没有宿主时，
 * 外层包建的缺省端口会遮住内层包自己的，各包只含自己目录的端口会让内层的键显示成键名。
 */

import {computed, inject, provide, readonly, ref} from "vue";
import type {InjectionKey, Ref} from "vue";

import {NB_UI_CATALOGS, NB_UI_NAMESPACE, uiRef} from "../locales";
import type {NbUiTextKey} from "../locales";
import {isLocaleTag} from "../text";
import type {Catalog, Text, TextParams} from "../text";
import {createMinimalTranslator} from "../text/minimal";
import type {MinimalTranslator} from "../text/minimal";

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

/** 缺省端口的目录登记表：命名空间 → 各语言的目录与源语言。`version` 每次登记加一，端口据此重建翻译器。 */
interface DefaultCatalogs {
    readonly entries: Map<string, {readonly catalogs: Readonly<Record<string, Catalog>>; readonly source: string}>;
    version: number;
}

/**
 * 登记表挂在 `globalThis` 上、用 `Symbol.for` 取，理由同 `TEXT_PORT_KEY`：出现两份 nb-ui 模块时，各包登记进的仍是同一张表。
 * 表只增不减（同一命名空间再登记就替换），进程里所有没有宿主的组件共用。
 */
const DEFAULT_CATALOGS_KEY = Symbol.for("nb-ui.default-catalogs");

function defaultCatalogs(): DefaultCatalogs {
    const scope = globalThis as unknown as Record<symbol, DefaultCatalogs | undefined>;
    scope[DEFAULT_CATALOGS_KEY] ??= {entries: new Map(), version: 0};
    return scope[DEFAULT_CATALOGS_KEY];
}

/**
 * 共享包把自己的目录登记进缺省端口；在包的 Vue 层模块的顶层调用（导入即登记），源语言缺省 `zh-CN`。宿主的引擎不读这张表：
 * 宿主仍要自己登记共享包的目录。登记在已经画出来的组件之后发生时，那些组件到下次重画才翻得出新目录的键。
 */
export function registerDefaultCatalog(ns: string, catalogs: Readonly<Record<string, Catalog>>, source = "zh-CN"): void {
    const table = defaultCatalogs();
    table.entries.set(ns, {catalogs, source});
    table.version += 1;
}

registerDefaultCatalog(NB_UI_NAMESPACE, NB_UI_CATALOGS);

let built: {readonly version: number; readonly translator: MinimalTranslator} | undefined;

/** 按登记表建的最小实现；表变了才重建。 */
function defaultTranslator(): MinimalTranslator {
    const table = defaultCatalogs();
    if (built?.version !== table.version) {
        const entries = [...table.entries];
        built = {
            version: table.version,
            translator: createMinimalTranslator({catalogs: Object.fromEntries(entries.map(([ns, entry]) => [ns, entry.catalogs])), sources: Object.fromEntries(entries.map(([ns, entry]) => [ns, entry.source]))}),
        };
    }
    return built.translator;
}

function portFor(locale: Readonly<Ref<string>>): TextPort {
    return {locale, t: (text) => defaultTranslator().translate(text, locale.value), variants: (text) => defaultTranslator().variants(text)};
}

/** 缺省端口的语言：合法的标签取规范写法（`en-us` 得 `en-US`），不合法或没给时按 `zh-CN`（输出 8）。 */
function canonicalLocale(tag: string | undefined): string {
    return tag !== undefined && isLocaleTag(tag) ? (Intl.getCanonicalLocales(tag)[0] ?? "zh-CN") : "zh-CN";
}

let fallbackPort: TextPort | undefined;

/** 缺省端口：语言固定 `zh-CN`，按需建一次，所有没有宿主、也不在某个共享包的根组件下面的组件共用。 */
export function defaultTextPort(): TextPort {
    fallbackPort ??= portFor(readonly(ref("zh-CN")));
    return fallbackPort;
}

/** 组件取翻译端口；在 `setup` 里调用。读注入的组件要在同名 `.md` 里声明 `state:inject`。 */
export function useText(): TextPort {
    return inject(TEXT_PORT_KEY, defaultTextPort, true);
}

/**
 * 共享包的根组件在 `setup` 里调用：上面注入了端口就用它，`locale` 不起作用；没有时按 `locale` 建一个缺省端口（含全部已登记
 * 的目录）并 provide 给子树。返回提供方自己用的端口（Vue 的 `inject` 只看祖先，提供方自己调用 `useText` 拿不到它 provide 的）。
 * 调用的组件要在同名 `.md` 里声明 `state:inject`。
 */
export function provideDefaultText(locale: () => string | undefined): TextPort {
    const injected = inject(TEXT_PORT_KEY, null);
    if (injected !== null) return injected;
    const port = portFor(computed(() => canonicalLocale(locale())));
    provide(TEXT_PORT_KEY, port);
    return port;
}

/**
 * 组件取自己目录（命名空间 `nb-ui`）里的文字；在 `setup` 里调用，同样要在同名 `.md` 里声明 `state:inject`。
 * 返回的函数每次调用都读端口的当前语言，所以放进 `computed` 或模板里，换语言后会更新。
 */
export function useUiText(): (key: NbUiTextKey, params?: TextParams) => string {
    const port = useText();
    return (key, params) => port.t(uiRef(key, params));
}
