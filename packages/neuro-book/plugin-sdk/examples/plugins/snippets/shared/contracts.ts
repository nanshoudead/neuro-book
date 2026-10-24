/**
 * `example.snippets` 对外公开的合同：一个配置项与它所在的设置分区的 id。
 *
 * 配置项定义写在这里（而不是写在 `web/` 里），因为三处要用同一份常量：插件描述（`../plugin.ts`）把它的 `contribution`
 * 交给宿主登记，页面读写它，别的插件要读片段时也从这里引用（所有已声明的项都可读，只有声明者能写，
 * docs/specs/settings/configuration.md 输出第 11 条）。
 */

import {Type} from "typebox";
import type {Static} from "typebox";

import {definePlugin} from "@notnotype/nb-plugin-sdk";
import {setting} from "@notnotype/nb-plugin-sdk/settings";

/** 插件的身份（读法见 `../../clock/shared/contracts.ts`）。snippets 只在浏览器窗口里有入口：它不存数据，配置项的读写全交给 `nbook.settings`。 */
export const plugin = definePlugin({id: "example.snippets", version: "0.1.0", locations: ["browser"]});

/** page 分区的短名：浏览器入口用它贡献分区（`settingsPage`），配置项用它拼出分区 id 写进 `section`。 */
export const SNIPPETS_PAGE = "main";

/** 设置窗口里的分区 id：插件 id 加 `.` 加短名（docs/specs/settings/settings-window.md“分区声明”）。 */
export const SNIPPETS_SECTION = `${plugin.id}.${SNIPPETS_PAGE}` as const;

export const SnippetSchema = Type.Object({
    name: Type.String({minLength: 1, maxLength: 40}),
    text: Type.String({maxLength: 2000}),
}, {additionalProperties: false});

export type Snippet = Static<typeof SnippetSchema>;

/**
 * 片段列表。为什么设置窗口的通用列表画不了它、要贡献 page 分区：值是对象的数组，通用列表只会画开关、选项、数字与单行
 * 文字，别的类型只读显示“只能在设置文件里改”（settings-window.md 输出 9）。要让用户在界面上增删改，就由插件自己画
 * 这一页。
 *
 * - `layers` 不写，缺省两层都允许：片段不执行程序、不指网络地址，项目层文件来自别人的仓库也无妨（configuration.md
 *   “声明”的作者规则）。每部作品可以有自己的一份。
 * - `section` 指向自己贡献的 page 分区：通用列表不画指向 page 分区的项，由页面负责（settings-window.md 输出 2）。
 * - 层与层之间整体覆盖、不合并（configuration.md 输出 6）：本作品写了列表，用户设置里的片段在这部作品里就整个看不到。
 *   页面因此按“这一层整份列表”来编辑。
 */
export const itemsSetting = setting(plugin, {
    name: "items",
    schema: Type.Array(SnippetSchema, {maxItems: 100}),
    default: [
        {name: "开场白", text: "那天的雾很大，港口的汽笛响了三声。"},
        {name: "场景转换", text: "——"},
        {name: "章末钩子", text: "他还不知道，这封信会改变一切。"},
    ],
    title: {"zh-CN": "片段", "en-US": "Snippets"},
    description: {"zh-CN": "本作品里可以另备一份，整份替换用户设置里的片段", "en-US": "A book can keep its own list, which replaces yours entirely"},
    section: SNIPPETS_SECTION,
});
