/**
 * 抽取线程的入口（runner.ts 起它）。整个任务跑在这里，主线程只收事件、发停止：编译整本书是同步计算（百章的书一次
 * 约半秒，每章要编译几次），放在主线程会卡住同一服务的查询与停止（docs/specs/story/ingest.md 输出 12）。
 *
 * 停止：主线程先在共享内存里置标志（编译结束、提交之前就能看到），再发一条消息中止在途的模型请求与重试等待。
 * 密钥由这里按环境变量名自己读，不经消息传递。
 */

import {Library} from "../core/library";
import {runIngest, type IngestEvent, type JobOutcome} from "./job";
import {IngestStore, type Price} from "./store";

export interface WorkerStart {
    type: "start";
    libraryRoot: string;
    id: string;
    endpoint: {baseUrl: string; model: string; apiKeyEnv: string; maxTokens: number};
    price: Price | null;
    run: string;
    /** 一个 Int32：非 0 表示要停。 */
    stop: SharedArrayBuffer;
}

export type WorkerInbound = WorkerStart | {type: "stop"};
export type WorkerOutbound = {type: "event"; event: IngestEvent} | {type: "outcome"; outcome: JobOutcome};

declare const self: Worker;

const controller = new AbortController();

self.onmessage = (message: MessageEvent<WorkerInbound>) => {
    const data = message.data;
    if (data.type === "stop") {
        controller.abort();
        return;
    }
    const flag = new Int32Array(data.stop);
    const library = new Library(data.libraryRoot);
    void runIngest({
        library,
        store: new IngestStore(library, data.id),
        endpoint: {baseUrl: data.endpoint.baseUrl, model: data.endpoint.model, apiKey: process.env[data.endpoint.apiKeyEnv] ?? "", maxTokens: data.endpoint.maxTokens},
        price: data.price,
        run: data.run,
        signal: controller.signal,
        stopRequested: () => Atomics.load(flag, 0) !== 0,
        onEvent: event => self.postMessage({type: "event", event} satisfies WorkerOutbound),
    }).then(
        outcome => self.postMessage({type: "outcome", outcome} satisfies WorkerOutbound),
        // 本机故障（写不了书库、程序错误）：照问答的口径归为 model_failed 的 local，任务停下，可以接着抽。
        (error: unknown) => self.postMessage({type: "outcome", outcome: {kind: "failed", code: "model_failed", errorKind: "local", message: `本机错误：${error instanceof Error ? error.message : String(error)}`}} satisfies WorkerOutbound),
    );
};
