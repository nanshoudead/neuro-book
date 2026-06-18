import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {randomUUID} from "node:crypto";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {Type} from "typebox";
import {defineAgentProfile} from "nbook/server/agent/profiles/define-agent-profile";
import {AgentProfileCatalog} from "nbook/server/agent/profiles/catalog";
import {toolset} from "nbook/server/agent/profiles/profile-tools";
import {defineLowCodeForm, type LowCodeFieldDefinition} from "nbook/server/low-code-form";
import {
    loadEffectiveConfigForAgentRuntime,
    readConfigBootstrap,
    readConfigEditorSnapshot,
    saveGlobalConfig,
    saveProjectConfig,
} from "nbook/server/config/config-service";

const createdRoots: string[] = [];
const catalog = createCatalog(["leader.default", "leader.assets", "custom.agent", "writer"]);
let globalConfigBackupPath: string | null = null;

describe("config service", {timeout: 30_000}, () => {
    beforeEach(async () => {
        globalConfigBackupPath = await moveGlobalConfigAside();
        await createProjectFixture();
    });

    afterEach(async () => {
        await Promise.all(createdRoots.splice(0).map((root) => fs.rm(root, {recursive: true, force: true})));
        await fs.rm(path.join("workspace", ".nbook", "config.json"), {force: true});
        await fs.rm(path.join("workspace", "config-test-project"), {recursive: true, force: true});
        if (globalConfigBackupPath) {
            await fs.mkdir(path.join("workspace", ".nbook"), {recursive: true});
            await fs.rename(globalConfigBackupPath, path.join("workspace", ".nbook", "config.json"));
            globalConfigBackupPath = null;
        }
    });

    it("无配置文件时返回默认 Global + Project 快照且不创建文件", async () => {
        const snapshot = await readConfigEditorSnapshot({workspaceKind: "novel", projectPath: "workspace/config-test-project"}, catalog);

        expect(snapshot.defaultProfileSettings.effectiveProfileKey).toBe("leader.default");
        expect(snapshot.effective.ui).toMatchObject({costCurrency: "USD"});
        await expect(fs.access(path.join("workspace", ".nbook", "config.json"))).rejects.toMatchObject({code: "ENOENT"});
        await expect(fs.access(path.join("workspace", "config-test-project", ".nbook", "config.json"))).rejects.toMatchObject({code: "ENOENT"});
    });

    it("Global UI 费用显示币种可以保存并被 bootstrap 读回", async () => {
        const snapshot = await saveGlobalConfig({
            ui: {
                theme: "sepia",
                costCurrency: "CNY",
            },
        }, {workspaceKind: "user-assets"});
        const bootstrap = await readConfigBootstrap({workspaceKind: "user-assets"}, catalog);

        expect(snapshot.global.ui?.costCurrency).toBe("CNY");
        expect(snapshot.effective.ui).toMatchObject({costCurrency: "CNY"});
        expect(bootstrap.ui.costCurrency).toBe("CNY");
    });

    it("非法 UI 费用显示币种会回退为 USD", async () => {
        const snapshot = await saveGlobalConfig({
            ui: {
                theme: "sepia",
                costCurrency: "EUR",
            },
        } as never, {workspaceKind: "user-assets"});

        expect(snapshot.global.ui?.costCurrency).toBe("USD");
        expect(snapshot.effective.ui).toMatchObject({costCurrency: "USD"});
    });

    it("Project Config 在 project.yaml 损坏时仍可读写", async () => {
        await fs.writeFile(path.join("workspace", "config-test-project", "project.yaml"), "kind: novel\ntitle: Config\nsummary: ''\na'a\n", "utf-8");

        const snapshot = await saveProjectConfig({
            agent: {defaultProfileKey: "custom.agent"},
        }, {workspaceKind: "novel", projectPath: "workspace/config-test-project"});

        expect(snapshot.defaultProfileSettings.effectiveProfileKey).toBe("custom.agent");
        await fs.access(path.join("workspace", "config-test-project", ".nbook", "config.json"));
    });

    it("Global secret 写回缺失 value 时保留旧 API key", async () => {
        await saveGlobalConfig({
            models: {
                default: "deepseek/deepseek-v4-flash",
                providers: [{
                    id: "deepseek",
                    name: "DeepSeek",
                    api: null,
                    options: {
                        apiKey: {configured: false, maskedValue: null, value: "sk-test-123456"},
                        baseURL: "",
                        proxy: "",
                        timeoutMs: null,
                        requestOptions: {},
                    },
                    models: [{
                        id: "deepseek-v4-flash",
                        name: "DeepSeek V4 Flash",
                        group: null,
                        enabled: true,
                        contextWindowTokens: 128000,
                    }],
                }],
            },
        }, {workspaceKind: "user-assets"});

        const snapshot = await saveGlobalConfig({
            models: {
                default: "deepseek/deepseek-v4-flash",
                providers: [{
                    id: "deepseek",
                    name: "DeepSeek",
                    api: null,
                    options: {
                        apiKey: {configured: true, maskedValue: "sk-t...3456"},
                        baseURL: "",
                        proxy: "",
                        timeoutMs: null,
                        requestOptions: {},
                    },
                    models: [{
                        id: "deepseek-v4-flash",
                        name: "DeepSeek V4 Flash",
                        group: null,
                        enabled: true,
                        contextWindowTokens: 128000,
                    }],
                }],
            },
        }, {workspaceKind: "user-assets"});
        const raw = JSON.parse(await fs.readFile(path.join("workspace", ".nbook", "config.json"), "utf-8")) as {
            models?: {providers?: Array<{options: {apiKey: string}}>}
        };

        expect(raw.models?.providers?.[0]?.options.apiKey).toBe("sk-test-123456");
        expect(snapshot.modelSettings.providers[0]?.options.apiKey).toEqual({
            configured: true,
            maskedValue: "sk-t...3456",
        });
    });

    it("Global web secret 写回缺失 value 时保留旧 API key 并脱敏展示", async () => {
        await saveGlobalConfig({
            web: {
                search: {
                    order: ["tavily", "brave"],
                    providers: {
                        tavily: {
                            enabled: true,
                            apiKey: {configured: false, maskedValue: null, value: "tvly-secret-123456"},
                        },
                        brave: {
                            enabled: true,
                            apiKey: {configured: false, maskedValue: null, value: "brave-secret-123456"},
                            country: "US",
                            searchLang: "en",
                        },
                    },
                },
            },
        }, {workspaceKind: "user-assets"});

        const snapshot = await saveGlobalConfig({
            web: {
                search: {
                    order: ["brave", "tavily"],
                    providers: {
                        tavily: {
                            enabled: true,
                            apiKey: {configured: true, maskedValue: "tvly...3456"},
                        },
                        brave: {
                            enabled: true,
                            apiKey: {configured: true, maskedValue: "brav...3456"},
                            country: "JP",
                            searchLang: "ja",
                        },
                    },
                },
            },
        }, {workspaceKind: "user-assets"});
        const raw = JSON.parse(await fs.readFile(path.join("workspace", ".nbook", "config.json"), "utf-8")) as {
            web?: {search?: {providers?: {tavily?: {apiKey?: string}; brave?: {apiKey?: string}}}}
        };

        expect(raw.web?.search?.providers?.tavily?.apiKey).toBe("tvly-secret-123456");
        expect(raw.web?.search?.providers?.brave?.apiKey).toBe("brave-secret-123456");
        expect(snapshot.global.web?.search?.providers?.tavily?.apiKey).toEqual({
            configured: true,
            maskedValue: "tvly...3456",
        });
        expect(snapshot.effective.web.search.order).toEqual(["brave", "tavily"]);
        expect(snapshot.effective.web.search.providers.brave.country).toBe("JP");
    });

    it("Global web 部分写回会保留模型配置段", async () => {
        await saveGlobalConfig({
            models: {
                default: "deepseek/deepseek-v4-flash",
                providers: [{
                    id: "deepseek",
                    name: "DeepSeek",
                    api: null,
                    options: {
                        apiKey: {configured: false, maskedValue: null, value: "sk-keep-model"},
                        baseURL: "",
                        proxy: "",
                        timeoutMs: null,
                        requestOptions: {},
                    },
                    models: [{
                        id: "deepseek-v4-flash",
                        name: "DeepSeek V4 Flash",
                        group: null,
                        enabled: true,
                        contextWindowTokens: 128000,
                    }],
                }],
            },
        }, {workspaceKind: "user-assets"});

        const snapshot = await saveGlobalConfig({
            web: {
                search: {
                    order: ["brave", "tavily"],
                    providers: {
                        brave: {
                            enabled: true,
                            apiKey: {configured: false, maskedValue: null, value: "brave-web-key"},
                            country: "US",
                            searchLang: "en",
                        },
                    },
                },
            },
        }, {workspaceKind: "user-assets"});

        expect(snapshot.modelSettings.defaultModelKey).toBe("deepseek/deepseek-v4-flash");
        expect(snapshot.modelSettings.providers[0]?.options.apiKey.configured).toBe(true);
        expect(snapshot.effective.web.search.providers.brave.enabled).toBe(true);
        expect(snapshot.effective.web.search.providers.brave.apiKey).toBe("brave-web-key");
    });

    it("Global 部分写回会保留未提交的配置段", async () => {
        await saveGlobalConfig({
            auth: {enabled: true},
            models: {
                default: "deepseek/deepseek-v4-flash",
                providers: [{
                    id: "deepseek",
                    name: "DeepSeek",
                    api: null,
                    options: {
                        apiKey: {configured: false, maskedValue: null, value: "sk-keep-me"},
                        baseURL: "https://api.deepseek.com/v1",
                        proxy: "",
                        timeoutMs: 180000,
                        requestOptions: {},
                    },
                    models: [{
                        id: "deepseek-v4-flash",
                        name: "DeepSeek V4 Flash",
                        group: null,
                        enabled: true,
                        contextWindowTokens: 128000,
                    }],
                }],
            },
        }, {workspaceKind: "user-assets"});

        const snapshot = await saveGlobalConfig({
            auth: {enabled: false},
        }, {workspaceKind: "user-assets"});

        expect(snapshot.effective.auth.enabled).toBe(false);
        expect(snapshot.modelSettings.defaultModelKey).toBe("deepseek/deepseek-v4-flash");
        expect(snapshot.modelSettings.providers).toHaveLength(1);
        const raw = JSON.parse(await fs.readFile(path.join("workspace", ".nbook", "config.json"), "utf-8")) as {
            auth?: {enabled?: boolean};
            models?: {providers?: Array<{options: {apiKey: string}}>}
        };
        expect(raw.auth?.enabled).toBe(false);
        expect(raw.models?.providers?.[0]?.options.apiKey).toBe("sk-keep-me");
    });

    it("Global 模型写回会保留 Pi Model 字段", async () => {
        const snapshot = await saveGlobalConfig({
            models: {
                default: "custom/mimo-vl",
                providers: [{
                    id: "custom",
                    name: "Custom",
                    api: "openai-completions",
                    options: {
                        apiKey: {configured: false, maskedValue: null, value: "sk-custom"},
                        baseURL: "",
                        proxy: "",
                        timeoutMs: null,
                        requestOptions: {},
                    },
                    models: [{
                        id: "mimo-vl",
                        name: "Mimo Vision",
                        group: null,
                        enabled: true,
                        provider: "xiaomi-token-plan-cn",
                        api: "openai-completions",
                        baseUrl: "https://model.example/v1",
                        reasoning: true,
                        input: ["text", "image"],
                        maxTokens: 1234,
                        cost: {
                            input: 1,
                            output: 2,
                            cacheRead: 3,
                            cacheWrite: 4,
                        },
                        compat: {
                            thinkingFormat: "deepseek",
                            supportsStrictMode: false,
                        },
                        contextWindowTokens: 98765,
                    }],
                }],
            },
        }, {workspaceKind: "user-assets"});

        const visionModel = snapshot.modelSettings.providers[0]?.models.find((model) => model.id === "mimo-vl");

        expect(visionModel).toMatchObject({
            provider: "xiaomi-token-plan-cn",
            api: "openai-completions",
            baseUrl: "https://model.example/v1",
            reasoning: true,
            input: ["text", "image"],
            maxTokens: 1234,
            cost: {
                input: 1,
                output: 2,
                cacheRead: 3,
                cacheWrite: 4,
            },
            compat: {
                thinkingFormat: "deepseek",
                supportsStrictMode: false,
            },
            contextWindowTokens: 98765,
        });
        expect(snapshot.modelSettings.providers[0]?.api).toBe("openai-completions");
    });

    it("Project Config 可以覆盖默认模型、embedding 模型与默认 profile，但拒绝全局字段", async () => {
        await saveGlobalConfig({
            models: {
                default: "deepseek/a",
                providers: [{
                    id: "deepseek",
                    name: "DeepSeek",
                    api: null,
                    options: {apiKey: {configured: false, maskedValue: null}, baseURL: "", proxy: "", timeoutMs: null, requestOptions: {}},
                    models: [
                        {id: "a", name: "A", group: null, enabled: true, contextWindowTokens: null},
                        {id: "b", name: "B", group: null, enabled: true, contextWindowTokens: null},
                    ],
                }],
            },
            embedding: {
                enabled: true,
                provider: "openai-compatible",
                model: "global-embed",
                dimensions: 1536,
                apiKey: {configured: false, maskedValue: null, value: "sk-embedding"},
                baseURL: "https://embedding.example/v1",
                timeoutMs: 30000,
                requestOptions: {encoding_format: "float"},
            },
            agent: {
                defaultProfileKey: {novel: "leader.default", userAssets: "leader.assets"},
                profiles: {},
            },
        }, {workspaceKind: "novel", projectPath: "workspace/config-test-project"});

        const snapshot = await saveProjectConfig({
            models: {default: "deepseek/b"},
            embedding: {model: "project-embed", dimensions: 768},
            agent: {defaultProfileKey: "custom.agent"},
        }, {workspaceKind: "novel", projectPath: "workspace/config-test-project"});

        expect(snapshot.effective.models.defaultModelKey).toBe("deepseek/b");
        expect(snapshot.effective.embedding).toMatchObject({
            enabled: true,
            provider: "openai-compatible",
            model: "project-embed",
            dimensions: 768,
            apiKey: "sk-embedding",
            baseURL: "https://embedding.example/v1",
            timeoutMs: 30000,
            requestOptions: {encoding_format: "float"},
        });
        expect(snapshot.embeddingSettings.global.apiKey).toEqual({
            configured: true,
            maskedValue: "sk-e...ding",
        });
        expect(snapshot.embeddingSettings.project).toEqual({
            model: "project-embed",
            dimensions: 768,
        });
        expect(snapshot.effective.agent.defaultProfileKey.novel).toBe("custom.agent");
        expect(snapshot.defaultProfileSettings.effectiveProfileKey).toBe("custom.agent");
        await expect(saveProjectConfig({
            models: {
                default: "deepseek/b",
                providers: [],
            } as never,
        }, {workspaceKind: "novel", projectPath: "workspace/config-test-project"})).rejects.toMatchObject({statusCode: 400});
        await expect(saveProjectConfig({
            embedding: {
                model: "bad",
                baseURL: "https://project-should-not-own-service.example/v1",
            } as never,
        }, {workspaceKind: "novel", projectPath: "workspace/config-test-project"})).rejects.toMatchObject({statusCode: 400});
    });

    it("Project Config 的 null 覆盖会回落到 Global Config", async () => {
        await saveGlobalConfig({
            models: {
                default: "deepseek/a",
                providers: [{
                    id: "deepseek",
                    name: "DeepSeek",
                    api: null,
                    options: {apiKey: {configured: false, maskedValue: null}, baseURL: "", proxy: "", timeoutMs: null, requestOptions: {}},
                    models: [
                        {id: "a", name: "A", group: null, enabled: true, contextWindowTokens: null},
                    ],
                }],
            },
            agent: {
                defaultProfileKey: {novel: "leader.default", userAssets: "leader.assets"},
                profiles: {},
            },
        }, {workspaceKind: "novel", projectPath: "workspace/config-test-project"});

        const snapshot = await saveProjectConfig({
            models: {default: null},
            agent: {defaultProfileKey: null},
        }, {workspaceKind: "novel", projectPath: "workspace/config-test-project"});

        expect(snapshot.effective.models.defaultModelKey).toBe("deepseek/a");
        expect(snapshot.effective.agent.defaultProfileKey.novel).toBe("leader.default");
        expect(snapshot.defaultProfileSettings.effectiveProfileKey).toBe("leader.default");
    });

    it("Global embedding 启用后空模型和空维度会写入默认值", async () => {
        const snapshot = await saveGlobalConfig({
            embedding: {
                enabled: true,
                provider: "openai-compatible",
                model: null,
                dimensions: null,
                apiKey: {configured: false, maskedValue: null, value: "sk-embedding"},
                baseURL: "https://embedding.example/v1",
                timeoutMs: 30000,
                requestOptions: {},
            },
        }, {workspaceKind: "novel", projectPath: "workspace/config-test-project"});

        expect(snapshot.global.embedding).toMatchObject({
            enabled: true,
            model: "text-embedding-3-small",
            dimensions: 1536,
            timeoutMs: 30000,
        });
        expect(snapshot.effective.embedding).toMatchObject({
            enabled: true,
            model: "text-embedding-3-small",
            dimensions: 1536,
            timeoutMs: 30000,
        });
    });

    it("Agent runtime 配置读取会合并 Project embedding 覆盖", async () => {
        await saveGlobalConfig({
            embedding: {
                enabled: true,
                provider: "openai-compatible",
                model: "global-embed",
                dimensions: 1536,
                apiKey: {configured: false, maskedValue: null, value: "sk-embedding"},
                baseURL: "https://embedding.example/v1",
                timeoutMs: 30000,
                requestOptions: {},
            },
        }, {workspaceKind: "novel", projectPath: "workspace/config-test-project"});
        await saveProjectConfig({
            embedding: {
                model: "project-embed",
                dimensions: 768,
            },
        }, {workspaceKind: "novel", projectPath: "workspace/config-test-project"});

        const effective = await loadEffectiveConfigForAgentRuntime({
            workspaceRoot: "workspace",
            projectPath: "workspace/config-test-project",
        });

        expect(effective.embedding).toMatchObject({
            enabled: true,
            provider: "openai-compatible",
            model: "project-embed",
            dimensions: 768,
            apiKey: "sk-embedding",
            baseURL: "https://embedding.example/v1",
        });
    });

    it("Agent runtime 配置读取支持外部 Project Workspace 绝对 projectPath", async () => {
        const externalProjectRoot = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "nbook-external-project-")), "external-project");
        createdRoots.push(path.dirname(externalProjectRoot));
        await fs.mkdir(path.join(externalProjectRoot, ".nbook"), {recursive: true});
        await fs.writeFile(path.join(externalProjectRoot, "project.yaml"), [
            "kind: novel",
            "title: External Project",
            "summary: ''",
            "",
        ].join("\n"), "utf-8");
        await saveGlobalConfig({
            embedding: {
                enabled: true,
                provider: "openai-compatible",
                model: "global-embed",
                dimensions: 1536,
                apiKey: {configured: false, maskedValue: null, value: "sk-embedding"},
                baseURL: "https://embedding.example/v1",
                timeoutMs: 30000,
                requestOptions: {},
            },
        }, {workspaceKind: "novel", projectPath: "workspace/config-test-project"});
        await fs.writeFile(path.join(externalProjectRoot, ".nbook", "config.json"), JSON.stringify({
            embedding: {
                model: "external-embed",
                dimensions: 384,
            },
        }, null, 4), "utf-8");

        const effective = await loadEffectiveConfigForAgentRuntime({
            workspaceRoot: "workspace",
            projectPath: externalProjectRoot,
        });

        expect(effective.embedding).toMatchObject({
            enabled: true,
            provider: "openai-compatible",
            model: "external-embed",
            dimensions: 384,
            apiKey: "sk-embedding",
            baseURL: "https://embedding.example/v1",
        });
    });

    it("Agent Profile 模型默认参数支持 Project 覆盖并被 profile 继承", async () => {
        await saveGlobalConfig({
            agent: {
                defaultProfileKey: {novel: "leader.default", userAssets: "leader.assets"},
                profileModelDefaults: {
                    reasoningEffort: "high",
                    stream: false,
                },
                profiles: {
                    "leader.default": {
                        model: {
                            temperature: 0.4,
                        },
                    },
                },
            },
        }, {workspaceKind: "novel", projectPath: "workspace/config-test-project"});

        const snapshot = await saveProjectConfig({
            agent: {
                profileModelDefaults: {
                    topK: 5,
                    reasoningEffort: "low",
                },
                profiles: {
                    "leader.default": {
                        model: {
                            reasoningEffort: "medium",
                        },
                    },
                },
            },
        }, {workspaceKind: "novel", projectPath: "workspace/config-test-project"});

        const leader = snapshot.agentProfileSettings.agentProfiles.find((profile) => profile.profileKey === "leader.default");
        const assets = snapshot.agentProfileSettings.agentProfiles.find((profile) => profile.profileKey === "leader.assets");

        expect(snapshot.agentProfileSettings.profileModelDefaults).toMatchObject({
            reasoningEffort: "low",
            stream: false,
            topK: 5,
        });
        expect(leader?.model).toMatchObject({
            temperature: 0.4,
            topK: 5,
            reasoningEffort: "medium",
            stream: false,
        });
        expect(assets?.model).toMatchObject({
            topK: 5,
            reasoningEffort: "low",
            stream: false,
        });
    });

    it("Project 只覆盖 Agent Profile 默认参数时也会更新已有 Global profile 的 effective model", async () => {
        await saveGlobalConfig({
            agent: {
                defaultProfileKey: {novel: "leader.default", userAssets: "leader.assets"},
                profileModelDefaults: {
                    reasoningEffort: "off",
                    stream: true,
                },
                profiles: {
                    "leader.default": {
                        model: {
                            temperature: 0.3,
                        },
                    },
                },
            },
        }, {workspaceKind: "novel", projectPath: "workspace/config-test-project"});

        const snapshot = await saveProjectConfig({
            agent: {
                profileModelDefaults: {
                    reasoningEffort: "xhigh",
                },
            },
        }, {workspaceKind: "novel", projectPath: "workspace/config-test-project"});

        const leader = snapshot.agentProfileSettings.agentProfiles.find((profile) => profile.profileKey === "leader.default");

        expect(leader?.model).toMatchObject({
            temperature: 0.3,
            reasoningEffort: "xhigh",
            stream: true,
        });
    });

    it("Agent Profile settings 默认只返回轻量列表且不解析低代码 options", async () => {
        const optionsProvider = vi.fn(() => [
            {value: "default-style", label: "默认文风"},
            {value: "cinematic", label: "电影感"},
        ]);
        const lightCatalog = createCatalog(["writer"], {writingStyleOptions: optionsProvider});
        const snapshot = await readConfigEditorSnapshot({workspaceKind: "user-assets"}, lightCatalog);
        const writer = snapshot.agentProfileSettings.agentProfiles.find((profile) => profile.profileKey === "writer");

        expect(writer?.settings).toBeNull();
        expect(writer?.model).toMatchObject({stream: true});
        expect(optionsProvider).not.toHaveBeenCalled();
    });

    it("Agent Profile settings 完整模式只读取带 settings form 的 runtime profile", async () => {
        const profileCatalog = createCatalog(["leader.default", "leader.assets", "custom.agent", "writer"]);
        const getSpy = vi.spyOn(profileCatalog, "get");

        try {
            const snapshot = await readConfigEditorSnapshot({workspaceKind: "user-assets"}, profileCatalog, {
                includeAgentProfileSettings: true,
            });
            const writer = snapshot.agentProfileSettings.agentProfiles.find((profile) => profile.profileKey === "writer");

            expect(writer?.settings?.form.fields.map((field) => field.path)).toEqual(["writingStylePreset", "narrativePerson"]);
            expect(getSpy).toHaveBeenCalledTimes(1);
            expect(getSpy).toHaveBeenCalledWith("writer");
        } finally {
            getSpy.mockRestore();
        }
    });

    it("Agent Profile settings 支持 Global 保存并返回 form 与 effective value", async () => {
        const snapshot = await saveGlobalConfig({
            agent: {
                defaultProfileKey: {novel: "leader.default", userAssets: "leader.assets"},
                profiles: {
                    writer: {
                        model: {},
                        settings: {
                            writingStylePreset: "cinematic",
                            narrativePerson: "first",
                        },
                    },
                },
            },
        }, {workspaceKind: "user-assets"}, catalog, {includeAgentProfileSettings: true});
        const writer = snapshot.agentProfileSettings.agentProfiles.find((profile) => profile.profileKey === "writer");

        expect(writer?.settings?.form.fields.map((field) => field.path)).toEqual(["writingStylePreset", "narrativePerson"]);
        expect(writer?.settings?.value).toMatchObject({
            writingStylePreset: "cinematic",
            narrativePerson: "first",
        });
        expect(writer?.settings?.inheritedValue).toMatchObject({
            writingStylePreset: "default-style",
            narrativePerson: "third",
        });
        expect(writer?.settings?.globalPatch).toEqual({
            writingStylePreset: "cinematic",
            narrativePerson: "first",
        });
    });

    it("Agent Profile settings 支持 Project patch 覆盖与继承", async () => {
        await saveGlobalConfig({
            agent: {
                defaultProfileKey: {novel: "leader.default", userAssets: "leader.assets"},
                profiles: {
                    writer: {
                        model: {},
                        settings: {
                            writingStylePreset: "cinematic",
                            narrativePerson: "first",
                        },
                    },
                },
            },
        }, {workspaceKind: "novel", projectPath: "workspace/config-test-project"}, catalog);

        const overrideSnapshot = await saveProjectConfig({
            agent: {
                profiles: {
                    writer: {
                        model: {},
                        settings: {
                            narrativePerson: "second",
                        },
                    },
                },
            },
        }, {workspaceKind: "novel", projectPath: "workspace/config-test-project"}, catalog, {includeAgentProfileSettings: true});
        const overridden = overrideSnapshot.agentProfileSettings.agentProfiles.find((profile) => profile.profileKey === "writer");

        expect(overridden?.settings?.value).toMatchObject({
            writingStylePreset: "cinematic",
            narrativePerson: "second",
        });
        expect(overridden?.settings?.inheritedValue).toMatchObject({
            writingStylePreset: "cinematic",
            narrativePerson: "first",
        });
        expect(overridden?.settings?.projectPatch).toEqual({
            narrativePerson: "second",
        });

        const inheritedSnapshot = await saveProjectConfig({
            agent: {
                profiles: {
                    writer: {
                        model: {},
                        settings: {},
                    },
                },
            },
        }, {workspaceKind: "novel", projectPath: "workspace/config-test-project"}, catalog, {includeAgentProfileSettings: true});
        const inherited = inheritedSnapshot.agentProfileSettings.agentProfiles.find((profile) => profile.profileKey === "writer");

        expect(inherited?.settings?.value).toMatchObject({
            writingStylePreset: "cinematic",
            narrativePerson: "first",
        });
        expect(inherited?.settings?.projectPatch).toEqual({});
    });

    it("Agent Profile settings 保存 Project patch 时按继承后的 effective value 校验", async () => {
        await saveGlobalConfig({
            agent: {
                defaultProfileKey: {novel: "leader.default", userAssets: "leader.assets"},
                profiles: {
                    writer: {
                        model: {},
                        settings: {
                            writingStylePreset: "cross-invalid",
                        },
                    },
                },
            },
        }, {workspaceKind: "novel", projectPath: "workspace/config-test-project"}, catalog);

        await expect(saveProjectConfig({
            agent: {
                profiles: {
                    writer: {
                        model: {},
                        settings: {
                            narrativePerson: "second",
                        },
                    },
                },
            },
        }, {workspaceKind: "novel", projectPath: "workspace/config-test-project"}, catalog)).rejects.toMatchObject({statusCode: 400});
    });

    it("Agent Profile settings 保存时拒绝非法 option 与自定义校验错误", async () => {
        await expect(saveGlobalConfig({
            agent: {
                defaultProfileKey: {novel: "leader.default", userAssets: "leader.assets"},
                profiles: {
                    writer: {
                        model: {},
                        settings: {
                            writingStylePreset: "missing",
                        },
                    },
                },
            },
        }, {workspaceKind: "novel", projectPath: "workspace/config-test-project"}, catalog)).rejects.toMatchObject({statusCode: 400});

        await expect(saveGlobalConfig({
            agent: {
                defaultProfileKey: {novel: "leader.default", userAssets: "leader.assets"},
                profiles: {
                    writer: {
                        model: {},
                        settings: {
                            writingStylePreset: "forbidden",
                        },
                    },
                },
            },
        }, {workspaceKind: "novel", projectPath: "workspace/config-test-project"}, catalog)).rejects.toMatchObject({statusCode: 400});
    });
});

