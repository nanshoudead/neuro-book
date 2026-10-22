/**
 * 宿主交给对话视图的两样东西：界面语言与渲染组件（Markdown 显示、提示词编辑器、已发送文字的静态显示）。
 * `AgentConversationView` 收到属性后 provide 给子组件；零件单独挂载时（Lab、宿主自己拼装）用 `provideAgentView`。
 *
 * 没有提供方时语言是中文、渲染组件用包内的缺省实现：零件在任何地方都能挂上，只是 Markdown 按纯文字显示、输入框
 * 退化为普通文本框（docs/specs/ui/agent-conversation-view.md“失败与恢复”）。值用 getter 传，宿主切换语言或换组件时
 * 子组件跟着变。
 */

import type {Component, ComputedRef, InjectionKey} from "vue";
import {computed, inject, provide} from "vue";

import {agentText, textOf} from "../messages";
import type {AgentTextKey} from "../messages";
import type {AgentLocale, ViewText} from "../types";
import PlainMarkdown from "./fallback/PlainMarkdown.vue";
import PlainPromptEditor from "./fallback/PlainPromptEditor.vue";
import PlainPromptTextView from "./fallback/PlainPromptTextView.vue";

/** 宿主注入的渲染组件；形状见核心的 `ports.ts`。缺哪个用包内的缺省实现。 */
export type AgentViewRenderers = {
    markdown?: Component;
    promptEditor?: Component;
    promptTextView?: Component;
};

type AgentViewHost = {
    locale: () => AgentLocale;
    renderers: () => AgentViewRenderers;
};

const hostKey: InjectionKey<AgentViewHost> = Symbol("nb-agent-ui/host");

const FALLBACK_HOST: AgentViewHost = {locale: () => "zh-CN", renderers: () => ({})};

export function provideAgentView(options: {locale: () => AgentLocale; renderers?: () => AgentViewRenderers}): void {
    provide(hostKey, {locale: options.locale, renderers: options.renderers ?? (() => ({}))});
}

export type AgentTextApi = {
    locale: ComputedRef<AgentLocale>;
    /** 本包文字表里的一条。 */
    t: (key: AgentTextKey, params?: Readonly<Record<string, string | number>>) => string;
    /** 注册表、纯逻辑层或宿主给的文字。 */
    text: (value: ViewText) => string;
};

export function useAgentText(): AgentTextApi {
    const host = inject(hostKey, FALLBACK_HOST);
    const locale = computed(() => host.locale());
    return {
        locale,
        t: (key, params) => agentText(locale.value, key, params),
        text: (value) => textOf(value, locale.value),
    };
}

export type ResolvedRenderers = {
    markdown: Component;
    promptEditor: Component;
    promptTextView: Component;
    /** 用的是缺省的普通文本框：没有标签、附件与粘贴块，输入框据此隐藏“添加附件”、不列 `/` 命令菜单。 */
    plainEditor: boolean;
};

export function useAgentRenderers(): ComputedRef<ResolvedRenderers> {
    const host = inject(hostKey, FALLBACK_HOST);
    return computed(() => {
        const given = host.renderers();
        return {
            markdown: given.markdown ?? PlainMarkdown,
            promptEditor: given.promptEditor ?? PlainPromptEditor,
            promptTextView: given.promptTextView ?? PlainPromptTextView,
            plainEditor: given.promptEditor === undefined,
        };
    });
}
