/**
 * 进程中断时的收尾。
 *
 * nb-harness 依赖的 OMP（`@oh-my-pi/pi-utils` 的 postmortem）一被导入，就在主线程装上 SIGINT 处理：先跑登记过的
 * 清理回调（最多等 10 秒），再以 130 退出进程。宿主自己 `process.on("SIGINT")` 拦不住这次退出，回调里没做完的
 * 收尾（例如写下“中断”的记录）就丢了。要在中断时收尾的宿主经这里登记：回调返回的 Promise 完成后进程才退出。
 */

import {postmortem} from "@oh-my-pi/pi-utils";

/** 登记中断（SIGINT）时的收尾；返回解除登记的函数。正常退出时不调用回调。 */
export function onProcessInterrupt(callback: () => void | Promise<void>): () => void {
    return postmortem.register("nb-harness-interrupt", (reason) => (reason === postmortem.Reason.SIGINT ? callback() : undefined));
}
