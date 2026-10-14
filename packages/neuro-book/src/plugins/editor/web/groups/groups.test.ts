/**
 * 编辑组与标签（docs/specs/workbench/editor.md 输出 1–5）：纯模型；布局用真实的 nb-ui grid。
 */

import {describe, expect, it} from "bun:test";

import {createEditorGroups} from "./groups";
import type {EditorGroups} from "./groups";
import {CODE_EDITOR, MARKDOWN_EDITOR} from "../../shared/contracts";

const md = {editor: MARKDOWN_EDITOR} as const;
const addresses = (groups: EditorGroups, index = 0): string[] => (groups.groups.value[index]?.tabs ?? []).map((tab) => `${tab.address}${tab.preview ? "*" : ""}`);
const active = (groups: EditorGroups): string | undefined => groups.activeTab()?.address;

describe("Spec workbench.editor 输出 1：preview 与 permanent", () => {
    it("单击替换本组的 preview；已在本组只激活；permanent 打开或 pin 转正；转正后不再被替换", () => {
        const groups = createEditorGroups();
        groups.open("project://a.md", {mode: "preview", ...md});
        const second = groups.open("project://b.md", {mode: "preview", ...md});
        expect(second.replaced?.address).toBe("project://a.md");
        expect(addresses(groups)).toEqual(["project://b.md*"]);
        groups.open("project://b.md", {mode: "permanent", ...md});
        expect(addresses(groups)).toEqual(["project://b.md"]);
        expect(groups.open("project://a.md", {mode: "preview", ...md}).replaced).toBeNull();
        expect(addresses(groups)).toEqual(["project://b.md", "project://a.md*"]);
        const tab = groups.groups.value[0]?.tabs[1];
        groups.pin(tab?.id ?? "");
        groups.open("project://c.md", {mode: "preview", ...md});
        expect(addresses(groups)).toEqual(["project://b.md", "project://a.md", "project://c.md*"]);
        const again = groups.open("project://b.md", {mode: "preview", ...md});
        expect(again.replaced).toBeNull();
        expect(active(groups)).toBe("project://b.md");
        expect(addresses(groups)).toEqual(["project://b.md", "project://a.md", "project://c.md*"]);
    });

    it("新标签插在活动标签之后", () => {
        const groups = createEditorGroups();
        for (const name of ["a", "b", "c"]) groups.open(`project://${name}.md`, {mode: "permanent", ...md});
        groups.activate(groups.groups.value[0]?.tabs[0]?.id ?? "");
        groups.open("project://d.md", {mode: "permanent", ...md});
        expect(addresses(groups)).toEqual(["project://a.md", "project://d.md", "project://b.md", "project://c.md"]);
    });
});

describe("Spec workbench.editor 输出 1、39：同一文件的几个标签", () => {
    it("按地址加编辑器区分：同一组里源码与预览视图并存；reuse 决定哪个算已打开；换成本组已有的那种编辑器时切过去并关掉当前这个", () => {
        const groups = createEditorGroups();
        const source = groups.open("project://a.html", {mode: "permanent", editor: CODE_EDITOR}).tab;
        const preview = groups.open("project://a.html", {mode: "permanent", editor: "test.html.preview"}).tab;
        expect(addresses(groups)).toEqual(["project://a.html", "project://a.html"]);
        expect(preview.id).not.toBe(source.id);
        // 不指定编辑器的打开由调用方给 reuse：认可非预览的那一个。
        expect(groups.open("project://a.html", {mode: "permanent", editor: CODE_EDITOR, reuse: (tab) => tab.editor !== "test.html.preview"}).tab.id).toBe(source.id);
        expect(groups.setEditor(preview.id, CODE_EDITOR)?.id).toBe(preview.id);
        expect(groups.groups.value[0]?.tabs.map((tab) => tab.id)).toEqual([source.id]);
        expect(groups.activeTab()?.id).toBe(source.id);
    });

    it("语言随拆分复制，换编辑器时与光标一起丢掉；快照往返保留语言", () => {
        const groups = createEditorGroups();
        const tab = groups.open("project://a.txt", {mode: "permanent", editor: CODE_EDITOR}).tab;
        groups.setLanguage(tab.id, "python");
        groups.setCursor(tab.id, {line: 2, column: 1});
        const split = groups.split(tab.id, "right");
        expect(split).toMatchObject({language: "python", cursor: {line: 2, column: 1}});
        expect(createEditorGroups(JSON.parse(JSON.stringify(groups.snapshot()))).groups.value.map((group) => group.tabs[0])).toMatchObject([{language: "python"}, {language: "python"}]);
        groups.setEditor(tab.id, MARKDOWN_EDITOR);
        const changed = groups.find(tab.id)?.tab;
        expect(changed?.kind === "file" ? [changed.language, changed.cursor] : null).toEqual([undefined, undefined]);
        groups.setLanguage(split!.id, null);
        const cleared = groups.find(split!.id)?.tab;
        expect(cleared?.kind === "file" ? cleared.language : null).toBeUndefined();
    });

    it("光标写法按编辑器的声明：没有声明的编辑器不记光标", () => {
        const groups = createEditorGroups(null, (editor) => (editor === "test.viewer" ? null : "line"));
        const viewer = groups.open("project://a.png", {mode: "permanent", editor: "test.viewer"}).tab;
        groups.setCursor(viewer.id, {line: 1, column: 1});
        const tab = groups.find(viewer.id)?.tab;
        expect(tab?.kind === "file" ? tab.cursor : null).toBeUndefined();
    });
});

