/**
 * `instance.test.ts` 的子进程：认领 argv[2] 给的状态根，在标准输出写一行认领结果（JSON），认领到就一直持有，
 * 直到标准输入读到 `release`（放下后以 0 退出）或进程被结束。只由测试启动。
 */

import {createInterface} from "node:readline";

import {claimStateRoot} from "nbook/server/instance";

const stateRoot = process.argv[2];
if (stateRoot === undefined) throw new Error("要给状态根");
const result = await claimStateRoot({stateRoot, kind: "fixture", version: "0.0.0-test", report: () => undefined});
console.log(JSON.stringify(result.ok ? {ok: true} : result));
if (!result.ok) process.exit(0);
const claim = result.claim;
createInterface({input: process.stdin}).on("line", (line) => {
    if (line.trim() !== "release") return;
    void claim.release().then(() => process.exit(0));
});
