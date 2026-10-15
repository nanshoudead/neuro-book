/**
 * 独立服务的登记：`<书库>/.serve.json`（docs/specs/story/cli-skill.md 的“副作用与数据”）。只有持有服务锁的
 * `serve` 写它（src/server/registry.ts）；命令行读它，判断是否有效后用来给出查看器地址。
 */

import {readFile} from "node:fs/promises";
import {join} from "node:path";

import {systemErrorCode} from "../core/errors";

export const REGISTRATION_FILE = ".serve.json";
export const LOCK_FILE = ".serve.lock";
/** 服务在每个响应（含 401）上带的实例号响应头。 */
export const INSTANCE_HEADER = "x-nbstory-instance";
/** 判定登记是否有效时等服务回应的上限：连不上的本机端口通常立刻拒绝，这只防卡住。 */
const PROBE_TIMEOUT_MS = 300;

export interface Registration {
    instance: string;
    url: string;
    port: number;
    pid: number;
}

export async function readRegistration(library: string): Promise<Registration | null> {
    try {
        const value = JSON.parse(await readFile(join(library, REGISTRATION_FILE), "utf8")) as unknown;
        if (typeof value === "object" && value !== null && "instance" in value && "url" in value && typeof value.instance === "string" && typeof value.url === "string") {
            return value as Registration;
        }
        return null;
    } catch (error) {
        if (systemErrorCode(error) === "ENOENT" || error instanceof SyntaxError) return null;
        throw error;
    }
}

/** 登记有效：地址能连上，且那里的服务报出的实例号与登记相同。 */
export async function isLive(registration: Registration): Promise<boolean> {
    try {
        const response = await fetch(`${registration.url}/`, {redirect: "manual", signal: AbortSignal.timeout(PROBE_TIMEOUT_MS)});
        await response.body?.cancel();
        return response.headers.get(INSTANCE_HEADER) === registration.instance;
    } catch {
        // 连不上、超时都说明这份登记无效（服务已退出或端口换了主人）。
        return false;
    }
}

/** 有效的登记；没有或无效时为 null。 */
export async function liveRegistration(library: string): Promise<Registration | null> {
    const registration = await readRegistration(library);
    return registration && (await isLive(registration)) ? registration : null;
}
