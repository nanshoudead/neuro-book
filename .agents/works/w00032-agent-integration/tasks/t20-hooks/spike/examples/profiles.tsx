/**
 * 几个 Profile：写手、主创（旧 leader.default 的结构）、行内编辑（单轮模板）、只看最近几轮的总结者。
 */

import {h, Fragment, System, History, Input, Slot, User, Tag, If} from "../template.ts";
import type {ExtensionDef, ProfileDef} from "../kernel.ts";
import {historySlice, pathState, seed, sessionState} from "../core.ts";

void Fragment;

// ---------- 写手 ----------

const words = pathState<number>({id: "writer/words", initial: 0, exports: {value: (n) => n}});

export const writer: ProfileDef = {
    id: "writer",
    system: "你是本书的写手，只改正文目录。",
    tools: {required: ["read", "edit"]},
    extensions: [
        seed({id: "writer/seed", on: ["session_created", "compaction"], messages: () => ["正文在 project://正文/。"]}),
        // 字数：读文件是 I/O，在反应里读、写成事件；值没变不写；会变，所以交到“会变的槽”
        words.extension({
            slots: {"word-count": {volatile: true}},
            react: words.load({
                on: ["user", (e) => e.type === "tool_result" && e.data.tool === "edit"],
                load: (ctx) => (ctx.file("正文/第3章.md") ?? "").length,
            }),
            contribute: (mine) => ({"word-count": `本章当前字数：${mine}`}),
        }),
        {
            id: "writer/continue",
            setup: () => ({
                state: {
                    initial: 0,
                    reduce: (n: number, e) => (e.type === "writer/continue" ? n + 1 : e.type === "user" ? 0 : n),
                },
                react(e, ctx) {
                    const len = ctx.read("writer/words", "value") as number;
                    if (e.type === "assistant" && !e.data.toolCalls.length && len < 3000 && ctx.mine < 3)
                        return [{cls: "conv", type: "writer/continue", data: {text: `请接着写完（本章 ${len} 字，不到 3000 字）`}}];
                },
                render: {"writer/continue": (e) => e.data.text},
            }),
        },
        {
            id: "writer/edit-scope",
            setup: () => ({
                intercept: {
                    async tool(call, next) {
                        if (call.name === "edit" && !String(call.args.path).startsWith("正文/")) return {text: "写手只改正文目录", isError: true};
                        return next(call);
                    },
                },
            }),
        },
    ],
};
// ---------- 主创（旧 leader.default 的结构，提示词正文省略） ----------

const persona = sessionState<string>({id: "leader.default/persona", initial: "熟悉、活泼、直率。"});

const COLLABORATION: Record<string, string> = {
    default: "<collaboration_mode value=\"default\">用户主导核心创作决策。</collaboration_mode>",
    conservative: "<collaboration_mode value=\"conservative\">先提问、给候选方向。</collaboration_mode>",
};

export const leaderExtensions: ExtensionDef[] = [
    persona.loader({
        on: ["session_opened", "settings_changed", (e, ctx) => e.type === "nbook.history/file-changed" && e.data.path === `profile/${ctx.settings.leaderPersonaPreset}`],
        load: (ctx) => ctx.file(`profile/${ctx.settings.leaderPersonaPreset}`) ?? "熟悉、活泼、直率。",
    }),
    seed({
        id: "leader.default/seed",
        on: ["session_created", "compaction"],
        messages: (ctx) => ["<agent_catalog>writer, researcher</agent_catalog>", ctx.file("docs/profile-routing.md") ?? "", "<skill_catalog>novel-guide</skill_catalog>"],
    }),
    {
        id: "leader.default/writer-only",
        setup: () => ({
            intercept: {
                async tool(call, next) {
                    if (["write", "edit"].includes(call.name) && String(call.args.path).startsWith("正文/")) return {text: "正文交给 writer：用 agent.invoke 调用 writer", isError: true};
                    return next(call);
                },
            },
        }),
    },
];

export const leader: ProfileDef = {
    id: "leader.default",
    tools: {required: ["read", "edit", "todo"], optional: ["world.execute", "sql.execute"]},
    // 覆盖模式提醒的措辞；放在 Profile 上，历史、本轮输入、本轮记录里都一样，事件从本轮挪进历史时不变样
    render: {"nbook.agent/mode/reminder": (e) => `<mode>${e.data.text}</mode>`},
    prompt: ({state, settings}) => (
        <>
            <System>
                {settings.customTopSystemPrompt && <Tag name="custom_top_system_prompt">{settings.customTopSystemPrompt}</Tag>}
                <Tag name="leader_persona">{state.read("leader.default/persona")}</Tag>
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
    extensions: leaderExtensions,
};

/** 同一个主创，换成“会变的槽放在本轮输入前面”的写法，用来比较缓存。 */
export const leaderSlotBeforeInput: ProfileDef = {
    ...leader,
    id: "leader.slot-before-input",
    prompt: ({state}) => (
        <>
            <System>
                <Tag name="leader_persona">{state.read("leader.default/persona")}</Tag>
                <Slot name="*" stable />
            </System>
            <History />
            <Slot name="*" volatile />
            <Input />
        </>
    ),
};

// ---------- 行内编辑：单轮模板，没有历史 ----------

const selection = pathState<string>({id: "inline/selection", initial: ""});
export const inlineEditor: ProfileDef = {
    id: "inline.editor",
    tools: {required: []},
    prompt: () => (
        <>
            <System>你是行内编辑器。只输出改写后的段落。</System>
            <User>
                请改写下面这段：
                <Slot name="selection" />
                要求：<Input />
            </User>
        </>
    ),
    extensions: [selection.extension({slots: {selection: {volatile: true}}, contribute: (mine) => ({selection: mine})})],
};
export const setSelection = (text: string) => selection.set(text);

// ---------- 总结者：替换 core.history，只看最近 2 轮，工具结果只留首行 ----------

export const summarizer: ProfileDef = {
    id: "summarizer",
    system: "你负责总结。",
    tools: {required: ["read"]},
    globalExtensions: {exclude: ["memory", "reminder", "history", "time"]},
    extensions: [{
        id: "summarizer/history",
        replaces: "core.history",
        setup: () => ({
            state: historySlice({keepRuns: 2}),
            render: {tool_result: (e) => String(e.data.text).split("\n")[0]!},
        }),
    }],
};

/** 写错了的历史投影：去掉工具结果却留下工具调用。内核校验应当拦下。 */
export const brokenHistory: ProfileDef = {
    ...summarizer,
    id: "broken",
    extensions: [{
        id: "broken/history",
        replaces: "core.history",
        setup: () => ({state: historySlice(), render: {tool_result: () => null}}),
    }],
};
