/**
 * 书 id 的协调者（core/library.ts 的 IdCoordinator），注入给命令行与独立服务构造的书库：导入、抽取占用与删除都先拿
 * 这个 id 的独占锁（与抽取任务同一把，`.locks/<书 id>.lock`），在锁里判定与发布。删除前先停本进程里这个 id 的
 * 抽取任务、等它放锁；别的进程在抽时拿不到锁，删除报 `ingest_running`（docs/specs/story/ingest.md 输出 16）。
 */

import type {IdCoordinator, Library} from "../core/library";
import type {Runner} from "./runner";
import {IngestStore} from "./store";

export function ingestCoordinator(library: () => Library, localRunners?: ReadonlyMap<string, Runner>): IdCoordinator {
    return {
        lock: id => new IngestStore(library(), id).tryLock(),
        async stopLocal(id) {
            const local = localRunners?.get(id);
            if (!local) return;
            local.stop();
            await local.done;
        },
    };
}
