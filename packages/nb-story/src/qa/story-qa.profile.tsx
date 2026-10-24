/** @jsxImportSource @notnotype/nb-profile */
/**
 * 作答 Agent 的 Profile（docs/specs/story/qa.md 输出 1、9）：系统提示词与工具声明。版本 2 起可以追问；版本 4 起作答
 * 方式按对话二选一（`initial.answer`）：`answer` 工具是可选的，只在结构化对话里登记（`tools.ts` 的 `storyQaPlugin`），
 * 没登记的可选工具不进生效工具集，所以 Markdown 对话的快照里没有它。旧版本的会话恢复不了（harness 按快照里的版本
 * 拒绝），那时的对话不能续问（F8）。全读的原文不进 `initial`（会话快照会整份存下 `initial`），由引擎放在第一条用户消息里。
 */

import {defineProfile, HistorySet, optional, ProfilePrompt, System, toolRef, toolset} from "@notnotype/nb-profile";
import {Type} from "typebox";

import {QaAnswerModeSchema} from "../contract/qa-record";
import {ANSWER_RULES, COMMON_RULES, MARKDOWN_RULES, STRUCTURED_RULES} from "./rules";
import {ANSWER_TOOL_ID, OPTIONAL_TOOL_IDS, QUERY_TOOL_IDS} from "./tools";

export default defineProfile({
    manifest: {key: "story-qa", version: "4", name: "剧情问答", description: "按阅读位置回答小说剧情问题，查图、读原文，用 Markdown 回答或用 answer 交卷；可以追问。"},
    initialSchema: Type.Object({
        title: Type.String(),
        /** 阅读位置，写成“章.段”。 */
        at: Type.String(),
        mode: Type.Union([Type.Literal("graph"), Type.Literal("full")]),
        /** 图当目录的章数上限；全读时为 null。 */
        maxChapters: Type.Union([Type.Integer({minimum: 1}), Type.Null()]),
        /** 这本书记不记数值（ingest.md 输出 18）；不记时提示词里不提数值。没有这一项的旧会话按记。 */
        ledger: Type.Optional(Type.Boolean()),
        /** 作答方式：Markdown 文字，或用 answer 工具交结构化的卷。 */
        answer: QaAnswerModeSchema,
    }),
    // answer 一律可选：登不登记由作答方式决定（见文件头）。
    tools: toolset(...[...QUERY_TOOL_IDS, ANSWER_TOOL_ID].map(id => (OPTIONAL_TOOL_IDS.has(id) || id === ANSWER_TOOL_ID ? optional(toolRef(id)) : toolRef(id)))),
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
            <System>{initial.answer === "markdown" ? MARKDOWN_RULES : STRUCTURED_RULES}</System>
            <System>{COMMON_RULES}</System>
            <HistorySet />
        </ProfilePrompt>
    ),
});
