/**
 * `nbstory qa`：列出、显示与删除问答记录（docs/specs/story/qa.md 输出 16）。只读写书库，不调用模型。
 */

import {Library} from "../core/library";
import {StoryError} from "../core/errors";
import {QaRecords} from "../core/qa-records";
import {recordLine, recordText} from "../qa/format";
import {NEXT_STEP, type CliIo} from "./main";

export async function qaCommand(options: {library: string | undefined; params: Record<string, unknown>; json: boolean}, io: CliIo): Promise<number> {
    const {params, json} = options;
    const library = options.library === undefined ? new Library() : new Library(options.library);
    const first = params.first as string | undefined;
    const second = params.second as string | undefined;
    const done = (data: unknown, text: string): number => {
        io.stdout(json ? JSON.stringify({ok: true, data}) : text);
        return 0;
    };
    try {
        if (first !== undefined && second !== undefined && first !== "rm") {
            io.stderr("用法：nbstory qa、nbstory qa <记录 id>、nbstory qa rm <记录 id>");
            return 2;
        }
        const bookId = await library.resolveBookId(params.book as string | undefined);
        const {generation} = await library.readMeta(bookId);
        const records = new QaRecords(library, bookId);
        if (first === undefined) {
            const list = await records.list(generation);
            return done({records: list}, list.length === 0 ? "这本书还没有问答记录" : list.map(recordLine).join("\n"));
        }
        if (first === "rm") {
            if (second === undefined) {
                io.stderr("qa rm 要给记录 id");
                return 2;
            }
            await records.remove(second, generation);
            return done({}, "已删除");
        }
        const record = await records.get(first, generation);
        return done(record, recordText(record));
    } catch (error) {
        if (!(error instanceof StoryError)) throw error;
        if (json) io.stdout(JSON.stringify({ok: false, error: {code: error.code, message: error.message}}));
        else {
            const next = error.code === "qa_record_not_found" ? "用 nbstory qa 查看这本书的记录" : NEXT_STEP[error.code];
            io.stderr(`错误（${error.code}）：${error.message}${next ? `\n下一步：${next}` : ""}`);
        }
        return 1;
    }
}
