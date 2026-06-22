export type JsonValue = null | boolean | number | string | JsonValue[] | {[key: string]: JsonValue};

export type WorldMutationOp = "set" | "add" | "unset" | "listAppend" | "collectionAdd" | "collectionRemove";

export type WorldMutationDraft = {
    subjectId: string;
    attr: string;
    op: WorldMutationOp;
    value?: JsonValue;
};

export type MutationListUpdate = {
    mutations: WorldMutationDraft[];
    index: number;
    changed: boolean;
    message?: string;
};

export type WorldPreviewAttrKind = "scalar" | "list" | "collection" | "object";

export type WorldPreviewSchemaAttr = {
    name: string;
    kind: WorldPreviewAttrKind;
    type?: string;
    itemType?: string;
    enum?: JsonValue[];
    default?: JsonValue;
    desc?: string;
    fields?: Record<string, WorldPreviewSchemaAttr>;
};

export type WorldPreviewSchemaType = {
    type: string;
    desc?: string;
    attrs: WorldPreviewSchemaAttr[];
};

export type WorldPreviewSubject = {
    id: string;
    type: string;
    name: string;
};

export type WorldPreviewProject = {
    title: string;
    projectPath: string;
    summary?: string;
};

export type WorldPreviewStateSubject = {
    subjectId: string;
    attrs: Record<string, JsonValue>;
};

export type WorldPreviewValueOption = {
    label: string;
    value: string;
    key: string;
};

export type ParseResult<TValue> = {
    ok: true;
    value: TValue;
} | {
    ok: false;
    message: string;
};

const MUTATION_OPS = new Set<WorldMutationOp>(["set", "add", "unset", "listAppend", "collectionAdd", "collectionRemove"]);

const PREVIEW_DEMO_SUBJECTS: WorldPreviewSubject[] = [
    {id: "world", type: "world", name: "世界"},
    {id: "capital", type: "location", name: "王都"},
    {id: "erina", type: "character", name: "艾莉娜"},
    {id: "old-sword", type: "item", name: "旧剑"},
];

const PREVIEW_DEMO_ATTR_REQUIREMENTS: Array<{
    type: string;
    attr: string;
    kind: WorldPreviewAttrKind;
    expectedTypes?: string[];
}> = [
    {type: "world", attr: "events", kind: "list", expectedTypes: ["text"]},
    {type: "location", attr: "events", kind: "list", expectedTypes: ["text"]},
    {type: "character", attr: "location", kind: "scalar", expectedTypes: ["ref(location)"]},
    {type: "character", attr: "inventory", kind: "collection", expectedTypes: ["ref(item)"]},
    {type: "character", attr: "events", kind: "list", expectedTypes: ["text"]},
    {type: "item", attr: "durability", kind: "scalar", expectedTypes: ["int", "float"]},
    {type: "item", attr: "events", kind: "list", expectedTypes: ["text"]},
];

/** 将逗号分隔输入整理为非空字符串数组。 */
export function parseCsvList(input: string): string[] {
    return input
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
}

/** 将 subject id 列表格式化为逗号分隔可读输入。 */
export function formatSubjectList(input: string[]): string {
    return input.map((item) => item.trim()).filter(Boolean).join(", ");
}

/** 按 title / projectPath / summary 过滤 preview 的 Project 下拉候选。 */
export function filterPreviewProjects<TProject extends WorldPreviewProject>(projects: TProject[], query: string): TProject[] {
    const keyword = query.trim().toLowerCase();
    if (!keyword) {
        return projects;
    }
    return projects.filter((project) => {
        return project.title.toLowerCase().includes(keyword)
            || project.projectPath.toLowerCase().includes(keyword)
            || (project.summary?.toLowerCase().includes(keyword) ?? false);
    });
}

