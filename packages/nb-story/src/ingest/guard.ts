/**
 * 删除书时的检查（docs/specs/story/ingest.md 输出 16），注入给 core/library.ts 的 `removeGuard`：本进程里这个 id 有
 * 抽取任务就先停下它、等它放锁；然后试着拿抽取锁，拿不到说明别的进程在抽，删除报 `ingest_running`。拿到的锁在
 * 删除期间一直持有，删完才放：这段时间里没有任务能在这个 id 上开始。
 */

import type {Library, RemoveGuard} from "../core/library";
import type {Runner} from "./runner";
import {IngestStore} from "./store";

export function ingestRemoveGuard(library: () => Library, localRunners?: ReadonlyMap<string, Runner>): RemoveGuard {
    return async id => {
        const local = localRunners?.get(id);
        if (local) {
            local.stop();
            await local.done;
        }
        const lock = await new IngestStore(library(), id).tryLock();
        if (!lock) return null;
        return {
            release: async () => {
                lock.release();
            },
        };
    };
}
