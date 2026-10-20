/**
 * 书 id 的协调者（core/library.ts 的 IdCoordinator），注入给命令行与独立服务构造的书库：导入、抽取占用与删除都先拿
 * 这个 id 的独占锁（与抽取任务同一把，`.locks/<书 id>.lock`），在锁里判定与发布。删除前先停本进程里这个 id 的
 * 抽取任务、等它放锁；别的进程在抽时拿不到锁，删除报 `ingest_running`（docs/specs/story/ingest.md 输出 16）。
 */

import {Library, type IdCoordinator} from "../core/library";
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

/** 带协调者的书库：命令行与独立服务都这样构造。`localRunners` 是本进程里正在运行的任务，删除时先停它们。 */
export function coordinatedLibrary(root?: string, localRunners?: ReadonlyMap<string, Runner>): Library {
    const library: Library = new Library(root, {coordinator: ingestCoordinator(() => library, localRunners)});
    return library;
}
