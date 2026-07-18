import type {SelectOption} from "nbook/app/components/common/form/FormSelect.vue";
import type {ModelSettingsModelDraft} from "nbook/app/components/novel-ide/settings/model-settings-draft";
import type {ConfiguredModelDto, ModelLibraryEntryDto} from "nbook/shared/dto/app-settings.dto";
import type {ProviderConfigIssue} from "nbook/shared/models/provider-config-contract";

export type ModelCheckView = {
    success: boolean;
    latencyMs: number | null;
    message: string;
    cancelled?: boolean;
};

export type SavedModelView = {
    model: ModelSettingsModelDraft;
    apiLabel: string;
    apiSourceLabel: string;
    contextWindowLabel: string;
    issues: ProviderConfigIssue[];
    checkResult: ModelCheckView | null;
    checking: boolean;
    runnable: boolean;
};

export type SavedModelGroupView = {
    group: string;
    models: SavedModelView[];
};

export type DiscoveryListModel = {
    name: string;
    id: string;
    group: string;
    state: "enabled" | "disabled" | "remote-complete" | "remote-incomplete";
    completeModel?: ConfiguredModelDto;
    incompleteCandidate?: Omit<ConfiguredModelDto, "enabled">;
};

export type DiscoveryModelGroup = {
    group: string;
    models: DiscoveryListModel[];
};

export type ModelLibraryGroup = {
    group: string;
    models: ModelLibraryEntryDto[];
};

export type ManualModelDraft = {
    name: string;
    id: string;
    api: string;
    group: string;
    contextWindowTokens: string;
    maxTokens: string;
};

export type ModelApiOption = SelectOption;