/** 保证当前选中的 Project 仍出现在候选里，避免搜索词让 select 显示成空值。 */
export function keepSelectedPreviewProject<TProject extends WorldPreviewProject>(projects: TProject[], selectedProject: TProject | null | undefined): TProject[] {
    if (!selectedProject || projects.some((project) => project.projectPath === selectedProject.projectPath)) {
        return projects;
    }
    return [selectedProject, ...projects];
}

/** 从候选 path 中选择仍存在于列表里的 Project；候选都无效时回退到第一项。 */
export function selectPreviewProjectPath<TProject extends WorldPreviewProject>(projects: TProject[], ...candidates: Array<string | null | undefined>): string {
    const knownPaths = new Set(projects.map((project) => project.projectPath));
    for (const candidate of candidates) {
        const projectPath = candidate?.trim() ?? "";
        if (projectPath && knownPaths.has(projectPath)) {
            return projectPath;
        }
    }
    return projects[0]?.projectPath ?? "";
}

/** 把后端 / Agent 向的同 instant 冲突提示翻译成 Preview / Workbench 可执行的 UI 行动。 */
export function formatWorldEngineConflictMessage(message: string): string {
    if (!message.includes("existingSliceId=")) {
        return message;
    }
    const detail = message.match(/existingSliceId=.*$/)?.[0] ?? "";
    const suffix = detail ? `\n${detail}` : "";
    if (message.includes("edit_world_slice")) {
        return `该时间已有切面。请在 Timeline 中找到该时间的 slice，点击“载入编辑”把本次变更合并进去，或把 time 改到相邻时间。${suffix}`;
    }
    if (message.includes("目标时间已有非 init 切面")) {
        return `目标时间已有普通切面，不能自动追加 subject 初始化。请在 Timeline 中载入这个时间的 slice，显式合并初始化变更，或把初始化时间改到相邻时间。${suffix}`;
    }
    if (message.includes("目标时间已有其他切面")) {
        return `目标时间已有其他切面。请在 Timeline 中载入目标时间的 slice 合并，或把 time 改到相邻时间。${suffix}`;
    }
    return message;
}

/** 从当前状态里为 collectionRemove 生成已有项下拉候选。 */
export function collectionRemoveValueOptions(states: WorldPreviewStateSubject[], subjectId: string, attrPath: string): WorldPreviewValueOption[] {
    const state = states.find((item) => item.subjectId === subjectId);
    const value = state ? stateValueAtPath(state.attrs, attrPath) : undefined;
    if (!Array.isArray(value)) {
        return [];
    }
    return value.map((item, index) => {
        const option = formatValueOption(item);
        return {label: option.label, value: option.value, key: `${index}:${option.value}`};
    });
}

/** 将 JSON mutation textarea 解析为 World Engine API 可接受的 mutation 数组。 */
export function parseMutationJson(input: string): ParseResult<WorldMutationDraft[]> {
    try {
        // JSON.parse 是外部输入边界，必须先以 unknown 接住再逐层校验。
        const parsed: unknown = JSON.parse(input);
        if (!Array.isArray(parsed) || parsed.length === 0) {
            return {ok: false, message: "mutations 必须是非空数组"};
        }
        const mutations: WorldMutationDraft[] = [];
        for (const item of parsed) {
            const mutation = parseMutation(item);
            if (!mutation.ok) {
                return mutation;
            }
            mutations.push(mutation.value);
        }
        return {ok: true, value: mutations};
    } catch (error) {
        return {ok: false, message: error instanceof Error ? error.message : "mutations JSON 解析失败"};
    }
}

/** 将 mutation 选择索引夹到当前列表的有效范围；空列表固定返回 0。 */
export function clampMutationIndex(length: number, index: number): number {
    if (length <= 0) {
        return 0;
    }
    if (!Number.isInteger(index) || index < 0) {
        return 0;
    }
    return Math.min(index, length - 1);
}

