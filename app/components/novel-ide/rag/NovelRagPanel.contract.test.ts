import {readFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import {describe, expect, it} from "vitest";
import {isNovelIdeTab, NOVEL_IDE_TABS} from "nbook/app/components/novel-ide/mock-data";

const ragPanelPath = fileURLToPath(new URL("./NovelRagPanel.vue", import.meta.url));
const ragInspectorPath = fileURLToPath(new URL("./NovelRagInspectorDialog.vue", import.meta.url));
const ragInspectorSidebarPath = fileURLToPath(new URL("./NovelRagInspectorSidebar.vue", import.meta.url));
const ragInspectorMainPath = fileURLToPath(new URL("./NovelRagInspectorMain.vue", import.meta.url));
const ragInspectorDetailPath = fileURLToPath(new URL("./NovelRagInspectorDetail.vue", import.meta.url));
const sidebarPath = fileURLToPath(new URL("../NovelIdeSidebar.vue", import.meta.url));
const toolPanelPath = fileURLToPath(new URL("../NovelIdeToolPanel.vue", import.meta.url));
const headerPath = fileURLToPath(new URL("../NovelIdeHeader.vue", import.meta.url));
const indexPagePath = fileURLToPath(new URL("../../../pages/index.vue", import.meta.url));

describe("NovelRagPanel contract", () => {
    it("注册 RAG tab 并在 user-assets 模式隐藏入口", async () => {
        expect(NOVEL_IDE_TABS).toContain("rag");
        expect(isNovelIdeTab("rag")).toBe(true);

        const sidebar = await readFile(sidebarPath, "utf-8");
        const toolPanel = await readFile(toolPanelPath, "utf-8");
        expect(sidebar).toContain("value: \"rag\"");
        expect(sidebar).toContain("label: \"RAG\"");
        expect(sidebar).toContain("props.userAssetsMode ? items.filter((item) => item.value === \"files\") : items");
        expect(toolPanel).toContain("NovelRagPanel");
        expect(toolPanel).toContain("activeTab === 'rag' && !props.userAssetsMode");
    });

    it("保留基础空状态和真实 RAG API 入口", async () => {
        const panel = await readFile(ragPanelPath, "utf-8");
        expect(panel).toContain("当前没有 Project Workspace。");
        expect(panel).toContain("当前 Project 暂无 subject RAG 数据。");
        expect(panel).toContain("/api/projects/rag/overview");
        expect(panel).toContain("/api/projects/rag/subject");
        expect(panel).toContain("/api/projects/rag/search");
        expect(panel).toContain("/api/projects/rag/rebuild");
        expect(panel).toContain("/api/projects/rag/events");
        expect(panel).toContain("/api/projects/rag/memories");
        expect(panel).not.toContain("打开源文件");
        expect(panel).not.toContain("Embedding 设置");
    });

    it("加载失败时清空旧数据，并在重建跳过时展示失败原因", async () => {
        const panel = await readFile(ragPanelPath, "utf-8");
        expect(panel).toContain("overview.value = null;");
        expect(panel).toContain("selectedSubjectPath.value = \"\";");
        expect(panel).toContain("subjectDetail.value = null;");
        expect(panel).toContain("searchResult.value = null;");
        expect(panel).toContain("formatRebuildWarning(result)");
        expect(panel).toContain("const failures = result.results.filter((item) => !item.ok);");
        expect(panel).toContain("失败原因：");
    });

    it("注册 Header RAG Inspector 入口和独立 dialog", async () => {
        const header = await readFile(headerPath, "utf-8");
        const indexPage = await readFile(indexPagePath, "utf-8");
        const inspector = await readFile(ragInspectorPath, "utf-8");
        const inspectorSidebar = await readFile(ragInspectorSidebarPath, "utf-8");
        const inspectorMain = await readFile(ragInspectorMainPath, "utf-8");
        const inspectorDetail = await readFile(ragInspectorDetailPath, "utf-8");

        expect(header).toContain("open-rag-inspector");
        expect(header).toContain("title=\"RAG Inspector\"");
        expect(header).toContain("i-lucide-brain-circuit");
        expect(indexPage).toContain("NovelRagInspectorDialog");
        expect(indexPage).toContain("ragInspectorOpen");
        expect(inspector).toContain("/api/projects/rag/inspector");
        expect(inspector).toContain("/api/projects/rag/debug");
        expect(inspector).toContain("size=\"workbench\"");
        expect(inspector).toContain("overlay-type=\"blur\"");
        expect(inspector).toContain("NovelRagInspectorSidebar");
        expect(inspector).toContain("NovelRagInspectorMain");
        expect(inspector).toContain("NovelRagInspectorDetail");
        expect(inspectorSidebar).toContain("Subject 列表");
        expect(inspectorMain).toContain("索引条目");
        expect(inspectorMain).toContain("召回测试");
        expect(inspectorDetail).toContain("向量预览");
        expect(inspectorDetail).toContain("chunkSourceCounts");
        expect(inspectorDetail).toContain("清空缓存");
        expect(inspectorDetail).toContain("标记待索引");
    });
});
