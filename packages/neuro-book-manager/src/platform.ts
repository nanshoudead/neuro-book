import type {InstallProfile, ProductPlatform} from "#manager/types";

/** 解析当前 Product 平台；支持 Windows x64 和 Linux x64/arm64 glibc。macOS 不提供 Product 资产。 */
export function currentProductPlatform(): ProductPlatform {
    assertManagerPlatform();
    if (process.platform === "win32") {
        return "windows-x64";
    }
    if (process.platform === "linux") {
        const report = process.report?.getReport() as {header?: {glibcVersionRuntime?: string}} | undefined;
        if (!report?.header?.glibcVersionRuntime) {
            throw new Error("Manager 只支持 Linux glibc，当前环境未检测到 glibc。");
        }
        return process.arch === "arm64" ? "linux-aarch64-glibc" : "linux-x64-glibc";
    }
    throw new Error(`Product 资产只支持 Windows/Linux，检测到：${process.platform}；macOS 请使用 Docker 或 Source Dev。`);
}

/** Manager 的统一宿主平台门禁；macOS 放行 Docker 与 Source Dev。 */
export function assertManagerPlatform(): void {
    if (process.arch !== "x64" && process.arch !== "arm64") {
        throw new Error(`Manager 只支持 x64/arm64，检测到：${process.arch}`);
    }
    if (process.platform === "win32" || process.platform === "darwin") return;
    if (process.platform === "linux") {
        const report = process.report?.getReport() as {header?: {glibcVersionRuntime?: string}} | undefined;
        if (!report?.header?.glibcVersionRuntime) throw new Error("Manager 只支持 Linux glibc。");
        return;
    }
    throw new Error(`Manager 只支持 Windows/Linux/macOS，检测到：${process.platform}`);
}

/** 当前平台暂不支持的 Profile；macOS 仅放行 Docker 与 Source Dev。 */
export function unsupportedProfiles(): InstallProfile[] {
    if (process.platform === "darwin") return ["source-product", "product-bun", "windows-portable"];
    return [];
}

/** 返回平台可执行文件后缀。 */
export function executableName(name: string): string {
    return process.platform === "win32" ? `${name}.exe` : name;
}
