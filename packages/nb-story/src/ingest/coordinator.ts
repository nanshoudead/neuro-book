/**
 * 书 id 的协调者（core/library.ts 的 IdCoordinator），注入给命令行与独立服务构造的书库：导入、抽取占用与删除都先拿
 * 这个 id 的独占锁（与抽取任务同一把，`.locks/<书 id>.lock`），在锁里判定与发布。删除前先停本进程里这个 id 的
 * 抽取任务、等它放锁；别的进程在抽时拿不到锁，删除报 `ingest_running`（docs/specs/story/ingest.md 输出 16）。
 */

import {Library, type IdCoordinator} from "../core/library";
import type {Runner} from "./runner";
import {IngestStore} from "./store";

/** 本进程里的抽取任务：删除前停下这个 id 的任务（含正在启动的）并等它放锁。 */
export interface LocalTasks {
    stop(id: string): Promise<void>;
}

/** 只有已经启动的任务时（命令行）：按任务表停。 */
export function runnerTable(runners: ReadonlyMap<string, Runner>): LocalTasks {
    return {
        async stop(id) {
            const local = runners.get(id);
            if (!local) return;
            local.stop();
            await local.done;
        },
    };
}

export function ingestCoordinator(library: () => Library, local?: LocalTasks): IdCoordinator {
    return {
        lock: id => new IngestStore(library(), id).tryLock(),
        stopLocal: id => local?.stop(id) ?? Promise.resolve(),
    };
}

/** 带协调者的书库：命令行与独立服务都这样构造。`local` 是本进程里的抽取任务，删除时先停它们。 */
export function coordinatedLibrary(root?: string, local?: LocalTasks): Library {
    const library: Library = new Library(root, {coordinator: ingestCoordinator(() => library, local)});
    return library;
}
