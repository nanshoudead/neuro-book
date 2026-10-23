/** @jsxImportSource @notnotype/nb-profile */
/**
 * 作答 Agent 的 Profile（docs/specs/story/qa.md 输出 1、9）：系统提示词与工具声明。版本 2 起 `answer` 可选、可以追问；
 * 版本 1 的会话恢复不了（harness 按快照里的版本拒绝），那时的对话不能续问（F8）。全读的原文不进 `initial`
 * （会话快照会整份存下 `initial`），由引擎放在第一条用户消息里。
 */

import {defineProfile, HistorySet, optional, ProfilePrompt, System, toolRef, toolset} from "@notnotype/nb-profile";
import {Type} from "typebox";

import {ANSWER_RULES, QA_RULES} from "./rules";
import {ANSWER_TOOL_ID, OPTIONAL_TOOL_IDS, QUERY_TOOL_IDS} from "./tools";

export default defineProfile({
    manifest: {key: "story-qa", version: "3", name: "剧情问答", description: "按阅读位置回答小说剧情问题，查图、读原文、用 answer 交卷；不需要查书的话直接用文字回复。可以追问。"},
    initialSchema: Type.Object({
        title: Type.String(),
        /** 阅读位置，写成“章.段”。 */
        at: Type.String(),
        mode: Type.Union([Type.Literal("graph"), Type.Literal("full")]),
        /** 图当目录的章数上限；全读时为 null。 */
        maxChapters: Type.Union([Type.Integer({minimum: 1}), Type.Null()]),
        /** 这本书记不记数值（ingest.md 输出 18）；不记时提示词里不提数值。没有这一项的旧会话按记。 */
        ledger: Type.Optional(Type.Boolean()),
    }),
    tools: toolset(...[...QUERY_TOOL_IDS, ANSWER_TOOL_ID].map(id => (OPTIONAL_TOOL_IDS.has(id) ? optional(toolRef(id)) : toolRef(id)))),
    context: ({initial}) => (
        <ProfilePrompt>
            <System>
                {`你是熟读小说原文的读者，回答关于小说《${initial.title}》的问题。读者读到了第 ${initial.at.replace(".", " 章第 ")} 段（${initial.at}）：只依据这个位置以前的内容回答，不提及之后的任何内容。只依据原文和工具查到的材料，不使用外部知识。小说可能有笔误、措辞不严谨、比喻或网络梗，要结合上下文判断真实含义。`}
            </System>
            {initial.mode === "graph" ? (
                <System>
                    {`工具里有系统自动抽取的记忆图（人物、身份、谁知道什么、情节、${initial.ledger === false ? "" : "数值、"}悬念、时间线）和原文。先用图和搜索找到相关的人物与章节，再用 read 读原文核对；图是自动抽取的，会有错，结论以原文为准，答案里的每个出处都要是你读过的段落。一问最多读 ${initial.maxChapters} 个不同的章，挑着读，读过的章可以再读。`}
                </System>
            ) : (
                <System>
                    {"第一条消息里已经给出了阅读位置以前的全部原文（每行“章.段 正文”），可以直接引用其中任何段落；工具也可以用来查图、定位。"}
                </System>
            )}
            <System>{ANSWER_RULES}</System>
            <System>{QA_RULES}</System>
            <HistorySet />
        </ProfilePrompt>
    ),
});
