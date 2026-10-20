/**
 * 子进程入口：`bun ingest-child.ts <书库> <原文文件> <书名> <端点地址>`，在子进程里发起一次抽取（密钥环境变量
 * `INGEST_CHILD_KEY`）。向标准输出逐行写：`started <id>`、每次提交 `committed <章>`、结束时 `outcome <kind>`。测试按
 * 输出判定，也会在任务进行中强行结束这个进程。
 */

import {readFile} from "node:fs/promises";

import {Library} from "../src/core/library";
import {startIngest} from "../src/ingest/runner";

const [library, file, title, url] = process.argv.slice(2);
if (!library || !file || !title || !url) throw new Error("用法：ingest-child.ts <书库> <原文文件> <书名> <端点地址>");

const {runner} = await startIngest({
    library: new Library(library),
    text: await readFile(file, "utf8"),
    title,
    endpoint: {baseUrl: url, model: "m", apiKeyEnv: "INGEST_CHILD_KEY", maxTokens: 32_000},
    price: null,
    runner: "cli",
    onEvent: event => {
        if (event.type === "committed") process.stdout.write(`committed ${event.chapter}\n`);
    },
});
if (!runner) {
    process.stdout.write("outcome done\n");
} else {
    process.stdout.write(`started ${runner.id}\n`);
    const outcome = await runner.done;
    process.stdout.write(`outcome ${outcome.kind}\n`);
}
