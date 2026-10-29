/**
 * 组件取文字（docs/specs/ui/i18n.md、docs/specs/ui/agent-conversation-view.md“边界与兼容”）：读宿主注入的翻译端口，
 * 本包目录的键绑定命名空间 `nb-agent-ui`、按源语言目录核对。
 *
 * 端口从哪来，按先后：
 * 1. 宿主注入的端口（nb-ui 的 `TEXT_PORT_KEY`）。宿主要登记本包目录（`@notnotype/nb-agent-ui/locales`），语言以它为准，
 *    根组件的 `locale` 属性不起作用。
 * 2. 没有注入时，根组件（`AgentConversationView`、`AgentSessionList`、`AgentModelCatalog`，以及调用 `provideAgentView` 的
 *    提供方）按自己的 `locale`（缺省 zh-CN）建 nb-ui 的缺省端口并 provide：子组件、嵌套的 nb-ui 控件与嵌进来的别的共享包
 *    （例如 nb-markdown 的展示器）拿到同一个。
 * 3. 零件脱离根组件单独挂载、上面也没有注入时，用 nb-ui 的缺省端口，语言 zh-CN。
 *
 * 缺省端口的目录是所有已导入共享包登记的（nb-ui 的 `registerDefaultCatalog`）：本模块导入时登记本包目录，用到本包组件就会导入它。
 */

import type {Ref} from "vue";

import type {Text, TextParams} from "@notnotype/nb-ui/text";
import {provideDefaultText, registerDefaultCatalog, useText} from "@notnotype/nb-ui/text-port";
import type {TextPort} from "@notnotype/nb-ui/text-port";

import {NB_AGENT_UI_CATALOGS, NB_AGENT_UI_NAMESPACE, NB_AGENT_UI_SOURCE_LOCALE} from "../locales";
import {agentRef} from "../text";
import type {AgentTextKey} from "../text";
import type {AgentLocale} from "../types";

registerDefaultCatalog(NB_AGENT_UI_NAMESPACE, NB_AGENT_UI_CATALOGS, NB_AGENT_UI_SOURCE_LOCALE);

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
 * 根组件在 `setup` 里调用：有注入的端口就用它；没有时按 `locale` 建缺省端口并 provide 给子树（nb-ui 的 `provideDefaultText`）。
 * 返回提供方自己用的文字函数（Vue 的 `inject` 只看祖先，提供方自己调用 `useAgentText` 拿不到它 provide 的端口）。
 */
export function provideAgentText(locale: () => AgentLocale | undefined): AgentTextApi {
    return textApi(provideDefaultText(locale));
}

/** 组件在 `setup` 里调用。读注入的组件要在同名 `.md` 里声明 `state:inject`。 */
export function useAgentText(): AgentTextApi {
    return textApi(useText());
}
