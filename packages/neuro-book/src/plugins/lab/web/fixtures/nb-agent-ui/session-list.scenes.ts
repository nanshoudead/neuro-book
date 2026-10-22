/**
 * 会话列表的 Lab 场景（Spec“会话列表”与验收 26、27）。时间按本地时区构造：同一份场景在哪个时区的机器上都写成
 * “今天的时刻、昨天、月日”，截图与巡检不随机器变。
 */
import type {AgentSessionListItem} from "@notnotype/nb-agent-ui";
import type {AgentSessionList} from "@notnotype/nb-agent-ui/vue";
import type {LabFixtureDefinition} from "../index";

const at = (month: number, day: number, hour = 12, minute = 0, year = 2026) => new Date(year, month - 1, day, hour, minute).getTime();
const now = at(10, 20, 13, 30);

const items: AgentSessionListItem[] = [
    {id: "c-overview", title: "这本书讲了什么？", description: "3 轮 · 图当目录", updatedAt: at(10, 20, 13, 7), status: "idle"},
    {id: "c-running", title: "南嘉鱼知道心月狐就是苏天晴吗？其他魔法少女呢？", description: "2 轮 · 图当目录", updatedAt: at(10, 20, 13, 6), status: "running"},
    {id: "c-early", title: "第 20 章时风信子怀疑过心月狐吗？", description: "1 轮 · 全读", updatedAt: at(10, 19, 21, 40), status: "idle", note: {text: "读到 38.12，早于你现在的位置", icon: "i-lucide-history"}},
    {id: "c-hello", title: "你好", description: "1 轮 · 图当目录", updatedAt: at(10, 19, 8, 0), status: "interrupted"},
    {id: "c-failed", title: "列出所有魔法少女的变身口号", description: "1 轮 · 图当目录", updatedAt: at(10, 18), status: "error"},
    {id: "c-old", title: "", updatedAt: at(12, 30, 12, 0, 2025), status: "idle"},
];

type Scene = LabFixtureDefinition<typeof AgentSessionList>["scenes"][number];

const base = {items, selectedId: "c-overview", now, locale: "zh-CN" as const};

export const agentSessionListScenes: Scene[] = [
    {id: "list", label: "各种状态的行：选中、运行中、提醒、已中断、出错、未命名", input: {props: base}},
    {id: "renamed", label: "宿主改称“对话”（labels）", input: {props: {...base, labels: {title: "对话", create: "新对话", empty: "还没有对话", untitled: "未命名对话"}}}},
    {id: "no-header", label: "放进下拉：没有标题行", input: {props: {...base, header: false}}},
    {id: "loading", label: "加载中", input: {props: {...base, items: [], state: "loading"}}},
    {id: "empty", label: "还没有会话", input: {props: {...base, items: []}}},
    {id: "error", label: "没取到，可重试", input: {props: {...base, items: [], state: "error"}}},
    {id: "english", label: "英文界面", input: {props: {...base, locale: "en-US"}}},
];
