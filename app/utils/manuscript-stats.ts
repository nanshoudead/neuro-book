export type ManuscriptStatsNode = {
    entryType: string | null;
    words: number;
    path: string;
    isDirectory: boolean;
    contentNode: boolean;
    size: number;
};

export type ManuscriptStatsSnapshot = {
    currentWords: number;
    totalWords: number;
    totalSize: number;
    chapters: number;
    files: number;
};

/**
 * 统计 manuscript 节点子树，避免文件树中的目录节点和 index.md 文件节点重复计算同一正文。
 */
export function computeManuscriptStats(currentNode: ManuscriptStatsNode | null, workspaceTree: ManuscriptStatsNode[]): ManuscriptStatsSnapshot {
    if (!currentNode) {
        return emptyManuscriptStats();
    }

    const basePath = manuscriptBasePath(currentNode.path);
    if (!basePath) {
        return {
            currentWords: currentNode.words,
            totalWords: currentNode.words,
            totalSize: currentNode.size,
            chapters: 0,
            files: currentNode.isDirectory ? 0 : 1,
        };
    }

    const prefix = `${basePath}/`;
    const descendantFiles = workspaceTree.filter((node) => !node.isDirectory && node.path.startsWith(prefix));
    const contentIndexFiles = descendantFiles.filter((node) => node.contentNode && node.path.toLowerCase().endsWith("/index.md"));

    return {
        currentWords: currentNode.words,
        totalWords: contentIndexFiles.reduce((total, node) => total + node.words, 0),
        totalSize: descendantFiles.reduce((total, node) => total + node.size, 0),
        chapters: contentIndexFiles.filter((node) => node.entryType === "chapter").length,
        files: descendantFiles.length,
    };
}

function emptyManuscriptStats(): ManuscriptStatsSnapshot {
    return {
        currentWords: 0,
        totalWords: 0,
        totalSize: 0,
        chapters: 0,
        files: 0,
    };
}

function manuscriptBasePath(path: string): string {
    return path.toLowerCase().endsWith("/index.md")
        ? path.slice(0, -"/index.md".length)
        : path.replace(/\/$/, "");
}
