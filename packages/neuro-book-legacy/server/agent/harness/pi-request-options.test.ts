import {mkdtempSync, readFileSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {describe, expect, it} from "vitest";
import {parsePiSimpleRequestOptions, piRequestAuthOptions} from "nbook/server/agent/harness/pi-request-options";
import {VERTEX_ADC_API_KEY} from "nbook/server/models/vertex-credentials";

describe("Pi simple request options", () => {
    it("保留 Pi 0.80.6 streamSimple 已确认支持的 JSON 参数", () => {
        const options = parsePiSimpleRequestOptions({
            temperature: 0.3,
            headers: {"x-test": "ok", "x-remove": null},
            websocketConnectTimeoutMs: 2_000,
            maxRetries: 1,
            maxRetryDelayMs: 3_000,
            metadata: {tenant: "test"},
            env: {AWS_REGION: "ap-southeast-1"},
            transport: "auto",
            cacheRetention: "long",
            thinkingBudgets: {low: 2_048, high: 16_384},
        });

        expect(options).toMatchObject({
            temperature: 0.3,
            maxRetries: 1,
            headers: {"x-test": "ok", "x-remove": null},
            env: {AWS_REGION: "ap-southeast-1"},
            thinkingBudgets: {low: 2_048, high: 16_384},
        });
    });

    it("运行时空配置使用默认重试次数，显式 0 关闭重试", () => {
        expect(parsePiSimpleRequestOptions({}).maxRetries).toBe(5);
        expect(parsePiSimpleRequestOptions({maxRetries: 0}).maxRetries).toBe(0);
    });

    it.each(["apiKey", "signal", "onPayload", "sessionId", "reasoning", "timeoutMs", "maxTokens", "bearerToken", "serviceTier"])(
        "拒绝 runtime-owned 或 streamSimple 不生效字段 %s",
        (key) => {
            expect(() => parsePiSimpleRequestOptions({[key]: "invalid"})).toThrow("Unrecognized key");
        },
    );

    it("自定义 OpenAI-compatible 空 key 使用内部无认证占位值", () => {
        expect(piRequestAuthOptions({api: "openai-completions"})).toEqual({apiKey: "neurobook-no-auth"});
        expect(piRequestAuthOptions({api: "openai-responses"})).toEqual({apiKey: "neurobook-no-auth"});
        expect(piRequestAuthOptions({api: "anthropic-messages"})).toEqual({});
        expect(piRequestAuthOptions({api: "google-generative-ai"})).toEqual({});
    });

    it("Vertex 服务账号 JSON 落成凭据文件，并保留调用方指定的项目和区域", () => {
        const directory = mkdtempSync(join(tmpdir(), "vertex-credentials-"));
        const document = `{
            "type": "service_account",
            "project_id": "demo-project",
            "private_key": "-----BEGIN PRIVATE KEY-----\\nMIIB\\n-----END PRIVATE KEY-----\\n",
            "client_email": "vertex@demo-project.iam.gserviceaccount.com"
        }`;
        try {
            const first = piRequestAuthOptions({
                api: "google-vertex",
                apiKey: document,
                env: {GOOGLE_CLOUD_LOCATION: "us-central1", GOOGLE_CLOUD_PROJECT: "override-project"},
                vertexCredentialsDirectory: directory,
            });
            const second = piRequestAuthOptions({
                api: "google-vertex",
                apiKey: document,
                vertexCredentialsDirectory: directory,
            });

            expect(first).toMatchObject({
                apiKey: VERTEX_ADC_API_KEY,
                env: {
                    GOOGLE_CLOUD_PROJECT: "override-project",
                    GOOGLE_CLOUD_LOCATION: "us-central1",
                },
            });
            expect(second.env).toMatchObject({
                GOOGLE_CLOUD_PROJECT: "demo-project",
                GOOGLE_CLOUD_LOCATION: "global",
            });
            expect(first.env?.GOOGLE_APPLICATION_CREDENTIALS).toBe(second.env?.GOOGLE_APPLICATION_CREDENTIALS);
            expect(readFileSync(first.env?.GOOGLE_APPLICATION_CREDENTIALS ?? "", "utf8")).toBe(document.trim());
            expect(JSON.stringify(first)).not.toContain("BEGIN PRIVATE KEY");
        } finally {
            rmSync(directory, {recursive: true, force: true});
        }
    });

    it("Vertex API key 原样传递，不合法的服务账号 JSON 不会被当成密钥发出去", () => {
        const directory = mkdtempSync(join(tmpdir(), "vertex-credentials-"));
        try {
            expect(piRequestAuthOptions({
                api: "google-vertex",
                apiKey: "AQ.vertex-key",
                vertexCredentialsDirectory: directory,
            })).toEqual({apiKey: "AQ.vertex-key"});
            expect(() => piRequestAuthOptions({
                api: "google-vertex",
                apiKey: '{"type":"service_account","private_key":"-----BEGIN PRIVATE KEY-----\\nsecret\\n-----END PRIVATE KEY-----\\n"}',
                vertexCredentialsDirectory: directory,
            })).toThrow("service_account");
        } finally {
            rmSync(directory, {recursive: true, force: true});
        }
    });

    it("Bedrock API key 映射到 bearer token env 并保留其他 provider env", () => {
        expect(piRequestAuthOptions({
            api: "bedrock-converse-stream",
            apiKey: "bedrock-token",
            env: {AWS_REGION: "us-west-2"},
        })).toEqual({
            env: {
                AWS_REGION: "us-west-2",
                AWS_BEARER_TOKEN_BEDROCK: "bedrock-token",
            },
        });
    });
});
