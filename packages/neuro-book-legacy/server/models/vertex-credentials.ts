import {createHash} from "node:crypto";
import {mkdirSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";

/**
 * Pi 的 google-vertex 见到这个 apiKey 就改走 Application Default Credentials。
 * 服务账号 JSON 不能原样放进 apiKey，否则会被当成 Bearer 发出去。
 */
export const VERTEX_ADC_API_KEY = "gcp-vertex-credentials";

/** Gemini on Vertex 的默认发布区域。调用方用 GOOGLE_CLOUD_LOCATION 覆盖。 */
export const DEFAULT_VERTEX_LOCATION = "global";

export type VertexServiceAccount = {
    projectId: string;
    /** 用户贴进来的原文。重序列化会丢掉 Google 密钥文件里的未知字段。 */
    document: string;
};

type ServiceAccountDocument = {
    type: "service_account";
    project_id: string;
    private_key: string;
    client_email: string;
};

/** 系统临时目录下的凭据文件。内容与配置里的密钥相同，只为满足 Pi 只读 keyFilename。 */
export function defaultVertexCredentialsDirectory(): string {
    return join(tmpdir(), "neuro-book-vertex-credentials");
}

/**
 * 识别贴进密钥框的 Google 服务账号 JSON。
 *
 * 不以 `{` 开头的字符串是 API key，返回 null。
 * 以 `{` 开头但不是合法服务账号时抛错，避免把整份密钥当 Bearer 发出去。
 */
export function readVertexServiceAccount(value: string): VertexServiceAccount | null {
    const document = value.trim();
    if (!document.startsWith("{")) {
        return null;
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(document);
    } catch {
        throw new Error("Vertex 凭据不是合法的 JSON。");
    }
    if (!isServiceAccount(parsed)) {
        throw new Error("Vertex 凭据必须是 type 为 service_account 的服务账号 JSON。");
    }
    return {projectId: parsed.project_id.trim(), document};
}

/** 按原文哈希落盘。同一份密钥重复调用复用已有文件，不把私钥写进路径。 */
export function writeVertexServiceAccountFile(account: VertexServiceAccount, directory: string): string {
    mkdirSync(directory, {recursive: true, mode: 0o700});
    const hash = createHash("sha256").update(account.document).digest("hex").slice(0, 32);
    const path = join(directory, `vertex-${hash}.json`);
    try {
        writeFileSync(path, account.document, {encoding: "utf8", mode: 0o600, flag: "wx"});
    } catch (error) {
        if (!isErrno(error, "EEXIST")) {
            throw error;
        }
    }
    return path;
}

function isServiceAccount(value: unknown): value is ServiceAccountDocument {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return false;
    }
    const record = value as Record<string, unknown>;
    return record.type === "service_account"
        && typeof record.project_id === "string"
        && record.project_id.trim().length > 0
        && typeof record.private_key === "string"
        && record.private_key.includes("PRIVATE KEY")
        && typeof record.client_email === "string"
        && record.client_email.includes("@");
}

function isErrno(error: unknown, code: string): boolean {
    return typeof error === "object" && error !== null && "code" in error && (error as {code?: unknown}).code === code;
}
