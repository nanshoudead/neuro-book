/**
 * 问答页的翻译端口（docs/specs/ui/i18n.md）：nb-story 没有宿主的翻译引擎，界面只用中文，所以用 nb-ui 的最小实现、登记问答页
 * 用到的共享包的目录（nb-ui、nb-agent-ui、nb-markdown），语言固定 zh-CN，由 `QaPage.vue` 注入。
 *
 * 不能不注入：上面没有端口时，对话视图（nb-agent-ui）按自己的 `locale` 建包内的缺省端口给子树，那里只有 nb-ui 与 nb-agent-ui
 * 的目录；对话视图里的 nb-markdown 组件（输入框、已发送文字、回答的 Markdown）读到它，只会显示键名。
 */

import {NB_AGENT_UI_CATALOGS, NB_AGENT_UI_NAMESPACE} from "@notnotype/nb-agent-ui/locales";
import {NB_MARKDOWN_CATALOGS, NB_MARKDOWN_NAMESPACE} from "@notnotype/nb-markdown/locales";
import {NB_UI_CATALOGS, NB_UI_NAMESPACE} from "@notnotype/nb-ui/locales";
import {createMinimalTranslator} from "@notnotype/nb-ui/text/minimal";
import type {TextPort} from "@notnotype/nb-ui/text-port";
import {readonly, ref} from "vue";

export function storyTextPort(): TextPort {
    const translator = createMinimalTranslator({catalogs: {[NB_UI_NAMESPACE]: NB_UI_CATALOGS, [NB_AGENT_UI_NAMESPACE]: NB_AGENT_UI_CATALOGS, [NB_MARKDOWN_NAMESPACE]: NB_MARKDOWN_CATALOGS}});
    const locale = readonly(ref("zh-CN"));
    return {locale, t: (text) => translator.translate(text, locale.value), variants: (text) => translator.variants(text)};
}
