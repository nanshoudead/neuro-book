import {mkdir} from "node:fs/promises";
import {join, resolve} from "node:path";

import {readInstallationManifest} from "nbook/packages/neuro-book-manager/src/manifest-store";
import {createOperation, pathCreateEffect, setOperationEffect} from "nbook/packages/neuro-book-manager/src/operation";

/** 为公开GHCR门禁创建可恢复的planned journal，验证Manager真实恢复路径。 */
const rootArgument = process.argv[2]?.trim();
if (!rootArgument) throw new Error("需要Installation Root。" );
const root = resolve(rootArgument);
const manifest = await readInstallationManifest(join(root, ".deploy", "installation.json"));
if (!manifest) throw new Error("缺少Installation Manifest。" );
const marker = join(root, ".deploy", "staging", "release-recovery-marker");
let journal = await createOperation({
    id: "release-recovery",
    action: "update",
    root,
    containerEngine: manifest.containerEngine,
    effects: [pathCreateEffect(".deploy/staging/release-recovery-marker")],
    backupRoot: join(root, ".deploy", "backups", "release-recovery"),
    previousManifest: manifest,
    nextManifest: null,
});
await mkdir(marker, {recursive: true});
journal = await setOperationEffect(journal, pathCreateEffect(".deploy/staging/release-recovery-marker", "applied"));
