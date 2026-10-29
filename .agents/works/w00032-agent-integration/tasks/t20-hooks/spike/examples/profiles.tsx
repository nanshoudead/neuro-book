/**
 * 几个 Profile（第二版）：写手、主创（旧 leader.default 的结构）、行内编辑（单轮模板）、只看最近几轮的总结者。
 */

import {h, Fragment, System, History, Input, Slot, User, P, Tag, If} from "../template.ts";
import {conv, defineExtension, defineProfile, is, K, path, session} from "../api.ts";
import {historyExtension, seed} from "../core.ts";

void Fragment;
void h;

// ---------- 写手 ----------

/** 写手自带的一个扩展：字数（反应里读文件、写成事件）、接着写（显式 continue）、只改正文目录、调用上下文。 */
export const writerCore = defineExtension({
    id: "writer",
    state: {words: path(0), continues: path(0)},
    events: {continue: conv()},
    reduce: {
        continues: (n, e, ev) => (ev.continue.is(e) ? n + 1 : is(e, K.user) ? 0 : undefined),
    },
    react(e, ctx) {
        const len = (ctx.file("正文/第3章.md") ?? "").length;
        if (is(e, K.user) || (is(e, K.toolResult) && e.data.tool === "edit")) return len === ctx.mine.words ? undefined : [ctx.set("words", len)];
        if (is(e, K.assistant) && !e.data.toolCalls.length && ctx.mine.words < 3000 && ctx.mine.continues < 3)
            return {events: [ctx.ev.continue({text: `请接着写完（本章 ${ctx.mine.words} 字，不到 3000 字）`})], continue: true};
    },
    render: {continue: (e) => e.data.text},
    contribute: {"word-count": {volatile: true, value: (m) => `本章当前字数：${m.words}`}},
    intercept: {
        async tool(call, next) {
            if (call.name === "edit" && !String(call.args.path).startsWith("正文/")) return {text: "写手只改正文目录", isError: true};
            return next(call);
        },
    },
});

export const writer = defineProfile({
    id: "writer",
    system: "你是本书的写手，只改正文目录。",
    tools: {required: ["read", "edit"]},
    extensions: [
        // 种子：会话创建时写，能读调用方给的 initial（旧版 HistorySet 里的 inputContext）
        seed({
            id: "writer.seed",
            on: [K.sessionCreated, K.compaction],
            messages: (e) => ["正文在 project://正文/。", is(e, K.sessionCreated) && e.data.initial ? `<input_context>${JSON.stringify(e.data.initial)}</input_context>` : null],
        }),
        writerCore,
    ],
});

// ---------- 主创（旧 leader.default 的结构，提示词正文省略） ----------

const COLLABORATION: Record<string, string> = {
    default: "<collaboration_mode value=\"default\">用户主导核心创作决策。</collaboration_mode>",
    conservative: "<collaboration_mode value=\"conservative\">先提问、给候选方向。</collaboration_mode>",
};

export const leaderCore = defineExtension({
    id: "leader.default",
    state: {persona: session("熟悉、活泼、直率。")},
    react(e, ctx) {
        // 人设：会话打开、设置变化、人设文件被改时读一次；值没变不写
        const watched = `profile/${ctx.settings.leaderPersonaPreset}`;
        if (!(is(e, K.sessionOpened) || is(e, K.settingsChanged) || (e.type === "nbook.history/fileChanged" && (e.data as {path: string}).path === watched))) return;
        const text = ctx.file(watched) ?? "熟悉、活泼、直率。";
        return text === ctx.mine.persona ? undefined : [ctx.set("persona", text)];
    },
    intercept: {
        // 旧版只能在提示词里说“写作必须交给 writer”；现在能挡住
        async tool(call, next) {
            if (["write", "edit"].includes(call.name) && String(call.args.path).startsWith("正文/")) return {text: "正文交给 writer：用 agent.invoke 调用 writer", isError: true};
            return next(call);
        },
    },
});

export const leader = defineProfile({
    id: "leader.default",
    tools: {required: ["read", "edit", "todo"], optional: ["world.execute", "sql.execute"]},
    // 覆盖模式提醒的措辞；写在 Profile 上，历史、本轮输入、本轮记录里都一样
    render: {"nbook.agent.mode/reminder": (e) => `<mode>${(e.data as {text: string}).text}</mode>`},
    prompt: ({state, settings}) => (
        <>
            <System>
                {settings.customTopSystemPrompt && <Tag name="custom_top_system_prompt">{settings.customTopSystemPrompt}</Tag>}
                <Tag name="leader_persona">{state.own("leader.default").persona}</Tag>
                {COLLABORATION[settings.collaborationMode ?? "default"]}
                你现在在 Neuro Book 中作为默认 Leader Agent 工作。
                <If tool="world.execute"># World Engine ……</If>
                <Slot name="sql-schema" />
                <Slot name="*" stable />
            </System>
            <History />
            <Slot name="*" volatile />
        </>
    ),
    extensions: [
        seed({
            id: "leader.seed",
            on: [K.sessionCreated, K.compaction],
            messages: (_e, ctx) => ["<agent_catalog>writer, researcher</agent_catalog>", ctx.file("docs/profile-routing.md"), "<skill_catalog>novel-guide</skill_catalog>"],
        }),
        leaderCore,
    ],
});

/** 同一个主创，换成“会变的槽放在本轮输入前面”的写法，用来比较缓存。 */
export const leaderSlotBeforeInput = defineProfile({
    ...leader,
    id: "leader.slot-before-input",
    prompt: ({state}) => (
        <>
            <System>
                <Tag name="leader_persona">{state.own("leader.default").persona}</Tag>
                <Slot name="*" stable />
            </System>
            <History />
            <Slot name="*" volatile />
            <Input />
        </>
    ),
});

// ---------- 行内编辑：单轮模板，没有历史；选区随输入的 payload 来 ----------

export const inlineEditor = defineProfile({
    id: "inline.editor",
    tools: {required: []},
    // 单轮模板不要别人的持久消息（记忆、提醒）：显式不收全局扩展
    globalExtensions: "none",
    prompt: ({read}) => {
        const input = read("core.history", "input");
        const selection = (input?.data.payload as {selection?: string} | undefined)?.selection ?? "";
        return (
            <>
                <System>你是行内编辑器。只输出改写后的段落。</System>
                <User>
                    请改写下面这段：
                    {selection}
                    <P>要求：<Input /></P>
                </User>
            </>
        );
    },
});

// ---------- 总结者：替换 core.history，只看最近 2 轮，工具结果只留首行 ----------

export const summarizer = defineProfile({
    id: "summarizer",
    system: "你负责总结。",
    tools: {required: ["read"]},
    globalExtensions: {exclude: ["memory", "reminder", "history", "time"]},
    render: {tool_result: (e) => String((e.data as {text: string}).text).split("\n")[0]!},
    extensions: [historyExtension({id: "summarizer.history", replaces: "core.history", keepRuns: 2})],
});

/** 写错了的历史投影：去掉工具结果却留下工具调用。内核校验应当拦下。 */
export const brokenHistory = defineProfile({
    ...summarizer,
    id: "broken",
    render: {tool_result: () => null},
});
