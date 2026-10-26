/**
 * 子进程入口：`bun churn-child.ts <书库> <文件 A> <文件 B> <次数>`。反复删除 fox 并交替用 A、B 重新导入，
 * 书名分别是 "A"、"B"（与文件里的 book.title 相同），测固定一代时的跨进程竞争。
 */

import {Library} from "../src/core/library";

const [library, fileA, fileB, times] = process.argv.slice(2);
if (!library || !fileA || !fileB || !times) throw new Error("用法：churn-child.ts <书库> <文件 A> <文件 B> <次数>");

const lib = new Library(library);
for (let round = 0; round < Number(times); round += 1) {
    await lib.removeBook("fox");
    const useB = round % 2 === 0;
    await lib.importBook({file: useB ? fileB : fileA, title: useB ? "B" : "A", id: "fox"});
}
