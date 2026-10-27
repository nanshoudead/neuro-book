/**
 * `nbook` 用哪个状态根（docs/specs/runtime/cli.md 的“状态根”）：`--state-root` 优先，其次环境变量 `NBOOK_STATE_ROOT`，
 * 都没有时用平台的数据目录。服务端进程本身仍要求显式的状态根（`readServerConfig`），缺省只在命令行这一层定。
 *
 * 不用 `env-paths`：它给目录名加 `-nodejs` 后缀、Windows 多一层 `Data`、macOS 用小写名，与这里定的路径不同。
 */

import {isAbsolute, join, resolve, win32} from "node:path";

/** 平台的数据目录下的 NeuroBook 状态根。 */
export function defaultStateRoot(platform: NodeJS.Platform, env: Readonly<Record<string, string | undefined>>, home: string): string {
    if (platform === "win32") {
        const local = env.LOCALAPPDATA?.trim();
        return win32.join(local || win32.join(home, "AppData", "Local"), "NeuroBook");
    }
    if (platform === "darwin") return join(home, "Library", "Application Support", "NeuroBook");
    // XDG 规范：XDG_DATA_HOME 不是绝对路径时当作没设。
    const data = env.XDG_DATA_HOME?.trim();
    return join(data && isAbsolute(data) ? data : join(home, ".local", "share"), "neuro-book");
}

export interface StateRootInput {
    /** `--state-root` 的值；没给为 undefined。 */
    readonly option: string | undefined;
    readonly env: Readonly<Record<string, string | undefined>>;
    readonly platform: NodeJS.Platform;
    readonly home: string;
    readonly cwd: string;
}

/** 取值顺序：`--state-root` > `NBOOK_STATE_ROOT`（空串算没给）> 平台缺省。相对路径按当前目录解析。 */
export function resolveStateRoot(input: StateRootInput): string {
    const chosen = input.option?.trim() || input.env.NBOOK_STATE_ROOT?.trim();
    return chosen ? resolve(input.cwd, chosen) : defaultStateRoot(input.platform, input.env, input.home);
}
