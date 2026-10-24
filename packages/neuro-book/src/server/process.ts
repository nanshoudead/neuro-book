/**
 * 后端进程的启动与退出：解析启动参数，按给定清单启动唯一的运行实例，等停止结算后以约定的退出码结束进程。
 * 产品入口（`main.ts`）与开发入口（`development-main.ts`）只差加载的清单。
 *
 * 监听成功后在标准输出打印一行 `Listening on <地址>`，开发监督进程与 smoke 据此取得实际端口；内核 RPC 端口
 * 另打印一行 `RPC listening on <ws 地址>`。
 */

import {writeSync} from "node:fs";
import {join} from "node:path";

import {prepareInstalledPlugins, safeModeOf} from "nbook/plugin-platform/backend/startup";
import type {PluginsPreparation} from "nbook/plugin-platform/backend/startup";
import type {PluginDescriptor} from "nbook/manifest";
import {NEUROBOOK_PROFILE} from "nbook/plugin-platform-profile";

import {readServerConfig, ServerConfigError} from "./config";
import type {ServerConfig} from "./config";
import {ServerAssemblyError, startServer} from "./start";
import type {RunningServer, StartServerOptions} from "./start";

function readConfigOrExit(): ServerConfig {
    try {
        return readServerConfig(process.argv.slice(2), process.env, process.cwd());
    } catch (error) {
        if (!(error instanceof ServerConfigError)) throw error;
        writeSync(2, `${JSON.stringify({level: "fatal", event: "runtime.config.invalid", code: error.code, message: error.message})}\n`);
        process.exit(1);
    }
}

function startOrExit(config: ServerConfig, manifest: ReadonlyArray<PluginDescriptor>, prepared: PluginsPreparation, options: ServerProcessOptions): RunningServer {
    try {
        return startServer({
            config,
            manifest,
            prepared,
            projectEntry: options.projectEntry,
            devTask: options.devTask,
            stopInput: config.stopStdin ? process.stdin : null,
            onListening: (url) => {
                console.log(`Listening on ${url}`);
            },
            onRpcListening: (url) => {
                console.log(`RPC listening on ${url}`);
            },
        });
    } catch (error) {
        // 致命诊断已由 startServer 同步写出。
        if (!(error instanceof ServerAssemblyError)) throw error;
        process.exit(1);
    }
}

export interface ServerProcessOptions {
    /** 项目宿主入口；缺省为产品入口，开发入口给开发用的项目入口。 */
    readonly projectEntry?: string;
    /** 只有开发入口给出（样例作品）。 */
    readonly devTask?: StartServerOptions["devTask"];
}

export async function runServerProcess(manifest: ReadonlyArray<PluginDescriptor>, options: ServerProcessOptions = {}): Promise<never> {
    const config = readConfigOrExit();
    // 第三方插件集合在装配之前确定：要处理上次留下的待生效变化，并取跨进程的写入锁。
    const prepared = await prepareInstalledPlugins({root: join(config.stateRoot, "plugins"), profile: NEUROBOOK_PROFILE, safeMode: safeModeOf(process.env, NEUROBOOK_PROFILE)});
    const server = startOrExit(config, manifest, prepared, options);
    const {exitCode} = await server.stopped;
    // 插件代码已经停了，放下版本租约，别的服务端下次启动就能回收这些版本。进程退出时锁也会放下，这里只是不等到那时。
    await prepared.release();
    process.exit(exitCode);
}
