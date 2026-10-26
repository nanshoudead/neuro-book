/**
 * 测试共用的一份生成好的 SDK 包。生成一次要一两分钟（大半在生成声明文件），`pack.test.ts` 与 `template.test.ts` 在同一个
 * `bun test` 进程里共用它：第一个要的测试触发生成，之后的等同一个 Promise。用的测试把 tarball 解进自己的作者目录，不改生成的
 * 目录。临时根在进程退出时删掉；进程被杀时留下的由临时根的回收清掉（owner 已退出、超出窗口）。
 */

import {rmSync} from "node:fs";
import {join} from "node:path";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {buildSdk} from "../pack";
import type {BuiltSdk} from "../pack";

let built: Promise<BuiltSdk> | null = null;

export function builtSdk(): Promise<BuiltSdk> {
    built ??= (async () => {
        const root = await createTestTmpRoot("neuro-book-sdk", "built-sdk");
        process.once("exit", () => rmSync(root, {recursive: true, force: true}));
        return buildSdk(join(root, "sdk"));
    })();
    return built;
}