describe("Spec workbench.editor 输出 2–3：拆分与关闭", () => {
    it("拆分在右侧新建组打开同一文档并成为活动组；打开在活动组；关闭激活右侧（没有时左侧）；组空了随之关闭，活动组换到相邻组", () => {
        const groups = createEditorGroups();
        groups.open("project://a.md", {mode: "permanent", ...md});
        const b = groups.open("project://b.md", {mode: "permanent", ...md}).tab;
        const split = groups.split(b.id, "right");
        expect(split?.address).toBe("project://b.md");
        expect(groups.groups.value).toHaveLength(2);
        expect(groups.activeGroup.value).toBe(groups.groups.value[1]?.id);
        expect(groups.grid.root()).toMatchObject({kind: "branch", orientation: "horizontal"});
        groups.open("project://c.md", {mode: "preview", ...md});
        expect(addresses(groups, 1)).toEqual(["project://b.md", "project://c.md*"]);
        expect(addresses(groups, 0)).toEqual(["project://a.md", "project://b.md"]);

        groups.activate(groups.groups.value[0]?.tabs[0]?.id ?? "");
        groups.close(groups.groups.value[0]?.tabs[0]?.id ?? "");
        expect(active(groups)).toBe("project://b.md");
        // 关掉活动组里的全部标签：组随之关闭，活动组换到相邻的组。
        const second = groups.groups.value[1];
        groups.activate(second?.tabs[0]?.id ?? "");
        for (const tab of second?.tabs ?? []) groups.close(tab.id);
        expect(active(groups)).toBe("project://b.md");
        expect(groups.groups.value).toHaveLength(1);
        expect(groups.grid.root()).toMatchObject({kind: "leaf"});
        expect(groups.activeGroup.value).toBe(groups.groups.value[0]?.id);

        // 只剩一组时关掉最后一个标签，组留着。
        groups.close(groups.groups.value[0]?.tabs[0]?.id ?? "");
        expect(groups.groups.value).toHaveLength(1);
        expect(groups.groups.value[0]?.active).toBeNull();
    });

    it("关闭中间的活动标签激活它右侧的；关闭最右的激活左侧的", () => {
        const groups = createEditorGroups();
        for (const name of ["a", "b", "c"]) groups.open(`project://${name}.md`, {mode: "permanent", ...md});
        groups.activate(groups.groups.value[0]?.tabs[1]?.id ?? "");
        groups.close(groups.groups.value[0]?.tabs[1]?.id ?? "");
        expect(active(groups)).toBe("project://c.md");
        groups.close(groups.groups.value[0]?.tabs[1]?.id ?? "");
        expect(active(groups)).toBe("project://a.md");
    });

    it("关闭其它、同组移动、换编辑器", () => {
        const groups = createEditorGroups();
        for (const name of ["a", "b", "c"]) groups.open(`project://${name}.md`, {mode: "permanent", ...md});
        const b = groups.groups.value[0]?.tabs[1];
        groups.move(b?.id ?? "", 1);
        expect(addresses(groups)).toEqual(["project://a.md", "project://c.md", "project://b.md"]);
        groups.move(b?.id ?? "", 1);
        expect(addresses(groups)).toEqual(["project://a.md", "project://c.md", "project://b.md"]);
        groups.setEditor(b?.id ?? "", CODE_EDITOR);
        expect(groups.find(b?.id ?? "")?.tab).toMatchObject({kind: "file", editor: CODE_EDITOR});
        expect(groups.closeOthers(b?.id ?? "").map((tab) => tab.address)).toEqual(["project://a.md", "project://c.md"]);
        expect(addresses(groups)).toEqual(["project://b.md"]);
    });

    it("改名把标签跟到新地址；关闭某个目录下的全部标签", () => {
        const groups = createEditorGroups();
        groups.open("project://dir/a.md", {mode: "permanent", ...md});
        const split = groups.split(groups.activeTab()?.id ?? "", "down");
        groups.open("project://dir/b.md", {mode: "permanent", ...md});
        groups.open("project://other.md", {mode: "permanent", ...md});
        groups.rebind("project://dir", "project://moved");
        expect(addresses(groups, 0)).toEqual(["project://moved/a.md"]);
        expect(addresses(groups, 1)).toEqual(["project://moved/a.md", "project://moved/b.md", "project://other.md"]);
        expect(split).not.toBeNull();
        expect(groups.closeWithin(["project://moved"]).map((tab) => tab.address)).toEqual(["project://moved/a.md", "project://moved/a.md", "project://moved/b.md"]);
        expect(groups.groups.value).toHaveLength(1);
        expect(addresses(groups)).toEqual(["project://other.md"]);
    });

    it("改名时留在原处的地址（目标上有一份要保留的文档）不跟过去", () => {
        const groups = createEditorGroups();
        groups.open("project://dir/a.md", {mode: "permanent", ...md});
        groups.open("project://dir/b.md", {mode: "permanent", ...md});
        groups.rebind("project://dir", "project://moved", ["project://dir/b.md"]);
        expect(addresses(groups)).toEqual(["project://moved/a.md", "project://dir/b.md"]);
    });
});

