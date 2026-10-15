import {spawn} from "node:child_process";
import {once} from "node:events";
import {join} from "node:path";
import {createInterface} from "node:readline";

/**
 * 文件屏障：用 Linux 的写租约让别的进程打开这几个文件时挂在内核里，直到测试放掉租约（`fixtures/file-lease.py`）。
 * 读盘慢的真实时序就这样造出来，不替换被测代码里的任何函数；`stat` 不受影响，只有 `open` 会挂住。
 * 内核最多挂 `/proc/sys/fs/lease-break-time` 秒（默认 45 秒），用例要在这之前放掉。
 */
export type LeaseState = "held" | "breaking" | "released";
export type FileLeases = {
    /** 每个文件的状态，顺序同传入的路径；`breaking` 表示有人正卡在打开它上面。 */
    states(): Promise<LeaseState[]>;
    /** 放掉第 `index` 个文件的租约：卡在打开它上面的调用随即返回。 */
    release(index: number): Promise<void>;
    /** 重新挂上第 `index` 个文件的租约，要等别人把它关掉才挂得上：完成时说明读它的那一方已经关了文件。 */
    reacquire(index: number): Promise<void>;
    close(): Promise<void>;
};

const SCRIPT = join(import.meta.dir, "fixtures", "file-lease.py");

export async function holdFileLeases(paths: readonly string[]): Promise<FileLeases> {
    const child = spawn("python3", [SCRIPT, ...paths], {stdio: ["pipe", "pipe", "inherit"]});
    const lines = createInterface({input: child.stdout!});
    const replies: string[] = [];
    let waiter: ((line: string) => void) | null = null;
    lines.on("line", (line) => {
        if (waiter) {
            const take = waiter;
            waiter = null;
            take(line);
        } else replies.push(line);
    });
    const exited = once(child, "exit");
    const nextLine = () => {
        const ready = replies.shift();
        if (ready !== undefined) return Promise.resolve(ready);
        return new Promise<string>((resolveLine, rejectLine) => {
            waiter = resolveLine;
            void exited.then(([code]) => rejectLine(new Error(`租约进程退出（${String(code)}），没有回应`)));
        });
    };
    // 命令一条一条发，每条等一行回应。
    let chain: Promise<unknown> = Promise.resolve();
    const ask = (command: string) => {
        const reply = chain.then(() => {
            child.stdin!.write(`${command}\n`);
            return nextLine();
        });
        chain = reply;
        return reply;
    };
    const ok = async (command: string) => {
        const reply = await ask(command);
        if (reply !== "ok") throw new Error(`租约进程对 ${command} 回了 ${reply}`);
    };
    const held = await nextLine();
    if (held !== "held") throw new Error(`租约没挂上：${held}`);
    return {
        async states() {
            return JSON.parse(await ask("state")) as LeaseState[];
        },
        release: (index) => ok(`release ${index}`),
        reacquire: (index) => ok(`reacquire ${index}`),
        async close() {
            if (child.exitCode !== null || child.signalCode !== null) return;
            child.stdin!.end();
            await exited;
        },
    };
}
