import {readFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import {describe, expect, it} from "vitest";
import {isNovelIdeTab, NOVEL_IDE_TABS} from "nbook/app/components/novel-ide/mock-data";

const headerPath = fileURLToPath(new URL("../components/novel-ide/NovelIdeHeader.vue", import.meta.url));
const sidebarPath = fileURLToPath(new URL("../components/novel-ide/NovelIdeSidebar.vue", import.meta.url));
const toolPanelPath = fileURLToPath(new URL("../components/novel-ide/NovelIdeToolPanel.vue", import.meta.url));
const welcomePath = fileURLToPath(new URL("../components/markdown-studio/MarkdownStudioWelcome.vue", import.meta.url));
const agentSurfacePath = fileURLToPath(new URL("../components/novel-ide/agent/AgentChatSurface.vue", import.meta.url));

describe("Novel writing mode entries", () => {
    it("写作模式主路径只保留文件与角色侧栏入口", async () => {
        expect(NOVEL_IDE_TABS).toEqual(["files", "characters"]);
        expect(isNovelIdeTab("outline")).toBe(false);
        expect(isNovelIdeTab("rag")).toBe(false);

        const sidebar = await readFile(sidebarPath, "utf-8");
        const toolPanel = await readFile(toolPanelPath, "utf-8");

        expect(sidebar).not.toContain("value: \"outline\"");
        expect(sidebar).not.toContain("value: \"rag\"");
        expect(toolPanel).not.toContain("NovelPlotPanel");
        expect(toolPanel).not.toContain("NovelRagPanel");
    });

    it("顶栏和欢迎页不再暴露 Plot / RAG / simulation 快捷入口", async () => {
        const header = await readFile(headerPath, "utf-8");
        const welcome = await readFile(welcomePath, "utf-8");

        expect(header).not.toContain("open-plot-workbench");
        expect(header).not.toContain("open-rag-inspector");
        expect(header).not.toContain("ide.header.plotWorkbench");
        expect(header).not.toContain("ide.header.ragInspector");
        expect(welcome).not.toContain("open-plot-workbench");
        expect(welcome).not.toContain("open-rag-inspector");
        expect(welcome).not.toContain("id: \"simulation\"");
        expect(welcome).not.toContain("open-path\", \"simulation/");
    });

    it("Agent 新建菜单隐藏 RP 与 simulator profile，但保留历史显示映射", async () => {
        const agentSurface = await readFile(agentSurfacePath, "utf-8");

        expect(agentSurface).toContain("hiddenWritingModeProfileKeys");
        expect(agentSurface).not.toContain("{profileKey: \"rp.leader\"");
        expect(agentSurface).not.toContain("{profileKey: \"simulator.leader\"");
        expect(agentSurface).toContain("case \"rp.leader\": return t(\"agent.profiles.rpLeader\")");
        expect(agentSurface).toContain("case \"simulator.leader\": return t(\"agent.profiles.simulatorLeader\")");
    });
});
