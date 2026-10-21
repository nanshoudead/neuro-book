import type {OptionSource} from "@notnotype/nb-form";
import type {FormOptionSources} from "@notnotype/nb-form/vue";
import type {Component, MaybeRefOrGetter, Ref} from "vue";

import type {SettingLayer} from "nbook/shared/settings";

/**
 * `nbook.settings` 的浏览器合同里依赖 Vue 的部分：page 分区（贡献点 `settings.pages`）的实现与页面上下文、选项提供者
 * （贡献点 `settings.choices`）的实现（docs/specs/settings/settings-window.md）。贡献点 id 与分区声明在 `shared/contracts.ts`，别的插件在运行时引用那里，
 * 这里的类型用 `import type`；包页面用的 `settingsPage` 在 `nbook/ui/settings/settings-page`。
 */

/** page 分区的实现：设置窗口第一次显示这个分区时才调用 `load()`，每次加载经当前的交付句柄取。 */
export interface SettingsPageImplementation {
    load(): Promise<Component>;
}

/**
 * 选项提供者的实现：设置窗口第一次要这个提供者的选项时调用一次 `source()`（同一次交付只调一次），之后读它给的响应式值。
 * 提供者自己的数据要取（例如向服务商要模型列表）时，自己报 `loading` 与 `unavailable`。
 */
export interface SettingsChoicesImplementation {
    source(): MaybeRefOrGetter<OptionSource<string>>;
}

/** page 分区的组件经只读的 `context` 属性收到它。 */
export interface SettingsPageContext {
    readonly id: string;
    /** 当前标签：“用户”或“本作品”；切换标签时变化，页面只编辑这一层。 */
    readonly layer: Readonly<Ref<SettingLayer>>;
    /** 窗口绑定的作品的书名；没有绑定作品时为 null。 */
    readonly projectTitle: Readonly<Ref<string | null>>;
    /** 全部选项提供者的选项源，按提供者 id；直接交给页面里 `SchemaField`、`SchemaForm` 的 `options`。 */
    readonly options: FormOptionSources;
}
