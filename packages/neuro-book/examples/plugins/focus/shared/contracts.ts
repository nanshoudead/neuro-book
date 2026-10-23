/**
 * `example.focus` 两端共用的合同：设置项、远程服务与“今天”的形状。浏览器入口与服务端入口都引用这里；别的插件要读专注
 * 状态，也只引用这里。
 */

import {Type} from "typebox";
import type {Static} from "typebox";

import {defineRemoteService, defineSetting, SETTINGS_SECTIONS_POINT} from "@notnotype/nb-plugin-sdk";
import type {ContributionDeclaration, RemoteResult, RemoteSubscribeOptions, RemoteSubscription, SettingsSectionDeclaration} from "@notnotype/nb-plugin-sdk";

const PLUGIN = "example.focus";

/** 设置窗口左栏的分区（list 分区：设置项按声明画成表单，不用写页面）。 */
export const section: ContributionDeclaration<SettingsSectionDeclaration> = {
    capability: SETTINGS_SECTIONS_POINT,
    id: `${PLUGIN}.main`,
    declaration: {title: {"zh-CN": "专注计时", "en-US": "Focus timer"}, icon: "i-lucide-timer", category: "plugins", groups: [{id: "timer", title: {"zh-CN": "计时", "en-US": "Timer"}}]},
};

/**
 * 一次专注多少分钟。只放在用户层：开始计时的是服务端，服务端只读得到缺省值与用户层（作品层属于项目，项目实例才读得到），
 * 写在作品层的值在这里不会生效，用户也看不出为什么。
 */
export const minutesSetting = defineSetting({
    plugin: PLUGIN,
    name: "minutes",
    schema: Type.Integer({minimum: 1, maximum: 120}),
    default: 25,
    title: {"zh-CN": "专注时长（分钟）", "en-US": "Focus length (minutes)"},
    description: {"zh-CN": "下一次开始时生效；进行中的那次不变", "en-US": "Applies from the next start; a running session keeps its length"},
    layers: ["user"],
    applies: "now",
    section: section.id,
    group: "timer",
});

export const RunningSchema = Type.Object({startedAt: Type.Number(), endsAt: Type.Number()}, {additionalProperties: false});

/**
 * 服务端给出的“今天”：进行中的一次（没有为 null）、今天完成的次数与分钟数，以及服务端此刻的时间。窗口按 `endsAt` 与
 * 服务端时间算剩余，不自己每秒减一：后台标签页的计时器会被浏览器放慢，减出来的数会越差越远。
 */
export const TodaySchema = Type.Object({
    running: Type.Union([RunningSchema, Type.Null()]),
    completed: Type.Integer({minimum: 0}),
    minutes: Type.Integer({minimum: 0}),
    now: Type.Number(),
}, {additionalProperties: false});

export type Today = Static<typeof TodaySchema>;

const Empty = Type.Object({}, {additionalProperties: false});
const StorageFailed = Type.Object({code: Type.String(), detail: Type.String()}, {additionalProperties: false});

/**
 * 专注会话的远程服务。“结束”不是一个调用：服务端按 `endsAt` 自己结束（见服务端入口的“结算”），窗口关了、服务端重启了，
 * 到点的那次照样记为完成。
 */
export const sessionsContract = defineRemoteService({
    id: "example.focus/sessions",
    version: 1,
    provider: "server",
    callers: ["browser"],
    methods: {
        today: {input: Empty, output: TodaySchema, effect: "read", errors: {"storage-failed": StorageFailed}},
        start: {input: Empty, output: TodaySchema, effect: "write", errors: {"already-running": Empty, "storage-failed": StorageFailed}},
        cancel: {input: Empty, output: TodaySchema, effect: "write", errors: {"not-running": Empty, "storage-failed": StorageFailed}},
    },
    events: {
        /** “今天”变了就推一次；订阅建立时先推一次当前的，订阅方拿它当基线。 */
        changed: {filter: Empty, payload: TodaySchema},
    },
});

/**
 * 浏览器状态（`web/focus-store.ts`）用到的那几样：远程服务的客户端正好满足它。单独写成接口，组件测试在 Node 里没有服务端，
 * 给它一个内存里的实现。
 */
export interface FocusSource {
    today(): Promise<RemoteResult<Today, "storage-failed">>;
    start(): Promise<RemoteResult<Today, "already-running" | "storage-failed">>;
    cancel(): Promise<RemoteResult<Today, "not-running" | "storage-failed">>;
    subscribe(listener: (today: Today) => void, options: RemoteSubscribeOptions): Promise<RemoteResult<RemoteSubscription>>;
}

export const START_COMMAND = `${PLUGIN}.start`;
export const CANCEL_COMMAND = `${PLUGIN}.cancel`;
export const TOGGLE_COMMAND = `${PLUGIN}.toggle`;