/** 原位替换指定 mutation，返回新的 mutation 列表和保留后的选中索引。 */
export function replaceMutationAt(mutations: WorldMutationDraft[], index: number, mutation: WorldMutationDraft): ParseResult<MutationListUpdate> {
    if (!isValidMutationIndex(mutations, index)) {
        return {ok: false, message: "请选择要替换的 mutation。"};
    }
    return {
        ok: true,
        value: {
            mutations: mutations.map((item, itemIndex) => itemIndex === index ? mutation : item),
            index,
            changed: true,
        },
    };
}

/** 在指定 mutation 后插入一条新 mutation，并选中新插入项。 */
export function insertMutationAfter(mutations: WorldMutationDraft[], index: number, mutation: WorldMutationDraft): ParseResult<MutationListUpdate> {
    if (!isValidMutationIndex(mutations, index)) {
        return {ok: false, message: "请选择插入位置。"};
    }
    return {
        ok: true,
        value: {
            mutations: [
                ...mutations.slice(0, index + 1),
                mutation,
                ...mutations.slice(index + 1),
            ],
            index: index + 1,
            changed: true,
        },
    };
}

/** 复制指定 mutation 到原项后方，并选中新副本。 */
export function duplicateMutationAt(mutations: WorldMutationDraft[], index: number): ParseResult<MutationListUpdate> {
    const mutation = mutations[index];
    if (!mutation || !isValidMutationIndex(mutations, index)) {
        return {ok: false, message: "请选择要复制的 mutation。"};
    }
    const duplicated: WorldMutationDraft = {...mutation};
    if ("value" in mutation && mutation.value !== undefined) {
        duplicated.value = cloneJsonValue(mutation.value);
    }
    return insertMutationAfter(mutations, index, duplicated);
}

/** 删除指定 mutation，返回新的 mutation 列表和删除后的选中索引。 */
export function deleteMutationAt(mutations: WorldMutationDraft[], index: number): ParseResult<MutationListUpdate> {
    if (!isValidMutationIndex(mutations, index)) {
        return {ok: false, message: "请选择要删除的 mutation。"};
    }
    const next = mutations.filter((_, itemIndex) => itemIndex !== index);
    return {
        ok: true,
        value: {
            mutations: next,
            index: clampMutationIndex(next.length, index),
            changed: true,
        },
    };
}

/** 上移或下移指定 mutation 一位；到达边界时返回 changed=false。 */
export function moveMutationAt(mutations: WorldMutationDraft[], index: number, direction: "up" | "down"): ParseResult<MutationListUpdate> {
    if (!isValidMutationIndex(mutations, index)) {
        return {ok: false, message: "请选择要移动的 mutation。"};
    }
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= mutations.length) {
        return {
            ok: true,
            value: {
                mutations,
                index,
                changed: false,
                message: direction === "up" ? "所选 mutation 已经在最上方。" : "所选 mutation 已经在最下方。",
            },
        };
    }
    const currentMutation = mutations[index];
    const targetMutation = mutations[targetIndex];
    if (!currentMutation || !targetMutation) {
        return {ok: false, message: "请选择要移动的 mutation。"};
    }
    const next = [...mutations];
    next[index] = targetMutation;
    next[targetIndex] = currentMutation;
    return {
        ok: true,
        value: {
            mutations: next,
            index: targetIndex,
            changed: true,
        },
    };
}

/** 格式化 JSON，失败时返回空对象字符串。 */
export function formatPreviewJson(value: JsonValue | JsonValue[] | Record<string, JsonValue> | null | undefined): string {
    return JSON.stringify(value ?? {}, null, 2);
}

/** 解析表单里的 value：JSON 字面量严格解析，普通文本按字符串处理。 */
export function parseLooseJsonValue(input: string): ParseResult<JsonValue> {
    const text = input.trim();
    if (!text) {
        return {ok: true, value: ""};
    }
    if (!shouldParseAsJson(text)) {
        return {ok: true, value: input};
    }
    try {
        const parsed: unknown = JSON.parse(text);
        if (!isJsonValue(parsed)) {
            return {ok: false, message: "value 必须是 JSON 值"};
        }
        return {ok: true, value: parsed};
    } catch (error) {
        return {ok: false, message: error instanceof Error ? error.message : "value JSON 解析失败"};
    }
}

