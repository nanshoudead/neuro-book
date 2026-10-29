/**
 * 作答 Agent 的工具（docs/specs/story/qa.md 输出 3 到 8）：查询工具与命令行的查询命令同名，参数是查询方法的原生参数
 * 去掉 `book`、`at`，结果是命令行给人读的文字；`answer` 是可选的收尾工具。
 *
 * 一轮一份：工具实现捕获这一轮的状态（固定的一代、阅读位置、读原文账本），由引擎为每一轮新建登记表登记，
 * 不按 sessionId 在进程里共享状态。
 */

import type {HarnessPlugin, PluginToolDeclaration, ToolImpl} from "@notnotype/nb-harness";
import {Type, type TSchema} from "typebox";

import {COMMANDS} from "../cli/commands";
import {formatResult} from "../cli/format";
import {STORY_METHODS, type StoryMethod} from "../contract/contract";
import {PERSPECTIVE_METHODS, type BookSession} from "../core/api";
import type {BookFeatures, Position} from "../core/dataset";
import type {QaAnswerMode} from "../contract/qa-record";
import {AnswerSchema, type Answer} from "../core/qa-records";
import {validateAnswer} from "./answer";
import {readRange, type Reach} from "./reach";
import type {ReadLedger} from "./read-ledger";

/** 一问的状态；工具执行时读它、`read` 改账本、`answer` 通过校验时写下答案。 */
export interface QaToolState {
    readonly book: BookSession;
    readonly at: Position;
    /** 图工具用的位置：阅读位置在没抽取的尾部里时是抽取进度（qa/reach.ts）。 */
    readonly graphAt: Position;
    readonly reach: Reach;
    /** 对话里最近一条位置提醒写的“图只抽到第 N 章”，而现在图已抽到别处（抽取在对话之后推进了）；没有这回事为 null。 */
    readonly staleGraph: {was: number; now: number} | null;
    readonly ledger: ReadLedger;
    /** 通过校验的答案；`answer` 成功时写下。 */
    answer: Answer | null;
}

/** 每个查询工具在命令表摘要之外的用法说明与 JSON 例子（模型照着写参数）。 */
const TOOL_USAGE: Partial<Record<string, string>> = {
    info: "书名、章数与目录。例：{}",
    chapter: "某一章的情节、新出现的对象、揭晓的秘密、数值变动与悬念。例：{\"chapter\": 12}",
    find: "按名字或称呼找对象，列出 id、全部称呼与同一身份。例：{\"query\": \"狐狐\"}（整串匹配，一个名字）；可加 \"kind\"",
    card: "人物卡：称呼、读者此时知道的同一身份、各方面概况、知道的秘密。entity 写 id、名字或称呼。例：{\"entity\": \"苏天晴\"}",
    knowledge: "这个对象知道、认为、怀疑或不知道的事，带怎么知道的与出处。例：{\"entity\": \"南小风\", \"query\": \"花铃\"}；可加 \"state\"（knows、believes、suspects、heard、read、unaware）。query 按整串匹配，只写一个关键词；不写就列出全部",
    statements: "关于这个对象的说法，带记录标记与出处。例：{\"entity\": \"林沐瑶\", \"query\": \"心月狐\"}。query 按整串匹配，只写一个关键词",
    appearances: "这个对象参与的情节。例：{\"entity\": \"花铃\"}；可加 \"query\"（整串匹配，一个关键词）",
    ties: "这个对象和每个对象的关系：关系词、身份连接、一句说明。例：{\"entity\": \"苏天晴\"}",
    between: "两个对象之间的全部说法、一起出场的情节、互相知道的事。例：{\"entity\": \"苏天晴\", \"other\": \"南嘉鱼\"}",
    relations: "人物之间的关系、同场、认知与身份连接的总表。例：{}；可加 \"kinds\": [\"character\"]、\"minTogether\": 2",
    knows: "秘密矩阵：每个秘密，读者与各人物此时知不知道、怎么知道的。例：{}",
    ledger: "各项数值、道具与任务的当前值。例：{}",
    track: "某一项数值的逐笔流水与对账差额。例：{\"track\": \"神典石\"}",
    questions: "书里的悬念与进展。例：{\"state\": \"open\"}；可加 \"query\"（整串匹配，一个关键词）",
    timeline: "按故事时间排的时间点与当时的情节。例：{}；可加 \"order\": \"source\"",
    episodes: "情节列表，带参与者、地点、步骤与出处。例：{\"query\": \"楼顶\"}（整串匹配，一个关键词）；可加 \"arc\"",
    arcs: "当前这一批主线。例：{}",
    search: "在可见的名字、说法与原文里搜，按空白拆成几个词，含的词多的排前面。例：{\"query\": \"地狱猫 南嘉鱼\"}；可加 \"kinds\": [\"source\"]",
    read: "读原文，返回“章.段 正文”。from、to 是 {chapter, paragraph}；只给 from 的章就读整章。例：{\"from\": {\"chapter\": 37}}、{\"from\": {\"chapter\": 37, \"paragraph\": 1}, \"to\": {\"chapter\": 37, \"paragraph\": 40}}",
    para: "引用某一段的图里记录。例：{\"chapter\": 37, \"paragraph\": 8}",
};

