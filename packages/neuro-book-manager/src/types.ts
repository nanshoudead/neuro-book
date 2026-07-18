import type {StateRootIntegrityResult} from "nbook/server/runtime/state-root-integrity";

/** NeuroBook Manager 支持的安装 Profile。 */
export type InstallProfile =
    | "source-dev"
    | "source-product"
    | "product-bun"
    | "windows-portable"
    | "source-docker"
    | "ghcr";

/** Release channel。canary 表示全部受支持 prerelease。 */
export type ReleaseChannel = "stable" | "canary";

/** 受管容器部署使用的宿主引擎。 */
export type ContainerEngine = "docker" | "podman";

/** 用户级 Manager 配置中的安装偏好。 */
export type ManagerPreferences = {
    channel: ReleaseChannel;
    installDirectory: string;
    discoveryRoots?: string[];
};

export type CommandInspection = {available: boolean; version?: string};
export type InspectionIssue = {code: string; message: string; remediation?: string};
export type CandidateKind = "managed-installation" | "neuro-book-checkout" | "portable-state" | "invalid-installation" | "unrelated";
export type GitInspection = {repository: string; branch: string; upstream?: string; revision: string; dirty: boolean};
export type ProductInspection = {exists: boolean; trusted: boolean; revision?: string};
export type StateInspection = {root: StateRootPath; configExists: boolean; workspaceExists: boolean; databaseExists: boolean};

/** 目录身份和离线完整性检查；不包含运行状态。 */
export type OfflineInspection = {
    root: string;
    kind: CandidateKind;
    manifest?: InstallationManifest;
    git?: GitInspection;
    product: ProductInspection;
    state: StateInspection;
    blockers: InspectionIssue[];
    warnings: InspectionIssue[];
};

export type EnvironmentInspection = {
    bun: CommandInspection;
    git: CommandInspection;
    containerEngine: ContainerEngine | null;
    container: CommandInspection;
    compose: CommandInspection;
};
export type InstanceDiscovery = {candidates: OfflineInspection[]; warnings: InspectionIssue[]};
export type ImportInspection = OfflineInspection & {importable: boolean};

export type InstallationCheckStatus = "pass" | "warn" | "fail";
export type InstallationCheckCategory = "manifest" | "manager" | "runtime" | "tool" | "source" | "product" | "state" | "service" | "operation";

/** doctor与离线导入共用的稳定检查项。 */
export type InstallationCheck = {
    id: string;
    category: InstallationCheckCategory;
    status: InstallationCheckStatus;
    message: string;
    /** 仅在用户可采取明确修复动作时存在。 */
    remediation?: string;
};

/** 当前实例服务状态；停止是合法状态，degraded/unavailable表示需要处理。 */
export type InstallationServiceStatus = {
    kind: "native" | "container";
    status: "running" | "stopped" | "degraded" | "unavailable";
    port: number;
    expectedVersion: string;
    /** 成功访问版本接口时存在。 */
    observedVersion?: string;
    /** Docker Profile中由Manifest决定。 */
    expectedImage?: string;
    /** Docker Compose可解析时存在。 */
    configuredImage?: string;
    /** 已创建容器可inspect时存在。 */
    actualImage?: string;
    /** 已创建容器存在时记录。 */
    containerId?: string;
    message: string;
};

/** status的轻量、稳定JSON合同。 */
export type InstallationStatus = {
    root: string;
    profile: InstallProfile;
    containerEngine: ContainerEngine | null;
    managerVersion: string;
    executingManagerVersion: string;
    appVersion: string;
    channel: ReleaseChannel;
    sourceRevision: string;
    stateRoot: string;
    port: number;
    productReady: boolean;
    service: InstallationServiceStatus;
    unfinishedOperations: string[];
    stateIntegrity: StateRootIntegrityResult;
    nextActions: string[];
    components: InstallationComponents;
};

