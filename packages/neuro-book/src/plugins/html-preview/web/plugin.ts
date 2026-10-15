/**
 * `nbook.html-preview` 浏览器入口（docs/specs/workbench/html-preview.md）：向编辑器区交 HTML 的预览编辑器（`role: "preview"`），
 * 另有“允许联网”的开关（命令、公开状态与编辑区标题上的按钮）。控件要的令牌服务、时钟与联网开关由这里包进组件，控件
 * 合同之外的东西不经编辑器区。联网开关只在内存里、按地址记，刷新后回到不联网。
 */

import {computed, defineComponent, h, reactive} from "vue";
import {Type} from "typebox";

import {diagnosticsKey} from "@notnotype/nb-runtime/diagnostics";
import {defineEntry} from "@notnotype/nb-runtime/plugins";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";

import {COMMANDS_POINT, menuImplementations} from "nbook/plugins/commands/shared/contracts";
import type {CommandDeclaration} from "nbook/plugins/commands/shared/contracts";
import {EDITOR_EDITORS_POINT, EDITOR_TITLE_POINT} from "nbook/plugins/editor/shared/contracts";
import type {EditorDeclaration, EditorTitleItemDeclaration} from "nbook/plugins/editor/shared/contracts";
import {filesPreviewContract} from "nbook/plugins/files/shared/contracts";
import {PUBLIC_STATE_POINT, publicStateKey} from "nbook/plugins/state/shared/contracts";
import {clockKey, windowNavigationKey} from "nbook/shared/host";
import {windowProjectKey} from "nbook/shared/projects";
import {bindingsOf, definePublicState} from "nbook/shared/store/public";

import {descriptor} from "../plugin";
import type {PreviewAccess} from "./access";

export const HTML_PREVIEW_EDITOR = "nbook.html-preview.html";
/** 内置命令的 id 第二段是功能域（docs/specs/workbench/commands.md 的“命令身份”），不是提供方插件：预览归 `editor` 域。 */
export const TOGGLE_NETWORK_COMMAND = "nbook.editor.toggle-preview-network";

const DECLARATION: EditorDeclaration = {
    title: {"zh-CN": "HTML 预览", "en-US": "HTML Preview"},
    selector: {extensions: ["html", "htm"]},
    priority: "option",
    input: "text",
    role: "preview",
};

const reason = (zh: string, en: string) => ({"zh-CN": zh, "en-US": en});

const previewState = definePublicState("nbook.html-preview", {
    // 活动标签是 HTML 的预览视图：开关按钮只在这时出现。
    active: {type: "boolean", unready: false, reason: reason("活动的不是 HTML 预览", "The active editor is not an HTML preview")},
    networkAllowed: {type: "boolean", unready: false},
});

const TOGGLE: CommandDeclaration = {
    title: {"zh-CN": "预览：允许联网", "en-US": "Preview: Allow Network Access"},
    category: {"zh-CN": "HTML 预览", "en-US": "HTML Preview"},
    description: "Allow or forbid network access for the active HTML preview; by default the preview can only read files in the work.",
    args: Type.Object({}, {additionalProperties: false}),
    effect: "read",
    when: {requires: [previewState.key("active")]},
    // 打开联网是对不受信任的页面放权，只由用户自己点。
    expose: {agent: "never"},
};

const TITLE_ITEMS: ReadonlyArray<{readonly id: string; readonly declaration: EditorTitleItemDeclaration}> = [
    {id: "nbook.html-preview.network", declaration: {section: "1", command: TOGGLE_NETWORK_COMMAND, icon: "i-lucide-globe", label: {"zh-CN": "允许联网", "en-US": "Allow Network Access"}, toggled: previewState.key("networkAllowed"), when: {requires: [previewState.key("active")]}}},
];

