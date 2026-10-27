/**
 * 问答记录里一轮的形状（docs/specs/story/qa.md 输出 7、15）：作答工具 `answer` 的参数（也是记录里答案的形状）与
 * 记录的一轮。单独成文件、不碰 node：问答记录（`core/qa-records.ts`）读文件时按它核对，接口合同与网页也用同一份。
 */

import {Type, type Static} from "typebox";

/** 出处：“章.段”或“章.段—章.段”。 */
const Ref = Type.String({description: "出处：“章.段”或“章.段—章.段”，例如 37.8 或 38.50—38.57"});

/** 作答工具 `answer` 的参数，也是记录里答案的形状（qa.md 输出 7）。 */
export const AnswerSchema = Type.Object(
    {
        conclusion: Type.String({description: "先给的结论"}),
        conclusionType: Type.Union([Type.Literal("明说"), Type.Literal("推断"), Type.Literal("解读"), Type.Literal("无法确定")]),
        knowledge: Type.Optional(
            Type.Array(
                Type.Object(
                    {
                        who: Type.String(),
                        state: Type.Union([Type.Literal("知道"), Type.Literal("怀疑"), Type.Literal("不知道"), Type.Literal("原文没有表明")]),
                        how: Type.String({description: "怎么知道的"}),
                        refs: Type.Array(Ref),
                    },
                    {additionalProperties: false},
                ),
                {description: "“谁知道什么”的题：一行一人"},
            ),
        ),
        points: Type.Optional(Type.Array(Type.Object({text: Type.String(), refs: Type.Array(Ref)}, {additionalProperties: false}), {description: "其他题：分点"})),
        explanation: Type.String({description: "展开说明"}),
        evidence: Type.Array(Ref, {description: "依据出处"}),
        coverage: Type.String({description: "覆盖了哪些范围、可能漏了什么"}),
    },
    {additionalProperties: false},
);
export type Answer = Static<typeof AnswerSchema>;

export const QaModeSchema = Type.Union([Type.Literal("graph"), Type.Literal("full")]);
export const QaUsageSchema = Type.Object({input: Type.Number(), output: Type.Number(), cacheRead: Type.Number(), cacheWrite: Type.Number(), cost: Type.Union([Type.Number(), Type.Null()]), complete: Type.Boolean()});
export const QaStatusSchema = Type.Union([Type.Literal("answered"), Type.Literal("failed"), Type.Literal("interrupted")]);
export const QaFailureSchema = Type.Union([Type.Object({code: Type.String(), kind: Type.Optional(Type.String()), message: Type.String()}), Type.Null()]);
export const QaPositionSchema = Type.Object({chapter: Type.Integer({minimum: 1}), paragraph: Type.Integer({minimum: 1})});
export const ChaptersSchema = Type.Array(Type.Integer({minimum: 1}));
export const QaTurnSchema = Type.Object({
    question: Type.String(),
    status: QaStatusSchema,
    answer: Type.Union([AnswerSchema, Type.Null()]),
    reply: Type.Union([Type.Object({text: Type.String(), truncated: Type.Boolean(), unverifiedRefs: Type.Array(Type.String()), ungrounded: Type.Optional(Type.Boolean())}), Type.Null()]),
    error: QaFailureSchema,
    chaptersRead: ChaptersSchema,
    rejections: Type.Integer({minimum: 0}),
    usage: QaUsageSchema,
    ms: Type.Number(),
    model: Type.String(),
    startedAt: Type.String(),
    logFrom: Type.Optional(Type.Integer({minimum: 1})),
    /** 这一轮用的阅读位置；对话中途改过位置之后的轮都有（t25）。没有这一项的旧记录用对话的 `at`。 */
    at: Type.Optional(QaPositionSchema),
    /** Markdown 回复里有没核实的出处时，让模型改了一次（qa.md 的“出处复查”）；没复查的轮没有这一项。 */
    recheck: Type.Optional(Type.Object({unverified: Type.Integer({minimum: 1}), outcome: Type.Union([Type.Literal("rewritten"), Type.Literal("failed"), Type.Literal("aborted")])})),
});
export type QaTurnView = Static<typeof QaTurnSchema>;

/** 作答方式：用 Markdown 文字回答，或用 answer 工具交结构化的卷。按对话固定。 */
export const QaAnswerModeSchema = Type.Union([Type.Literal("markdown"), Type.Literal("structured")]);
export type QaAnswerMode = Static<typeof QaAnswerModeSchema>;

type QaPositionValue = {chapter: number; paragraph: number};
/** 算位置用到的那几项：核心库的记录、网页拿到的记录视图都满足它。 */
interface ConversationPositions {
    at: QaPositionValue;
    currentAt?: QaPositionValue | undefined;
    turns: readonly {at?: QaPositionValue | undefined}[];
}

/**
 * 这个对话下一问用的阅读位置：改过位置的取 `currentAt`，没改过的取最后一轮用的位置，旧记录再回落到对话开始时的 `at`。
 * 引擎、`qa.get`、`qa.list`、命令行、页面的位置控件与新提醒里的“从 A”都用这一个规则。
 */
export function currentPosition(conversation: ConversationPositions): QaPositionValue {
    return conversation.currentAt ?? conversation.turns.at(-1)?.at ?? conversation.at;
}

/**
 * 整个对话出现过的最高位置：开始时的位置、每一轮用的位置与当前位置里最靠后的。剧透警告（列表的“晚于你现在的位置”、页头
 * 高亮）按它判断：位置往回调不能解除旧答案里可能带着后文的警告。
 */
export function highestPosition(conversation: ConversationPositions): QaPositionValue {
    const all = [conversation.at, ...conversation.turns.flatMap(item => (item.at === undefined ? [] : [item.at])), ...(conversation.currentAt === undefined ? [] : [conversation.currentAt])];
    return all.reduce((best, item) => (item.chapter > best.chapter || (item.chapter === best.chapter && item.paragraph > best.paragraph) ? item : best));
}