describe("Spec workbench.editor 输出 35：在侧边打开", () => {
    it("右侧没有组时在活动组右侧新建一个空组、不带走活动标签；有了以后再“侧边”就是它；在它里面打开后它成为活动组；从右边的组再侧边又新建", () => {
        const groups = createEditorGroups();
        groups.open("project://a.md", {mode: "permanent", ...md});
        const side = groups.sideGroup();
        expect(groups.groups.value.map((group) => group.id)).toEqual([groups.groups.value[0]?.id, side]);
        expect(addresses(groups, 1)).toEqual([]);
        expect(addresses(groups, 0)).toEqual(["project://a.md"]);
        groups.open("project://b.md", {mode: "permanent", ...md, group: side});
        expect(groups.activeGroup.value).toBe(side);
        expect(addresses(groups, 1)).toEqual(["project://b.md"]);
        // 回到左边的组：再侧边仍是同一个右侧组，不再新建。
        groups.focusGroup(groups.groups.value[0]?.id as string);
        expect(groups.sideGroup()).toBe(side);
        expect(groups.groups.value).toHaveLength(2);
        // 活动的是最右的组：再侧边在它右侧新建。
        groups.focusGroup(side);
        const third = groups.sideGroup();
        expect(third).not.toBe(side);
        expect(groups.groups.value.map((group) => group.id)).toEqual([groups.groups.value[0]?.id, side, third]);
    });

    it("右侧的是一列上下拆开的组：取那一列最上面的组", () => {
        const groups = createEditorGroups();
        groups.open("project://a.md", {mode: "permanent", ...md});
        const left = groups.activeGroup.value;
        groups.split(groups.activeTab()?.id as string, "right");
        const top = groups.activeGroup.value;
        groups.split(groups.activeTab()?.id as string, "down");
        groups.focusGroup(left);
        expect(groups.sideGroup()).toBe(top);
    });
});

