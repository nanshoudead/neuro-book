/**
 * 问答页输入框的模型与推理档（docs/specs/story/viewer.md 输出 50）：设置里的候选 × `models.catalog` → 模型下拉的各项、所选
 * 模型的推理档与上下文窗口；换模型时推理档往下夹；上下文用量按最近一次请求算。都是纯函数，页面只做接线。
 */

import type {ComposerModelView, MessageView} from "@notnotype/nb-agent-ui";

import type {QaConfig} from "../../contract/config-schema";
import type {ViewerResult} from "../../contract/contract";

export type CatalogProvider = ViewerResult<"models.catalog">["providers"][number];
type CatalogModel = CatalogProvider["models"][number];

/** 推理档从低到高，同 OMP（nb-harness 的 THINKING_EFFORTS）。 */
const EFFORT_ORDER = ["minimal", "low", "medium", "high", "xhigh", "max"];

export interface CandidateInfo {
    readonly view: ComposerModelView;
    readonly contextWindow: number | null;
    readonly efforts: readonly string[];
}

function splitRef(ref: string): {provider: string; model: string} {
    const slash = ref.indexOf("/");
    return {provider: ref.slice(0, slash), model: ref.slice(slash + 1)};
}

/** 这家服务商现在用不了的原因（密钥没有值、要登录）；用得了时为 undefined。 */
function unavailableReason(provider: CatalogProvider): string | undefined {
    if (provider.access === "keyless" || provider.keySet) return undefined;
    if (provider.access === "unsupported") return "这家服务商在这里用不了";
    if (provider.keyEnvs.length === 0) return "要登录才能用";
    return `${provider.keyEnvs.join(" 或 ")} 没有值`;
}

/** 候选按设置里的顺序；目录里找不到的仍列出，灰掉并写原因。 */
export function candidateInfos(config: Pick<QaConfig, "models">, providers: readonly CatalogProvider[]): Map<string, CandidateInfo> {
    const byId = new Map(providers.map(provider => [provider.id, provider]));
    return new Map(config.models.map(ref => {
        const {provider: providerId, model: modelId} = splitRef(ref);
        const provider = byId.get(providerId);
        const model: CatalogModel | undefined = provider?.models.find(item => item.id === modelId);
        if (provider === undefined || model === undefined) {
            return [ref, {view: {key: ref, label: modelId, supportsImages: false, group: providerId, unavailable: "目录里没有这个模型"}, contextWindow: null, efforts: []}];
        }
        const unavailable = unavailableReason(provider);
        return [ref, {view: {key: ref, label: model.name, supportsImages: model.images, group: provider.name, ...(unavailable === undefined ? {} : {unavailable})}, contextWindow: model.contextWindow, efforts: model.efforts}];
    }));
}

/** 选的档往下夹到支持的档（同 OMP 的 clampThinkingLevelForModel）：没有档时为 null，比最低档还低时取最低档。 */
export function clampThinking(efforts: readonly string[], requested: string | null): string | null {
    if (requested === null || efforts.length === 0) return null;
    if (efforts.includes(requested)) return requested;
    const rank = EFFORT_ORDER.indexOf(requested);
    let clamped: string | null = null;
    for (const effort of efforts) {
        if (EFFORT_ORDER.indexOf(effort) > rank) break;
        clamped = effort;
    }
    return clamped ?? efforts[0]!;
}

/**
 * 这个对话没选过模型时用哪个（qa.md 输出 40）：新对话是默认模型；续问接着用最近一轮的（还在候选里时），否则默认模型。
 * 推理档：用的是默认模型时取设置的档，否则不写。
 */
export function defaultChoice(config: Pick<QaConfig, "models" | "model">, lastTurnModel: string | null): {model: string; thinking: string | null} {
    const model = lastTurnModel !== null && config.models.includes(lastTurnModel) ? lastTurnModel : config.model.use;
    return {model, thinking: model === config.model.use ? (config.model.thinking ?? null) : null};
}

/** 上下文用量：最近一条带用量的助手消息的输入（含缓存读写，同 OMP 的口径）；没有时为 0。 */
export function contextTokensOf(messages: readonly MessageView[]): number {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
        const message = messages[index]!;
        if (message.kind === "assistant" && message.usage !== undefined) return message.usage.input + message.usage.cacheRead + message.usage.cacheWrite;
    }
    return 0;
}
