/**
 * 子进程入口：`bun import-child.ts <书库> <文件> <书名> [书 id]`。
 * 成功时向标准输出写 `ok <id> <代号>`，失败时写 `error <码>`，退出码都是 0；测试按输出判定。
 */

import {StoryError} from "../src/core/errors";
import {Library} from "../src/core/library";

const [library, file, title, id] = process.argv.slice(2);
if (!library || !file || !title) throw new Error("用法：import-child.ts <书库> <文件> <书名> [书 id]");

try {
    const result = await new Library(library).importBook({file, title, ...(id ? {id} : {})});
    process.stdout.write(`ok ${result.id} ${result.generation}\n`);
} catch (error) {
    if (!(error instanceof StoryError)) throw error;
    process.stdout.write(`error ${error.code}\n`);
}
