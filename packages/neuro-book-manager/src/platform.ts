import type {InstallProfile, ProductPlatform} from "#manager/types";

/** Product平台到公开Release资产名的穷举映射。 */
export const PRODUCT_ASSET_NAMES = {
    "windows-x64": "neuro-book-product-windows-x64.zip",
    "linux-x64-glibc": "neuro-book-product-linux-x64-glibc.tar.gz",
    "linux-aarch64-glibc": "neuro-book-product-linux-aarch64-glibc.tar.gz",
    "darwin-x64": "neuro-book-product-darwin-x64.tar.gz",
    "darwin-aarch64": "neuro-book-product-darwin-aarch64.tar.gz",
} as const satisfies Record<ProductPlatform, string>;

const ALL_PROFILES = [
    "source-dev",
    "source-product",
    "product-bun",
    "windows-portable",
    "source-docker",
    "ghcr",
] as const satisfies readonly InstallProfile[];

const POSIX_PROFILES = ALL_PROFILES.filter((profile) => profile !== "windows-portable");

const PLATFORM_PROFILES = {
    "windows-x64": ALL_PROFILES,
    "linux-x64-glibc": POSIX_PROFILES,
    "linux-aarch64-glibc": POSIX_PROFILES,
    "darwin-x64": POSIX_PROFILES,
    "darwin-aarch64": POSIX_PROFILES,
} as const satisfies Record<ProductPlatform, readonly InstallProfile[]>;

export type PlatformRuntime = {
    platform: NodeJS.Platform;
    arch: NodeJS.Architecture;
    /** Linux检测到glibc时非空；其他宿主不使用。 */
    glibcVersion?: string;
};

/** 解析宿主Product平台；不支持的平台和libc直接拒绝。 */
export function productPlatform(runtime: PlatformRuntime): ProductPlatform {
    if (runtime.platform === "win32") {
        if (runtime.arch !== "x64") throw new Error(`Windows只支持x64，检测到：${runtime.arch}`);
        return "windows-x64";
    }
    if (runtime.platform === "linux") {
        if (!runtime.glibcVersion) throw new Error("Manager只支持Linux glibc。");
        if (runtime.arch === "x64") return "linux-x64-glibc";
        if (runtime.arch === "arm64") return "linux-aarch64-glibc";
        throw new Error(`Linux只支持x64/ARM64，检测到：${runtime.arch}`);
    }
    if (runtime.platform === "darwin") {
        if (runtime.arch === "x64") return "darwin-x64";
        if (runtime.arch === "arm64") return "darwin-aarch64";
        throw new Error(`macOS只支持x64/ARM64，检测到：${runtime.arch}`);
    }
    throw new Error(`Manager只支持Windows/Linux/macOS，检测到：${runtime.platform}`);
}

/** 返回当前宿主的Product平台。 */
export function currentProductPlatform(): ProductPlatform {
    const report = process.platform === "linux"
        ? process.report?.getReport() as {header?: {glibcVersionRuntime?: string}} | undefined
        : undefined;
    return productPlatform({
        platform: process.platform,
        arch: process.arch,
        glibcVersion: report?.header?.glibcVersionRuntime,
    });
}

/** 校验Manager宿主平台。 */
export function assertManagerPlatform(): void {
    currentProductPlatform();
}

/** 返回指定平台正式支持的Profile。 */
export function supportedProfiles(platform = currentProductPlatform()): readonly InstallProfile[] {
    return PLATFORM_PROFILES[platform];
}

/** 校验当前平台是否支持指定Profile。 */
export function assertProfileSupported(profile: InstallProfile): void {
    const platform = currentProductPlatform();
    if (!supportedProfiles(platform).includes(profile)) {
        throw new Error(`${platform}不支持${profile} Profile。`);
    }
}

/** 返回平台可执行文件后缀。 */
export function executableName(name: string): string {
    return process.platform === "win32" ? `${name}.exe` : name;
}
