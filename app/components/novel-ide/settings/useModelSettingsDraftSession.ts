import {computed, nextTick, ref} from "vue";
import {useConfigApi} from "nbook/app/composables/useConfigApi";
import {useNotification} from "nbook/app/composables/useNotification";
import {useNovelIdeStore} from "nbook/app/stores/novel-ide";
import {resolveApiErrorMessage} from "nbook/app/utils/api-error";
import {createModelCostDraft, parseModelCostDraft} from "nbook/app/components/novel-ide/settings/model-cost-draft";
import {
    buildModelsSection,
    cleanGlobalAgent,
    cleanModelKey,
    cleanProjectAgent,
    ensureRunnableDefault,
    inspectSettingsDraft,
    parseDraftInteger,
    parseModelCompat,
    parseModelInput,
    parseModelReasoning,
    parseRequestOptions,
    parseStringMap,
    previewModelLibraryRepairs,
    renameAgentProvider,
    type ModelSettingsDraft,
    type ModelSettingsModelDraft,
    type ModelSettingsProviderDraft,
} from "nbook/app/components/novel-ide/settings/model-settings-draft";
import type {ConfiguredModelDto, EnabledModelOptionDto, ModelLibraryDto, ModelProviderDraftDto} from "nbook/shared/dto/app-settings.dto";
import type {ConfigEditorSnapshotDto, ConfigModelSettingsDto, ConfigWorkspaceQueryDto, GlobalConfigUpdateDto, ProjectConfigDto} from "nbook/shared/dto/config.dto";
import {selectModelApi, type ModelReferenceInput} from "nbook/shared/models/provider-config-contract";
import {deriveModelGroup} from "nbook/shared/models/model-group";

export type ModelSettingsScope = "global" | "project";

export type ModelSettingsPanelProps = {
    scope: ModelSettingsScope;
    targetQuery?: ConfigWorkspaceQueryDto;
    targetLabel: string;
};

type DraftSessionOptions = {
    props: ModelSettingsPanelProps;
    loadLibraries(): Promise<ModelLibraryDto>;
    resetChecks(): void;
    cancelProviderChecks(provider: ModelSettingsProviderDraft, clearBatch: boolean): void;
    cancelModelCheck(provider: ModelSettingsProviderDraft, model: ModelSettingsModelDraft): void;
    resetDiscovery(preserveResults: boolean): void;
    renameDiscovery(previousId: string, nextId: string): void;
    removeDiscovery(providerId: string): void;
};

/**
 * 管理 Provider Config 草稿、Config 快照和保存顺序。
 * Automatic Model Discovery 与健康检查通过回调 seam 参与重置和取消，不反向拥有 Config 状态。
 */
