<script setup lang="ts">
import type {SelectOption} from "nbook/app/components/common/form/FormSelect.vue";
import FormInput from "nbook/app/components/common/form/FormInput.vue";
import FormSelect from "nbook/app/components/common/form/FormSelect.vue";
import Dialog from "nbook/app/components/common/Dialog.vue";
import NovelIdeModelSelect from "nbook/app/components/novel-ide/settings/NovelIdeModelSelect.vue";
import NovelIdeModelEditDialog from "nbook/app/components/novel-ide/settings/NovelIdeModelEditDialog.vue";
import {clearModelCostDraft, createEmptyModelCostDraft, createModelCostDraft, parseModelCostDraft} from "nbook/app/components/novel-ide/settings/model-cost-draft";
import {configuredModelFromCatalog, requiredModelFields, resolveDiscoveredModelDraft} from "nbook/app/components/novel-ide/settings/model-draft-factory";
import {
    disableInvalidDrafts,
    clearUnsupportedDefaultApis,
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
    previewCatalogRepairs,
    renameAgentProvider,
    type ModelSettingsDraft,
    type ModelSettingsModelDraft,
    type ModelSettingsProviderDraft,
} from "nbook/app/components/novel-ide/settings/model-settings-draft";
import {useNovelIdeStore} from "nbook/app/stores/novel-ide";
import {useConfigApi} from "nbook/app/composables/useConfigApi";
import {useNotification} from "nbook/app/composables/useNotification";
import {resolveApiErrorMessage} from "nbook/app/utils/api-error";
import type {
    CheckModelResponseDto,
    ConfiguredModelDto,
    DiscoverProviderModelsResponseDto,
    DiscoveredProviderModelDto,
    EnabledModelOptionDto,
    ModelInputKind,
    ModelCatalogEntryDto,
    ModelProviderDraftDto,
    NeuroModelCatalogDto,
    ProviderPresetDto,
} from "nbook/shared/dto/app-settings.dto";
import type {ConfigEditorSnapshotDto, ConfigModelSettingsDto, ConfigWorkspaceQueryDto, GlobalConfigUpdateDto, ProjectConfigDto} from "nbook/shared/dto/config.dto";
import type {ModelReferenceInput} from "nbook/shared/models/provider-config-contract";

type ConfigSettingsScope = "global" | "project";

const props = withDefaults(defineProps<{
    scope?: ConfigSettingsScope;
    targetQuery?: ConfigWorkspaceQueryDto;
    targetLabel?: string;
}>(), {
    scope: "global",
    targetQuery: undefined,
    targetLabel: "",
});

type ModelDraft = ModelSettingsModelDraft;

type ManualModelDraft = {
    name: string;
    id: string;
    api: string;
    group: string;
    contextWindowTokens: string;
    maxTokens: string;
};

type ProviderDraft = ModelSettingsProviderDraft;

type ModelCheckResult = CheckModelResponseDto & {
    cancelled?: boolean;
};

type ModelCheckControllerState = {
    controller: AbortController;
};

type ModelCheckBatchState = {
    providerKey: string;
    modelKeys: string[];
};

const {t} = useI18n();

const fallbackProviderPreset: ProviderPresetDto = {
    id: "custom-openai-completions",
    name: "Custom OpenAI Completions",
    baseUrl: "",
    supportedApis: ["openai-completions"],
    defaultApi: "openai-completions",
    discovery: {adapter: "openai-models", endpointPath: null},
};

const novelIdeStore = useNovelIdeStore();
const configApi = useConfigApi();
const notification = useNotification();

const loading = ref(false);
const saving = ref(false);
const activeProviderKey = ref("");
const selectedPreset = ref<string>(fallbackProviderPreset.id);
const draft = ref<ModelSettingsDraft>({
    defaultModelKey: null,
    providers: [],
});
const snapshotText = ref("");
const scopeAgentSnapshotText = ref("");
const discoveredModels = ref<Record<string, DiscoveredProviderModelDto[]>>({});
const modelCatalog = ref<NeuroModelCatalogDto | null>(null);
const resolvedContextWindowMap = ref<Record<string, number | null>>({});
const providerDiscoveringId = ref("");
const modelCheckControllers = ref<Record<string, ModelCheckControllerState>>({});
const modelCheckResults = ref<Record<string, ModelCheckResult>>({});
const activeModelCheckBatches = ref<Record<string, ModelCheckBatchState>>({});
const manualModelDrafts = ref<Record<string, ManualModelDraft>>({});
const libraryDialogOpen = ref(false);
const editorSnapshot = ref<ConfigEditorSnapshotDto | null>(null);
let providerLocalKeySeed = 0;
let modelLocalKeySeed = 0;
let modelCheckStateVersion = 0;

const expandedGroups = ref<Record<string, boolean>>({});
const editingModel = ref<ModelDraft | null>(null);
const modelEditDialogOpen = ref(false);
const deleteProviderDialogOpen = ref(false);
const validationDialogOpen = ref(false);
const repairingModels = ref(false);
const isProjectScope = computed(() => props.scope === "project");
const modelApiOptions: SelectOption[] = [
    {value: "openai-completions", label: "OpenAI Completions", description: "OpenAI-compatible Chat Completions"},
    {value: "openai-responses", label: "OpenAI Responses", description: "OpenAI Responses API"},
    {value: "anthropic-messages", label: "Anthropic Messages", description: "Anthropic Claude Messages"},
    {value: "google-generative-ai", label: "Google Generative AI", description: "Gemini / Google GenAI"},
    {value: "bedrock-converse-stream", label: "Bedrock Converse", description: "AWS Bedrock Converse Stream"},
];
const modelInputOptions = computed<Array<{value: ModelInputKind; label: string; iconClass: string}>>(() => [
    {value: "text", label: t("settings.panels.models.textInput"), iconClass: "i-lucide-type"},
    {value: "image", label: t("settings.panels.models.imageInput"), iconClass: "i-lucide-image"},
]);

const providerPresetOptions = computed<ProviderPresetDto[]>(() => modelCatalog.value?.providerPresets ?? [fallbackProviderPreset]);

function toggleGroup(group: string): void {
    expandedGroups.value[group] = !expandedGroups.value[group];
}

async function openModelEdit(model: ModelDraft): Promise<void> {
    editingModel.value = model;
    try {
        await loadModelCatalog();
    } catch (error) {
        notification.error(resolveApiErrorMessage(error, t("settings.panels.models.loadPiCatalogFailed")));
    } finally {
        modelEditDialogOpen.value = true;
    }
}

/**
 * 创建只用于前端渲染和选中状态的稳定 Provider key。
 */
function createProviderLocalKey(providerId: string): string {
    providerLocalKeySeed += 1;
    return `provider-${providerLocalKeySeed}-${providerId.trim() || "draft"}`;
}

/** 创建只用于前端渲染和检测状态的稳定模型 key。 */
function createModelLocalKey(modelId: string): string {
    modelLocalKeySeed += 1;
    return `model-${modelLocalKeySeed}-${modelId.trim() || "draft"}`;
}

/**
 * 收集当前 Provider 的本地 key。按队列复用，避免临时重复配置 ID 时生成重复 Vue key。
 */
function collectProviderLocalKeys(): Map<string, string[]> {
    const localKeyMap = new Map<string, string[]>();
    for (const provider of draft.value.providers) {
        const localKeys = localKeyMap.get(provider.id) ?? [];
        localKeys.push(provider.localKey);
        localKeyMap.set(provider.id, localKeys);
    }
    return localKeyMap;
}

/**
 * 克隆模型草稿。
 */