/** 把 JSON value 格式化成会被 parseLooseJsonValue 保真还原的表单字符串。 */
export function formatJsonInputValue(value: JsonValue): string {
    if (typeof value !== "string") {
        return JSON.stringify(value);
    }
    if (shouldParseAsJson(value.trim())) {
        return JSON.stringify(value);
    }
    return value;
}

/** 从 calendar examples 推导一个适合作为普通 slice 的后续时间，避免与 init instant 撞车。 */
export function suggestSliceTime(examples: string[]): string {
    const first = examples[0] ?? "";
    const nextSecond = addOneSecond(first);
    if (nextSecond) {
        return nextSecond;
    }
    return examples[1] ?? first;
}

/** 从 calendar examples 与已占用时间里推导一个未占用的 preview 示例切面时间。 */
export function suggestNextPreviewTime(examples: string[], usedTimes: string[]): string {
    const used = new Set(usedTimes.map((item) => item.trim()).filter(Boolean));
    for (let index = usedTimes.length - 1; index >= 0; index -= 1) {
        const base = usedTimes[index]?.trim() ?? "";
        for (let offset = 1; offset < 3600; offset += 1) {
            const candidate = addSecondsWithinDay(base, offset);
            if (candidate && !used.has(candidate)) {
                return candidate;
            }
        }
    }
    const first = examples[0] ?? "";
    const next = addOneSecond(first);
    if (next && !used.has(next)) {
        return next;
    }
    for (const example of examples) {
        if (!used.has(example)) {
            return example;
        }
    }
    return suggestSliceTime(examples);
}

/** 返回 preview 一键示例世界需要创建的 subjects。 */
export function previewDemoSubjects(): WorldPreviewSubject[] {
    return PREVIEW_DEMO_SUBJECTS.map((subject) => ({...subject}));
}

/** 返回 preview 一键示例世界写入的事件 mutations。 */
export function previewDemoMutations(): WorldMutationDraft[] {
    return [
        {subjectId: "world", attr: "events", op: "listAppend", value: "世界引擎示例启动"},
        {subjectId: "capital", attr: "name", op: "set", value: "王都"},
        {subjectId: "capital", attr: "events", op: "listAppend", value: "艾莉娜抵达王都"},
        {subjectId: "erina", attr: "location", op: "set", value: "subject://capital"},
        {subjectId: "erina", attr: "inventory", op: "collectionAdd", value: "subject://old-sword"},
        {subjectId: "erina", attr: "events", op: "listAppend", value: "抵达王都并拾起旧剑"},
        {subjectId: "old-sword", attr: "name", op: "set", value: "旧剑"},
        {subjectId: "old-sword", attr: "durability", op: "add", value: -5},
        {subjectId: "old-sword", attr: "events", op: "listAppend", value: "被艾莉娜拾起，剑身多了一道裂纹"},
    ];
}

/** 检查当前 schema 和已有 subjects 是否能承载 preview 内置示例世界。 */
export function validatePreviewDemoSchema(schemaTypes: WorldPreviewSchemaType[], subjects: WorldPreviewSubject[]): string {
    const availableTypes = new Set(schemaTypes.map((item) => item.type));
    const missingTypes = Array.from(new Set(PREVIEW_DEMO_SUBJECTS.map((subject) => subject.type))).filter((type) => !availableTypes.has(type));
    if (missingTypes.length) {
        return `当前 schema 缺少示例所需类型：${missingTypes.join(", ")}`;
    }
    const attrErrors = validatePreviewDemoAttrs(schemaTypes);
    if (attrErrors.length) {
        return `当前 schema 不适合内置示例：${attrErrors.join("；")}`;
    }
    const conflicts = PREVIEW_DEMO_SUBJECTS.filter((seed) => {
        const current = subjects.find((subject) => subject.id === seed.id);
        return current && current.type !== seed.type;
    });
    if (conflicts.length) {
        return `已有 subject 与示例 id 冲突：${conflicts.map((seed) => {
            const current = subjects.find((subject) => subject.id === seed.id);
            return `${seed.id}(需要 ${seed.type}，当前 ${current?.type ?? "未知"})`;
        }).join(", ")}`;
    }
    return "";
}

