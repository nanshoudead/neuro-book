/**
 * nb-agent-ui 渲染层的场景（组件树里 `nb-agent-ui` 一组，docs/specs/ui/agent-conversation-view.md）。场景数据迁自
 * 旧应用的 Lab（归档提交 865c9f593）。组件经 `@notnotype/nb-agent-ui/vue` 的公开入口取；要注入 Markdown 与编辑器的
 * 零件经 `host.ts` 包一层，`host.ts` 只在选中场景时动态加载。
 */

import type {
    AgentChainSummary,
    AgentCommandDetail,
    AgentConversationComposer,
    AgentConversationTurn,
    AgentConversationView,
    AgentDeliveryNotice,
    AgentFileChanges,
    AgentFileContentDetail,
    AgentMarkdown,
    AgentMessageActions,
    AgentModelPicker,
    AgentQueuedMessages,
    AgentRawView,
    AgentTaskList,
    AgentTaskListNode,
    AgentToolDetail,
    AgentTurnBlock,
    AgentUserContent,
    PlainMarkdown,
    PlainPromptEditor,
    PlainPromptTextView,
} from "@notnotype/nb-agent-ui/vue";
import type {Component} from "vue";

import {defineLabFixture} from "../index";
import type {LabFixture} from "../index";
import {defineSubjectFixture} from "../subject-fixture";
import {agentConversationComposerScenes, agentModelPickerScenes, agentQueuedMessagesScenes} from "./composer.scenes";
import {
    agentChainSummaryScenes,
    agentCommandDetailScenes,
    agentConversationTurnScenes,
    agentDeliveryNoticeScenes,
    agentFileChangesScenes,
    agentFileContentDetailScenes,
    agentMarkdownScenes,
    agentMessageActionsScenes,
    agentRawViewScenes,
    agentTaskListNodeScenes,
    agentTaskListScenes,
    agentToolDetailScenes,
    agentTurnBlockScenes,
    agentUserContentScenes,
} from "./parts.scenes";
import {agentConversationViewScenes} from "./view.scenes";

type SubjectName = Parameters<typeof import("./host")["agentSubject"]>[0];

/** 渲染层的公开组件，包上 Lab 的宿主（语言、Markdown 与编辑器）。 */
function agentSubject(name: SubjectName): () => Promise<{default: Component}> {
    return async () => (await import("./host")).agentSubject(name);
}

