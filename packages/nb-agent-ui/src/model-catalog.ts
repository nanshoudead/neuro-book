/**
 * 模型目录对话框（`AgentModelCatalog`）的数据与纯函数：服务商分成能用与用不了两段、按 `服务商/模型名` 三层搜索、各服务商的
 * 命中数。做法参照 OMP 的 `/models`：精确、连续子串、模糊三层，同层按默认顺序。视图类型由宿主从自己的目录映射过来
 * （nb-story 映射 nb-harness 的 `listCatalog`），本包不依赖 nb-harness。
 */

/**
 * 只认环境变量的宿主能不能用这家：`keyless` 不设密钥也能用；`login` 要登录拿令牌，只有它的变量有值时能用；`key` 设好
 * 环境变量就能用；`unsupported` 用不了。
 */
export type CatalogAccess = "keyless" | "login" | "key" | "unsupported";

export type CatalogModelView = {
    id: string;
    name: string;
    /** 接口名，例如 `openai-responses`。 */
    api: string;
    contextWindow: number | null;
    reasoning: boolean;
    images: boolean;
    /** 每百万 token 的单价；未知时为 null（界面写“未知”，不写成免费）。 */
    price: {input: number; output: number; currency: string} | null;
};

export type CatalogProviderView = {
    id: string;
    name: string;
    /** `custom` 是宿主配置里的自定义服务商。 */
    source: "catalog" | "custom";
    access: CatalogAccess;
    /** 可以设的密钥环境变量，按查找的顺序。 */
    keyEnvs: readonly string[];
    /** 密钥有没有值。 */
    keySet: boolean;
    models: readonly CatalogModelView[];
};

/** 这家的模型能不能选：自定义服务商、`key`、`keyless` 能选；`login` 只在有值时能选；`unsupported` 不能选。 */
export function providerSelectable(provider: CatalogProviderView): boolean {
    if (provider.source === "custom") return true;
    switch (provider.access) {
        case "key":
        case "keyless":
            return true;
        case "login":
            return provider.keySet;
        case "unsupported":
            return false;
    }
}

/**
 * 左栏的顺序：能选的在前（自定义的、密钥有值的排在最前，其余保持宿主给的顺序），用不了的在分隔线后。
 */
export function orderProviders(providers: readonly CatalogProviderView[]): {usable: CatalogProviderView[]; locked: CatalogProviderView[]} {
    const usable = providers.filter(providerSelectable);
    const rank = (provider: CatalogProviderView) => (provider.source === "custom" ? 0 : provider.keySet ? 1 : 2);
    return {usable: usable.map((provider, index) => ({provider, index})).sort((a, b) => rank(a.provider) - rank(b.provider) || a.index - b.index).map(item => item.provider), locked: providers.filter(provider => !providerSelectable(provider))};
}

/**
 * 同一家里的默认顺序：同一系列（模型名里第一个数字之前的部分）按名字，系列内版本号新的在前，例如
 * `claude-sonnet-5`、`claude-sonnet-4.6`、`gpt-5.6`、`gpt-4`。
 */
export function compareModels(a: CatalogModelView, b: CatalogModelView): number {
    const family = (id: string) => id.replace(/\d.*$/u, "");
    const byFamily = family(a.id).localeCompare(family(b.id));
    if (byFamily !== 0) return byFamily;
    return b.id.localeCompare(a.id, undefined, {numeric: true});
}

/** 一条搜索结果；`tier` 0 是精确，1 是连续子串，2 是模糊（字符按顺序出现）。 */
export type CatalogHit = {provider: CatalogProviderView; model: CatalogModelView; ref: string; tier: 0 | 1 | 2};

/** 引用：`服务商/模型名`。 */
export function catalogRef(provider: CatalogProviderView, model: CatalogModelView): string {
    return `${provider.id}/${model.id}`;
}

/**
 * 在这些服务商里搜：按 `服务商/模型名` 与显示名匹配，大小写不分。结果按层排，同层里能选的服务商在前，再按服务商顺序与
 * `compareModels`。查询为空时是全部模型的默认顺序（`tier` 都是 0）。
 */
export function searchCatalog(providers: readonly CatalogProviderView[], query: string): CatalogHit[] {
    const {usable, locked} = orderProviders(providers);
    const ordered = [...usable, ...locked];
    const q = query.trim().toLowerCase();
    const hits: (CatalogHit & {order: number})[] = [];
    ordered.forEach((provider, order) => {
        for (const model of [...provider.models].sort(compareModels)) {
            const ref = catalogRef(provider, model);
            const tier = q === "" ? 0 : matchTier(q, ref.toLowerCase(), model.id.toLowerCase(), model.name.toLowerCase());
            if (tier !== null) hits.push({provider, model, ref, tier, order});
        }
    });
    // Array.prototype.sort 是稳定的：同层同服务商时保留上面的默认顺序。
    return hits.sort((a, b) => a.tier - b.tier || a.order - b.order).map(({order: _order, ...hit}) => hit);
}

function matchTier(query: string, ref: string, id: string, name: string): 0 | 1 | 2 | null {
    if (ref === query || id === query || name === query) return 0;
    if (ref.includes(query) || name.includes(query)) return 1;
    return isSubsequence(query, ref) || isSubsequence(query, name) ? 2 : null;
}

function isSubsequence(query: string, text: string): boolean {
    let index = 0;
    for (const char of text) {
        if (char === query[index]) index += 1;
        if (index === query.length) return true;
    }
    return false;
}

/** 各服务商的命中数（左栏在搜索时显示）。 */
export function hitCounts(hits: readonly CatalogHit[]): Map<string, number> {
    const counts = new Map<string, number>();
    for (const hit of hits) counts.set(hit.provider.id, (counts.get(hit.provider.id) ?? 0) + 1);
    return counts;
}