/** doctor的完整、稳定JSON合同。 */
export type DoctorReport = {
    healthy: boolean;
    containerEngine: ContainerEngine | null;
    checks: InstallationCheck[];
    paths: {
        root: string;
        stateRoot: string;
        workspace: string;
        bootConfig: string;
        stateIntegrity: StateRootIntegrityResult;
    };
    service: InstallationServiceStatus & {
        commands: {
            bun: CommandInspection;
            git: CommandInspection;
            rg: CommandInspection;
            container: CommandInspection;
            compose: CommandInspection;
        };
    };
    components: InstallationComponents;
    operations: string[];
    python: {python3: CommandInspection; python: CommandInspection; note: string};
};

/** 用户注册的 NeuroBook 实例索引；实例自身状态仍以 installation.json 为准。 */
export type ManagerInstance = {
    id: string;
    name: string;
    root: string;
    registeredAt: string;
    lastUsedAt: string;
};

/** 位于用户主目录的 Manager 配置。 */
export type ManagerConfig = {
    schemaVersion: 1;
    defaultInstanceId: string | null;
    preferences: ManagerPreferences;
    instances: ManagerInstance[];
};

/** 当前支持的Product平台唯一枚举。 */
export const PRODUCT_PLATFORMS = [
    "windows-x64",
    "linux-x64-glibc",
    "linux-aarch64-glibc",
    "darwin-x64",
    "darwin-aarch64",
] as const;

/** 当前支持的 Product 平台。 */
export type ProductPlatform = typeof PRODUCT_PLATFORMS[number];

/** 安装根允许的 State Root 映射。 */
export type StateRootPath = "." | "data";

/** 托管下载资产必须保存的审计信息。 */
export type ManagedAssetMetadata = {
    archiveSha256: string;
    sourceUrl: string;
    license: string;
    redistribution: string;
};

export type SourceComponent =
    | {
        provider: "git";
        version: string;
        revision: string;
        path: ".";
        repository: string;
        branch: string;
    }
    | ({
        provider: "release";
        version: string;
        revision: string;
        path: ".";
        files: string[];
    } & ManagedAssetMetadata)
    | {
        provider: "container";
        version: string;
        revision: string;
        path: "/app";
    };

export type ProductComponent =
    | {
        provider: "git";
        version: string;
        revision: string;
        path: ".output";
        platform: ProductPlatform;
    }
    | ({
        provider: "release";
        version: string;
        revision: string;
        path: ".output";
        platform: ProductPlatform;
    } & ManagedAssetMetadata)
    | {
        provider: "container";
        version: string;
        revision: string;
        image: string;
        /** GHCR 必填；Source Docker 的本地 revision image 不设置。 */
        digest?: string;
    };

export type ManagerComponent = {
    provider: "managed";
    version: string;
    path: string;
    bundleSha256: string;
};

export type SystemRuntimeComponent = {
    provider: "system";
    version: string;
    executable: string;
};

export type ManagedRuntimeComponent = {
    provider: "managed";
    version: string;
    path: string;
    executableSha256: string;
} & ManagedAssetMetadata;

export type ManagerRuntimeComponent = SystemRuntimeComponent | ManagedRuntimeComponent;

export type ApplicationRuntimeComponent = ManagerRuntimeComponent | {
    provider: "container";
    version: string;
};

export type SystemToolComponent = {
    provider: "system";
    version: string;
    executable: string;
};

export type ManagedToolComponent = {
    provider: "managed";
    version: string;
    path: string;
    executableSha256: string;
} & ManagedAssetMetadata;

export type ManagedGitToolComponent = Omit<ManagedToolComponent, "executableSha256"> & {
    distribution: "PortableGit";
    bashPath: string;
    gitSha256: string;
    bashSha256: string;
};

export type ContainerToolComponent = {
    provider: "container";
    version: string;
};

export type ToolComponents = {
    rg?: SystemToolComponent | ManagedToolComponent | ContainerToolComponent;
    git?: SystemToolComponent | ManagedGitToolComponent | ContainerToolComponent;
    python?: SystemToolComponent | ContainerToolComponent;
};

