/**
 * 问答页输入框的模型与推理档（docs/specs/story/viewer.md 输出 50）：设置里的候选 × `models.catalog` → 模型下拉的各项、所选
 * 模型的推理档与上下文窗口；换模型时推理档往下夹；上下文用量按最近一次请求算。都是纯函数，页面只做接线。
 */

import {providerSelectable, type ComposerModelView, type MessageView} from "@notnotype/nb-agent-ui";

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

/**
 * 这家服务商的密钥状态，设置页的服务商列表与输入框下拉共用。能不能用按 nb-agent-ui 的 `providerSelectable`（模型目录
 * 对话框用的同一条规则），`usable` 为 false 时 `text` 是原因。
 */
export function providerNote(provider: CatalogProvider): {usable: boolean; text: string} {
    const usable = providerSelectable(provider) && (provider.keySet || provider.access === "keyless");
    if (provider.access === "unsupported" && provider.source === "catalog") return {usable: false, text: "这家服务商在这里用不了"};
    if (provider.access === "keyless" && !provider.keySet) return {usable: true, text: "不设密钥也能用"};
    if (provider.keyEnvs.length === 0) return {usable, text: "要登录，这里用不了"};
    const env = provider.keyEnvs.join(" 或 ");
    return {usable, text: provider.keySet ? `${env} 已设置` : `${env} 没有值`};
}

/** token 数的短写（上下文窗口、输出上限）：`131.1K`、`1M`，同模型目录对话框。 */
export function formatTokenCount(count: number): string {
    if (count >= 1_000_000) return `${Number((count / 1_000_000).toFixed(2))}M`;
    if (count >= 1_000) return `${Number((count / 1_000).toFixed(1))}K`;
    return String(count);
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
        const note = providerNote(provider);
        return [ref, {view: {key: ref, label: model.name, supportsImages: model.images, group: provider.name, ...(note.usable ? {} : {unavailable: note.text})}, contextWindow: model.contextWindow, efforts: model.efforts}];
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

/**
 * 这一轮用的模型与选的档：这个对话选过、且选的还在候选里时用选的；否则按 `defaultChoice`。选过的模型可能在设置页被去掉
 * （“管理模型…”往返之后存档还在），这时当作没选过，不把已删的模型发出去。
 */
export function resolveChoice(config: Pick<QaConfig, "models" | "model">, selected: {modelKey: string | null; thinking: string | null}, lastTurnModel: string | null): {model: string; requested: string | null} {
    if (selected.modelKey !== null && config.models.includes(selected.modelKey)) return {model: selected.modelKey, requested: selected.thinking};
    const fallback = defaultChoice(config, lastTurnModel);
    return {model: fallback.model, requested: fallback.thinking};
}

/**
 * 上下文用量：最近一条正常完成、带用量的助手消息的提示词 token（输入含缓存读写，同 OMP 的 `calculatePromptTokens`；被停止
 * 或出错的跳过，同 OMP 的 `getAssistantUsage`）。这是上一次请求的提示词大小，不含那条回复本身；没有时为 0。
 */
export function contextTokensOf(messages: readonly MessageView[]): number {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
        const message = messages[index]!;
        if (message.kind === "assistant" && message.status === "done" && message.usage !== undefined) return message.usage.input + message.usage.cacheRead + message.usage.cacheWrite;
    }
    return 0;
}
