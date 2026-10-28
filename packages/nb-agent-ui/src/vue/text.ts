/**
 * 组件取文字（docs/specs/ui/i18n.md、docs/specs/ui/agent-conversation-view.md“边界与兼容”）：读宿主注入的翻译端口，
 * 本包目录的键绑定命名空间 `nb-agent-ui`、按源语言目录核对。
 *
 * 端口从哪来，按先后：
 * 1. 宿主注入的端口（nb-ui 的 `TEXT_PORT_KEY`）。宿主要登记本包目录（`@notnotype/nb-agent-ui/locales`），语言以它为准，
 *    根组件的 `locale` 属性不起作用。
 * 2. 没有注入时，根组件（`AgentConversationView`、`AgentSessionList`、`AgentModelCatalog`，以及调用 `provideAgentView` 的
 *    提供方）按自己的 `locale`（缺省 zh-CN）建包内的缺省端口并 provide：子组件与嵌套的 nb-ui 控件拿到同一个。
 * 3. 零件脱离根组件单独挂载、上面也没有注入时，用包内的缺省端口，语言 zh-CN。
 *
 * 不直接用 nb-ui 的 `useText()`：它在没有注入时给 nb-ui 的缺省端口，那里没有本包目录，只会显示键名。也不在“端口取不到
 * 本包的键”时再兜底：端口取不到时返回键名或（测试环境的宿主引擎）抛错，没有可靠的判据。
 */

import {computed, inject, provide, readonly, ref} from "vue";
import type {Ref} from "vue";

import {NB_UI_CATALOGS, NB_UI_NAMESPACE} from "@notnotype/nb-ui/locales";
import type {Text, TextParams} from "@notnotype/nb-ui/text";
import {createMinimalTranslator} from "@notnotype/nb-ui/text/minimal";
import type {MinimalTranslator} from "@notnotype/nb-ui/text/minimal";
import {TEXT_PORT_KEY} from "@notnotype/nb-ui/text-port";
import type {TextPort} from "@notnotype/nb-ui/text-port";

import {NB_AGENT_UI_CATALOGS, NB_AGENT_UI_NAMESPACE} from "../locales";
import {agentRef} from "../text";
import type {AgentTextKey} from "../text";
import type {AgentLocale} from "../types";

let translator: MinimalTranslator | undefined;
let fallbackPort: TextPort | undefined;

/** nb-ui 与本包的目录、最小实现；按需建一次，所有缺省端口共用。 */
function packageTranslator(): MinimalTranslator {
    translator ??= createMinimalTranslator({catalogs: {[NB_UI_NAMESPACE]: NB_UI_CATALOGS, [NB_AGENT_UI_NAMESPACE]: NB_AGENT_UI_CATALOGS}});
    return translator;
}

function packagePort(locale: Readonly<Ref<string>>): TextPort {
    const text = packageTranslator();
    return {locale, t: (value) => text.translate(value, locale.value), variants: (value) => text.variants(value)};
}

function defaultPort(): TextPort {
    fallbackPort ??= packagePort(readonly(ref("zh-CN")));
    return fallbackPort;
}

export type AgentTextApi = {
    /** 当前语言；格式化时间与数字、交给宿主注入的渲染组件时用。 */
    locale: Readonly<Ref<AgentLocale>>;
    /** 本包目录里的一条。 */
    t: (key: AgentTextKey, params?: TextParams) => string;
    /** 注册表、核心或宿主给的文字。 */
    text: (value: Text) => string;
};

function textApi(port: TextPort): AgentTextApi {
    return {locale: port.locale, t: (key, params) => port.t(agentRef(key, params)), text: (value) => port.t(value)};
}

/**
 * 根组件在 `setup` 里调用：有注入的端口就用它；没有时按 `locale` 建包内的缺省端口并 provide 给子树。返回提供方自己用的
 * 文字函数（Vue 的 `inject` 只看祖先，提供方自己调用 `useAgentText` 拿不到它 provide 的端口）。
 */
export function provideAgentText(locale: () => AgentLocale | undefined): AgentTextApi {
    const injected = inject(TEXT_PORT_KEY, null);
    if (injected !== null) return textApi(injected);
    const port = packagePort(computed(() => locale() ?? "zh-CN"));
    provide(TEXT_PORT_KEY, port);
    return textApi(port);
}

/** 组件在 `setup` 里调用。读注入的组件要在同名 `.md` 里声明 `state:inject`。 */
export function useAgentText(): AgentTextApi {
    return textApi(inject(TEXT_PORT_KEY, null) ?? defaultPort());
}
