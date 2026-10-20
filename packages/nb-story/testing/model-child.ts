/**
 * 子进程入口：`bun model-child.ts <端点地址>`，用环境变量 `MODEL_CHILD_KEY` 里的（假）密钥调一次抽取的模型调用，
 * 结束时向标准输出写 `outcome <ok|错误归类>`。测试检查这个进程的全部输出里没有密钥（SDK 自己打的日志也算）。
 */

import {callModel, ModelError} from "../src/ingest/model";

const [url] = process.argv.slice(2);
if (!url) throw new Error("用法：model-child.ts <端点地址>");
const outcome = await callModel(
    {baseUrl: url, model: "m", apiKey: process.env.MODEL_CHILD_KEY ?? "", maxTokens: 100},
    {system: "s", user: "u", effort: "minimal", sleep: async () => undefined},
).then(
    () => "ok",
    (error: unknown) => (error instanceof ModelError ? error.kind : "other"),
);
process.stdout.write(`outcome ${outcome}\n`);