export const htmlPreviewBrowserPlugin: PluginDefinition = {
    id: descriptor.id,
    entries: [defineEntry({
        id: "browser",
        location: "browser",
        // 启动即交付：恢复会话时预览视图不必等按需激活。
        activationEvents: ["onStartup"],
        dependencies: [{key: diagnosticsKey}, {key: clockKey}, {key: publicStateKey}, {key: windowProjectKey}, {key: windowNavigationKey}],
        contributions: [
            {capability: EDITOR_EDITORS_POINT, id: HTML_PREVIEW_EDITOR, declaration: DECLARATION},
            {capability: COMMANDS_POINT, id: TOGGLE_NETWORK_COMMAND, declaration: TOGGLE},
            ...previewState.contributions,
            ...TITLE_ITEMS.map(({id, declaration}) => ({capability: EDITOR_TITLE_POINT, id, declaration})),
        ],
        activate: (context) => {
            const diagnostics = context.services.require(diagnosticsKey);
            const clock = context.services.require(clockKey);
            const state = context.services.require(publicStateKey);
            const project = context.services.require(windowProjectKey).project;
            const remote = context.remote.use(filesPreviewContract);
            const navigation = context.services.require(windowNavigationKey);
            const report = (message: string, error?: unknown): void => {
                diagnostics.record({level: "warn", event: "html-preview.token", message, ...(error === undefined ? {} : {error}), source: {plugin: descriptor.id}});
            };
            const access: PreviewAccess = {
                open: async (network) => {
                    if (project === null) return {ok: false, denial: "no-project"};
                    const result = await remote.open({project: project.id, generation: project.generation, network});
                    if (!result.ok) {
                        report(`申请预览令牌失败：${result.code}`);
                        return {ok: false, denial: result.code === "generation-gone" ? "closed" : "unreachable"};
                    }
                    return {ok: true, token: result.value.token, base: new URL(result.value.base, navigation.currentUrl()).href};
                },
                close: (token) => {
                    void remote.close({token}).then((result) => {
                        if (!result.ok) report(`作废预览令牌失败：${result.code}`);
                    }, (error: unknown) => report("作废预览令牌失败", error));
                },
            };
            /** 允许联网的地址（只在内存里）。 */
            const allowed = reactive(new Set<string>());
            const read = (key: string): unknown => {
                const value = state.read(key);
                return value.status === "ready" ? value.value : null;
            };
            const active = computed(() => read("nbook.editor/activeEditor") === HTML_PREVIEW_EDITOR);
            const activeAddress = computed(() => read("nbook.editor/activeDocument"));
            const networkAllowed = computed(() => active.value && typeof activeAddress.value === "string" && allowed.has(activeAddress.value));
            const network = (address: string): boolean => allowed.has(address);
            const published = bindingsOf(previewState, {active, networkAllowed});
            return {
                contributions: {
                    [EDITOR_EDITORS_POINT]: {[HTML_PREVIEW_EDITOR]: {load: async () => {
                        const {default: HtmlPreview} = await import("./components/HtmlPreview.vue");
                        // 编辑器区按控件合同传属性与事件；令牌服务、时钟与联网开关在这里补上。
                        return defineComponent({
                            name: "HtmlPreviewHost",
                            inheritAttrs: false,
                            setup: (_props, {attrs}) => () => h(HtmlPreview, {...attrs, access, clock, network} as never),
                        });
                    }}},
                    [COMMANDS_POINT]: {[TOGGLE_NETWORK_COMMAND]: {run: () => {
                        const address = activeAddress.value;
                        if (!active.value || typeof address !== "string") return {ok: false, code: "unavailable", reason: "活动的不是 HTML 预览"};
                        if (allowed.has(address)) allowed.delete(address);
                        else allowed.add(address);
                        return {ok: true, value: null};
                    }}},
                    [PUBLIC_STATE_POINT]: Object.fromEntries(published.bindings),
                    [EDITOR_TITLE_POINT]: menuImplementations(TITLE_ITEMS),
                },
            };
        },
    })],
};
