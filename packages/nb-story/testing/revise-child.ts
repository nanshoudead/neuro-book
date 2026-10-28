/**
 * 子进程入口：对书库里的书写一条手动连接的修订（`core/overlay/store.test.ts` 用它造跨进程的并发写入）。
 * 用法：bun testing/revise-child.ts <书库> <书 id> <依据位置>；成功时在标准输出写这次写入的版本号。
 */

import {createStoryApi} from "../src/core/api";

const [library, book, evidence] = process.argv.slice(2);
const outcome = await createStoryApi({library: library!}).call("revisions.link", {book: book!, a: "e3-2", b: "e1-1", evidence: evidence!, certainty: "candidate"});
if (!outcome.ok) {
    console.error(`${outcome.error.code} ${outcome.error.message}`);
    process.exit(1);
}
console.log(String(outcome.value.version));