/** 按 schema attr 推导 Mutation Builder 可用的 op 集合。 */
export function opOptionsForPreviewAttr(attr: WorldPreviewSchemaAttr | null | undefined): WorldMutationOp[] {
    if (attr?.kind === "list") {
        return ["listAppend"];
    }
    if (attr?.kind === "collection") {
        return ["collectionAdd", "collectionRemove"];
    }
    if (attr?.kind === "object") {
        return ["set", "unset"];
    }
    if (!attr?.type || attr.type === "int" || attr.type === "float") {
        return ["set", "add", "unset"];
    }
    return ["set", "unset"];
}

/** 按完整 attr path 解析 schema attr；开放 object key 会继承根 object 的 itemType 投影。 */
export function resolvePreviewAttrPath(attrs: WorldPreviewSchemaAttr[], attrPath: string): WorldPreviewSchemaAttr | null {
    const name = attrPath.trim();
    const exact = attrs.find((attr) => attr.name === name);
    if (exact) {
        return exact;
    }

    const [rootName, ...pathParts] = name.split(".");
    if (!rootName || pathParts.length === 0 || pathParts.some((part) => part.trim() === "")) {
        return null;
    }
    const root = attrs.find((attr) => attr.name === rootName);
    if (root?.kind !== "object") {
        return null;
    }
    let current: WorldPreviewSchemaAttr = root;
    for (const part of pathParts) {
        if (current.kind !== "object") {
            return null;
        }
        const field = current.fields?.[part];
        if (field) {
            current = field;
            continue;
        }
        const itemType = current.itemType ?? current.type;
        if (!itemType) {
            return null;
        }
        current = {
            name: part,
            kind: itemType === "object" ? "object" : "scalar",
            type: itemType === "object" ? undefined : itemType,
            enum: current.enum,
            desc: current.desc,
        };
    }
    return {
        ...current,
        name,
    };
}

/** 按 schema attr 推导快捷填充时的默认 mutation draft。 */
export function defaultMutationForPreviewAttr(subjectId: string, attr: WorldPreviewSchemaAttr, subjects: WorldPreviewSubject[] = []): WorldMutationDraft {
    const op = opOptionsForPreviewAttr(attr)[0] ?? "set";
    const mutation: WorldMutationDraft = {
        subjectId,
        attr: attr.name,
        op,
    };
    if (op !== "unset") {
        mutation.value = defaultValueForPreviewAttr(attr, subjects);
    }
    return mutation;
}

/** 按 subject 类型和 schema 推导一条适合初始草稿的 mutation。 */
export function defaultMutationForPreviewSubject(schemaTypes: WorldPreviewSchemaType[], subjects: WorldPreviewSubject[], subjectId: string): WorldMutationDraft {
    const subject = subjects.find((item) => item.id === subjectId);
    const typeName = subject?.type ?? schemaTypes[0]?.type ?? "";
    const subjectType = schemaTypes.find((item) => item.type === typeName);
    const attrs = subjectType?.attrs ?? [];
    const ownEventAttr = attrs.find((item) => item.name === "events");
    if (ownEventAttr) {
        return defaultMutationForPreviewAttr(subjectId, ownEventAttr, subjects);
    }
    const eventSubject = subjects.find((item) => {
        const schemaType = schemaTypes.find((candidate) => candidate.type === item.type);
        return item.id === "world" && Boolean(schemaType?.attrs.some((attr) => attr.name === "events"));
    });
    if (eventSubject) {
        const eventAttr = schemaTypes.find((item) => item.type === eventSubject.type)?.attrs.find((item) => item.name === "events");
        if (eventAttr) {
            return defaultMutationForPreviewAttr(eventSubject.id, eventAttr, subjects);
        }
    }
    const firstAttr = attrs[0];
    if (firstAttr) {
        return defaultMutationForPreviewAttr(subjectId, firstAttr, subjects);
    }
    return {subjectId, attr: "events", op: "listAppend", value: "世界事件"};
}