describe("Spec workbench.editor 输出 5：会话快照", () => {
    it("快照恢复出同样的组、布局、标签与活动项；新建的组不与恢复的 id 冲突", () => {
        const groups = createEditorGroups();
        groups.open("project://a.md", {mode: "permanent", ...md});
        groups.open("project://b.md", {mode: "preview", ...md});
        groups.split(groups.activeTab()?.id ?? "", "right");
        groups.open("user://u.md", {mode: "permanent", editor: CODE_EDITOR});
        const snapshot = groups.snapshot();
        const restored = createEditorGroups(JSON.parse(JSON.stringify(snapshot)));
        expect(restored.snapshot()).toEqual(snapshot);
        expect(active(restored)).toBe("user://u.md");
        // 让记录里的组与分支恰好用上新计数会先给出的 id：新拆出的组与分支仍不冲突。
        const renamed = JSON.parse(JSON.stringify(snapshot).replaceAll(`"${snapshot.activeGroup}"`, "\"g1\"").replace(/"id":"b\d+"/u, "\"id\":\"b2\""));
        const colliding = createEditorGroups(renamed);
        expect(colliding.groups.value.map((group) => group.id)).toEqual(["g0", "g1"]);
        const split = colliding.split(colliding.activeTab()?.id ?? "", "down");
        expect(split).not.toBeNull();
        expect(new Set(colliding.groups.value.map((group) => group.id)).size).toBe(3);
    });

    it("上次的光标随快照往返；写法与编辑器对不上的（Markdown 记着行列、源码记着位置）恢复时丢掉（输出 30）", () => {
        const groups = createEditorGroups();
        groups.open("project://a.md", {mode: "permanent", ...md});
        groups.open("project://c.json", {mode: "permanent", editor: CODE_EDITOR});
        const [a, c] = groups.groups.value[0]!.tabs;
        groups.setCursor(a!.id, {offset: 4});
        groups.setCursor(c!.id, {line: 2, column: 3});
        groups.setCursor(c!.id, {offset: 9});
        const snapshot = groups.snapshot();
        expect(snapshot.groups[0]?.tabs.map((tab) => tab.cursor)).toEqual([{offset: 4}, {line: 2, column: 3}]);
        expect(createEditorGroups(JSON.parse(JSON.stringify(snapshot))).snapshot()).toEqual(snapshot);
        const crossed = {...snapshot, groups: snapshot.groups.map((group) => ({...group, tabs: [{...group.tabs[0]!, cursor: {line: 1, column: 1}}, {...group.tabs[1]!, cursor: {offset: 2}}]}))};
        expect(createEditorGroups(crossed).groups.value[0]?.tabs.map((tab) => (tab.kind === "file" ? tab.cursor : null))).toEqual([undefined, undefined]);
    });

    it("页面标签（输出 33）不进快照：活动的是页面时记它左边最近的文件标签；页面不拆分、不换编辑器", () => {
        const groups = createEditorGroups();
        groups.open("project://a.md", {mode: "permanent", ...md});
        groups.openPage("page://nbook.test.welcome");
        groups.open("project://b.md", {mode: "permanent", ...md});
        const page = groups.groups.value[0]!.tabs[1]!;
        groups.activate(page.id);
        const snapshot = groups.snapshot();
        expect(snapshot.groups[0]?.tabs.map((tab) => tab.address)).toEqual(["project://a.md", "project://b.md"]);
        expect(snapshot.groups[0]?.active).toBe(0);
        expect(groups.split(page.id, "right")).toBeNull();
        expect(groups.setEditor(page.id, CODE_EDITOR)).toBeNull();
        expect(groups.find(page.id)?.tab.kind).toBe("page");

        const only = createEditorGroups();
        only.openPage("page://nbook.test.welcome");
        expect(only.snapshot().groups[0]).toMatchObject({tabs: [], active: null});
    });

    it("布局与组对不上、活动组不存在或快照损坏：从一个空组开始", () => {
        const groups = createEditorGroups();
        groups.open("project://a.md", {mode: "permanent", ...md});
        const snapshot = groups.snapshot();
        for (const broken of [
            {...snapshot, activeGroup: "nope"},
            {...snapshot, groups: [...snapshot.groups, {id: "extra", tabs: [], active: null}]},
            {...snapshot, layout: {version: 1, root: null}},
            // 叶的 id 与组的 ref 不一致：渲染按叶的 id 找组，会找不到这些标签。
            JSON.parse(JSON.stringify(snapshot).replace(/"kind":"leaf","id":"[^"]+"/u, '"kind":"leaf","id":"alien"')),
        ]) {
            const restored = createEditorGroups(broken as never);
            expect(restored.groups.value).toEqual([{id: "g0", tabs: [], active: null}]);
        }
    });
});