async function moveGlobalConfigAside(): Promise<string | null> {
    const configPath = path.join("workspace", ".nbook", "config.json");
    try {
        await fs.access(configPath);
    } catch (error) {
        if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
            return null;
        }
        throw error;
    }

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "nbook-config-test-"));
    const backupPath = path.join(tempDir, "config.json");
    await fs.rename(configPath, backupPath);
    return backupPath;
}

async function createProjectFixture(): Promise<void> {
    await fs.mkdir(path.join("workspace", "config-test-project"), {recursive: true});
    await fs.writeFile(path.join("workspace", "config-test-project", "project.yaml"), [
        "kind: novel",
        "title: Config Test Project",
        "summary: ''",
        "",
    ].join("\n"), "utf-8");
}

function createCatalog(
    profileKeys: string[],
    options: {writingStyleOptions?: LowCodeFieldDefinition["options"]} = {},
): AgentProfileCatalog {
    const profileCatalog = new AgentProfileCatalog("__missing_system__", "__missing_user__");
    const writerSettingsForm = defineLowCodeForm({
        schema: Type.Object({
            writingStylePreset: Type.String(),
            narrativePerson: Type.Union([
                Type.Literal("first"),
                Type.Literal("second"),
                Type.Literal("third"),
            ]),
        }, {additionalProperties: false}),
        defaults: {
            writingStylePreset: "default-style",
            narrativePerson: "third",
        },
        fields: [
            {
                path: "writingStylePreset",
                component: "combobox",
                label: "文风预设",
                options: options.writingStyleOptions ?? [
                    {value: "default-style", label: "默认文风"},
                    {value: "cinematic", label: "电影感"},
                    {value: "cross-invalid", label: "交叉校验"},
                    {value: "forbidden", label: "禁用文风"},
                ],
            },
            {
                path: "narrativePerson",
                component: "radio",
                label: "默认人称",
                options: [
                    {value: "third", label: "第三人称"},
                    {value: "first", label: "第一人称"},
                    {value: "second", label: "第二人称"},
                ],
            },
        ],
        validate(value) {
            const issues: Array<{path: string; severity: "error"; message: string}> = [];
            if (value.writingStylePreset === "forbidden") {
                issues.push({path: "writingStylePreset", severity: "error" as const, message: "禁用文风不可保存。"});
            }
            if (value.writingStylePreset === "cross-invalid" && value.narrativePerson === "second") {
                issues.push({path: "narrativePerson", severity: "error" as const, message: "交叉校验文风不能使用第二人称。"});
            }
            return issues;
        },
    });
    for (const profileKey of profileKeys) {
        const baseProfile = {
            manifest: {
                key: profileKey,
                name: profileKey,
            },
            initialSchema: Type.Object({}, {additionalProperties: false}),
            outputSchema: Type.Unknown(),
            tools: toolset(),
            prepare: () => ({}),
        } satisfies Parameters<typeof defineAgentProfile>[0];
        profileCatalog.register(profileKey === "writer"
            ? defineAgentProfile({
                ...baseProfile,
                settingsForm: writerSettingsForm,
            })
            : defineAgentProfile(baseProfile), true);
    }
    return profileCatalog;
}