/** 读取一次 mutation.value 实际要填写的值类型；list/collection 优先使用 itemType。 */
export function previewAttrValueType(attr: WorldPreviewSchemaAttr | null | undefined): string | undefined {
    if (!attr) {
        return undefined;
    }
    if (attr.kind === "list" || attr.kind === "collection") {
        return attr.itemType ?? attr.type;
    }
    return attr.type ?? attr.itemType;
}

/** 判断当前 attr/op 的 value 是否必须是 JSON object。 */
export function previewAttrNeedsJsonObject(attr: WorldPreviewSchemaAttr | null | undefined, op: WorldMutationOp): boolean {
    if (!attr || op === "unset") {
        return false;
    }
    return attr.kind === "object" || previewAttrValueType(attr) === "object";
}

/** 判断 JSON value 是否是非数组 object。 */
export function isJsonObjectValue(value: JsonValue): value is Record<string, JsonValue> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseMutation(input: unknown): ParseResult<WorldMutationDraft> {
    if (!isRecord(input)) {
        return {ok: false, message: "mutation 必须是 object"};
    }
    const subjectId = typeof input.subjectId === "string" ? input.subjectId.trim() : "";
    const attr = typeof input.attr === "string" ? input.attr.trim() : "";
    const op = typeof input.op === "string" && MUTATION_OPS.has(input.op as WorldMutationOp) ? input.op as WorldMutationOp : null;
    if (!subjectId) {
        return {ok: false, message: "mutation.subjectId 不能为空"};
    }
    if (!attr) {
        return {ok: false, message: "mutation.attr 不能为空"};
    }
    if (!op) {
        return {ok: false, message: "mutation.op 不合法"};
    }
    const hasValue = "value" in input;
    if (op === "unset" && hasValue) {
        return {ok: false, message: "mutation.value 在 unset 时必须省略"};
    }
    if (op !== "unset" && !hasValue) {
        return {ok: false, message: "mutation.value 不能为空"};
    }
    if (!hasValue) {
        return {ok: true, value: {subjectId, attr, op}};
    }
    if (!isJsonValue(input.value)) {
        return {ok: false, message: "mutation.value 必须是 JSON 值"};
    }
    return {ok: true, value: {subjectId, attr, op, value: input.value}};
}

function isValidMutationIndex(mutations: WorldMutationDraft[], index: number): boolean {
    return Number.isInteger(index) && index >= 0 && index < mutations.length;
}

/** 按 schema attr 推导 mutation value 默认值，不决定 mutation op。 */
export function defaultValueForPreviewAttr(attr: WorldPreviewSchemaAttr, subjects: WorldPreviewSubject[] = []): JsonValue {
    if (attr.default !== undefined) {
        return cloneJsonValue(attr.default);
    }
    const valueType = previewAttrValueType(attr);
    if (attr.kind === "list" && valueType === "text") {
        return "记录";
    }
    if (valueType === "int" || valueType === "float") {
        return 0;
    }
    if (valueType === "bool") {
        return false;
    }
    if (attr.kind === "object" || valueType === "object") {
        return {};
    }
    if (valueType === "enum" && attr.enum?.length) {
        return cloneJsonValue(attr.enum[0] ?? "");
    }
    return refPlaceholder(valueType, subjects);
}

