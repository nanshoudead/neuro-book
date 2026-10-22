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
import {firstLine, markdownPreviewLine} from "../format";
import type {MarkdownPreviewPort} from "../ports";
import PlainMarkdown from "./fallback/PlainMarkdown.vue";
import PlainPromptEditor from "./fallback/PlainPromptEditor.vue";
import PlainPromptTextView from "./fallback/PlainPromptTextView.vue";

/** 宿主注入的渲染组件与 Markdown 预览函数；形状见核心的 `ports.ts`。缺哪个用包内的缺省实现。 */
export type AgentViewRenderers = {
    markdown?: Component;
    promptEditor?: Component;
    promptTextView?: Component;
    markdownPreview?: MarkdownPreviewPort;
};

type AgentViewHost = {
    locale: () => AgentLocale;
    renderers: () => AgentViewRenderers;
};

const hostKey: InjectionKey<AgentViewHost> = Symbol("nb-agent-ui/host");

const FALLBACK_HOST: AgentViewHost = {locale: () => "zh-CN", renderers: () => ({})};

/**
 * 交出语言与渲染组件。返回提供方自己用的文字函数：Vue 的 `inject` 只看祖先提供的值，提供方自己调用 `useAgentText`
 * 拿到的是缺省中文。
 */
export function provideAgentView(options: {locale: () => AgentLocale; renderers?: () => AgentViewRenderers}): AgentTextApi {
    const host: AgentViewHost = {locale: options.locale, renderers: options.renderers ?? (() => ({}))};
    provide(hostKey, host);
    return textApi(host);
}

export type AgentTextApi = {
    locale: ComputedRef<AgentLocale>;
    /** 本包文字表里的一条。 */
    t: (key: AgentTextKey, params?: Readonly<Record<string, string | number>>) => string;
    /** 注册表、纯逻辑层或宿主给的文字。 */
    text: (value: ViewText) => string;
};

export function useAgentText(): AgentTextApi {
    return textApi(inject(hostKey, FALLBACK_HOST));
}

function textApi(host: AgentViewHost): AgentTextApi {
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
    markdownPreview: MarkdownPreviewPort;
    /** 用的是缺省的普通文本框：没有标签、附件与粘贴块，输入框据此隐藏“添加附件”、不列 `/` 命令菜单。 */
    plainEditor: boolean;
};

/** 每个宿主函数只报一次，免得流式中每次重算都刷一条。 */
const failedPreviews = new WeakSet<MarkdownPreviewPort>();

/**
 * 宿主的预览函数与工具渲染器的回调一样包一层（Spec“失败与恢复”）：抛错或给的不是字符串时这一行按包内的缺省写法，
 * 给了多行时只取第一行。
 */
function guardPreview(port: MarkdownPreviewPort): MarkdownPreviewPort {
    return (text) => {
        try {
            const line: unknown = port(text);
            if (typeof line === "string") return firstLine(line);
            throw new TypeError(`返回了 ${typeof line}`);
        } catch (error) {
            if (!failedPreviews.has(port)) {
                failedPreviews.add(port);
                console.error("nb-agent-ui: 宿主的 markdownPreview 出错，这一行按缺省写法显示", error);
            }
            return markdownPreviewLine(text);
        }
    };
}

export function useAgentRenderers(): ComputedRef<ResolvedRenderers> {
    const host = inject(hostKey, FALLBACK_HOST);
    return computed(() => {
        const given = host.renderers();
        return {
            markdown: given.markdown ?? PlainMarkdown,
            promptEditor: given.promptEditor ?? PlainPromptEditor,
            promptTextView: given.promptTextView ?? PlainPromptTextView,
            markdownPreview: given.markdownPreview === undefined ? markdownPreviewLine : guardPreview(given.markdownPreview),
            plainEditor: given.promptEditor === undefined,
        };
    });
}
