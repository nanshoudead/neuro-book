/**
 * 会话列表（Spec 验收 26、27）：行的内容、发出的 action 与三种状态。时间用本地时区构造，不依赖机器在哪个时区。
 */
import {describe, expect, it} from "vitest";
import {mount} from "@vue/test-utils";

import type {AgentSessionListItem} from "../types";
import AgentSessionList from "./AgentSessionList.vue";

const at = (month: number, day: number, hour = 12, minute = 0) => new Date(2026, month - 1, day, hour, minute).getTime();
const now = at(10, 20, 9, 30);

const items: AgentSessionListItem[] = [
    {id: "s1", title: "这本书讲了什么？", description: "3 轮 · 图当目录", updatedAt: at(10, 20, 9, 7), status: "idle"},
    {id: "s2", title: "南嘉鱼知道吗？", description: "2 轮", updatedAt: at(10, 20, 9, 6), status: "running"},
    {id: "s3", title: "第 20 章时风信子怀疑过吗？", description: "1 轮 · 全读", updatedAt: at(10, 19), status: "idle", note: {text: "读到 38.12，早于你现在的位置", icon: "i-lucide-history"}},
    {id: "s4", title: "", updatedAt: at(10, 18), status: "interrupted"},
    {id: "s5", title: "列出变身口号", updatedAt: at(3, 2), status: "error"},
];

function mountList(props: Partial<InstanceType<typeof AgentSessionList>["$props"]> = {}) {
    return mount(AgentSessionList, {props: {items, selectedId: "s1", now, locale: "zh-CN", ...props}});
}

describe("AgentSessionList 的行（验收 26）", () => {
    it("每行有标题、说明、时间、状态与提醒；选中的标为当前项", () => {
        const view = mountList();
        const rows = view.findAll("[data-session]");
        expect(rows.map((row) => row.attributes("aria-current") ?? "")).toEqual(["true", "", "", "", ""]);
        expect(rows[0]!.text()).toContain("这本书讲了什么？");
        expect(rows[0]!.text()).toContain("3 轮 · 图当目录");
        expect(rows[0]!.get("time").text()).toBe("09:07");
        expect(rows[1]!.text()).toContain("运行中");
        expect(rows[2]!.text()).toContain("昨天");
        expect(rows[2]!.text()).toContain("读到 38.12，早于你现在的位置");
        expect(rows[3]!.text()).toContain("未命名会话");
        expect(rows[3]!.text()).toContain("已中断");
        expect(rows[4]!.text()).toContain("3月2日");
        expect(rows[4]!.text()).toContain("出错");
        expect(view.get("ul").attributes("role")).toBe("list");
    });

    it("点一行（含已选中的）发 session.select，点新建发 session.create", async () => {
        const view = mountList();
        await view.get("[data-session='s1']").trigger("click");
        await view.get("[data-session='s3']").trigger("click");
        await view.get("[data-session-create]").trigger("click");
        expect(view.emitted("action")?.map((args) => args[0])).toEqual([
            {type: "session.select", sessionId: "s1"},
            {type: "session.select", sessionId: "s3"},
            {type: "session.create"},
        ]);
    });
});

describe("AgentSessionList 的状态（验收 27）", () => {
    it("加载中、空、出错各有说明，都保留标题行与新建；出错时重试发 sessions.refresh", async () => {
        expect(mountList({state: "loading"}).text()).toContain("正在加载会话");
        const empty = mountList({items: []});
        expect(empty.text()).toContain("还没有会话");
        expect(empty.find("[data-session-create]").exists()).toBe(true);
        const failed = mountList({state: "error", errorMessage: "服务没有响应"});
        expect(failed.text()).toContain("服务没有响应");
        expect(failed.find("[data-session]").exists()).toBe(false);
        await failed.get("[data-session-retry]").trigger("click");
        expect(failed.emitted("action")?.map((args) => args[0])).toEqual([{type: "sessions.refresh"}]);
    });

    it("header 为 false 时没有标题行；labels 覆盖包内文字", () => {
        const bare = mountList({header: false});
        expect(bare.find("[data-session-create]").exists()).toBe(false);
        const renamed = mountList({items: [], labels: {title: "对话", empty: "还没有对话", create: "新对话"}});
        expect(renamed.text()).toContain("对话");
        expect(renamed.text()).toContain("还没有对话");
        expect(renamed.get("[data-session-create]").attributes("aria-label")).toBe("新对话");
    });

    it("英文界面", () => {
        const view = mountList({locale: "en-US", state: "error"});
        expect(view.text()).toContain("Couldn't load conversations");
        expect(view.text()).toContain("Retry");
    });
});
