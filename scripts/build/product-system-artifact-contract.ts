import {resolve} from "node:path";
import {
    readProfileArtifactManifest,
    validateProfileArtifact,
    type ProfileArtifactValidation,
} from "nbook/server/agent/profiles/profile-artifact-compiler";
import {
    readVariableDefinitionManifest,
    validateVariableDefinitionArtifact,
    type VariableDefinitionValidation,
} from "nbook/server/agent/variables/definition-artifact";

/**
 * 验证最终 `.output` 内置 artifact 完全依赖 Product runtime 自身。
 *
 * 该门禁只读，不重编、不修复；任何根 `node_modules` 或 Source checkout 依赖都会
 * 让 Product archive 在生成前失败。
 */
export async function assertProductSystemArtifactContract(applicationRoot = process.cwd()): Promise<void> {
    const root = resolve(applicationRoot);
    const agentRoot = resolve(root, ".output", "server", "assets", "workspace", ".nbook", "agent");
    const previousProductBuild = process.env.NEURO_BOOK_PRODUCT_BUILD;
    process.env.NEURO_BOOK_PRODUCT_BUILD = "1";
    try {
        const profileRoot = resolve(agentRoot, "profiles");
        const profileManifest = await readProfileArtifactManifest(profileRoot);
        if (profileManifest.profiles.length === 0) {
            throw new Error("Product system profile manifest 为空。请重新执行完整 Product build。");
        }
        if (profileManifest.profilesRoot !== "assets/workspace/.nbook/agent/profiles") {
            throw new Error(`Product system profile manifest root错误：${profileManifest.profilesRoot}`);
        }
        for (const profile of profileManifest.profiles) {
            assertProductDependencies(profile.fileName, profile.dependencies);
            const validation = await validateProfileArtifact(profileRoot, profile, {requireTypeArtifact: true});
            if (!validation.fresh) {
                throw new Error(`Product system profile artifact 无效：${profile.fileName}（${validationDetail(validation)}）`);
            }
        }

        const variableRoot = resolve(agentRoot, "variables");
        const variableManifest = await readVariableDefinitionManifest(variableRoot);
        if (variableManifest.definitions.length === 0) {
            throw new Error("Product system variable definition manifest 为空。请重新执行完整 Product build。");
        }
        if (variableManifest.definitionsRoot !== "assets/workspace/.nbook/agent/variables") {
            throw new Error(`Product system variable definition manifest root错误：${variableManifest.definitionsRoot}`);
        }
        for (const definition of variableManifest.definitions) {
            assertProductDependencies(definition.fileName, definition.dependencies);
            const validation = await validateVariableDefinitionArtifact(variableRoot, definition, {requireTypeArtifact: true});
            if (!validation.fresh) {
                throw new Error(`Product system variable definition artifact 无效：${definition.fileName}（${validationDetail(validation)}）`);
            }
        }
    } finally {
        if (previousProductBuild === undefined) {
            delete process.env.NEURO_BOOK_PRODUCT_BUILD;
        } else {
            process.env.NEURO_BOOK_PRODUCT_BUILD = previousProductBuild;
        }
    }
}

/** Product artifact 不得依赖 Source archive 或安装根 node_modules。 */
function assertProductDependencies(label: string, dependencies: Array<{path: string}>): void {
    const offender = dependencies.find((dependency) => !dependency.path.startsWith(".output/server/"));
    if (offender) {
        throw new Error(`Product system artifact 依赖越过 .output/server：${label} -> ${offender.path}`);
    }
}

/** 把 freshness 结果转换为可直接定位的错误细节。 */
function validationDetail(validation: ProfileArtifactValidation | VariableDefinitionValidation): string {
    if (validation.dependency) {
        return `${validation.reason}: ${validation.dependency.path}`;
    }
    return validation.reason ?? "unknown";
}

if (import.meta.main) {
    await assertProductSystemArtifactContract();
    console.log("Product system artifact contract passed");
}
