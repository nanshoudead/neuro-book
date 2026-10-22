/**
 * `nbstory qa`：列出、显示与删除问答记录，一个对话一条（docs/specs/story/qa.md 输出 16、F5、F6）。只读写书库，不调用模型。
 *
 * 先把位置参数解析成动作并检查用法，再解析书：用法错误的退出码不随书库里有几本书而变。
 */

import {Library} from "../core/library";
import {StoryError} from "../core/errors";
import {QaRecords} from "../core/qa-records";
import {conversationLine, conversationText} from "../qa/format";
import {NEXT_STEP, type CliIo} from "./main";

type Action = {kind: "list"} | {kind: "show"; id: string} | {kind: "remove"; id: string};

function actionOf(first: string | undefined, second: string | undefined): Action | null {
    if (first === undefined) return {kind: "list"};
    if (first === "rm") return second === undefined ? null : {kind: "remove", id: second};
    return second === undefined ? {kind: "show", id: first} : null;
}

export async function qaCommand(options: {library: string | undefined; params: Record<string, unknown>; json: boolean}, io: CliIo): Promise<number> {
    const {params, json} = options;
    const action = actionOf(params.first as string | undefined, params.second as string | undefined);
    if (action === null) {
        io.stderr("用法：nbstory qa、nbstory qa <记录 id>、nbstory qa rm <记录 id>");
        return 2;
    }
    const library = options.library === undefined ? new Library() : new Library(options.library);
    const done = (data: unknown, text: string): number => {
        io.stdout(json ? JSON.stringify({ok: true, data}) : text);
        return 0;
    };
    try {
        const bookId = await library.resolveBookId(params.book as string | undefined);
        const {generation} = await library.readMeta(bookId);
        const records = new QaRecords(library, bookId);
        switch (action.kind) {
            case "list": {
                const {records: list, broken} = await records.list(generation);
                const lines = [...list.map(conversationLine), ...broken.map(item => `${item.id}  损坏（${item.problem}），可以用 nbstory qa rm ${item.id} 删除`)];
                return done({records: list, broken}, lines.length === 0 ? "这本书还没有问答记录" : lines.join("\n"));
            }
            case "show": {
                const record = await records.get(action.id, generation);
                return done(record, conversationText(record));
            }
            case "remove":
                await records.remove(action.id, generation);
                return done({}, "已删除");
        }
    } catch (error) {
        if (!(error instanceof StoryError)) throw error;
        if (json) io.stdout(JSON.stringify({ok: false, error: {code: error.code, message: error.message}}));
        else {
            const next = error.code === "qa_record_not_found" ? "用 nbstory qa 查看这本书的记录" : error.code === "qa_record_broken" ? `用 nbstory qa rm ${action.kind === "list" ? "<记录 id>" : action.id} 删除它` : NEXT_STEP[error.code];
            io.stderr(`错误（${error.code}）：${error.message}${next ? `\n下一步：${next}` : ""}`);
        }
        return 1;
    }
}