function cloneJsonValue(input: JsonValue): JsonValue {
    return JSON.parse(JSON.stringify(input)) as JsonValue;
}

function stateValueAtPath(attrs: Record<string, JsonValue>, attrPath: string): JsonValue | undefined {
    const path = attrPath.trim();
    if (!path) {
        return undefined;
    }
    if (Object.prototype.hasOwnProperty.call(attrs, path)) {
        return attrs[path];
    }
    let current: JsonValue | undefined = attrs;
    for (const part of path.split(".")) {
        if (!isJsonRecord(current) || !Object.prototype.hasOwnProperty.call(current, part)) {
            return undefined;
        }
        current = current[part];
    }
    return current;
}

function formatValueOption(value: JsonValue): {label: string; value: string} {
    return {
        label: typeof value === "string" ? value : JSON.stringify(value),
        value: formatJsonInputValue(value),
    };
}

function refPlaceholder(type: string | undefined, subjects: WorldPreviewSubject[]): JsonValue {
    const refType = parseRefType(type);
    if (!refType) {
        return "";
    }
    const target = subjects.find((subject) => subject.type === refType);
    return target ? `subject://${target.id}` : "subject://";
}

function parseRefType(type: string | undefined): string | null {
    const match = /^ref\(([^)]+)\)$/.exec(type ?? "");
    return match?.[1] ?? null;
}

function validatePreviewDemoAttrs(schemaTypes: WorldPreviewSchemaType[]): string[] {
    const errors: string[] = [];
    for (const requirement of PREVIEW_DEMO_ATTR_REQUIREMENTS) {
        const subjectType = schemaTypes.find((item) => item.type === requirement.type);
        const attr = subjectType?.attrs.find((item) => item.name === requirement.attr);
        if (!attr) {
            errors.push(`${requirement.type}.${requirement.attr} 缺失`);
            continue;
        }
        if (attr.kind !== requirement.kind) {
            errors.push(`${requirement.type}.${requirement.attr} 需要 ${requirement.kind}，当前是 ${attr.kind}`);
            continue;
        }
        const valueType = previewAttrValueType(attr);
        if (requirement.expectedTypes && (!valueType || !requirement.expectedTypes.includes(valueType))) {
            errors.push(`${requirement.type}.${requirement.attr} 类型需要 ${requirement.expectedTypes.join("/")}，当前是 ${valueType ?? "未声明"}`);
        }
    }
    return errors;
}

function isJsonValue(input: unknown): input is JsonValue {
    if (input === null || typeof input === "string" || typeof input === "number" || typeof input === "boolean") {
        return typeof input !== "number" || Number.isFinite(input);
    }
    if (Array.isArray(input)) {
        return input.every(isJsonValue);
    }
    if (isRecord(input)) {
        return Object.values(input).every(isJsonValue);
    }
    return false;
}

function isRecord(input: unknown): input is Record<string, unknown> {
    return typeof input === "object" && input !== null && !Array.isArray(input);
}

function isJsonRecord(value: JsonValue | undefined): value is Record<string, JsonValue> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function shouldParseAsJson(input: string): boolean {
    return input.startsWith("{")
        || input.startsWith("[")
        || input.startsWith("\"")
        || input === "null"
        || input === "true"
        || input === "false"
        || /^-?\d+(\.\d+)?$/.test(input);
}

function addOneSecond(input: string): string | null {
    return addSecondsToPreviewTime(input, 1);
}

/** 给 Preview / Workbench 的常见日历字符串加秒；复杂自定义日历仍回退到 examples。 */
function addSecondsToPreviewTime(input: string, offset: number): string | null {
    const numericDateTime = addSecondsToNumericDateTime(input, offset);
    if (numericDateTime) {
        return numericDateTime;
    }
    return addSecondsWithinDay(input, offset);
}