export function useModelSettingsDraftSession(options: DraftSessionOptions) {
    const {t} = useI18n();
    const configApi = useConfigApi();
    const notification = useNotification();
    const novelIdeStore = useNovelIdeStore();
    const loading = ref(false);
    const saving = ref(false);
    const activeProviderKey = ref("");
    const draft = ref<ModelSettingsDraft>({defaultModelKey: null, providers: []});
    const snapshotText = ref("");
    const scopeAgentSnapshotText = ref("");
    const resolvedContextWindowMap = ref<Record<string, number | null>>({});
    const editorSnapshot = ref<ConfigEditorSnapshotDto | null>(null);
    const deleteProviderDialogOpen = ref(false);
    const validationDialogOpen = ref(false);
    const repairingModels = ref(false);
    let providerLocalKeySeed = 0;
    let modelLocalKeySeed = 0;

    const isProjectScope = computed(() => options.props.scope === "project");
    const activeProvider = computed(() => draft.value.providers.find((provider) => provider.localKey === activeProviderKey.value) ?? null);

    /** 创建只用于前端渲染的稳定 Provider key。 */
    function createProviderKey(providerId: string): string {
        providerLocalKeySeed += 1;
        return `provider-${providerLocalKeySeed}-${providerId.trim() || "draft"}`;
    }

    /** 创建只用于前端渲染与检测的稳定模型 key。 */
    function createModelKey(modelId: string): string {
        modelLocalKeySeed += 1;
        return `model-${modelLocalKeySeed}-${modelId.trim() || "draft"}`;
    }

    /** 将 DTO 模型复制成可编辑草稿。 */
    function cloneModel(model: ConfiguredModelDto): ModelSettingsModelDraft {
        return {
            localKey: createModelKey(model.id),
            name: model.name,
            id: model.id,
            group: model.group ?? "",
            enabled: model.enabled,
            api: model.api ?? "",
            reasoning: model.reasoning === null ? "inherit" : model.reasoning ? "true" : "false",
            input: model.input?.join(",") ?? "",
            maxTokens: typeof model.maxTokens === "number" ? String(model.maxTokens) : "",
            cost: createModelCostDraft(model.cost),
            compat: model.compat ? JSON.stringify(model.compat, null, 2) : "",
            headers: model.headers ? JSON.stringify(model.headers, null, 2) : "",
            thinkingLevelMap: model.thinkingLevelMap ? JSON.stringify(model.thinkingLevelMap, null, 2) : "",
            contextWindowTokens: typeof model.contextWindowTokens === "number" ? String(model.contextWindowTokens) : "",
        };
    }

    /** 收集现有 Provider 本地 key，刷新快照时按 ID 队列复用。 */
    function providerLocalKeys(): Map<string, string[]> {
        const keys = new Map<string, string[]>();
        for (const provider of draft.value.providers) {
            const values = keys.get(provider.id) ?? [];
            values.push(provider.localKey);
            keys.set(provider.id, values);
        }
        return keys;
    }

    /** 将 Config Provider DTO 复制成可编辑草稿。 */
    function cloneProvider(provider: ConfigModelSettingsDto["providers"][number], localKeys: Map<string, string[]>): ModelSettingsProviderDraft {
        return {
            localKey: localKeys.get(provider.id)?.shift() ?? createProviderKey(provider.id),
            sourceIndex: provider.sourceIndex,
            id: provider.id,
            name: provider.name,
            enabled: provider.enabled,
            modelApi: provider.modelApi ?? "",
            options: {
                apiKey: "",
                apiKeyConfigured: provider.options.apiKey.configured,
                apiKeyMaskedValue: provider.options.apiKey.maskedValue,
                apiKeyCleared: false,
                baseURL: provider.options.baseURL,
                proxy: provider.options.proxy,
                timeoutMs: typeof provider.options.timeoutMs === "number" ? String(provider.options.timeoutMs) : "",
                requestOptions: Object.keys(provider.options.requestOptions).length ? JSON.stringify(provider.options.requestOptions, null, 2) : "",
            },
            models: provider.models.map(cloneModel),
        };
    }

    /** 应用 Global 模型设置快照。 */
    function applyGlobal(snapshot: ConfigEditorSnapshotDto, preserveUiState = false): void {
        const localKeys = providerLocalKeys();
        const preferredProviderKey = activeProviderKey.value;
        draft.value = {
            defaultModelKey: snapshot.modelSettings.defaultModelKey,
            providers: snapshot.modelSettings.providers.map((provider) => cloneProvider(provider, localKeys)),
        };
        snapshotText.value = JSON.stringify(draft.value);
        scopeAgentSnapshotText.value = JSON.stringify(snapshot.global.agent ?? null);
        activeProviderKey.value = draft.value.providers.some((provider) => provider.localKey === preferredProviderKey)
            ? preferredProviderKey
            : draft.value.providers[0]?.localKey ?? "";
        options.resetDiscovery(preserveUiState);
        options.resetChecks();
        updateResolvedContextWindows(snapshot);
    }

    /** 应用 Project 默认模型覆盖快照。 */
    function applyProject(snapshot: ConfigEditorSnapshotDto): void {
        const localKeys = providerLocalKeys();
        draft.value = {
            defaultModelKey: snapshot.project?.models && Object.hasOwn(snapshot.project.models, "default") ? snapshot.project.models.default ?? null : null,
            providers: snapshot.modelSettings.providers.map((provider) => cloneProvider(provider, localKeys)),
        };
        snapshotText.value = JSON.stringify({defaultModelKey: draft.value.defaultModelKey});
        scopeAgentSnapshotText.value = JSON.stringify(snapshot.project?.agent ?? null);
        activeProviderKey.value = draft.value.providers.some((provider) => provider.localKey === activeProviderKey.value)
            ? activeProviderKey.value
            : draft.value.providers[0]?.localKey ?? "";
        options.resetDiscovery(false);
        options.resetChecks();
        updateResolvedContextWindows(snapshot);
    }

    /** 更新后端已解析的上下文窗口与模型标签。 */
    function updateResolvedContextWindows(snapshot: ConfigEditorSnapshotDto): void {
        resolvedContextWindowMap.value = Object.fromEntries(snapshot.modelSettings.enabledModels.map((model) => [model.key, model.contextWindowTokens]));
        novelIdeStore.setSelectedModelLabel(snapshot.modelSettings.defaultModelLabel);
    }

    /** 读取模型设置。 */
    async function load(): Promise<void> {
        loading.value = true;
        try {
            if (!isProjectScope.value) {
                void options.loadLibraries();
            }
            const snapshot = await configApi.editorSnapshot(options.props.targetQuery);
            editorSnapshot.value = snapshot;
            if (isProjectScope.value) {
                applyProject(snapshot);
            } else {
                applyGlobal(snapshot);
            }
        } catch (error) {
            notification.error(resolveApiErrorMessage(error, t("settings.panels.models.loadFailed")));
        } finally {
            loading.value = false;
        }
    }

    /** 当前草稿中真正可运行的模型 key。 */
    function availableModelKeys(): Set<string> {
        return inspectSettingsDraft({...draft.value, defaultModelKey: null}).runnableModelKeys;
    }

    /** 确保默认模型指向可运行模型。 */
    function ensureDefaultModel(): void {
        ensureRunnableDefault(draft.value);
    }

    /** 清理当前 scope 中已经不可运行的模型引用。 */
    function cleanScopeReferences(modelKeys: Set<string>): boolean {
        const snapshot = editorSnapshot.value;
        if (!snapshot) {
            return false;
        }
        const currentAgent = isProjectScope.value ? snapshot.project?.agent : snapshot.global.agent;
        const nextAgent = isProjectScope.value
            ? cleanProjectAgent(snapshot.project?.agent, modelKeys)
            : cleanGlobalAgent(snapshot.global.agent, modelKeys);
        if (JSON.stringify(nextAgent) === JSON.stringify(currentAgent)) {
            return false;
        }
        if (isProjectScope.value && snapshot.project) {
            snapshot.project.agent = nextAgent as typeof snapshot.project.agent;
        } else if (!isProjectScope.value) {
            snapshot.global.agent = nextAgent as typeof snapshot.global.agent;
        }
        return true;
    }

    /** 收集 Agent Config 中显式模型引用。 */
    function agentReferences(agent: {profileModelDefaults?: {modelKey?: string | null}; profiles?: Record<string, {model?: {modelKey?: string | null}}>} | undefined, path: Array<string | number>, label: string): ModelReferenceInput[] {
        if (!agent) {
            return [];
        }
        const references: ModelReferenceInput[] = [];
        if (agent.profileModelDefaults && Object.hasOwn(agent.profileModelDefaults, "modelKey")) {
            references.push({modelKey: agent.profileModelDefaults.modelKey ?? null, path: [...path, "profileModelDefaults", "modelKey"], label: `${label} Profile 默认模型`});
        }
        for (const [profileKey, profile] of Object.entries(agent.profiles ?? {})) {
            if (profile.model && Object.hasOwn(profile.model, "modelKey")) {
                references.push({modelKey: profile.model.modelKey ?? null, path: [...path, "profiles", profileKey, "model", "modelKey"], label: `${label} Profile ${profileKey} 模型`});
            }
        }
        return references;
    }

    const validationState = computed(() => {
        const globalDefault = editorSnapshot.value?.global.models?.default ?? null;
        const contractDraft = isProjectScope.value ? {...draft.value, defaultModelKey: draft.value.defaultModelKey ?? globalDefault} : draft.value;
        const references = isProjectScope.value
            ? agentReferences(editorSnapshot.value?.project?.agent, ["project", "agent"], "Project")
            : agentReferences(editorSnapshot.value?.global.agent, ["agent"], "Global");
        return inspectSettingsDraft(contractDraft, references);
    });
    const validationIssues = computed(() => validationState.value.issues);
    const validationIssueDetails = computed(() => validationIssues.value.map((issue) => issue.message).join("\n"));

    const dirty = computed(() => {
        const scopeAgent = isProjectScope.value ? editorSnapshot.value?.project?.agent : editorSnapshot.value?.global.agent;
        const agentChanged = JSON.stringify(scopeAgent ?? null) !== scopeAgentSnapshotText.value;
        return isProjectScope.value
            ? agentChanged || JSON.stringify({defaultModelKey: draft.value.defaultModelKey}) !== snapshotText.value
            : agentChanged || JSON.stringify(draft.value) !== snapshotText.value;
    });

    const defaultModelOptions = computed<EnabledModelOptionDto[]>(() => draft.value.providers.flatMap((provider) => provider.models
        .filter((model) => model.id.trim() && validationState.value.runnableModelKeys.has(`${provider.id.trim()}/${model.id.trim()}`))
        .map((model) => ({key: `${provider.id}/${model.id.trim()}`, label: `${provider.name} / ${model.name || model.id}`, providerId: provider.id, modelId: model.id.trim(), contextWindowTokens: parseDraftInteger(model.contextWindowTokens)})))
        .sort((left, right) => left.label.localeCompare(right.label)));

    const enabledModelGroups = computed(() => {
        const provider = activeProvider.value;
        if (!provider?.enabled) {
            return [] as Array<{group: string; models: ModelSettingsModelDraft[]}>;
        }
        const groups = new Map<string, ModelSettingsModelDraft[]>();
        for (const model of provider.models.filter((item) => item.enabled)) {
            const group = model.group.trim() || deriveModelGroup(model.id);
            const values = groups.get(group) ?? [];
            values.push(model);
            groups.set(group, values);
        }
        return [...groups.entries()].map(([group, models]) => ({group, models: [...models].sort((left, right) => left.id.localeCompare(right.id))})).sort((left, right) => left.group.localeCompare(right.group));
    });

    const disabledModels = computed(() => activeProvider.value?.models.filter((model) => !model.enabled).sort((left, right) => left.id.localeCompare(right.id)) ?? []);
    const activeProviderEnabledModelCount = computed(() => activeProvider.value?.enabled ? activeProvider.value.models.filter((model) => model.enabled).length : 0);

    /** 构造 Provider 检查和发现请求。 */
    function buildProviderRequest(provider: ModelSettingsProviderDraft): ModelProviderDraftDto {
        return {
            id: provider.id.trim(),
            name: provider.name.trim(),
            modelApi: selectModelApi(provider.modelApi, null),
            options: {
                apiKey: provider.options.apiKey.trim(),
                baseURL: provider.options.baseURL.trim(),
                proxy: provider.options.proxy.trim(),
                timeoutMs: parseDraftInteger(provider.options.timeoutMs),
                requestOptions: parseRequestOptions(provider.options.requestOptions),
            },
        };
    }

    /** 构造单模型健康检查草稿。 */
    function buildModelDraft(model: ModelSettingsModelDraft): Omit<ConfiguredModelDto, "enabled"> {
        return {
            name: model.name.trim(), id: model.id.trim(), group: model.group.trim() || null, api: model.api.trim() || null,
            reasoning: parseModelReasoning(model.reasoning), input: parseModelInput(model.input), maxTokens: parseDraftInteger(model.maxTokens),
            cost: parseModelCostDraft(model.cost), compat: parseModelCompat(model.compat), headers: parseStringMap(model.headers),
            thinkingLevelMap: parseStringMap(model.thinkingLevelMap), contextWindowTokens: parseDraftInteger(model.contextWindowTokens),
        };
    }

    /** 判断健康检查是否应读取已保存 Secret。 */
    function useSavedApiKey(provider: ModelSettingsProviderDraft): boolean {
        return !provider.options.apiKeyCleared && !provider.options.apiKey.trim();
    }

    /** Global Config 写回体。 */
    function globalPayload(): GlobalConfigUpdateDto {
        const modelKeys = availableModelKeys();
        const cleanedAgent = cleanGlobalAgent(editorSnapshot.value?.global.agent, modelKeys);
        const agentChanged = JSON.stringify(cleanedAgent ?? null) !== scopeAgentSnapshotText.value;
        return {...(agentChanged && cleanedAgent ? {agent: cleanedAgent} : {}), models: buildModelsSection(draft.value)};
    }

    /** Project Config 写回体。 */
    function projectPayload(): ProjectConfigDto {
        const modelKeys = availableModelKeys();
        const cleanedAgent = cleanProjectAgent(editorSnapshot.value?.project?.agent, modelKeys);
        const agentChanged = JSON.stringify(cleanedAgent ?? null) !== scopeAgentSnapshotText.value;
        return {models: {default: cleanModelKey(draft.value.defaultModelKey, modelKeys)}, ...(agentChanged && cleanedAgent ? {agent: cleanedAgent} : {})};
    }

    /** 保存模型设置并返回是否成功。 */
    async function saveResult(successMessage?: string): Promise<boolean> {
        if (!dirty.value || saving.value) {
            return false;
        }
        saving.value = true;
        try {
            const snapshot = isProjectScope.value
                ? await configApi.saveProject(projectPayload(), options.props.targetQuery)
                : await configApi.saveGlobal(globalPayload(), options.props.targetQuery);
            editorSnapshot.value = snapshot;
            if (isProjectScope.value) {
                applyProject(snapshot);
                notification.success(successMessage ?? t("settings.panels.models.projectSaveSuccess"));
            } else {
                applyGlobal(snapshot, true);
                notification.success(successMessage ?? t("settings.panels.models.globalSaveSuccess"));
            }
            return true;
        } catch (error) {
            notification.error(resolveApiErrorMessage(error, t("settings.panels.models.saveFailed")));
            return false;
        } finally {
            saving.value = false;
        }
    }

    /** 保存模型设置。 */
    async function save(): Promise<void> {
        await saveResult();
    }

    /** 放弃当前草稿并重新读取。 */
    async function restore(): Promise<void> {
        await load();
    }

    /** 切换当前 Provider 启用状态。 */
    function toggleActiveProviderEnabled(): void {
        const provider = activeProvider.value;
        if (!provider) {
            return;
        }
        if (provider.enabled) {
            options.cancelProviderChecks(provider, true);
        }
        provider.enabled = !provider.enabled;
        ensureDefaultModel();
    }

    /** 清空当前 Provider Secret。 */
    function clearActiveProviderApiKey(): void {
        const provider = activeProvider.value;
        if (!provider) {
            return;
        }
        Object.assign(provider.options, {apiKey: "", apiKeyConfigured: false, apiKeyMaskedValue: null, apiKeyCleared: true});
    }

    /** 重命名 Provider ID 并同步所有引用和临时会话。 */
    function renameActiveProviderId(nextId: string): void {
        const provider = activeProvider.value;
        if (!provider) {
            return;
        }
        const previousId = provider.id;
        const normalizedId = nextId.trim();
        options.cancelProviderChecks(provider, true);
        provider.id = normalizedId;
        if (previousId === normalizedId) {
            return;
        }
        if (draft.value.defaultModelKey?.startsWith(`${previousId}/`)) {
            draft.value.defaultModelKey = draft.value.defaultModelKey.replace(`${previousId}/`, `${normalizedId}/`);
        }
        if (editorSnapshot.value?.global.agent) {
            const renamed = renameAgentProvider(editorSnapshot.value.global.agent, previousId, normalizedId);
            editorSnapshot.value.global.agent = renamed.agent ?? editorSnapshot.value.global.agent;
        }
        options.renameDiscovery(previousId, normalizedId);
    }

    /** 请求删除当前 Provider。 */
    function requestDeleteActiveProvider(): void {
        if (activeProvider.value) {
            deleteProviderDialogOpen.value = true;
        }
    }

    /** 删除当前 Provider 并立即保存。 */
    async function confirmDeleteActiveProvider(): Promise<void> {
        const provider = activeProvider.value;
        if (!provider) {
            deleteProviderDialogOpen.value = false;
            return;
        }
        const providerId = provider.id;
        const providerName = provider.name;
        options.cancelProviderChecks(provider, true);
        draft.value.providers = draft.value.providers.filter((item) => item !== provider);
        if (draft.value.defaultModelKey?.startsWith(`${providerId}/`)) {
            draft.value.defaultModelKey = null;
        }
        options.removeDiscovery(providerId);
        activeProviderKey.value = draft.value.providers[0]?.localKey ?? "";
        ensureDefaultModel();
        deleteProviderDialogOpen.value = false;
        await saveResult(t("settings.panels.models.providerDeleted", {name: providerName}));
    }

    /** 启用或新增完整模型。 */
    function enableModel(model: ConfiguredModelDto): void {
        const provider = activeProvider.value;
        const modelId = model.id.trim();
        if (!provider || !modelId) {
            return;
        }
        const existing = provider.models.find((item) => item.id === modelId);
        if (existing) {
            Object.assign(existing, cloneModel(model));
        } else {
            provider.models.push(cloneModel(model));
        }
        ensureDefaultModel();
    }

    /** 停用模型。 */
    function disableModel(model: ModelSettingsModelDraft): void {
        const provider = activeProvider.value;
        if (provider) {
            options.cancelModelCheck(provider, model);
        }
        model.enabled = false;
        ensureDefaultModel();
    }

    /** 删除模型条目。 */
    function deleteModel(model: ModelSettingsModelDraft): void {
        const provider = activeProvider.value;
        if (!provider) {
            return;
        }
        options.cancelModelCheck(provider, model);
        provider.models = provider.models.filter((item) => item !== model);
        ensureDefaultModel();
        cleanScopeReferences(availableModelKeys());
    }

    /** 返回已保存模型的实时问题。 */
    function savedModelIssues(providerId: string, modelId: string) {
        const modelKey = `${providerId.trim()}/${modelId.trim()}`;
        return validationIssues.value.filter((issue) => issue.modelKey === modelKey);
    }

    /** 返回当前显示的上下文窗口。 */
    function displayedContextWindow(providerId: string, model: ModelSettingsModelDraft): string {
        const saved = resolvedContextWindowMap.value[`${providerId}/${model.id}`];
        return typeof saved === "number" && Number.isFinite(saved) ? String(saved) : model.contextWindowTokens.trim();
    }

    /** 一键应用 Model Library 可修复能力并清理失效引用。 */
    async function repair(): Promise<void> {
        if (repairingModels.value) {
            return;
        }
        repairingModels.value = true;
        try {
            const repairs = [] as ReturnType<typeof previewModelLibraryRepairs>;
            if (!isProjectScope.value) {
                const library = await options.loadLibraries();
                repairs.push(...previewModelLibraryRepairs(draft.value, library.models));
                for (const repairItem of repairs) {
                    const model = draft.value.providers[repairItem.providerIndex]?.models[repairItem.modelIndex];
                    if (model) {
                        const replacement = cloneModel(repairItem.replacement);
                        Object.assign(model, {api: replacement.api, reasoning: replacement.reasoning, input: replacement.input, maxTokens: replacement.maxTokens, thinkingLevelMap: replacement.thinkingLevelMap, contextWindowTokens: replacement.contextWindowTokens});
                    }
                }
                ensureDefaultModel();
            } else {
                draft.value.defaultModelKey = cleanModelKey(draft.value.defaultModelKey, availableModelKeys());
            }
            const referencesChanged = cleanScopeReferences(availableModelKeys());
            options.resetChecks();
            await nextTick();
            const message = t("settings.panels.models.oneClickRepairResult", {repaired: repairs.length, cleared: 0, disabled: 0, remaining: validationIssues.value.length});
            if (validationIssues.value.length > 0) {
                notification.warning(message, {title: t("settings.panels.models.oneClickRepairNeedsReview")});
            } else if (repairs.length > 0 || referencesChanged) {
                notification.success(message, {title: t("settings.panels.models.oneClickRepairDone")});
            } else {
                notification.info(t("settings.panels.models.oneClickRepairNoChange"));
            }
        } catch (error) {
            notification.error(resolveApiErrorMessage(error, t("settings.panels.models.oneClickRepairFailed")));
        } finally {
            repairingModels.value = false;
        }
    }

    return {
        loading, saving, activeProviderKey, draft, activeProvider, editorSnapshot, deleteProviderDialogOpen, validationDialogOpen, repairingModels,
        isProjectScope, dirty, validationState, validationIssues, validationIssueDetails, defaultModelOptions, enabledModelGroups, disabledModels,
        activeProviderEnabledModelCount, createProviderKey, cloneModel, buildProviderRequest, buildModelDraft, useSavedApiKey, ensureDefaultModel,
        clearActiveProviderApiKey, toggleActiveProviderEnabled, renameActiveProviderId, requestDeleteActiveProvider, confirmDeleteActiveProvider,
        enableModel, disableModel, deleteModel, savedModelIssues, displayedContextWindow, repair, load, save, restore,
    };
}
