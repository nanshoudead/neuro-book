import {describe, expect, it} from "vitest";
import {resolveProviderCredential} from "nbook/server/models/provider-credential";

describe("Provider credential resolver", () => {
    it("saved 只使用身份匹配连接的已保存 Secret", () => {
        expect(resolveProviderCredential(draft("request-secret"), "saved", config()).options.apiKey).toBe("saved-secret");
    });

    it("saved 拒绝同ID的任一连接身份变化或缺失配置", () => {
        const variants = [
            {...draft("request-secret"), options: {...draft("").options, baseURL: "https://evil.example/v1"}},
            {...draft("request-secret"), options: {...draft("").options, proxy: "http://127.0.0.1:9000"}},
            {...draft("request-secret"), modelApi: "openai-responses" as const},
        ];
        for (const variant of variants) {
            expect(() => resolveProviderCredential(variant, "saved", config()))
                .toThrow("连接身份与已保存配置不一致");
        }
        expect(() => resolveProviderCredential({...draft("request-secret"), id: "missing"}, "saved", config()))
            .toThrow("连接身份与已保存配置不一致");
    });

    it("provided 与 cleared 不读取已保存 Secret", () => {
        expect(resolveProviderCredential(draft("request-secret"), "provided", config()).options.apiKey).toBe("request-secret");
        expect(resolveProviderCredential(draft("request-secret"), "cleared", config()).options.apiKey).toBe("");
    });
});

function draft(apiKey: string) {
    return {id: "local", name: "Local", modelApi: "openai-completions" as const, options: {apiKey, baseURL: "https://example.com/v1", proxy: "", timeoutMs: null, requestOptions: {}}};
}

function config() {
    return {models: {defaultModelKey: null, providers: {local: {name: "Local", enabled: true, modelApi: "openai-completions" as const, options: {apiKey: "saved-secret", baseURL: "https://example.com/v1", proxy: "", timeoutMs: null, requestOptions: {}}, models: {}}}}};
}