export type InstallationComponents = {
    source: SourceComponent;
    product?: ProductComponent;
    manager: ManagerComponent;
    managerRuntime: ManagerRuntimeComponent;
    applicationRuntime: ApplicationRuntimeComponent;
    tools: ToolComponents;
};

/** 本机安装状态真相源。 */
export type InstallationManifest = {
    schemaVersion: 4;
    profile: InstallProfile;
    /** Container Profile记录实际引擎；原生Profile固定为null。 */
    containerEngine: ContainerEngine | null;
    managerVersion: string;
    appVersion: string;
    channel: ReleaseChannel;
    sourceRevision: string;
    stateRoot: StateRootPath;
    components: InstallationComponents;
    installedAt: string;
    updatedAt: string;
};

/** Release 中的可下载资产。 */
export type ReleaseAsset = {
    url: string;
    sha256: string;
    bytes: number;
};

/** 平台 Product 资产。 */
export type ProductReleaseAsset = ReleaseAsset & {
    platform: ProductPlatform;
    sourceRevision: string;
};

/** GHCR 镜像信息。 */
export type ReleaseImage = {
    ref: string;
    digest: string;
    sourceRevision: string;
};

/** GitHub Release 附带的统一组件清单。 */
export type ReleaseManifest = {
    schemaVersion: 3;
    version: string;
    channel: ReleaseChannel;
    sourceRevision: string;
    minManagerVersion: string;
    source: ReleaseAsset;
    products: ProductReleaseAsset[];
    windowsPortable: ReleaseAsset;
    ghcr: ReleaseImage;
};

/** Profile 对组件来源的声明。 */
export type ProfileDefinition = {
    profile: InstallProfile;
    source: SourceComponent["provider"];
    product: "none" | "build" | ProductComponent["provider"];
    applicationRuntime: ApplicationRuntimeComponent["provider"];
    tools: "system" | "managed" | "container";
    docker: boolean;
};

/** Manager 操作计划，dry-run 与执行共用。 */
export type OperationPlan = {
    action: "install" | "update" | "start";
    root: string;
    profile: InstallProfile;
    steps: string[];
};

export type OperationPhase = "planned" | "staged" | "validated" | "switched" | "migrated" | "healthy" | "committed";

export type OperationJournal = {
    schemaVersion: 2;
    id: string;
    action: "install" | "update";
    phase: OperationPhase;
    root: string;
    /** 本次事务固定使用的容器引擎；非容器事务为null。 */
    containerEngine: ContainerEngine | null;
    createdPaths: string[];
    backupRoot: string;
    previousManifest: InstallationManifest | null;
    nextManifest: InstallationManifest | null;
    git?: {
        previousRevision: string;
        targetRevision: string;
        /** Source Dev主checkout frozen install完成后为true。 */
        dependenciesInstalled?: boolean;
    };
    database?: {
        configuredUrl: string;
        path: string;
        backup: string;
        checkpoint: {busy: number; log: number; checkpointed: number};
    };
    /** Source Dev迁移使用的目标revision staged root；默认使用Installation Root。 */
    migrationRoot?: string;
    /** Product数据格式迁移必须先于Product/Compose回滚恢复。 */
    attachmentMigration?: {
        runId: string;
        state: "planned" | "applied" | "rolled_back";
        migratedSessions: number;
        sessions: Array<{
            sessionId: number | null;
            sourcePath: string;
            sourceHash: string;
            targetHash: string;
            /** apply完成后由migration报告提供；planned阶段为空。 */
            backupPath?: string;
        }>;
    };
    docker?: {
        previousState: "running" | "stopped" | "missing";
        stopped: boolean;
        previousCompose?: string;
        composeChanged: boolean;
        composeCreated: boolean;
        previousImage?: string;
        targetImage?: string;
        imageCreated?: string;
        cleanupError?: string;
    };
    manager?: {
        wrapperBackup?: string;
        wrappersChanged: boolean;
    };
    outcome?: "success" | "rolled-back";
    createdAt: string;
    updatedAt: string;
};