const QUERY_COMMANDS = ["info", "chapter", "find", "card", "knowledge", "statements", "appearances", "ties", "between", "relations", "knows", "ledger", "track", "questions", "timeline", "episodes", "arcs", "search", "read", "para"] as const;

/** 只在这本书记这一类时才有的查询（docs/specs/story/qa.md；开关见 ingest.md 输出 18）。 */
const FEATURE_OF: Partial<Record<(typeof QUERY_COMMANDS)[number], keyof BookFeatures>> = {knows: "secrets", ledger: "ledger", track: "ledger"};

/**
 * 工具 id：`story.<命令名>`；`story.answer` 是收尾工具。Profile 按这些 id 声明工具：`OPTIONAL_TOOL_IDS` 里的声明成可选，
 * 关掉了那一类的书不登记它们，会话里就没有这几个工具（Profile 是模块级的、各问共用，不按书改它）。
 */
export const QUERY_TOOL_IDS: readonly string[] = QUERY_COMMANDS.map(name => `story.${name}`);
export const OPTIONAL_TOOL_IDS: ReadonlySet<string> = new Set(Object.keys(FEATURE_OF).map(name => `story.${name}`));
export const ANSWER_TOOL_ID = "story.answer";

const PAGING_HINT = "列表结果分页：结果末尾给了下一页的 cursor 时，原样传 \"cursor\" 取下一页；\"limit\" 默认 50。";

type ToolResult = Awaited<ReturnType<ToolImpl["execute"]>>;

function text(content: string, isError = false): ToolResult {
    return {content: [{type: "text", text: content}], ...(isError ? {isError: true} : {})};
}

function methodOf(name: string): StoryMethod {
    const spec = COMMANDS.find(command => command.name === name);
    if (!spec?.method) throw new Error(`命令表里没有查询命令 ${name}`);
    return spec.method;
}

/**
 * 查询方法的参数去掉 `book`、`at`（不适用视角的方法另去掉 `perspective`）。不写 additionalProperties: false：
 * 写了 OMP 会在调用前悄悄删掉多余的字段，模型写了 `at` 也得不到任何提示；不写时多余字段原样传进来，`at`、`book`
 * 由 execute 明确拒绝，其余的由查询方法的严格 schema 报 invalid_params。
 */
function toolParameters(method: StoryMethod): TSchema {
    // 等级参数不进问答：问答要全部证据，折叠是给人看的（docs/specs/story/qa.md 输出 3）。
    const omitted = PERSPECTIVE_METHODS.has(method) ? ["book", "at", "maxTier"] : ["book", "at", "perspective", "maxTier"];
    return Type.Omit(STORY_METHODS[method].input, omitted);
}

