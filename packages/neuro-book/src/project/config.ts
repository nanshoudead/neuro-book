/**
 * 项目宿主的启动参数：服务端起子进程时经环境变量交入。子进程只由服务端启动，参数不对是服务端的错，
 * 因此只做结构校验，不做目录校验（服务端登记与创建时已校验过）。
 */

import {join} from "node:path";

import type {PluginDescriptor} from "@notnotype/nb-runtime/plugins";
import {Type} from "typebox";
import {Value} from "typebox/value";

export interface ProjectConfig {
    readonly stateRoot: string;
    readonly id: string;
    readonly name: string;
    readonly generation: number;
    /** 项目目录的真实路径。 */
    readonly root: string;
    /** 诊断文件出口获授的日志位置：每个项目一个目录，与服务端的日志位置各自持有授予。 */
    readonly logDirectory: string;
    /**
     * 服务端本次启动登记、且在项目实例登记的第三方插件（docs/specs/runtime/plugin-install.md）：子进程不自己读登记表，
     * 同一次服务端运行中先后打开的作品看到同一个集合。
     */
    readonly thirdParty: ReadonlyArray<PluginDescriptor>;
}

const ThirdPartySchema = Type.Array(Type.Object({
    id: Type.String({minLength: 1}),
    version: Type.String({minLength: 1}),
    locations: Type.Array(Type.String({minLength: 1})),
    contributions: Type.Optional(Type.Array(Type.Object({capability: Type.String({minLength: 1}), id: Type.String({minLength: 1}), declaration: Type.Unknown()}, {additionalProperties: false}))),
}, {additionalProperties: false}));

export class ProjectConfigError extends Error {
    readonly variable: string;

    constructor(variable: string, message: string) {
        super(message);
        this.name = "ProjectConfigError";
        this.variable = variable;
    }
}

/** 服务端交给项目宿主的环境变量。 */
export const PROJECT_ENV = {
    stateRoot: "NBOOK_STATE_ROOT",
    id: "NBOOK_PROJECT_ID",
    name: "NBOOK_PROJECT_NAME",
    generation: "NBOOK_PROJECT_GENERATION",
    root: "NBOOK_PROJECT_ROOT",
    /** JSON 数组；没有第三方插件时可以不给。 */
    thirdParty: "NBOOK_THIRD_PARTY_PLUGINS",
} as const;

export function readProjectConfig(env: Readonly<Record<string, string | undefined>>): ProjectConfig {
    const read = (variable: string): string => {
        const value = env[variable]?.trim();
        if (!value) throw new ProjectConfigError(variable, `缺少 ${variable}`);
        return value;
    };
    const stateRoot = read(PROJECT_ENV.stateRoot);
    const name = read(PROJECT_ENV.name);
    const generationText = read(PROJECT_ENV.generation);
    const generation = Number(generationText);
    if (!/^[1-9]\d*$/.test(generationText) || !Number.isSafeInteger(generation)) {
        throw new ProjectConfigError(PROJECT_ENV.generation, `${PROJECT_ENV.generation} 必须是正整数，收到 ${generationText}`);
    }
    return {stateRoot, id: read(PROJECT_ENV.id), name, generation, root: read(PROJECT_ENV.root), logDirectory: join(stateRoot, "logs", "projects", name), thirdParty: readThirdParty(env[PROJECT_ENV.thirdParty])};
}

function readThirdParty(text: string | undefined): ReadonlyArray<PluginDescriptor> {
    if (text === undefined || text.trim() === "") return [];
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch {
        throw new ProjectConfigError(PROJECT_ENV.thirdParty, `${PROJECT_ENV.thirdParty} 不是合法 JSON`);
    }
    if (!Value.Check(ThirdPartySchema, parsed)) throw new ProjectConfigError(PROJECT_ENV.thirdParty, `${PROJECT_ENV.thirdParty} 不是插件描述的数组`);
    return parsed;
}