function cloneModel(model: ConfiguredModelDto): ModelDraft {
    return {
        localKey: createModelLocalKey(model.id),
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

/**
 * 切换模型输入能力；空数组表示能力尚未填写。
 */
function toggleModelInput(model: ModelDraft, inputKind: ModelInputKind): void {
    const values = parseModelInput(model.input) ?? [];
    model.input = values.includes(inputKind)
        ? values.filter((item) => item !== inputKind).join(",")
        : [...values, inputKind].join(",");
}

function modelInputEnabled(model: ModelDraft, inputKind: ModelInputKind): boolean {
    return (parseModelInput(model.input) ?? []).includes(inputKind);
}

/**
 * 清空用户模型配置中的价格。
 */
function resetModelCost(model: ModelDraft): void {
    clearModelCostDraft(model.cost);
}

/**
 * 从当前 Model Catalog 复制完整基础价格与 tiers。
 */
function enableModelCostOverride(model: ModelDraft): void {
    model.cost = createModelCostDraft(findCatalogModel(model.id)?.cost ?? {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        tiers: [],
    });
}

/**
 * 克隆 Provider 草稿。
 */
function cloneProvider(provider: ConfigModelSettingsDto["providers"][number], localKeyMap: Map<string, string[]> = new Map()): ProviderDraft {
    const localKeyQueue = localKeyMap.get(provider.id);
    return {
        localKey: localKeyQueue?.shift() ?? createProviderLocalKey(provider.id),
        sourceIndex: provider.sourceIndex,
        id: provider.id,
        name: provider.name,
        enabled: provider.enabled,
        defaultApi: provider.defaultApi ?? "",
        discovery: {
            adapter: provider.discovery.adapter,
            endpointPath: provider.discovery.endpointPath ?? "",
        },
        options: {
            apiKey: "",
            apiKeyConfigured: provider.options.apiKey.configured,
            apiKeyMaskedValue: provider.options.apiKey.maskedValue,
            apiKeyCleared: false,
            baseURL: provider.options.baseURL,
            proxy: provider.options.proxy,
            timeoutMs: typeof provider.options.timeoutMs === "number" ? String(provider.options.timeoutMs) : "",
            requestOptions: Object.keys(provider.options.requestOptions).length > 0
                ? JSON.stringify(provider.options.requestOptions, null, 2)
                : "",
        },
        models: provider.models.map(cloneModel),
    };
}

/**
 * 将接口响应应用到本地草稿。
 */
function applySettings(snapshot: ConfigEditorSnapshotDto, options: {preserveUiState?: boolean; preferredProviderKey?: string} = {}): void {
    const localKeyMap = collectProviderLocalKeys();
    const preferredProviderKey = options.preferredProviderKey ?? activeProviderKey.value;
    draft.value = {
        defaultModelKey: snapshot.modelSettings.defaultModelKey,
        providers: snapshot.modelSettings.providers.map((provider) => cloneProvider(provider, localKeyMap)),
    };
    snapshotText.value = JSON.stringify(draft.value);
    scopeAgentSnapshotText.value = JSON.stringify(snapshot.global.agent ?? null);
    activeProviderKey.value = draft.value.providers.some((provider) => provider.localKey === preferredProviderKey)
        ? preferredProviderKey
        : draft.value.providers[0]?.localKey ?? "";
    if (!options.preserveUiState) {
        discoveredModels.value = {};
        manualModelDrafts.value = {};
    }
    resetModelCheckState();
    resolvedContextWindowMap.value = Object.fromEntries(
        snapshot.modelSettings.enabledModels.map((model) => [model.key, model.contextWindowTokens]),
    );
    novelIdeStore.setSelectedModelLabel(snapshot.modelSettings.defaultModelLabel);
}

/**
 * 读取 Project Config 中显式保存的默认模型覆盖。
 */
function readProjectDefaultModelKey(snapshot: ConfigEditorSnapshotDto): string | null {
    return snapshot.project?.models && Object.hasOwn(snapshot.project.models, "default")
        ? snapshot.project.models.default ?? null
        : null;
}

/**
 * 将 Project Config 默认模型覆盖应用到表单草稿。
 */
function applyProjectSettings(snapshot: ConfigEditorSnapshotDto): void {
    const localKeyMap = collectProviderLocalKeys();
    editorSnapshot.value = snapshot;
    draft.value = {
        defaultModelKey: readProjectDefaultModelKey(snapshot),
        providers: snapshot.modelSettings.providers.map((provider) => cloneProvider(provider, localKeyMap)),
    };
    snapshotText.value = JSON.stringify({
        defaultModelKey: draft.value.defaultModelKey,
    });
    scopeAgentSnapshotText.value = JSON.stringify(snapshot.project?.agent ?? null);
    activeProviderKey.value = draft.value.providers.some((provider) => provider.localKey === activeProviderKey.value)
        ? activeProviderKey.value
        : draft.value.providers[0]?.localKey ?? "";
    discoveredModels.value = {};
    resolvedContextWindowMap.value = Object.fromEntries(
        snapshot.modelSettings.enabledModels.map((model) => [model.key, model.contextWindowTokens]),
    );
    manualModelDrafts.value = {};
    resetModelCheckState();
    novelIdeStore.setSelectedModelLabel(snapshot.modelSettings.defaultModelLabel);
}

/**
 * 读取当前显示给用户的上下文窗口。
 * 已保存模型优先显示后端解析结果；本地草稿回退到手动输入值。
 */
function resolveDisplayedContextWindow(providerId: string, model: ModelDraft): string {
    const savedValue = resolvedContextWindowMap.value[`${providerId}/${model.id}`];
    if (typeof savedValue === "number" && Number.isFinite(savedValue)) {
        return String(savedValue);
    }

    return model.contextWindowTokens.trim();
}

/**
 * 标记清空当前 Provider API key。保存后后端会写入空字符串。
 */
function clearActiveProviderApiKey(): void {
    if (!activeProvider.value) {
        return;
    }
    activeProvider.value.options.apiKey = "";
    activeProvider.value.options.apiKeyConfigured = false;
    activeProvider.value.options.apiKeyMaskedValue = null;
    activeProvider.value.options.apiKeyCleared = true;
}

/**
 * 构造 Global Config 写回体，secret 字段遵守“空输入保留旧值”语义。
 */
function buildGlobalConfigPayload(): GlobalConfigUpdateDto {
    const base = editorSnapshot.value?.global;
    const modelKeys = availableModelKeys();
    const cleanedAgent = cleanGlobalAgent(base?.agent, modelKeys);
    const agentChanged = JSON.stringify(cleanedAgent ?? null) !== scopeAgentSnapshotText.value;
    return {
        ...(agentChanged && cleanedAgent ? {agent: cleanedAgent} : {}),
        models: buildModelsSection(draft.value),
    };
}

/**
 * 构造 Project Config 写回体，清理已不存在 Provider 的模型引用。
 */
function buildProjectConfigPayload(): ProjectConfigDto {
    const base = editorSnapshot.value?.project;
    const modelKeys = availableModelKeys();
    const cleanedAgent = cleanProjectAgent(base?.agent, modelKeys);
    const agentChanged = JSON.stringify(cleanedAgent ?? null) !== scopeAgentSnapshotText.value;
    return {
        models: {default: cleanModelKey(draft.value.defaultModelKey, modelKeys)},
        ...(agentChanged && cleanedAgent ? {agent: cleanedAgent} : {}),
    };
}

/** 当前草稿中真正可运行的完整模型 key 集合。 */
function availableModelKeys(): Set<string> {
    return inspectSettingsDraft({...draft.value, defaultModelKey: null}).runnableModelKeys;
}

/**
 * 读取模型设定。
 */
async function loadSettings(): Promise<void> {
    loading.value = true;

    try {
        if (!isProjectScope.value) {
            void loadModelCatalog();
        }
        const snapshot = await configApi.editorSnapshot(props.targetQuery);
        editorSnapshot.value = snapshot;
        if (isProjectScope.value) {
            applyProjectSettings(snapshot);
        } else {
            applySettings(snapshot);
        }
    } catch (error) {
        notification.error(resolveApiErrorMessage(error, t("settings.panels.models.loadFailed")));
    } finally {
        loading.value = false;
    }
}

/**
 * 生成唯一 providerId。
 */
function buildUniqueProviderId(baseId: string): string {
    const normalizedBaseId = baseId.trim() || "provider";
    const providerIdSet = new Set(draft.value.providers.map((provider) => provider.id));
    if (!providerIdSet.has(normalizedBaseId)) {
        return normalizedBaseId;
    }

    let suffix = 2;
    while (providerIdSet.has(`${normalizedBaseId}-${String(suffix)}`)) {
        suffix += 1;
    }

    return `${normalizedBaseId}-${String(suffix)}`;
}

/** 确保默认模型仍然指向一个真正可运行的模型。 */
function ensureDefaultModelKey(): void {
    ensureRunnableDefault(draft.value);
}

/**
 * 获取当前激活的 Provider。
 */
const activeProvider = computed<ProviderDraft | null>(() => {
    return draft.value.providers.find((provider) => provider.localKey === activeProviderKey.value) ?? null;
});

/**
 * Provider 下模型自身标记为 enabled 的数量。
 */
function providerEnabledModelCount(provider: ProviderDraft): number {
    return provider.models.filter((model) => model.enabled).length;
}

const activeProviderEnabledModelCount = computed(() => {
    return activeProvider.value?.enabled ? providerEnabledModelCount(activeProvider.value) : 0;
});

const activeProviderModelCheckKeys = computed(() => {
    const provider = activeProvider.value;
    if (!provider?.enabled) {
        return [] as string[];
    }
    return provider.models
        .filter((model) => model.enabled)
        .map((model) => modelCheckKey(provider, model));
});

const activeProviderCheckingModelKeys = computed(() => {
    return activeProviderModelCheckKeys.value.filter((key) => Boolean(modelCheckControllers.value[key]));
});

const activeProviderCheckingModelCount = computed(() => activeProviderCheckingModelKeys.value.length);
const checkingAllModels = computed(() => {
    const provider = activeProvider.value;
    if (!provider) {
        return false;
    }
    const batch = activeModelCheckBatches.value[provider.localKey];
    return batch?.modelKeys.some((modelKey) => Boolean(modelCheckControllers.value[modelKey])) ?? false;
});

/**
 * 切换 Provider 启用状态；禁用后运行时把它视为不存在。
 */
function toggleActiveProviderEnabled(): void {
    const provider = activeProvider.value;
    if (!provider) {
        return;
    }
    if (provider.enabled) {
        cancelProviderChecks(provider, {clearBatch: true});
    }
    provider.enabled = !provider.enabled;
    ensureDefaultModelKey();
}

/**
 * 当前草稿是否有未保存修改。
 */
const dirty = computed(() => {
    const scopeAgent = isProjectScope.value
        ? editorSnapshot.value?.project?.agent
        : editorSnapshot.value?.global.agent;
    const agentChanged = JSON.stringify(scopeAgent ?? null) !== scopeAgentSnapshotText.value;
    if (isProjectScope.value) {
        return agentChanged || JSON.stringify({
            defaultModelKey: draft.value.defaultModelKey,
        }) !== snapshotText.value;
    }
    return agentChanged || JSON.stringify(draft.value) !== snapshotText.value;
});

/**
 * 默认模型候选列表。
 */
const defaultModelOptions = computed<EnabledModelOptionDto[]>(() => {
    return draft.value.providers.flatMap((provider) => provider.models
        .filter((model) => model.id.trim() && validationState.value.runnableModelKeys.has(`${provider.id.trim()}/${model.id.trim()}`))
        .map((model) => ({
            key: `${provider.id}/${model.id.trim()}`,
            label: `${provider.name} / ${model.name || model.id}`,
            providerId: provider.id,
            modelId: model.id.trim(),
            contextWindowTokens: parseDraftInteger(model.contextWindowTokens),
        })))
        .sort((left, right) => left.label.localeCompare(right.label));
});

/**
 * 当前 Provider 下启用模型的分组列表。
 */
const enabledModelGroups = computed(() => {
    const provider = activeProvider.value;
    if (!provider?.enabled) {
        return [] as Array<{group: string; models: ModelDraft[]}>;
    }

    const groupMap = new Map<string, ModelDraft[]>();
    for (const model of provider.models) {
        if (!model.enabled) {
            continue;
        }

        const groupName = model.group.trim() || deriveGroup(model.id);
        const groupModels = groupMap.get(groupName) ?? [];
        groupModels.push(model);
        groupMap.set(groupName, groupModels);
    }

    return [...groupMap.entries()]
        .map(([group, models]) => ({
            group,
            models: [...models].sort((left, right) => left.id.localeCompare(right.id)),
        }))
        .sort((left, right) => left.group.localeCompare(right.group));
});

/**
 * 当前 Provider 下已禁用模型列表。
 */
const disabledModels = computed(() => {
    const provider = activeProvider.value;
    if (!provider) {
        return [] as ModelDraft[];
    }

    return provider.models
        .filter((model) => !model.enabled)
        .sort((left, right) => left.id.localeCompare(right.id));
});

/**
 * 根据模型 ID 推导默认 group。
 */
function deriveGroup(modelId: string): string {
    const normalizedId = modelId.trim();
    if (!normalizedId) {
        return "default";
    }

    const separatorIndex = normalizedId.indexOf("-");
    if (separatorIndex <= 0) {
        return normalizedId;
    }

    return normalizedId.slice(0, separatorIndex);
}

/**
 * 获取当前 Provider 的手动新增模型草稿。
 */
function getManualModelDraft(providerId: string): ManualModelDraft {
    if (!manualModelDrafts.value[providerId]) {
        manualModelDrafts.value[providerId] = {
            name: "",
            id: "",
            api: "",
            group: "",
            contextWindowTokens: "",
            maxTokens: "",
        };
    }

    return manualModelDrafts.value[providerId];
}

function displayModelApi(model: ModelDraft): string {
    return model.api.trim() || t("settings.panels.models.notConfigured");
}

function displayModelApiSource(model: ModelDraft): string {
    return model.api.trim() ? t("settings.panels.models.modelApiSourceModel") : t("settings.panels.models.modelApiSourceMissing");
}

/** 按精确 model ID 查询 NeuroBook 唯一标准 Model Catalog。 */
function findCatalogModel(modelId: string): ModelCatalogEntryDto | null {
    return modelCatalog.value?.models.find((model) => model.id === modelId.trim()) ?? null;
}

const editingModelCatalogCost = computed(() => editingModel.value ? findCatalogModel(editingModel.value.id)?.cost ?? null : null);
const editingCatalogModel = computed(() => editingModel.value ? findCatalogModel(editingModel.value.id) : null);
const editingModelMissingFields = computed(() => editingModel.value ? requiredModelFields(buildModelCheckDraft(editingModel.value)) : []);

/** 用当前标准 Catalog 能力块完整覆盖模型能力，不修改名称、分组和启用状态。 */
function reapplyCatalogModel(model: ModelDraft): void {
    const catalogModel = findCatalogModel(model.id);
    if (!catalogModel) {
        notification.warning(t("settings.panels.models.noCatalogMetadata"));
        return;
    }
    const catalogDraft = cloneCatalogModel(catalogModel, activeProvider.value?.defaultApi || null, model.api || null);
    applyCatalogCapabilities(model, {...buildModelCheckDraft(catalogDraft), enabled: model.enabled});
}

/** 用 Catalog 完整能力块覆盖草稿，同时保留用户名称、分组和启用状态。 */
function applyCatalogCapabilities(model: ModelDraft, replacement: ConfiguredModelDto): void {
    const catalogDraft = cloneModel(replacement);
    Object.assign(model, {
        api: catalogDraft.api,
        reasoning: catalogDraft.reasoning,
        input: catalogDraft.input,
        maxTokens: catalogDraft.maxTokens,
        cost: catalogDraft.cost,
        compat: catalogDraft.compat,
        headers: catalogDraft.headers,
        thinkingLevelMap: catalogDraft.thinkingLevelMap,
        contextWindowTokens: catalogDraft.contextWindowTokens,
    });
}

/** 只清理当前设置 scope 中已经不能运行的模型引用。 */
function cleanScopeModelReferences(modelKeys: Set<string>): boolean {
    const snapshot = editorSnapshot.value;
    if (!snapshot) {
        return false;
    }
    const currentAgent = isProjectScope.value ? snapshot.project?.agent : snapshot.global.agent;
    const nextAgent = isProjectScope.value
        ? cleanProjectAgent(snapshot.project?.agent, modelKeys)
        : cleanGlobalAgent(snapshot.global.agent, modelKeys);
    const changed = JSON.stringify(nextAgent) !== JSON.stringify(currentAgent);
    if (!changed) {
        return false;
    }
    if (isProjectScope.value && snapshot.project) {
        snapshot.project.agent = nextAgent as typeof snapshot.project.agent;
    } else if (!isProjectScope.value) {
        snapshot.global.agent = nextAgent as typeof snapshot.global.agent;
    }
    return true;
}

/**
 * 一键修复当前模型草稿：应用可命中的 Catalog，禁用剩余无效模型并清理引用。
 * 只修改前端草稿，不自动保存。
 */
async function repairModelSettings(): Promise<void> {
    if (repairingModels.value) {
        return;
    }
    repairingModels.value = true;
    try {
        const repairs = [] as ReturnType<typeof previewCatalogRepairs>;
        let disabledModelKeys: string[] = [];
        let clearedDefaultApis = 0;
        if (!isProjectScope.value) {
            const catalog = await loadModelCatalog();
            clearedDefaultApis = clearUnsupportedDefaultApis(draft.value);
            repairs.push(...previewCatalogRepairs(draft.value, catalog.models));
            for (const repair of repairs) {
                const model = draft.value.providers[repair.providerIndex]?.models[repair.modelIndex];
                if (model) {
                    applyCatalogCapabilities(model, repair.replacement);
                }
            }
            disabledModelKeys = disableInvalidDrafts(draft.value);
            ensureRunnableDefault(draft.value);
        } else {
            draft.value.defaultModelKey = cleanModelKey(draft.value.defaultModelKey, availableModelKeys());
        }
        const modelKeys = availableModelKeys();
        const referencesChanged = cleanScopeModelReferences(modelKeys);
        resetModelCheckState();
        await nextTick();
        const remaining = validationIssues.value.length;
        const message = t("settings.panels.models.oneClickRepairResult", {
            repaired: repairs.length,
            cleared: clearedDefaultApis,
            disabled: disabledModelKeys.length,
            remaining,
        });
        if (remaining > 0) {
            notification.warning(message, {title: t("settings.panels.models.oneClickRepairNeedsReview")});
        } else if (repairs.length > 0 || clearedDefaultApis > 0 || disabledModelKeys.length > 0 || referencesChanged) {
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

function providerDefaultApiLabel(provider: ProviderDraft): string {
    return provider.defaultApi.trim()
        ? t("settings.panels.models.providerDefaultApi", {api: provider.defaultApi.trim()})
        : t("settings.panels.models.metadataOrRequiredApi");
}

/** 收集 Config agent 中显式保存的模型引用。 */
function agentModelReferences(
    agent: {profileModelDefaults?: {modelKey?: string | null}; profiles?: Record<string, {model?: {modelKey?: string | null}}>} | undefined,
    pathPrefix: Array<string | number>,
    labelPrefix: string,
): ModelReferenceInput[] {
    if (!agent) {
        return [];
    }
    const references: ModelReferenceInput[] = [];
    if (agent.profileModelDefaults && Object.hasOwn(agent.profileModelDefaults, "modelKey")) {
        references.push({
            modelKey: agent.profileModelDefaults.modelKey ?? null,
            path: [...pathPrefix, "profileModelDefaults", "modelKey"],
            label: `${labelPrefix} Profile 默认模型`,
        });
    }
    for (const [profileKey, profile] of Object.entries(agent.profiles ?? {})) {
        if (!profile.model || !Object.hasOwn(profile.model, "modelKey")) {
            continue;
        }
        references.push({
            modelKey: profile.model.modelKey ?? null,
            path: [...pathPrefix, "profiles", profileKey, "model", "modelKey"],
            label: `${labelPrefix} Profile ${profileKey} 模型`,
        });
    }
    return references;
}

/** 当前草稿的实时校验结果；Project scope 的 null 默认值表示继承 Global。 */
const validationState = computed(() => {
    const globalDefaultModelKey = editorSnapshot.value?.global.models?.default ?? null;
    const contractDraft = isProjectScope.value
        ? {...draft.value, defaultModelKey: draft.value.defaultModelKey ?? globalDefaultModelKey}
        : draft.value;
    const references = isProjectScope.value
        ? agentModelReferences(editorSnapshot.value?.project?.agent, ["project", "agent"], "Project")
        : agentModelReferences(editorSnapshot.value?.global.agent, ["agent"], "Global");
    return inspectSettingsDraft(contractDraft, references);
});

const validationIssues = computed(() => validationState.value.issues);
const validationIssueDetails = computed(() => validationIssues.value.map((issue) => issue.message).join("\n"));

function modelApiInheritLabel(model: ModelDraft): string {
    const providerApi = activeProvider.value?.defaultApi.trim();
    if (providerApi) {
        return t("settings.panels.models.providerDefaultApi", {api: providerApi});
    }
    return model.api.trim() || t("settings.panels.modelEdit.requiredForCustomModel");
}

function modelInputDisplayLabel(model: ModelDraft): string {
    return (parseModelInput(model.input) ?? [])
        .map((item) => modelInputOptions.value.find((option) => option.value === item)?.label ?? item)
        .join(" / ");
}

function modelReasoningDisplayLabel(model: ModelDraft): string {
    const reasoning = parseModelReasoning(model.reasoning);
    return reasoning === null ? t("settings.panels.models.unknown") : reasoning ? t("settings.panels.models.supported") : t("settings.panels.models.unsupported");
}

function formatTokenLimit(value: number | null | undefined): string {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        return t("settings.panels.models.unknown");
    }
    return new Intl.NumberFormat(undefined, {maximumFractionDigits: 0}).format(value);
}

function modelContextWindowDefaultLabel(model: ModelDraft): string {
    return parseDraftInteger(model.contextWindowTokens)
        ? `${formatTokenLimit(parseDraftInteger(model.contextWindowTokens))} tokens`
        : t("settings.panels.modelEdit.requiredForCustomModel");
}

function modelMaxTokensDefaultLabel(model: ModelDraft): string {
    return parseDraftInteger(model.maxTokens)
        ? `${formatTokenLimit(parseDraftInteger(model.maxTokens))} tokens`
        : t("settings.panels.modelEdit.requiredForCustomModel");
}

/**
 * 更新手动模型 ID 时，尽量从 Pi 内置目录同步 API 元数据。
 */
function updateManualModelId(providerId: string, modelId: string): void {
    const manualDraft = getManualModelDraft(providerId);
    manualDraft.id = modelId;
}

/**
 * 懒加载 Pi 内置模型目录。
 */
async function loadModelCatalog(): Promise<NeuroModelCatalogDto> {
    if (!modelCatalog.value) {
        modelCatalog.value = await configApi.modelCatalog();
        if (!providerPresetOptions.value.some((preset) => preset.id === selectedPreset.value)) {
            selectedPreset.value = providerPresetOptions.value[0]?.id ?? fallbackProviderPreset.id;
        }
    }
    return modelCatalog.value;
}

/** 把标准 Catalog 模型复制为完整、自包含的用户模型草稿。 */
function cloneCatalogModel(model: ModelCatalogEntryDto, providerDefaultApi: string | null, modelApi: string | null = null): ModelDraft {
    return cloneModel(configuredModelFromCatalog(model, {
        group: deriveGroup(model.id),
        enabled: false,
        modelApi,
        providerDefaultApi,
    }));
}

/**
 * 新增 Provider 预设。
 */
async function addProvider(): Promise<void> {
    try {
        await loadModelCatalog();
    } catch (error) {
        notification.error(resolveApiErrorMessage(error, t("settings.panels.models.loadPiCatalogFailed")));
        return;
    }
    const preset = providerPresetOptions.value.find((item) => item.id === selectedPreset.value) ?? providerPresetOptions.value[0];
    if (!preset) {
        return;
    }

    const providerId = buildUniqueProviderId(preset.id.replace(/^custom-/u, "custom-"));
    const localKey = createProviderLocalKey(providerId);
    activeProviderKey.value = localKey;
    draft.value.providers.push({
        localKey,
        id: providerId,
        name: preset.name,
        enabled: true,
        defaultApi: preset.defaultApi ?? "",
        discovery: {
            adapter: preset.discovery.adapter,
            endpointPath: preset.discovery.endpointPath ?? "",
        },
        options: {
            apiKey: "",
            baseURL: preset.baseUrl,
            proxy: "",
            timeoutMs: "",
            requestOptions: "",
            apiKeyConfigured: false,
            apiKeyMaskedValue: null,
            apiKeyCleared: false,
        },
        models: [],
    });
    notification.success(t("settings.panels.models.providerAdded", {label: preset.name}));
}

/**
 * 保存模型设定并返回是否成功，供删除 Provider 这类复合操作复用。
 */
async function saveSettingsResult(successMessage?: string): Promise<boolean> {
    if (!dirty.value || saving.value) {
        return false;
    }

    saving.value = true;

    try {
        const snapshot = isProjectScope.value
            ? await configApi.saveProject(buildProjectConfigPayload(), props.targetQuery)
            : await configApi.saveGlobal(buildGlobalConfigPayload(), props.targetQuery);
        editorSnapshot.value = snapshot;
        if (isProjectScope.value) {
            applyProjectSettings(snapshot);
            notification.success(successMessage ?? t("settings.panels.models.projectSaveSuccess"));
        } else {
            applySettings(snapshot, {preserveUiState: true, preferredProviderKey: activeProviderKey.value});
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

/**
 * 保存模型设定。
 */
async function saveSettings(): Promise<void> {
    await saveSettingsResult();
}

/**
 * 重新读取已保存的模型设定，放弃当前草稿。
 */
async function restoreSettings(): Promise<void> {
    await loadSettings();
}

/**
 * 重命名当前激活 Provider 的 id，并同步相关引用。
 */
function renameActiveProviderId(nextProviderId: string): void {
    const provider = activeProvider.value;
    if (!provider) {
        return;
    }

    const previousProviderId = provider.id;
    const normalizedProviderId = nextProviderId.trim();
    cancelProviderChecks(provider, {clearBatch: true});
    provider.id = normalizedProviderId;

    if (previousProviderId === normalizedProviderId) {
        return;
    }

    if (draft.value.defaultModelKey?.startsWith(`${previousProviderId}/`)) {
        draft.value.defaultModelKey = draft.value.defaultModelKey.replace(`${previousProviderId}/`, `${normalizedProviderId}/`);
    }
    renameProviderModelReferences(previousProviderId, normalizedProviderId);

    if (discoveredModels.value[previousProviderId]) {
        discoveredModels.value = {
            ...discoveredModels.value,
            [normalizedProviderId]: discoveredModels.value[previousProviderId] ?? [],
        };
        delete discoveredModels.value[previousProviderId];
    }

    if (manualModelDrafts.value[previousProviderId]) {
        manualModelDrafts.value = {
            ...manualModelDrafts.value,
            [normalizedProviderId]: manualModelDrafts.value[previousProviderId],
        };
        delete manualModelDrafts.value[previousProviderId];
    }
}

/**
 * Provider ID 重命名时只迁移 Global Config 中的模型引用。
 */
function renameProviderModelReferences(previousProviderId: string, nextProviderId: string): void {
    if (editorSnapshot.value?.global.agent) {
        const renamedGlobalAgent = renameAgentProvider(
            editorSnapshot.value.global.agent,
            previousProviderId,
            nextProviderId,
        );
        editorSnapshot.value.global.agent = renamedGlobalAgent.agent ?? editorSnapshot.value.global.agent;
    }
}

/**
 * 请求删除当前 Provider。
 */
function requestDeleteActiveProvider(): void {
    if (!activeProvider.value) {
        return;
    }
    deleteProviderDialogOpen.value = true;
}

/**
 * 删除当前 Provider，确认后立即保存当前模型面板草稿。
 */
async function confirmDeleteActiveProvider(): Promise<void> {
    const provider = activeProvider.value;
    if (!provider) {
        deleteProviderDialogOpen.value = false;
        return;
    }

    const deletedProviderId = provider.id;
    const deletedProviderName = provider.name;
    draft.value.providers = draft.value.providers.filter((item) => item !== provider);
    if (draft.value.defaultModelKey?.startsWith(`${deletedProviderId}/`)) {
        draft.value.defaultModelKey = null;
    }
    delete discoveredModels.value[deletedProviderId];
    delete manualModelDrafts.value[deletedProviderId];
    activeProviderKey.value = draft.value.providers[0]?.localKey ?? "";
    ensureDefaultModelKey();
    deleteProviderDialogOpen.value = false;
    await saveSettingsResult(t("settings.panels.models.providerDeleted", {name: deletedProviderName}));
}

/**
 * 读取当前 Provider 草稿请求体。
 */
function buildProviderRequest(provider: ProviderDraft): {provider: ModelProviderDraftDto} {
    return {
        provider: {
            id: provider.id.trim(),
            name: provider.name.trim(),
            defaultApi: provider.defaultApi.trim() || null,
            discovery: {
                adapter: provider.discovery.adapter,
                endpointPath: provider.discovery.endpointPath.trim() || null,
            },
            options: {
                apiKey: provider.options.apiKey.trim(),
                baseURL: provider.options.baseURL.trim(),
                proxy: provider.options.proxy.trim(),
                timeoutMs: parseDraftInteger(provider.options.timeoutMs),
                requestOptions: parseRequestOptions(provider.options.requestOptions),
            },
        },
    };
}

function shouldUseSavedProviderApiKey(provider: ProviderDraft): boolean {
    return !provider.options.apiKeyCleared && !provider.options.apiKey.trim();
}

function buildModelCheckDraft(model: ModelDraft): Omit<ConfiguredModelDto, "enabled"> {
    return {
        name: model.name.trim(),
        id: model.id.trim(),
        group: model.group.trim() || null,
        api: model.api.trim() || null,
        reasoning: parseModelReasoning(model.reasoning),
        input: parseModelInput(model.input),
        maxTokens: parseDraftInteger(model.maxTokens),
        cost: parseModelCostDraft(model.cost),
        compat: parseModelCompat(model.compat),
        headers: parseStringMap(model.headers),
        thinkingLevelMap: parseStringMap(model.thinkingLevelMap),
        contextWindowTokens: parseDraftInteger(model.contextWindowTokens),
    };
}

/**
 * 从 Provider 抓取模型列表。
 */
async function discoverModels(): Promise<void> {
    const provider = activeProvider.value;
    if (!provider || providerDiscoveringId.value) {
        return;
    }

    providerDiscoveringId.value = provider.id;

    try {
        await loadModelCatalog();
        const result = await $fetch<DiscoverProviderModelsResponseDto>("/api/config/models/provider-discover", {
            method: "POST",
            body: buildProviderRequest(provider),
        });
        discoveredModels.value = {
            ...discoveredModels.value,
            [provider.id]: result.models,
        };
        notification.success(result.message);
    } catch (error) {
        notification.error(resolveApiErrorMessage(error, t("settings.panels.models.discoverFailed")));
    } finally {
        providerDiscoveringId.value = "";
    }
}

/**
 * 启用或新增模型。
 */
function enableModel(model: ConfiguredModelDto): ModelDraft | null {
    const provider = activeProvider.value;
    if (!provider) {
        return null;
    }

    const modelId = model.id.trim();
    if (!modelId) {
        return null;
    }

    const existingModel = provider.models.find((item) => item.id === modelId);
    if (existingModel) {
        Object.assign(existingModel, cloneModel(model));
    } else {
        provider.models.push(cloneModel(model));
    }

    ensureDefaultModelKey();
    return provider.models.find((item) => item.id === modelId) ?? null;
}

/**
 * 将模型标记为禁用。
 */
function disableModel(model: ModelDraft): void {
    const provider = activeProvider.value;
    if (provider) {
        cancelModelCheck(provider, model);
    }
    model.enabled = false;
    ensureDefaultModelKey();
}

/** 删除指定模型条目；按对象身份处理，重复 ID 条目也能分别删除。 */
function deleteModel(model: ModelDraft): void {
    const provider = activeProvider.value;
    if (!provider) {
        return;
    }
    cancelModelCheck(provider, model);
    provider.models = provider.models.filter((item) => item !== model);
    ensureDefaultModelKey();
    cleanScopeModelReferences(availableModelKeys());
}

/**
 * 手动新增一个模型。
 */
function addManualModel(): void {
    const provider = activeProvider.value;
    if (!provider) {
        return;
    }

    const manualDraft = getManualModelDraft(provider.id);
    if (!manualDraft.name.trim() || !manualDraft.id.trim()) {
        notification.error(t("settings.panels.models.manualRequired"));
        return;
    }

    const catalogModel = findCatalogModel(manualDraft.id);
    const discovered: DiscoveredProviderModelDto = {
        name: manualDraft.name,
        id: manualDraft.id,
        api: manualDraft.api || provider.defaultApi || null,
        group: manualDraft.group || null,
        reasoning: null,
        input: null,
        contextWindowTokens: parseDraftInteger(manualDraft.contextWindowTokens),
        maxTokens: parseDraftInteger(manualDraft.maxTokens),
        cost: null,
        compat: null,
        headers: null,
        thinkingLevelMap: null,
    };
    const resolved = resolveDiscoveredModelDraft(discovered, catalogModel, provider.defaultApi || null);
    const added = enableModel(resolved.model);

    manualModelDrafts.value = {
        ...manualModelDrafts.value,
        [provider.id]: {
            name: "",
            id: "",
            api: "",
            group: "",
            contextWindowTokens: "",
            maxTokens: "",
        },
    };
    if (added && resolved.source === "incomplete") {
        void openModelEdit(added);
    }
    notification.success(t("settings.panels.models.manualAdded"));
}

function modelCheckKey(provider: ProviderDraft, model: ModelDraft): string {
    return `${provider.localKey}/${model.localKey}`;
}

/** 返回当前草稿对应模型的问题，编辑后立即更新。 */
function savedModelIssues(providerId: string, modelId: string) {
    const modelKey = `${providerId.trim()}/${modelId.trim()}`;
    return validationIssues.value.filter((issue) => issue.modelKey === modelKey);
}

/** 判断当前前端草稿是否已经具备健康检查所需的完整能力。 */
function modelDraftRunnable(provider: ProviderDraft, model: ModelDraft): boolean {
    return validationState.value.runnableModelKeys.has(`${provider.id.trim()}/${model.id.trim()}`);
}

function modelCheckResult(provider: ProviderDraft, model: ModelDraft): ModelCheckResult | null {
    return modelCheckResults.value[modelCheckKey(provider, model)] ?? null;
}

function isModelChecking(provider: ProviderDraft, model: ModelDraft): boolean {
    return Boolean(modelCheckControllers.value[modelCheckKey(provider, model)]);
}

function isAbortError(error: unknown): boolean {
    if (error instanceof DOMException && error.name === "AbortError") {
        return true;
    }
    const name = typeof error === "object" && error !== null && "name" in error
        ? (error as {name?: unknown}).name
        : null;
    return name === "AbortError";
}

function setModelCheckController(modelKey: string, controller: AbortController): void {
    modelCheckControllers.value = {
        ...modelCheckControllers.value,
        [modelKey]: {controller},
    };
}

/**
 * 批次下所有模型都停止后，释放“检测全部”的 UI 锁。
 */
function clearModelCheckBatchesIfSettled(providerKey?: string): void {
    const nextBatches = {...activeModelCheckBatches.value};
    const entries = providerKey
        ? [[providerKey, nextBatches[providerKey]] as const]
        : Object.entries(nextBatches);
    let changed = false;

    for (const [batchProviderKey, batch] of entries) {
        if (!batch) {
            continue;
        }
        if (batch.modelKeys.some((modelKey) => Boolean(modelCheckControllers.value[modelKey]))) {
            continue;
        }
        delete nextBatches[batchProviderKey];
        changed = true;
    }

    if (changed) {
        activeModelCheckBatches.value = nextBatches;
    }
}

/**
 * Provider 被禁用或重命名时，丢弃旧 Provider 批次锁。
 */
function clearProviderModelCheckBatch(provider: ProviderDraft): void {
    if (activeModelCheckBatches.value[provider.localKey]) {
        const nextBatches = {...activeModelCheckBatches.value};
        delete nextBatches[provider.localKey];
        activeModelCheckBatches.value = nextBatches;
    }
}

function clearModelCheckController(modelKey: string, controller: AbortController): void {
    if (modelCheckControllers.value[modelKey]?.controller !== controller) {
        return;
    }
    const nextControllers = {...modelCheckControllers.value};
    delete nextControllers[modelKey];
    modelCheckControllers.value = nextControllers;
    clearModelCheckBatchesIfSettled();
}

function writeModelCheckResult(modelKey: string, result: ModelCheckResult): void {
    modelCheckResults.value = {
        ...modelCheckResults.value,
        [modelKey]: result,
    };
}

function resetModelCheckState(): void {
    modelCheckStateVersion += 1;
    for (const state of Object.values(modelCheckControllers.value)) {
        state.controller.abort();
    }
    modelCheckControllers.value = {};
    modelCheckResults.value = {};
    activeModelCheckBatches.value = {};
}

function cancelProviderChecks(provider: ProviderDraft, options: {clearBatch?: boolean} = {}): void {
    for (const model of provider.models) {
        modelCheckControllers.value[modelCheckKey(provider, model)]?.controller.abort();
    }
    if (options.clearBatch) {
        clearProviderModelCheckBatch(provider);
    }
}

function cancelModelCheck(provider: ProviderDraft, model: ModelDraft): void {
    modelCheckControllers.value[modelCheckKey(provider, model)]?.controller.abort();
}

function cancelActiveProviderChecks(): void {
    const provider = activeProvider.value;
    if (!provider) {
        return;
    }
    cancelProviderChecks(provider);
}

/**
 * 对单个模型执行健康检查，并把结果写入模型行临时状态。
 */
async function runModelCheck(provider: ProviderDraft, model: ModelDraft): Promise<ModelCheckResult> {
    const modelKey = modelCheckKey(provider, model);
    const controller = new AbortController();
    const stateVersion = modelCheckStateVersion;
    setModelCheckController(modelKey, controller);

    try {
        const result = await $fetch<CheckModelResponseDto>("/api/config/models/model-check", {
            method: "POST",
            signal: controller.signal,
            body: {
                provider: buildProviderRequest(provider).provider,
                model: buildModelCheckDraft(model),
                useSavedApiKey: shouldUseSavedProviderApiKey(provider),
            },
        });
        if (stateVersion === modelCheckStateVersion && !controller.signal.aborted) {
            writeModelCheckResult(modelKey, result);
        }
        return result;
    } catch (error) {
        const result: ModelCheckResult = controller.signal.aborted || isAbortError(error)
            ? {
                success: false,
                latencyMs: null,
                message: t("settings.panels.models.modelCheckCancelled"),
                cancelled: true,
            }
            : {
                success: false,
                latencyMs: null,
                message: resolveApiErrorMessage(error, t("settings.panels.models.modelCheckFailed")),
            };
        if (stateVersion === modelCheckStateVersion) {
            writeModelCheckResult(modelKey, result);
        }
        return result;
    } finally {
        clearModelCheckController(modelKey, controller);
    }
}

/**
 * 对单个模型执行健康检查。
 */
async function checkModel(model: ModelDraft): Promise<void> {
    const provider = activeProvider.value;
    if (!provider?.enabled || !model.enabled || isModelChecking(provider, model)) {
        return;
    }

    await runModelCheck(provider, model);
}

/**
 * 并发检测当前 Provider 下所有启用且尚未检测中的模型。
 */
async function checkAllActiveProviderModels(): Promise<void> {
    const provider = activeProvider.value;
    if (!provider?.enabled || checkingAllModels.value) {
        return;
    }
    const enabledModels = provider.models.filter((model) => model.enabled);
    if (enabledModels.length === 0) {
        notification.info(t("settings.panels.models.noEnabledProviderModels"));
        return;
    }
    const batchModelKeys = enabledModels.map((model) => modelCheckKey(provider, model));
    activeModelCheckBatches.value = {
        ...activeModelCheckBatches.value,
        [provider.localKey]: {
            providerKey: provider.localKey,
            modelKeys: batchModelKeys,
        },
    };
    const models = enabledModels.filter((model) => !isModelChecking(provider, model));
    if (models.length === 0) {
        clearModelCheckBatchesIfSettled(provider.localKey);
        return;
    }

    try {
        await Promise.allSettled(models.map((model) => runModelCheck(provider, model)));
    } finally {
        clearModelCheckBatchesIfSettled(provider.localKey);
    }
}

/**
 * 获取当前 Provider 下远程抓取到的模型列表。
 */
const currentDiscoveredModels = computed(() => {
    return activeProvider.value ? (discoveredModels.value[activeProvider.value.id] ?? []) : [];
});

/**
 * 获取远程抓取模型的当前状态。
 */
function resolveDiscoveredModelState(modelId: string): "enabled" | "disabled" | "missing" {
    const provider = activeProvider.value;
    if (!provider) {
        return "missing";
    }

    const existingModel = provider.models.find((model) => model.id === modelId);
    if (!existingModel) {
        return "missing";
    }

    return existingModel.enabled ? "enabled" : "disabled";
}

const librarySearchQuery = ref("");

const unifiedLibraryGroups = computed(() => {
    const provider = activeProvider.value;
    if (!provider) return [];
    
    const allModelsMap = new Map<string, {name: string; id: string; group: string; state: "enabled" | "disabled" | "remote"; draftModel?: ConfiguredModelDto}>();
    
    for (const rm of currentDiscoveredModels.value) {
        const resolved = resolveDiscoveredModelDraft(rm, findCatalogModel(rm.id), provider.defaultApi || null);
        const group = rm.group || deriveGroup(rm.id);
        allModelsMap.set(rm.id, {
            name: rm.name,
            id: rm.id,
            group,
            state: resolveDiscoveredModelState(rm.id) === 'enabled' ? 'enabled' : 'remote',
            draftModel: resolved.model,
        });
    }

    for (const catalogModel of modelCatalog.value?.models ?? []) {
        if (allModelsMap.has(catalogModel.id)) {
            continue;
        }
        const catalogDraft = cloneCatalogModel(catalogModel, provider.defaultApi || null);
        allModelsMap.set(catalogModel.id, {
            name: catalogModel.name,
            id: catalogModel.id,
            group: deriveGroup(catalogModel.id),
            state: "remote",
            draftModel: {...buildModelCheckDraft(catalogDraft), enabled: true},
        });
    }
    
    for (const m of disabledModels.value) {
        const group = m.group.trim() || deriveGroup(m.id);
        const draftModel = buildModelCheckDraft(m);
        allModelsMap.set(m.id, {
            name: m.name,
            id: m.id,
            group,
            state: "disabled",
            draftModel: {...draftModel, enabled: requiredModelFields(draftModel).length === 0},
        });
    }
    
    for (const m of provider.models.filter(m => m.enabled)) {
        const group = m.group.trim() || deriveGroup(m.id);
        allModelsMap.set(m.id, { name: m.name, id: m.id, group, state: 'enabled' });
    }

    const query = librarySearchQuery.value.toLowerCase().trim();
    
    const groupMap = new Map<string, Array<{name: string; id: string; group: string; state: string; draftModel?: ConfiguredModelDto}>>();
    for (const model of allModelsMap.values()) {
        if (query && !model.name.toLowerCase().includes(query) && !model.id.toLowerCase().includes(query)) {
            continue;
        }
        const g = groupMap.get(model.group) ?? [];
        g.push(model);
        groupMap.set(model.group, g);
    }
    
    return [...groupMap.entries()]
        .map(([group, models]) => ({
            group,
            models: [...models].sort((left, right) => left.id.localeCompare(right.id)),
        }))
        .sort((left, right) => left.group.localeCompare(right.group));
});

const libraryExpandedGroups = ref<Record<string, boolean>>({});
function toggleLibraryGroup(group: string) {
    libraryExpandedGroups.value[group] = !libraryExpandedGroups.value[group];
}

function toggleLibraryModel(model: {name: string; id: string; group: string; state: string; draftModel?: ConfiguredModelDto}) {
    if (model.state === 'enabled') {
        const existing = activeProvider.value?.models.find(m => m.id === model.id);
        if (existing) disableModel(existing);
    } else {
        if (model.state === "disabled" && !(model.draftModel?.enabled ?? false)) {
            const existing = activeProvider.value?.models.find((item) => item.id === model.id);
            if (existing) {
                void openModelEdit(existing);
            }
            return;
        }
        const fallbackModel: ConfiguredModelDto = {
            name: model.name,
            id: model.id,
            group: model.group,
            enabled: false,
            api: activeProvider.value?.defaultApi || null,
            reasoning: null,
            input: null,
            maxTokens: null,
            cost: null,
            compat: null,
            headers: null,
            thinkingLevelMap: null,
            contextWindowTokens: null,
        };
        const enabled = enableModel(model.draftModel ?? fallbackModel);
        if (enabled && !(model.draftModel?.enabled ?? false)) {
            void openModelEdit(enabled);
        }
    }
}

watch(() => activeProvider.value?.id ?? "", (providerId) => {
    if (!providerId) {
        return;
    }

    getManualModelDraft(providerId);
});

onMounted(() => {
    void loadSettings();
});

onBeforeUnmount(() => {
    resetModelCheckState();
});

watch(() => [props.scope, props.targetQuery?.workspaceKind, props.targetQuery?.projectPath] as const, () => {
    void loadSettings();
});

defineExpose({
    dirty,
    loading,
    saving,
    saveSettings,
    restoreSettings,
});
</script>

<template>
    <!-- 模型设置主容器 -->
    <div class="space-y-4 pt-1">
        <!-- 精简版顶部栏 -->
        <div class="flex flex-wrap items-center justify-between gap-4">
            <div class="max-w-xl">
                <h3 class="text-base font-semibold text-[var(--text-main)]">{{ isProjectScope ? t("settings.panels.models.projectTitle") : t("settings.panels.models.globalTitle") }}</h3>
                <p class="mt-1 text-xs text-[var(--text-secondary)]">{{ isProjectScope ? t("settings.panels.models.projectDescription", {target: props.targetLabel || t("settings.panels.models.currentProject")}) : t("settings.panels.models.globalDescription") }}</p>
            </div>
        </div>

        <!-- 当前草稿问题：紧凑展示，完整内容放在 title；修复只改草稿，不自动保存。 -->
        <div v-if="validationIssues.length > 0" class="flex min-h-9 items-center gap-2 rounded-lg border border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] px-3 py-1.5 text-xs text-[var(--text-main)]" :title="validationIssueDetails">
            <span class="i-lucide-triangle-alert h-4 w-4 shrink-0 text-[var(--status-warning)]"></span>
            <span class="shrink-0 font-semibold">{{ t("settings.panels.models.validationIssuesTitle") }}</span>
            <span class="shrink-0 rounded bg-[var(--bg-panel)] px-1.5 py-0.5 text-[10px] text-[var(--text-secondary)]">{{ validationIssues.length }}</span>
            <span class="min-w-0 flex-1 truncate text-[var(--text-secondary)]">{{ validationIssues[0]?.message }}</span>
            <button class="inline-flex h-7 shrink-0 items-center justify-center rounded-md px-2 text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" @click="validationDialogOpen = true">{{ t("settings.panels.models.viewAllIssues") }}</button>
            <button class="inline-flex h-7 shrink-0 items-center justify-center rounded-md border border-[var(--status-warning-border)] bg-[var(--bg-panel)] px-2.5 font-medium text-[var(--text-main)] transition-colors hover:bg-[var(--bg-hover)] disabled:opacity-50" :disabled="repairingModels" @click="void repairModelSettings()">
                <span class="mr-1 h-3.5 w-3.5" :class="repairingModels ? 'i-lucide-loader-2 animate-spin' : 'i-lucide-wand-sparkles'"></span>
                {{ t("settings.panels.models.oneClickRepair") }}
            </button>
        </div>

        <!-- 顶部默认模型与新增 Provider -->
        <div class="grid gap-4" :class="isProjectScope ? '' : 'lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]'">
            <div class="group flex flex-col justify-center rounded-2xl border border-[var(--border-color)] bg-[var(--bg-panel)] px-5 py-4 shadow-sm transition-all duration-300 hover:shadow-md">
                <div class="mb-3 flex items-center gap-2">
                    <div class="flex h-6 w-6 items-center justify-center rounded-md bg-[var(--accent-bg)] text-[var(--accent-text)]">
                        <span class="i-lucide-cpu h-3.5 w-3.5"></span>
                    </div>
                    <div class="text-sm font-semibold text-[var(--text-main)]">{{ isProjectScope ? t("settings.panels.models.projectDefaultTitle") : t("settings.panels.models.globalDefaultTitle") }}</div>
                </div>
                <NovelIdeModelSelect
                    :model-value="draft.defaultModelKey"
                    :models="defaultModelOptions"
                    :allow-default="isProjectScope"
                    :default-label="t('settings.panels.models.followGlobalDefault')"
                    :placeholder="t('settings.panels.models.noEnabledModels')"
                    @update:model-value="draft.defaultModelKey = $event"
                />
            </div>

            <div v-if="!isProjectScope" class="group flex flex-col justify-center rounded-2xl border border-[var(--border-color)] bg-[var(--bg-panel)] px-5 py-4 shadow-sm transition-all duration-300 hover:shadow-md">
                <div class="mb-3 flex items-center gap-2">
                    <div class="flex h-6 w-6 items-center justify-center rounded-md bg-[var(--bg-input)] text-[var(--text-secondary)]">
                        <span class="i-lucide-network h-3.5 w-3.5"></span>
                    </div>
                    <div class="text-sm font-semibold text-[var(--text-main)]">{{ t("settings.panels.models.addProvider") }}</div>
                </div>
                <div class="flex items-center gap-2">
                    <div class="min-w-0 flex-1">
                        <FormSelect :model-value="selectedPreset" :options="providerPresetOptions.map((item) => ({value: item.id, label: item.name}))" @update:model-value="selectedPreset = $event" />
                    </div>
                    <button class="inline-flex h-7 shrink-0 items-center justify-center rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] px-3 text-xs font-medium text-[var(--text-main)] shadow-sm transition-colors hover:bg-[var(--bg-hover)] active:scale-95" @click="void addProvider()">
                        <span class="i-lucide-plus mr-1 h-3 w-3"></span>
                        {{ t("settings.panels.models.add") }}
                    </button>
                </div>
            </div>
        </div>

        <!-- Loading State -->
        <div v-if="loading" class="flex min-h-[400px] flex-col items-center justify-center gap-4 rounded-2xl border border-[var(--border-color)] bg-[var(--bg-panel)] shadow-sm">
            <span class="i-lucide-loader-2 h-8 w-8 animate-spin text-[var(--text-muted)]"></span>
            <span class="text-sm text-[var(--text-secondary)]">{{ t("settings.panels.models.loading") }}</span>
        </div>

        <!-- 模型设置双栏布局 -->
        <div v-else-if="!isProjectScope" class="grid min-h-[500px] gap-5 xl:grid-cols-[260px_minmax(0,1fr)]">
            <!-- 左侧 Provider 列表 -->
            <aside class="flex flex-col rounded-2xl border border-[var(--border-color)] bg-[var(--bg-panel)] p-2 shadow-sm">
                <div class="px-3 pb-3 pt-2">
                    <div class="text-[11px] font-bold uppercase tracking-[0.2em] text-[var(--text-muted)]">Providers</div>
                    <div class="mt-1 text-xs text-[var(--text-secondary)] opacity-80">{{ t("settings.panels.models.providersHint") }}</div>
                </div>

                <div v-if="draft.providers.length === 0" class="m-2 rounded-xl border border-dashed border-[var(--border-color)] px-4 py-8 text-center text-xs leading-6 text-[var(--text-secondary)]">
                    {{ t("settings.panels.models.noProviders") }}<br>{{ t("settings.panels.models.addProviderFromAbove") }}
                </div>

                <div class="flex flex-col gap-1 overflow-y-auto px-1 pb-1 custom-scrollbar">
                    <button
                        v-for="provider in draft.providers"
                        :key="provider.localKey"
                        class="group relative flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-all duration-300"
                        :class="activeProviderKey === provider.localKey ? 'bg-[var(--accent-bg)] text-[var(--accent-text)] shadow-sm' : provider.enabled ? 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]' : 'text-[var(--text-muted)] opacity-65 hover:bg-[var(--bg-hover)] hover:text-[var(--text-secondary)]'"
                        @click="activeProviderKey = provider.localKey"
                    >
                        <!-- 激活状态左侧指示条 -->
                        <div
                            class="absolute left-0 top-1/2 h-1/2 w-[3px] -translate-y-1/2 rounded-r-full bg-[var(--accent-main)] transition-all duration-300"
                            :class="activeProviderKey === provider.localKey ? 'opacity-100' : 'opacity-0 scale-y-0'"
                        ></div>

                        <span class="h-4 w-4 shrink-0 transition-transform duration-300 group-hover:scale-110" :class="[provider.enabled ? 'i-lucide-server' : 'i-lucide-server-off', activeProviderKey === provider.localKey ? 'text-[var(--accent-main)]' : 'text-[var(--text-muted)]']"></span>
                        <div class="min-w-0 flex-1">
                            <div class="truncate text-[13px] font-medium" :class="activeProviderKey === provider.localKey ? 'text-[var(--accent-text)]' : 'text-[var(--text-main)]'">{{ provider.name }}</div>
                            <div class="mt-0.5 flex min-w-0 items-center gap-1 truncate text-[11px] opacity-70">
                                <span class="truncate">{{ t("settings.panels.models.modelCount", {count: provider.enabled ? providerEnabledModelCount(provider) : 0}) }}</span>
                                <span v-if="!provider.enabled" class="shrink-0 rounded border border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] px-1 text-[10px] text-[var(--status-warning)]">{{ t("settings.panels.models.providerDisabled") }}</span>
                            </div>
                        </div>
                    </button>
                </div>
            </aside>

            <!-- 右侧 Provider 详情 -->
            <div class="relative min-w-0">
                <Transition
                    name="fade-slide"
                    mode="out-in"
                >
                    <section v-if="activeProvider" :key="activeProvider.localKey" class="space-y-5 pb-8">
                        <!-- Provider 连接表单 -->
                        <div class="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-panel)] p-5 shadow-sm transition-all duration-300 hover:shadow-md">
                            <!-- Provider 操作区 -->
                            <div class="flex flex-wrap items-center justify-between gap-2">
                                <div v-if="!activeProvider.enabled" class="inline-flex min-h-8 min-w-0 items-center gap-1.5 rounded-lg border border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] px-2.5 py-1 text-xs font-medium text-[var(--status-warning)]">
                                    <span class="i-lucide-server-off h-3.5 w-3.5"></span>
                                    {{ t("settings.panels.models.providerDisabledHint") }}
                                </div>

                                <div class="ml-auto flex flex-wrap items-center justify-end gap-2">
                                    <button class="inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium shadow-sm transition-all duration-200 hover:shadow active:scale-95" :class="activeProvider.enabled ? 'border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] text-[var(--status-warning)] hover:bg-[var(--status-warning-bg)]' : 'border-[var(--status-success-border)] bg-[var(--status-success-bg)] text-[var(--status-success)] hover:bg-[var(--status-success-bg)]'" @click="toggleActiveProviderEnabled">
                                        <span class="h-3.5 w-3.5" :class="activeProvider.enabled ? 'i-lucide-power-off' : 'i-lucide-power'"></span>
                                        {{ activeProvider.enabled ? t("settings.panels.models.disableProvider") : t("settings.panels.models.enableProvider") }}
                                    </button>
                                    <button class="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--border-color)] bg-[var(--bg-input)] px-3 text-xs font-medium text-[var(--text-main)] shadow-sm transition-all duration-200 hover:bg-[var(--bg-hover)] hover:shadow active:scale-95 disabled:pointer-events-none disabled:opacity-60" :disabled="providerDiscoveringId === activeProvider.id" @click="void discoverModels()">
                                        <span v-if="providerDiscoveringId === activeProvider.id" class="i-lucide-loader-2 h-3.5 w-3.5 animate-spin"></span>
                                        <span v-else class="i-lucide-cloud-lightning h-3.5 w-3.5 text-[var(--text-muted)]"></span>
                                        {{ providerDiscoveringId === activeProvider.id ? t("settings.panels.models.discovering") : t("settings.panels.models.discoverModels") }}
                                    </button>
                                    <button class="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] px-3 text-xs font-medium text-[var(--status-danger)] shadow-sm transition-all duration-200 hover:bg-[var(--status-danger-bg)] hover:shadow active:scale-95" @click="requestDeleteActiveProvider">
                                        <span class="i-lucide-trash-2 h-3.5 w-3.5"></span>
                                        {{ t("settings.panels.models.delete") }}
                                    </button>
                                </div>
                            </div>

                            <!-- Provider 表单 -->
                            <div class="mt-4 grid gap-4 md:grid-cols-2">
                                <div class="group space-y-1.5">
                                    <label class="text-xs font-medium text-[var(--text-secondary)] transition-colors group-focus-within:text-[var(--text-main)]">{{ t("settings.panels.models.providerId") }}</label>
                                    <FormInput :model-value="activeProvider.id" :placeholder="t('settings.panels.models.providerIdPlaceholder')" @update:model-value="renameActiveProviderId" />
                                </div>
                                <div class="group space-y-1.5">
                                    <label class="text-xs font-medium text-[var(--text-secondary)] transition-colors group-focus-within:text-[var(--text-main)]">{{ t("settings.panels.models.providerName") }}</label>
                                    <FormInput v-model="activeProvider.name" :placeholder="t('settings.panels.models.providerNamePlaceholder')" />
                                </div>
                                <div class="group space-y-1.5">
                                    <label class="text-xs font-medium text-[var(--text-secondary)] transition-colors group-focus-within:text-[var(--text-main)]">{{ t("settings.panels.models.apiFormat") }}</label>
                                    <FormSelect v-model="activeProvider.defaultApi" :options="[{value: '', label: providerDefaultApiLabel(activeProvider)}, ...modelApiOptions]" />
                                </div>
                                <div class="group space-y-1.5">
                                    <label class="text-xs font-medium text-[var(--text-secondary)] transition-colors group-focus-within:text-[var(--text-main)]">API Base</label>
                                    <FormInput v-model="activeProvider.options.baseURL" :placeholder="t('settings.panels.models.apiBasePlaceholder')" />
                                </div>
                                <div class="group space-y-1.5 md:col-span-2">
                                    <div class="flex items-center justify-between gap-3">
                                        <label class="text-xs font-medium text-[var(--text-secondary)] transition-colors group-focus-within:text-[var(--text-main)]">API Key</label>
                                        <button v-if="activeProvider.options.apiKeyConfigured" type="button" class="text-[11px] text-[var(--status-danger)] transition-colors hover:opacity-80" @click="clearActiveProviderApiKey">{{ t("settings.panels.models.clearApiKey") }}</button>
                                    </div>
                                    <FormInput v-model="activeProvider.options.apiKey" :placeholder="activeProvider.options.apiKeyConfigured ? t('settings.panels.models.configuredApiKeyPlaceholder', {value: activeProvider.options.apiKeyMaskedValue ?? ''}) : 'sk-...'" type="password" />
                                </div>
                                <div class="group space-y-1.5 md:col-span-2">
                                    <label class="text-xs font-medium text-[var(--text-secondary)] transition-colors group-focus-within:text-[var(--text-main)]">{{ t("settings.panels.models.proxy") }}</label>
                                    <FormInput v-model="activeProvider.options.proxy" placeholder="http://127.0.0.1:7890" />
                                </div>
                                <div class="group space-y-1.5 md:col-span-2">
                                    <label class="text-xs font-medium text-[var(--text-secondary)] transition-colors group-focus-within:text-[var(--text-main)]">{{ t("settings.panels.models.requestTimeout") }}</label>
                                    <FormInput v-model="activeProvider.options.timeoutMs" :placeholder="t('settings.panels.models.defaultTimeout')" type="number" />
                                </div>
                                <div class="group space-y-1.5 md:col-span-2">
                                    <label class="text-xs font-medium text-[var(--text-secondary)] transition-colors group-focus-within:text-[var(--text-main)]">{{ t("settings.panels.models.requestOptions") }}</label>
                                    <textarea v-model="activeProvider.options.requestOptions" rows="4" placeholder="{&quot;store&quot;:false}" class="w-full resize-y rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2.5 py-2 font-mono text-[12px] text-[var(--text-main)] outline-none transition-colors placeholder:text-[var(--text-muted)] placeholder:opacity-80 focus:border-[var(--accent-main)] focus:ring-1 focus:ring-[var(--accent-main)]/20"></textarea>
                                </div>
                                <div class="group space-y-1.5">
                                    <label class="text-xs font-medium text-[var(--text-secondary)]">Discovery Adapter</label>
                                    <FormSelect v-model="activeProvider.discovery.adapter" :options="[
                                        {value: 'openai-models', label: 'OpenAI-compatible /models'},
                                        {value: 'openrouter-models', label: 'OpenRouter Models'},
                                        {value: 'google-models', label: 'Google Models'},
                                        {value: 'none', label: 'Manual only'},
                                    ]" />
                                </div>
                                <div class="group space-y-1.5">
                                    <label class="text-xs font-medium text-[var(--text-secondary)]">Discovery Endpoint Path</label>
                                    <FormInput v-model="activeProvider.discovery.endpointPath" placeholder="/models" />
                                </div>
                            </div>
                        </div>

                        <!-- 已启用模型 -->
                        <div class="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-panel)] shadow-sm transition-all duration-300 hover:shadow-md overflow-hidden">
                            <div class="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--border-color)] px-5 py-4 bg-[var(--bg-panel)]">
                                <div>
                                    <div class="flex items-center gap-2">
                                        <h3 class="text-base font-semibold text-[var(--text-main)]">{{ t("settings.panels.models.enabledModels") }}</h3>
                                        <div class="flex items-center justify-center rounded-full bg-[var(--bg-input)] px-2 py-0.5 text-[11px] font-medium text-[var(--text-secondary)]">{{ activeProviderEnabledModelCount }}</div>
                                    </div>
                                    <p class="mt-1 text-xs text-[var(--text-secondary)]">{{ t("settings.panels.models.enabledModelsDescription") }}</p>
                                </div>
                                <div class="flex flex-wrap items-center justify-end gap-2">
                                    <button class="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--border-color)] bg-[var(--bg-input)] px-3 text-xs font-medium text-[var(--text-main)] shadow-sm transition-all duration-200 hover:bg-[var(--bg-hover)] active:scale-95 disabled:pointer-events-none disabled:opacity-50" :disabled="checkingAllModels || activeProviderEnabledModelCount === 0" @click="void checkAllActiveProviderModels()">
                                        <span class="h-3.5 w-3.5" :class="checkingAllModels ? 'i-lucide-loader-2 animate-spin' : 'i-lucide-list-checks'"></span>
                                        {{ checkingAllModels ? t("settings.panels.models.checkingAllModels") : t("settings.panels.models.checkAllModels") }}
                                    </button>
                                    <button v-if="activeProviderCheckingModelCount > 0" class="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] px-3 text-xs font-medium text-[var(--status-danger)] shadow-sm transition-all duration-200 hover:bg-[var(--status-danger-bg)] active:scale-95" @click="cancelActiveProviderChecks">
                                        <span class="i-lucide-circle-x h-3.5 w-3.5"></span>
                                        {{ t("settings.panels.models.cancelModelChecks") }}
                                    </button>
                                </div>
                            </div>

                            <div class="max-h-[360px] min-h-[150px] overflow-y-auto bg-[var(--bg-input)]/20 p-3 custom-scrollbar">
                                <div v-if="enabledModelGroups.length === 0" class="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-[var(--border-color)] py-8 text-center bg-[var(--bg-panel)]">
                                    <span class="i-lucide-box h-5 w-5 text-[var(--text-muted)]"></span>
                                    <div class="text-sm text-[var(--text-secondary)]">{{ t("settings.panels.models.noEnabledProviderModels") }}</div>
                                </div>

                                <div v-else class="space-y-2">
                                    <div v-for="group in enabledModelGroups" :key="group.group" class="rounded-xl border border-[var(--border-color)] bg-[var(--bg-panel)] overflow-hidden shadow-sm">
                                        <button class="flex w-full items-center justify-between gap-2 px-4 py-3 hover:bg-[var(--bg-hover)]/50 transition-colors" @click="toggleGroup(group.group)">
                                            <div class="flex items-center gap-2">
                                                <span class="h-4 w-4 shrink-0 transition-transform duration-200" :class="expandedGroups[group.group] === false ? 'i-lucide-chevron-right' : 'i-lucide-chevron-down text-[var(--text-muted)]'"></span>
                                                <span class="text-[12px] font-bold text-[var(--text-main)]">{{ group.group }}</span>
                                                <div class="flex items-center justify-center rounded-full bg-[var(--bg-input)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--text-secondary)]">{{ group.models.length }}</div>
                                            </div>
                                        </button>

                                        <div v-show="expandedGroups[group.group] !== false" class="border-t border-[var(--border-color)] bg-[var(--bg-input)]/10 divide-y divide-[var(--border-color)]">
                                            <div v-for="model in group.models" :key="model.localKey" class="group/model relative flex items-center justify-between px-4 py-2.5 transition-colors hover:bg-[var(--bg-hover)]/40">
                                                <div class="flex items-center gap-3 min-w-0">
                                                    <div class="flex h-6 w-6 items-center justify-center rounded bg-[var(--accent-bg)] text-[var(--accent-text)] shrink-0">
                                                        <span class="i-lucide-sparkles h-3.5 w-3.5"></span>
                                                    </div>
                                                    <div class="min-w-0 flex flex-col">
                                                        <div class="flex items-center gap-2">
                                                            <div class="truncate text-[13px] font-medium text-[var(--text-main)]">{{ model.name }}</div>
                                                            <span class="shrink-0 rounded border border-[var(--border-color)] bg-[var(--bg-input)] px-1.5 py-0.5 text-[10px] text-[var(--text-muted)]">
                                                                {{ displayModelApi(model) }}
                                                            </span>
                                                            <span class="shrink-0 rounded border border-[var(--border-color)] bg-[var(--bg-input)] px-1.5 py-0.5 text-[10px] text-[var(--text-muted)]">
                                                                {{ displayModelApiSource(model) }}
                                                            </span>
                                                            <span v-if="resolveDisplayedContextWindow(activeProvider.id, model)" class="shrink-0 rounded border border-[var(--border-color)] bg-[var(--bg-input)] px-1.5 py-0.5 text-[10px] text-[var(--text-muted)]">
                                                                {{ resolveDisplayedContextWindow(activeProvider.id, model) }} ctx
                                                            </span>
                                                        </div>
                                                        <div class="truncate text-[11px] text-[var(--text-muted)] mt-0.5">{{ model.id }}</div>
                                                        <div v-if="savedModelIssues(activeProvider.id, model.id).length > 0" class="mt-1 flex max-w-[520px] items-center gap-1.5 text-[11px] text-[var(--status-warning)]" :title="savedModelIssues(activeProvider.id, model.id).map((issue) => issue.message).join('\n')">
                                                            <span class="i-lucide-triangle-alert h-3 w-3 shrink-0"></span>
                                                            <span class="truncate">{{ savedModelIssues(activeProvider.id, model.id)[0]?.message }}</span>
                                                            <span v-if="savedModelIssues(activeProvider.id, model.id).length > 1" class="shrink-0 opacity-70">+{{ savedModelIssues(activeProvider.id, model.id).length - 1 }}</span>
                                                        </div>
                                                        <div v-if="modelCheckResult(activeProvider, model)" class="mt-1 flex max-w-[520px] items-center gap-1.5 text-[11px]" :class="modelCheckResult(activeProvider, model)?.cancelled ? 'text-[var(--text-muted)]' : modelCheckResult(activeProvider, model)?.success ? 'text-[var(--status-success)]' : 'text-[var(--status-danger)]'" :title="modelCheckResult(activeProvider, model)?.message">
                                                            <span class="h-3 w-3 shrink-0" :class="modelCheckResult(activeProvider, model)?.cancelled ? 'i-lucide-circle-slash' : modelCheckResult(activeProvider, model)?.success ? 'i-lucide-circle-check' : 'i-lucide-circle-x'"></span>
                                                            <span class="truncate">{{ modelCheckResult(activeProvider, model)?.message }}</span>
                                                            <span v-if="modelCheckResult(activeProvider, model)?.latencyMs !== null" class="shrink-0 opacity-70">{{ modelCheckResult(activeProvider, model)?.latencyMs }}ms</span>
                                                        </div>
                                                    </div>
                                                </div>

                                                <div class="flex shrink-0 items-center gap-1">
                                                    <button class="flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-secondary)] hover:bg-[var(--bg-input)] hover:text-[var(--text-main)] transition-colors disabled:opacity-50" :disabled="isModelChecking(activeProvider, model) || !modelDraftRunnable(activeProvider, model)" :title="t('settings.panels.models.checkModel')" @click="void checkModel(model)">
                                                        <span v-if="isModelChecking(activeProvider, model)" class="i-lucide-loader-2 h-3.5 w-3.5 animate-spin"></span>
                                                        <span v-else class="i-lucide-play h-3.5 w-3.5"></span>
                                                    </button>
                                                    <button v-if="isModelChecking(activeProvider, model)" class="flex h-7 w-7 items-center justify-center rounded-md text-[var(--status-danger)] transition-colors hover:bg-[var(--status-danger-bg)] hover:opacity-80" :title="t('settings.panels.models.cancelModelCheck')" @click="cancelModelCheck(activeProvider, model)">
                                                        <span class="i-lucide-circle-x h-3.5 w-3.5"></span>
                                                    </button>
                                                    <button class="flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-secondary)] hover:bg-[var(--bg-input)] hover:text-[var(--text-main)] transition-colors" :title="t('settings.panels.models.editSettings')" @click="openModelEdit(model)">
                                                        <span class="i-lucide-settings h-3.5 w-3.5"></span>
                                                    </button>
                                                    <button class="flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-secondary)] transition-colors hover:bg-[var(--status-danger-bg)] hover:text-[var(--status-danger)]" :title="t('settings.panels.models.disableModel')" @click="disableModel(model)">
                                                        <span class="i-lucide-minus h-3.5 w-3.5"></span>
                                                    </button>
                                                    <button class="flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-secondary)] transition-colors hover:bg-[var(--status-danger-bg)] hover:text-[var(--status-danger)]" :title="t('settings.panels.models.deleteModel')" @click="deleteModel(model)">
                                                        <span class="i-lucide-trash-2 h-3.5 w-3.5"></span>
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <!-- 禁用草稿也保留独立条目，重复 ID 可逐项编辑或删除。 -->
                                <div v-if="disabledModels.length > 0" class="mt-3 space-y-1 rounded-xl border border-[var(--border-color)] bg-[var(--bg-panel)] p-2">
                                    <div class="px-2 py-1 text-[11px] font-semibold text-[var(--text-muted)]">{{ t("settings.panels.models.disabledDrafts") }}</div>
                                    <div v-for="model in disabledModels" :key="model.localKey" class="flex items-center justify-between gap-3 rounded-lg px-2 py-2 hover:bg-[var(--bg-hover)]">
                                        <div class="min-w-0">
                                            <div class="truncate text-xs text-[var(--text-main)]">{{ model.name || model.id }}</div>
                                            <div class="truncate text-[10px] text-[var(--text-muted)]">{{ model.id }}</div>
                                        </div>
                                        <div class="flex shrink-0 items-center gap-1">
                                            <button class="flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-secondary)] hover:bg-[var(--bg-input)] hover:text-[var(--text-main)]" :title="t('settings.panels.models.editSettings')" @click="openModelEdit(model)"><span class="i-lucide-settings h-3.5 w-3.5"></span></button>
                                            <button class="flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-secondary)] hover:bg-[var(--status-danger-bg)] hover:text-[var(--status-danger)]" :title="t('settings.panels.models.deleteModel')" @click="deleteModel(model)"><span class="i-lucide-trash-2 h-3.5 w-3.5"></span></button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            
                            <div class="flex items-center gap-3 px-4 py-3 bg-[var(--bg-panel)] border-t border-[var(--border-color)]">
                                <button class="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--status-success-border)] bg-[var(--status-success-bg)] px-4 text-xs font-medium text-[var(--status-success)] shadow-sm transition-all duration-200 hover:bg-[var(--status-success-bg)] active:scale-95" @click="libraryDialogOpen = true">
                                    <span class="i-lucide-list-filter h-3.5 w-3.5"></span>
                                    {{ t("settings.panels.models.manageLibrary") }}
                                </button>
                                <button class="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--border-color)] bg-[var(--bg-input)] px-4 text-xs font-medium text-[var(--text-main)] shadow-sm transition-all duration-200 hover:bg-[var(--bg-hover)] active:scale-95" @click="libraryDialogOpen = true">
                                    <span class="i-lucide-plus h-3.5 w-3.5"></span>
                                    {{ t("settings.panels.models.add") }}
                                </button>
                            </div>
                        </div>
                    </section>

                    <section v-else class="flex min-h-[400px] flex-col items-center justify-center gap-4 rounded-2xl border border-[var(--border-color)] bg-[var(--bg-panel)] px-8 py-10 text-center shadow-sm">
                        <div class="flex h-16 w-16 items-center justify-center rounded-full bg-[var(--bg-input)] shadow-inner">
                            <span class="i-lucide-server-off h-8 w-8 text-[var(--text-muted)] opacity-50"></span>
                        </div>
                        <div>
                            <div class="text-base font-medium text-[var(--text-main)]">{{ t("settings.panels.models.noProviderSelected") }}</div>
                            <div class="mt-1 text-sm text-[var(--text-secondary)]">{{ t("settings.panels.models.selectProviderHint") }}</div>
                        </div>
                    </section>
                </Transition>
            </div>
        </div>
    </div>

    <Dialog
        v-model="validationDialogOpen"
        :title="t('settings.panels.models.validationIssuesTitle')"
        width="680px"
        height="70%"
        overlay-type="blur"
        :show-footer="false"
    >
        <!-- 完整模型配置问题列表 -->
        <div class="h-full space-y-2 overflow-y-auto pr-1 custom-scrollbar">
            <div v-for="(issue, index) in validationIssues" :key="`${issue.code}-${issue.path.join('.')}-${String(index)}`" class="rounded-lg border border-[var(--border-color)] bg-[var(--bg-panel)] px-3 py-2.5">
                <div class="flex flex-wrap items-center gap-2 text-xs">
                    <span class="rounded bg-[var(--status-warning-bg)] px-1.5 py-0.5 font-medium text-[var(--status-warning)]">{{ issue.code }}</span>
                    <span v-if="issue.modelKey" class="font-mono text-[var(--text-main)]">{{ issue.modelKey }}</span>
                </div>
                <p class="mt-1.5 text-sm text-[var(--text-main)]">{{ issue.message }}</p>
                <p class="mt-1 break-all font-mono text-[11px] text-[var(--text-muted)]">{{ issue.path.join(".") }}</p>
            </div>
        </div>
    </Dialog>

    <Dialog
        v-model="libraryDialogOpen"
        :title="activeProvider ? t('settings.panels.models.modelLibraryTitle', {provider: activeProvider.name}) : t('settings.panels.models.modelLibrary')"
        width="800px"
        height="85%"
        overlay-type="blur"
        :show-footer="false"
    >
        <div v-if="activeProvider" class="flex h-full flex-col gap-4 px-1 py-2">
            <!-- Header bar with search and discover button -->
            <div class="flex items-center gap-3 shrink-0">
                <div class="relative flex-1">
                    <span class="i-lucide-search absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]"></span>
                    <input v-model="librarySearchQuery" type="text" :placeholder="t('settings.panels.models.searchModels')" class="h-9 w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] pl-9 pr-3 text-sm text-[var(--text-main)] outline-none placeholder:text-[var(--text-muted)] focus:border-[var(--accent-main)]" />
                </div>
                <button class="flex h-9 items-center justify-center gap-2 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-3 text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)] disabled:opacity-50" :disabled="providerDiscoveringId === activeProvider.id" :title="t('settings.panels.models.refreshModels')" @click="void discoverModels()">
                    <span class="h-4 w-4" :class="providerDiscoveringId === activeProvider.id ? 'i-lucide-loader-2 animate-spin' : 'i-lucide-refresh-cw'"></span>
                    {{ t("settings.panels.models.refresh") }}
                </button>
            </div>
            
            <div class="flex-1 overflow-y-auto custom-scrollbar rounded-xl border border-[var(--border-color)] bg-[var(--bg-panel)] p-2 min-h-0">
                <div v-if="unifiedLibraryGroups.length === 0" class="flex h-full flex-col items-center justify-center py-20 text-center">
                    <span class="i-lucide-search-x mb-2 h-8 w-8 text-[var(--text-muted)] opacity-50"></span>
                    <span class="text-sm text-[var(--text-muted)]">{{ t("settings.panels.models.noMatchingModels") }}</span>
                </div>
                
                <div v-else class="space-y-2">
                    <div v-for="group in unifiedLibraryGroups" :key="group.group" class="rounded-xl border border-[var(--border-color)] bg-[var(--bg-panel)] shadow-sm overflow-hidden">
                        <button class="flex w-full items-center justify-between px-4 py-2 hover:bg-[var(--bg-hover)]/40 transition-colors bg-[var(--bg-input)]/30" @click="toggleLibraryGroup(group.group)">
                            <div class="flex items-center gap-2">
                                <span class="h-3.5 w-3.5 shrink-0 transition-transform duration-200" :class="libraryExpandedGroups[group.group] === false ? 'i-lucide-chevron-right' : 'i-lucide-chevron-down text-[var(--text-muted)]'"></span>
                                <span class="text-[12px] font-bold text-[var(--text-main)]">{{ group.group }}</span>
                                <div class="flex items-center justify-center rounded-full bg-[var(--bg-panel)] border border-[var(--border-color)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--text-secondary)]">{{ group.models.length }}</div>
                            </div>
                        </button>

                        <div v-show="libraryExpandedGroups[group.group] !== false" class="border-t border-[var(--border-color)] divide-y divide-[var(--border-color)] bg-[var(--bg-panel)]">
                            <div v-for="(model, index) in group.models" :key="`${group.group}-${model.id}`" class="flex items-center justify-between px-4 py-3 hover:bg-[var(--bg-hover)]/40 transition-colors" :class="{'opacity-60': model.state !== 'enabled'}">
                                <div class="flex items-center gap-3 min-w-0 flex-1 pr-4">
                                    <div class="flex h-6 w-6 items-center justify-center rounded bg-[var(--accent-bg)] text-[var(--accent-text)] shrink-0">
                                        <span class="i-lucide-sparkles h-3.5 w-3.5"></span>
                                    </div>
                                    <div class="min-w-0 flex flex-col">
                                        <div class="truncate text-[13px] font-medium text-[var(--text-main)]">{{ model.name }}</div>
                                        <div class="truncate text-[11px] text-[var(--text-muted)] mt-0.5">{{ model.id }}</div>
                                    </div>
                                </div>
                                <button class="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-input)] hover:text-[var(--text-main)] active:scale-95" @click="toggleLibraryModel(model)">
                                    <span class="h-4 w-4" :class="model.state === 'enabled' ? 'i-lucide-minus' : 'i-lucide-plus'"></span>
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            
            <!-- 手动添加模型入口 -->
            <div class="shrink-0 rounded-xl border border-[var(--border-color)] bg-[var(--bg-input)]/30 p-3">
                <div class="flex flex-wrap items-center gap-3">
                    <FormInput v-model="getManualModelDraft(activeProvider.id).name" :placeholder="t('settings.panels.models.manualName')" class="flex-1 bg-[var(--bg-panel)] shadow-sm !h-8 !text-xs" />
                    <FormInput :model-value="getManualModelDraft(activeProvider.id).id" :placeholder="t('settings.panels.models.manualId')" class="flex-1 bg-[var(--bg-panel)] shadow-sm !h-8 !text-xs" @update:model-value="updateManualModelId(activeProvider.id, $event)" />
                    <div class="w-[190px]">
                        <FormSelect v-model="getManualModelDraft(activeProvider.id).api" :options="[{value: '', label: activeProvider.defaultApi ? t('settings.panels.models.providerDefaultApi', {api: activeProvider.defaultApi}) : providerDefaultApiLabel(activeProvider)}, ...modelApiOptions]" :placeholder="t('settings.panels.models.apiFormat')" />
                    </div>
                    <FormInput v-model="getManualModelDraft(activeProvider.id).contextWindowTokens" :placeholder="t('settings.panels.models.contextWindow')" class="w-[120px] bg-[var(--bg-panel)] shadow-sm !h-8 !text-xs" />
                    <FormInput v-model="getManualModelDraft(activeProvider.id).maxTokens" :placeholder="t('settings.panels.models.maxTokens')" class="w-[120px] bg-[var(--bg-panel)] shadow-sm !h-8 !text-xs" />
                    <button class="inline-flex h-8 shrink-0 items-center justify-center rounded-md bg-[var(--accent-main)] px-3 text-xs font-medium text-[var(--text-inverse)] shadow-sm transition-all hover:opacity-90 active:scale-95" @click="addManualModel">
                        {{ t("settings.panels.models.add") }}
                    </button>
                </div>
            </div>
        </div>
    </Dialog>

    <Dialog
        v-model="deleteProviderDialogOpen"
        :title="t('settings.panels.models.deleteProviderTitle')"
        width="420px"
        overlay-type="blur"
        show-cancel
        @confirm="confirmDeleteActiveProvider"
    >
        <div v-if="activeProvider" class="space-y-3">
            <p class="text-sm text-[var(--text-secondary)]">{{ t("settings.panels.models.deleteProviderMessage", {name: activeProvider.name}) }}</p>
            <p class="rounded-lg border border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] px-3 py-2 text-xs text-[var(--status-warning)]">{{ t("settings.panels.models.deleteProviderWarning") }}</p>
        </div>
    </Dialog>

    <NovelIdeModelEditDialog
        v-model="modelEditDialogOpen"
        :editing-model="editingModel"
        :active-provider="activeProvider"
        :catalog-cost="editingModelCatalogCost"
        :catalog-model="editingCatalogModel"
        :missing-fields="editingModelMissingFields"
        :model-api-options="modelApiOptions"
        :model-input-options="modelInputOptions"
        :derive-group="deriveGroup"
        :resolve-displayed-context-window="resolveDisplayedContextWindow"
        :model-api-inherit-label="modelApiInheritLabel"
        :model-context-window-default-label="modelContextWindowDefaultLabel"
        :model-max-tokens-default-label="modelMaxTokensDefaultLabel"
        :model-input-display-label="modelInputDisplayLabel"
        :model-input-enabled="modelInputEnabled"
        :model-reasoning-display-label="modelReasoningDisplayLabel"
        @model-id-change="ensureDefaultModelKey"
        @toggle-model-input="toggleModelInput"
        @reset-model-input="($event) => { $event.input = ''; }"
        @reset-model-cost="resetModelCost"
        @enable-model-cost="enableModelCostOverride"
        @reapply-catalog="reapplyCatalogModel"
    />
</template>

<style scoped>
.fade-slide-enter-active,
.fade-slide-leave-active {
    transition: all 0.2s cubic-bezier(0.34, 1.15, 0.64, 1);
}
.fade-slide-enter-from {
    opacity: 0;
    transform: translateX(10px) scale(0.98);
}
.fade-slide-leave-to {
    opacity: 0;
    transform: translateX(-10px) scale(0.98);
}

.fade-enter-active,
.fade-leave-active {
    transition: opacity 0.2s ease;
}
.fade-enter-from,
.fade-leave-to {
    opacity: 0;
}
</style>