function queryTool(name: (typeof QUERY_COMMANDS)[number], state: QaToolState): {declaration: PluginToolDeclaration; impl: ToolImpl} {
    const method = methodOf(name);
    const summary = COMMANDS.find(command => command.name === name)!.summary;
    const paged = "cursor" in (STORY_METHODS[method].input.properties as object);
    const description = [summary, TOOL_USAGE[name], PERSPECTIVE_METHODS.has(method) ? "可加 \"perspective\"：按某个角色知道的事回答（写角色 id 或名字）。" : "", paged ? PAGING_HINT : ""].filter(Boolean).join("\n");
    // 阅读位置在没抽取的尾部里时，每个图工具的结果（含出错）末尾提醒：图只到抽取进度（t30）。
    const through = state.reach.committed;
    const stale = state.staleGraph === null ? "" : `\n（之前位置提醒里写的“图只抽到第 ${state.staleGraph.was} 章”已过期，现在图已抽到第 ${state.staleGraph.now} 章）`;
    const graphNote = state.at.chapter <= through ? stale : state.at.chapter > through ? `\n（图只抽到第 ${state.graphAt.chapter} 章；第 ${state.graphAt.chapter + 1} 章到第 ${state.at.chapter} 章的内容只能用 read 读原文）` : "";
    return {
        // read 改读原文账本：同一条模型消息里的几次 read 要依次执行，章数检查与登记之间才不会插进另一次（输出 5）。
        declaration: {id: `story.${name}`, name, description, parameters: toolParameters(method) as never, concurrency: name === "read" ? "exclusive" : "shared"},
        impl: {
            async execute(args) {
                if ("at" in args || "book" in args) return text("工具参数里不能写 book 或 at：书与阅读位置由系统固定", true);
                if ("maxTier" in args) return text("工具参数里不能写 maxTier：问答用全部记录", true);
                let params: Record<string, unknown> = args;
                if (name === "read") {
                    const plan = state.ledger.plan(args.from as never, args.to as never);
                    // 超出章数上限是正常的拒绝：按普通结果告诉模型没读（qa 输出 5，决定 14），网页不把它算成失败；其余拒绝是请求不成立。
                    if (!plan.ok) return text(plan.reason, plan.code !== "chapter_limit");
                    params = {from: plan.from, to: plan.to};
                }
                if (name === "read") {
                    const {from, to} = params as unknown as {from: Position; to: Position};
                    const outcome = await readRange(state.book, state.reach, from, to);
                    if ("error" in outcome) return text(`查询失败（${outcome.error.code}）：${outcome.error.message}`, true);
                    state.ledger.record(outcome.paragraphs.map(({chapter, paragraph}) => ({chapter, paragraph})));
                    return text(formatResult(method, outcome, "param"));
                }
                // 阅读位置在没抽取的尾部里：图里没有尾部章的记录，章号落在尾部的 chapter、para 不去查（查询会报“超出全书”，和事实不符）。
                if ((name === "chapter" || name === "para") && typeof args.chapter === "number" && state.reach.tail.some(chapter => chapter.chapter === args.chapter)) {
                    return text(`第 ${args.chapter} 章图里还没有记录：只能用 read 读原文。${graphNote}`);
                }
                const outcome = await state.book.call(method, {...params, at: state.graphAt});
                if (!outcome.ok) {
                    const {code, message, candidates} = outcome.error;
                    const lines = [`查询失败（${code}）：${message}`, ...(candidates ?? []).map(item => `  ${item.id}  ${item.label}（${item.note}）`)];
                    return text(lines.join("\n") + graphNote, true);
                }
                return text(formatResult(method, outcome.value, "param") + graphNote);
            },
        },
    };
}

function answerTool(state: QaToolState): {declaration: PluginToolDeclaration; impl: ToolImpl} {
    return {
        declaration: {
            id: ANSWER_TOOL_ID,
            name: "answer",
            description:
                "交卷：回答小说的问题时按结构交出答案，系统校验通过即结束这一问。要单独调用（同一条消息里不要同时调别的工具）。所有出处都要是这个对话里用 read 读过的段落，且不晚于阅读位置；校验不通过时会逐条告诉你哪里不对，改了再交。不需要查书的话不用它，直接用文字回复。",
            parameters: AnswerSchema as never,
            finish: true,
        },
        impl: {
            async execute(args) {
                const check = validateAnswer(args, state.ledger);
                if (!check.ok) {
                    return text(`答案没有通过校验，改了再交：\n${check.problems.map(problem => `- ${problem}`).join("\n")}`, true);
                }
                state.answer = check.answer;
                return text("已交卷");
            },
        },
    };
}

/**
 * 这一问的全部工具，作为一个插件交给 nb-harness 的登记表；书关掉的那一类的查询不登记，`answer` 只在结构化作答的
 * 对话里登记（Profile 里它是可选的，见 story-qa.profile.tsx）。
 */
export function storyQaPlugin(state: QaToolState, features: BookFeatures, answer: QaAnswerMode): HarnessPlugin {
    const open = QUERY_COMMANDS.filter(name => {
        const feature = FEATURE_OF[name];
        return feature === undefined || features[feature];
    });
    return {name: "nb-story", version: "1", tools: [...open.map(name => queryTool(name, state)), ...(answer === "structured" ? [answerTool(state)] : [])]};
}