/** 支持默认数字历格式跨日 / 跨月 / 跨年进位，不替代后端 Calendar 解析器。 */
function addSecondsToNumericDateTime(input: string, offset: number): string | null {
    const match = /^(.*?)(-?\d+)年(\s+)(\d{1,2})月(\d{1,2})日(\s+)(\d{1,2}):(\d{2}):(\d{2})$/.exec(input);
    if (!match) {
        return null;
    }
    const prefix = match[1] ?? "";
    const yearText = match[2] ?? "";
    const yearSeparator = match[3] ?? " ";
    const monthText = match[4] ?? "";
    const dayText = match[5] ?? "";
    const timeSeparator = match[6] ?? " ";
    const hourText = match[7] ?? "00";
    const minuteText = match[8] ?? "";
    const secondText = match[9] ?? "";
    let year = Number.parseInt(yearText, 10);
    let month = Number.parseInt(monthText, 10);
    let day = Number.parseInt(dayText, 10);
    const hour = Number.parseInt(hourText, 10);
    const minute = Number.parseInt(minuteText, 10);
    const second = Number.parseInt(secondText, 10);
    if (!Number.isSafeInteger(year) || !Number.isInteger(month) || !Number.isInteger(day) || !isValidPreviewClock(hour, minute, second) || month < 1 || month > 12 || day < 1 || day > 30) {
        return null;
    }
    const total = hour * 3600 + minute * 60 + second + offset;
    if (total < 0) {
        return null;
    }
    day += Math.floor(total / (24 * 3600));
    while (day > 30) {
        day -= 30;
        month += 1;
    }
    while (month > 12) {
        month -= 12;
        year += 1;
    }
    const secondOfDay = total % (24 * 3600);
    const nextHour = Math.floor(secondOfDay / 3600);
    const nextMinute = Math.floor((secondOfDay % 3600) / 60);
    const nextSecond = secondOfDay % 60;
    const nextHourText = hourText.length === 2 ? String(nextHour).padStart(2, "0") : String(nextHour);
    return `${prefix}${year}年${yearSeparator}${formatDatePart(month, monthText)}月${formatDatePart(day, dayText)}日${timeSeparator}${nextHourText}:${String(nextMinute).padStart(2, "0")}:${String(nextSecond).padStart(2, "0")}`;
}

/** 支持只有时分秒可识别时的同一天内进位。 */
function addSecondsWithinDay(input: string, offset: number): string | null {
    const match = /^(.*?)(\d{1,2}):(\d{2}):(\d{2})$/.exec(input);
    if (!match) {
        return null;
    }
    const prefix = match[1] ?? "";
    const hour = match[2] ?? "00";
    const hourNumber = Number.parseInt(hour, 10);
    const minute = Number.parseInt(match[3] ?? "", 10);
    const second = Number.parseInt(match[4] ?? "", 10);
    if (!isValidPreviewClock(hourNumber, minute, second)) {
        return null;
    }
    const total = hourNumber * 3600 + minute * 60 + second + offset;
    if (total < 0 || total >= 24 * 3600) {
        return null;
    }
    const nextHour = Math.floor(total / 3600);
    const nextMinute = Math.floor((total % 3600) / 60);
    const nextSecond = total % 60;
    const hourText = hour.length === 2 ? String(nextHour).padStart(2, "0") : String(nextHour);
    return `${prefix}${hourText}:${String(nextMinute).padStart(2, "0")}:${String(nextSecond).padStart(2, "0")}`;
}

/** 校验默认预览时间里的 24 小时时分秒。 */
function isValidPreviewClock(hour: number, minute: number, second: number): boolean {
    return Number.isInteger(hour) && Number.isInteger(minute) && Number.isInteger(second) && hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59 && second >= 0 && second <= 59;
}

/** 只在源字段显式使用前导零时保留月 / 日零填充。 */
function formatDatePart(value: number, source: string): string {
    return source.startsWith("0") ? String(value).padStart(source.length, "0") : String(value);
}
