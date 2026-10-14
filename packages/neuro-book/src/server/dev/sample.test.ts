/**
 * 开发模式的样例作品（w00022 t18）：真实临时目录与真实登记表上的首次新建、沿用、修复与重建、拒绝写入的情形、取消后不再写，
 * 以及与其它登记并发；再用真实后端子进程确认放样例不拖住就绪、卡住时按截止报告、停止不被它拖住。
 */

import {afterAll, afterEach, beforeAll, describe, expect, it} from "bun:test";
import {mkdir, readdir, readFile, realpath, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {PROJECT_IDENTITY_FILE, readProjectIdentity} from "../projects/identity";
import {createProjectRegistry, PROJECT_REGISTRY_FILE} from "../projects/registry";
import type {ProjectRegistry} from "../projects/registry";
import {DEV_SAMPLE_DIRECTORY, DEV_SAMPLE_PARENT, seedDevSample} from "./sample";
import type {DevSampleResult} from "./sample";

const SERVER_FIXTURE = join(import.meta.dir, "..", "testing", "fixture-entry.ts");
const FIRST_CHAPTER = join("正文", "第一章 雾港.md");

let tmp = "";
let counter = 0;

beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-dev", "dev-sample");
});

afterAll(async () => {
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

interface Workspace {
    /** 扮演包目录：样例放在它下面的 `.dev-sample/`。 */
    readonly packageRoot: string;
    readonly stateRoot: string;
    readonly registry: ProjectRegistry;
    readonly sampleDir: string;
    seed(signal?: AbortSignal): Promise<DevSampleResult>;
    registryText(): Promise<string | null>;
}

async function workspace(options: {readonly stateRoot?: (packageRoot: string) => string} = {}): Promise<Workspace> {
    counter += 1;
    const packageRoot = await realpath(await mkdirp(join(tmp, `case-${String(counter)}`, "package")));
    const stateRoot = options.stateRoot?.(packageRoot) ?? join(packageRoot, ".dev-state");
    const registry = createProjectRegistry({stateRoot, cwd: packageRoot});
    return {
        packageRoot,
        stateRoot,
        registry,
        sampleDir: join(packageRoot, DEV_SAMPLE_PARENT, DEV_SAMPLE_DIRECTORY),
        seed: (signal = new AbortController().signal) => seedDevSample(registry, {stateRoot, packageRoot, signal}),
        registryText: () => readFile(join(stateRoot, PROJECT_REGISTRY_FILE), "utf8").catch((error: unknown) => {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
            throw error;
        }),
    };
}

async function mkdirp(path: string): Promise<string> {
    await mkdir(path, {recursive: true});
    return path;
}

function succeeded(result: DevSampleResult): Extract<DevSampleResult, {ok: true}> {
    if (!result.ok) throw new Error(`期望放好样例，得到：${result.reason}`);
    return result;
}

async function exists(path: string): Promise<boolean> {
    try {
        await readdir(path);
        return true;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
        throw error;
    }
}

async function identityId(path: string): Promise<string | null> {
    const identity = await readProjectIdentity(path);
    return identity.status === "found" ? identity.id : null;
}

describe("放样例作品", () => {
    it("首次：新建 .dev-sample/sample、登记为 sample，复制样例内容，打开路径是 /?project=sample", async () => {
        const w = await workspace();
        const result = succeeded(await w.seed());
        expect(result.openPath).toBe("/?project=sample");
        expect(result.project).toMatchObject({name: "sample", path: w.sampleDir});
        const listed = await w.registry.list();
        expect(listed.ok && listed.value).toEqual([result.project]);
        expect(await identityId(w.sampleDir)).toBe(result.project.id);
        expect(await readFile(join(w.sampleDir, FIRST_CHAPTER), "utf8")).toContain("雾港");
        expect((await readdir(join(w.sampleDir, "正文"))).length).toBe(3);
    });

    it("再次：沿用同一部作品，不改登记表；用户改过的文件不覆盖，删掉的样例文件补回来", async () => {
        const w = await workspace();
        const first = succeeded(await w.seed());
        const registryBefore = await w.registryText();
        await writeFile(join(w.sampleDir, FIRST_CHAPTER), "我改过的第一章\n");
        await rm(join(w.sampleDir, "大纲.md"));
        const second = succeeded(await w.seed());
        expect(second.project).toEqual(first.project);
        expect(await w.registryText()).toBe(registryBefore);
        expect(await readFile(join(w.sampleDir, FIRST_CHAPTER), "utf8")).toBe("我改过的第一章\n");
        expect(await readFile(join(w.sampleDir, "大纲.md"), "utf8")).toContain("大纲");
    });

    it("身份文件缺失：按登记表里的 id 修复，仍是同一部作品", async () => {
        const w = await workspace();
        const first = succeeded(await w.seed());
        await rm(join(w.sampleDir, PROJECT_IDENTITY_FILE));
        const second = succeeded(await w.seed());
        expect(second.project).toEqual(first.project);
        expect(await identityId(w.sampleDir)).toBe(first.project.id);
    });

    it("目录被删：按原 id 重建目录与身份文件，内容复制回来，登记表不多出一项", async () => {
        const w = await workspace();
        const first = succeeded(await w.seed());
        await rm(join(w.packageRoot, DEV_SAMPLE_PARENT), {recursive: true});
        const second = succeeded(await w.seed());
        expect(second.project).toEqual(first.project);
        expect(await identityId(w.sampleDir)).toBe(first.project.id);
        expect(await readFile(join(w.sampleDir, FIRST_CHAPTER), "utf8")).toContain("雾港");
        const listed = await w.registry.list();
        expect(listed.ok && listed.value.length).toBe(1);
    });

    it("目录还在、登记表丢了（换了状态根）：接回原来的目录，沿用它的 id", async () => {
        const w = await workspace();
        const first = succeeded(await w.seed());
        await rm(w.stateRoot, {recursive: true});
        const second = succeeded(await w.seed());
        expect(second.project.id).toBe(first.project.id);
        expect(second.project.path).toBe(w.sampleDir);
    });

    for (const [label, stateRoot] of [["包目录本身", (root: string) => root], [".dev-sample", (root: string) => join(root, DEV_SAMPLE_PARENT)]] as const) {
        it(`状态根设为${label}：报失败，不建样例目录、不写登记表`, async () => {
            const w = await workspace({stateRoot});
            const result = await w.seed();
            expect(result.ok).toBe(false);
            expect(await exists(w.sampleDir)).toBe(false);
            expect(await w.registryText()).toBeNull();
        });
    }

    it("登记表损坏：报失败，登记表原样不动，也不建样例目录", async () => {
        const w = await workspace();
        await mkdir(w.stateRoot, {recursive: true});
        await writeFile(join(w.stateRoot, PROJECT_REGISTRY_FILE), "{坏掉的");
        const result = await w.seed();
        expect(result.ok).toBe(false);
        expect(await w.registryText()).toBe("{坏掉的");
        expect(await exists(w.sampleDir)).toBe(false);
    });

    it("身份文件损坏或 id 对不上：报失败，不覆盖身份文件", async () => {
        const w = await workspace();
        succeeded(await w.seed());
        const file = join(w.sampleDir, PROJECT_IDENTITY_FILE);
        for (const text of ["不是 JSON", `${JSON.stringify({schema: 1, id: crypto.randomUUID()})}\n`]) {
            await writeFile(file, text);
            expect((await w.seed()).ok).toBe(false);
            expect(await readFile(file, "utf8")).toBe(text);
        }
    });

    it("短名 sample 已是用户的另一部作品：不动它，样例另取短名，打开路径随登记表给的短名", async () => {
        const w = await workspace();
        const own = await mkdirp(join(w.packageRoot, "books", "sample"));
        const registered = await w.registry.register(own);
        expect(registered.ok && registered.project.name).toBe("sample");
        const result = succeeded(await w.seed());
        expect(result.project.name).toBe("sample-2");
        expect(result.openPath).toBe("/?project=sample-2");
        expect(await readdir(own)).toEqual([".nbook"]);
    });

    it("取消之后不再写：一开始就取消什么都不建；登记完成时取消就不复制内容", async () => {
        const w = await workspace();
        const aborted = new AbortController();
        aborted.abort();
        expect((await w.seed(aborted.signal)).ok).toBe(false);
        expect(await exists(join(w.packageRoot, DEV_SAMPLE_PARENT))).toBe(false);
        expect(await w.registryText()).toBeNull();

        // 登记表本身是真的；在 create 完成的那一刻取消，模拟截止恰好落在登记之后。
        const later = new AbortController();
        const registry: ProjectRegistry = {
            ...w.registry,
            create: async (input) => {
                const created = await w.registry.create(input);
                later.abort();
                return created;
            },
        };
        const result = await seedDevSample(registry, {stateRoot: w.stateRoot, packageRoot: w.packageRoot, signal: later.signal});
        expect(result.ok).toBe(false);
        expect(await readdir(w.sampleDir)).toEqual([".nbook"]);
    });

    it("与其它登记先后、并发：都经同一个登记表实例，两项都保留", async () => {
        const w = await workspace();
        const before = await mkdirp(join(w.packageRoot, "books", "before"));
        const during = await mkdirp(join(w.packageRoot, "books", "during"));
        expect((await w.registry.register(before)).ok).toBe(true);
        const [seeded, registered] = await Promise.all([w.seed(), w.registry.register(during)]);
        succeeded(seeded);
        expect(registered.ok).toBe(true);
        const listed = await w.registry.list();
        expect(listed.ok && listed.value.map((project) => project.name).sort()).toEqual(["before", "during", "sample"]);
    });
});

describe("后端进程里放样例（真实子进程）", () => {
    const children = new Set<{readonly exited: Promise<number | null>; kill(): void}>();

    afterEach(async () => {
        for (const child of children) {
            child.kill();
            await child.exited;
        }
        children.clear();
    });

    async function spawnServer(packageRoot: string, stateRoot: string, env: Record<string, string> = {}) {
        const child = Bun.spawn(["bun", SERVER_FIXTURE, "--stop-stdin"], {
            env: {...process.env, NBOOK_STATE_ROOT: stateRoot, NBOOK_PORT: "0", NBOOK_RPC_PORT: "0", NBOOK_TEST_PLUGINS: "", NBDEV_SAMPLE: "1", NBOOK_TEST_SAMPLE_ROOT: packageRoot, ...env},
            stdin: "pipe",
            stdout: "pipe",
            stderr: "pipe",
        });
        const exited = child.exited.then(() => child.exitCode);
        children.add({exited, kill: () => child.kill("SIGKILL")});
        let output = "";
        for (const stream of [child.stdout, child.stderr]) {
            void (async () => {
                for await (const chunk of stream.pipeThrough(new TextDecoderStream())) output += chunk;
            })();
        }
        const waitFor = (pattern: RegExp) => waitUntil(`后端输出 ${String(pattern)}`, () => pattern.exec(output), {timeoutMs: 15_000});
        return {
            waitFor,
            output: () => output,
            exited,
            stop: () => {
                child.stdin.write("stop\n");
                child.stdin.flush();
            },
        };
    }

    it("就绪之后报告 open-path，打开路径指向登记好的样例", async () => {
        const w = await workspace();
        const server = await spawnServer(w.packageRoot, w.stateRoot);
        const url = (await server.waitFor(/^Listening on (\S+)/mu))[1] as string;
        expect((await fetch(new URL("/api/runtime/health", url))).status).toBe(200);
        expect((await server.waitFor(/^\[dev\] open-path (\S+)$/mu))[1]).toBe("/?project=sample");
        const listed = await w.registry.list();
        expect(listed.ok && listed.value.map((project) => project.path)).toEqual([w.sampleDir]);
        server.stop();
        expect(await server.exited).toBe(0);
    }, 30_000);

    it("样例卡住时 health 照样 200，到截止报 sample-failed；停止不被卡住的任务拖住，以 0 退出", async () => {
        const w = await workspace();
        await mkdir(w.stateRoot, {recursive: true});
        // 登记表是一个没有写端的 FIFO：读它会一直挂着，样例的第一步就卡住。
        expect(Bun.spawnSync(["mkfifo", join(w.stateRoot, PROJECT_REGISTRY_FILE)]).exitCode).toBe(0);
        const server = await spawnServer(w.packageRoot, w.stateRoot, {NBOOK_TEST_SAMPLE_TIMEOUT_MS: "300", NBOOK_TEST_SAMPLE_STOP_MS: "200"});
        const url = (await server.waitFor(/^Listening on (\S+)/mu))[1] as string;
        expect((await fetch(new URL("/api/runtime/health", url))).status).toBe(200);
        await server.waitFor(/^\[dev\] sample-failed 超时/mu);
        expect(server.output()).not.toContain("[dev] open-path");
        server.stop();
        expect(await server.exited).toBe(0);
        await server.waitFor(/sample-abandoned/u);
    }, 30_000);
});
