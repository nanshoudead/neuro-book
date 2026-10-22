import type {AgentConversationView} from "@notnotype/nb-agent-ui/vue";
import {createHarnessTranscript} from "@notnotype/nb-agent-ui";
import type {LabFixtureDefinition} from "../index";
import {harnessReplayLog} from "./harness-replay";
import {
    answerMessages,
    conversationContext,
    messageStateMessages,
    pagedConversationMessages,
    runningConversationMessages,
    runningConversationNow,
    streamingMessages,
    streamingNow,
} from "./data";

type Scene = LabFixtureDefinition<typeof AgentConversationView>["scenes"][number];

/** 真实 harness 日志经适配器画成的消息。 */
function replayMessages() {
    const transcript = createHarnessTranscript();
    for (const entry of harnessReplayLog) transcript.applyLogEntry(entry);
    return [...transcript.messages()];
}

export const agentConversationViewScenes: Scene[] = [
    {
        id: "answer",
        label: "结果节点：答案卡片在整轮收起后仍露出",
        input: {props: {ctx: conversationContext({messages: answerMessages, branches: {}}), teleportTarget: false, locale: "zh-CN"}, model: {viewMode: "turns"}},
    },
    {
        id: "long-conversation",
        label: "多轮长对话",
        input: {props: {ctx: conversationContext(), teleportTarget: false, locale: "zh-CN"}, model: {viewMode: "turns"}},
    },
    {
        id: "running",
        label: "运行中",
        input: {
            props: {
                ctx: conversationContext({
                    messages: runningConversationMessages,
                    run: {status: "running", phase: "正在读取文件"},
                    now: runningConversationNow,
                }),
                teleportTarget: false, locale: "zh-CN",
            },
            model: {viewMode: "turns"},
        },
    },
    {
        id: "streaming",
        label: "流式输出",
        input: {
            props: {
                ctx: conversationContext({
                    messages: streamingMessages,
                    run: {status: "running", phase: "正在输出"},
                    branches: {},
                    now: streamingNow,
                }),
                teleportTarget: false, locale: "zh-CN",
            },
            model: {viewMode: "turns"},
        },
    },
    {
        id: "history-paged",
        label: "历史分页",
        input: {
            props: {
                ctx: conversationContext({messages: pagedConversationMessages, history: {hasMore: true, loading: false, error: null}}),
                teleportTarget: false, locale: "zh-CN",
            },
            model: {viewMode: "turns"},
        },
    },
    {
        id: "history-error",
        label: "历史加载失败",
        input: {
            props: {
                ctx: conversationContext({
                    messages: pagedConversationMessages,
                    history: {hasMore: true, loading: false, error: "网络连接中断，更早的内容没有加载。"},
                }),
                teleportTarget: false, locale: "zh-CN",
            },
            model: {viewMode: "turns"},
        },
    },
    {
        id: "message-states",
        label: "消息状态",
        input: {
            props: {ctx: conversationContext({messages: messageStateMessages, branches: {}, now: messageStateMessages.at(-1)!.timestamp}), teleportTarget: false, locale: "zh-CN"},
            model: {viewMode: "turns"},
        },
    },
    {
        id: "raw",
        label: "原始视图",
        input: {props: {ctx: conversationContext(), teleportTarget: false, locale: "zh-CN"}, model: {viewMode: "raw"}},
    },
    {
        id: "harness-replay",
        label: "harness 记录回放",
        input: {props: {ctx: conversationContext({messages: replayMessages()}), teleportTarget: false, locale: "zh-CN"}, model: {viewMode: "turns"}},
    },
    {
        id: "english",
        label: "英文界面",
        input: {props: {ctx: conversationContext(), teleportTarget: false, locale: "en-US"}, model: {viewMode: "turns"}},
    },
    {
        id: "plain",
        label: "缺省实现（没有注入渲染组件）",
        input: {props: {ctx: conversationContext(), teleportTarget: false, locale: "zh-CN"}, model: {viewMode: "turns"}},
    },
    {
        id: "no-session",
        label: "未选择会话",
        input: {
            props: {
                ctx: conversationContext({
                    session: null,
                    messages: [],
                    availability: {status: "unselected", message: "选择或新建一个会话后开始对话。", actions: []},
                }),
                teleportTarget: false, locale: "zh-CN",
            },
            model: {viewMode: "turns"},
        },
    },
];