export const nbAgentUiFixtures: LabFixture[] = [
    defineLabFixture<typeof AgentConversationView>({
        component: "AgentConversationView", scenes: agentConversationViewScenes,
        load: async () => (await import("./AgentConversationViewFixture.vue")).default,
    }),
    defineLabFixture<typeof AgentConversationComposer>({
        component: "AgentConversationComposer", scenes: agentConversationComposerScenes,
        load: async () => (await import("./AgentConversationComposerFixture.vue")).default,
    }),
    defineLabFixture<typeof AgentConversationTurn>({
        component: "AgentConversationTurn", scenes: agentConversationTurnScenes,
        load: async () => (await import("./AgentConversationTurnFixture.vue")).default,
    }),
    defineLabFixture<typeof AgentTurnBlock>({
        component: "AgentTurnBlock", scenes: agentTurnBlockScenes,
        load: async () => (await import("./AgentTurnBlockFixture.vue")).default,
    }),
    defineLabFixture<typeof AgentMarkdown>({
        component: "AgentMarkdown", scenes: agentMarkdownScenes,
        load: async () => (await import("./AgentMarkdownFixture.vue")).default,
    }),
    defineSubjectFixture<typeof AgentChainSummary>({
        component: "AgentChainSummary", scenes: agentChainSummaryScenes, subject: agentSubject("AgentChainSummary"),
        events: ["update:expanded"], writeBack: {"update:expanded": {layer: "model", key: "expanded"}}, class: "w-full",
    }),
    defineSubjectFixture<typeof AgentTaskList>({component: "AgentTaskList", scenes: agentTaskListScenes, subject: agentSubject("AgentTaskList")}),
    defineSubjectFixture<typeof AgentTaskListNode>({component: "AgentTaskListNode", scenes: agentTaskListNodeScenes, subject: agentSubject("AgentTaskListNode")}),
    defineSubjectFixture<typeof AgentToolDetail>({
        component: "AgentToolDetail", scenes: agentToolDetailScenes, subject: agentSubject("AgentToolDetail"), class: "w-full",
        runtimeProps: async () => ({registry: (await import("./host")).labAgentRegistry()}),
    }),
    defineSubjectFixture<typeof AgentFileContentDetail>({component: "AgentFileContentDetail", scenes: agentFileContentDetailScenes, subject: agentSubject("AgentFileContentDetail"), class: "w-full"}),
    defineSubjectFixture<typeof AgentCommandDetail>({component: "AgentCommandDetail", scenes: agentCommandDetailScenes, subject: agentSubject("AgentCommandDetail"), class: "w-full"}),
    defineSubjectFixture<typeof AgentMessageActions>({component: "AgentMessageActions", scenes: agentMessageActionsScenes, subject: agentSubject("AgentMessageActions"), events: ["select", "branch"]}),
    defineSubjectFixture<typeof AgentFileChanges>({component: "AgentFileChanges", scenes: agentFileChangesScenes, subject: agentSubject("AgentFileChanges"), events: ["open"]}),
    defineSubjectFixture<typeof AgentUserContent>({
        component: "AgentUserContent", scenes: agentUserContentScenes, subject: agentSubject("AgentUserContent"),
        events: ["action", "preview-image"],
        runtimeProps: async () => {
            const services = (await import("./host")).labAgentServices();
            return {resolveAttachmentUrl: services.resolveAttachmentUrl};
        },
    }),
    defineSubjectFixture<typeof AgentModelPicker>({
        component: "AgentModelPicker", scenes: agentModelPickerScenes, subject: agentSubject("AgentModelPicker"),
        events: ["select-model", "select-thinking"],
        writeBack: {"select-model": {layer: "props", key: "modelKey"}, "select-thinking": {layer: "props", key: "thinking"}},
    }),
    defineSubjectFixture<typeof AgentQueuedMessages>({component: "AgentQueuedMessages", scenes: agentQueuedMessagesScenes, subject: agentSubject("AgentQueuedMessages"), class: "w-full"}),
    defineSubjectFixture<typeof AgentDeliveryNotice>({
        component: "AgentDeliveryNotice", noInput: "只有“重新发送”“移除”两个事件，没有数据 prop", scenes: agentDeliveryNoticeScenes,
        subject: agentSubject("AgentDeliveryNotice"), events: ["resend", "dismiss"],
    }),
    defineSubjectFixture<typeof AgentRawView>({
        component: "AgentRawView", scenes: agentRawViewScenes, subject: agentSubject("AgentRawView"), events: ["action", "preview-image"], class: "w-full",
        runtimeProps: async () => {
            const host = await import("./host");
            return {registry: host.labAgentRegistry(), services: host.labAgentServices()};
        },
    }),
    defineSubjectFixture<typeof PlainMarkdown>({
        component: "PlainMarkdown", subject: agentSubject("PlainMarkdown"), class: "w-full",
        scenes: [{id: "text", label: "纯文字", input: {props: {text: "**加粗**不会生效，\n换行照常保留。", locale: "zh-CN"}}}],
    }),
    defineSubjectFixture<typeof PlainPromptTextView>({
        component: "PlainPromptTextView", subject: agentSubject("PlainPromptTextView"), class: "w-full",
        scenes: [{id: "text", label: "文字写法原样显示", input: {props: {text: "先读 [第三章 雨夜](/正文/第三章 雨夜.md)，再用 $reviewer 检查。", locale: "zh-CN"}}}],
    }),
    defineSubjectFixture<typeof PlainPromptEditor>({
        component: "PlainPromptEditor", subject: agentSubject("PlainPromptEditor"), class: "w-full",
        events: ["change", "submit", "escape", "shift-tab"],
        scenes: [
            {id: "empty", label: "空", input: {props: {draft: {text: "", version: 1}, locale: "zh-CN", placeholder: "给 Agent 写点什么"}}},
            {id: "draft", label: "带草稿，只读", input: {props: {draft: {text: "保留雨夜那段对话。", version: 1}, locale: "zh-CN", readonly: true}}},
        ],
    }),
];

