/**
 * 内置的读文件、改文件工具（`builtin.read`、`builtin.edit`）。harness 不会自动给出它们：宿主按需登记，
 * Profile 声明了才进生效工具集（docs/specs/agent/harness.md 输出 2）。
 *
 * 两者共享一份 `EditStore`（read 登记展示过的行，edit 靠它校验锚点），按会话各建一份，会话关闭时释放。
 */

import type {AgentTool} from "@oh-my-pi/pi-agent-core";
import {EditStore} from "@oh-my-pi/pi-natives";
import {createEditTool, type EditToolOptions} from "./edit.js";
import {createReadTool, type ReadToolOptions} from "./read.js";
import type {ToolImpl, ToolRegistry} from "./registry.js";

export const BUILTIN_PROVIDER = "builtin";
export const BUILTIN_VERSION = "1";

export interface BuiltinToolsOptions {
    readonly read?: Omit<ReadToolOptions, "store">;
    readonly edit?: Omit<EditToolOptions, "store">;
}

/** 把内置工具登记进登记表；只登记 options 里给了的那几个。 */
export function registerBuiltinTools(registry: ToolRegistry, options: BuiltinToolsOptions): void {
    const stores = new Map<string, EditStore>();
    const storeOf = (sessionId: string): EditStore => {
        let store = stores.get(sessionId);
        if (store === undefined) {
            store = new EditStore();
            stores.set(sessionId, store);
        }
        return store;
    };
    const releaseSession = (sessionId: string): void => {
        stores.get(sessionId)?.clear();
        stores.delete(sessionId);
    };

    const register = (id: string, make: (store: EditStore) => AgentTool): void => {
        const sample = make(new EditStore());
        const impl: ToolImpl = {
            execute(args, context, onUpdate) {
                return make(storeOf(context.sessionId)).execute(context.toolCallId, args as never, context.signal, onUpdate);
            },
            releaseSession,
        };
        registry.register(
            {
                id,
                name: sample.name,
                description: sample.description,
                parameters: JSON.parse(JSON.stringify(sample.parameters)),
                provider: BUILTIN_PROVIDER,
                version: BUILTIN_VERSION,
                finish: false,
                concurrency: sample.concurrency === "exclusive" ? "exclusive" : "shared",
                strict: sample.strict === true,
                ...(sample.customFormat === undefined ? {} : {customFormat: JSON.parse(JSON.stringify(sample.customFormat))}),
            },
            impl,
        );
    };

    if (options.read !== undefined) {
        const read = options.read;
        register("builtin.read", (store) => createReadTool({...read, store}));
    }
    if (options.edit !== undefined) {
        const edit = options.edit;
        register("builtin.edit", (store) => createEditTool({...edit, store}));
    }
}
