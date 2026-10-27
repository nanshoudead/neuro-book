/**
 * 网页上的“导入记忆图文件”与“安装 Skill”（docs/specs/story/viewer.md 输出 54，t29）：真实的 `serve` 进程与 HTTP。
 * Skill 装进用例自己的 HOME，不碰真实的用户目录。
 */

import {afterAll, beforeAll, describe, expect, test} from "bun:test";
import {mkdir, readdir, readFile, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";
import {gzipSync} from "node:zlib";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {loginCookie, rpc, startServe, type ServeProcess} from "../../testing/processes";
import {makeSampleRoot, smallDataset} from "../../testing/sample";
import {base64Bytes} from "./ingest-service";

let root = "";
let serve: ServeProcess;
let cookie = "";
let home = "";
let library = "";

beforeAll(async () => {
    root = await createTestTmpRoot("nb-story", "serve-tools");
    const sample = await makeSampleRoot("serve-tools");
    library = sample.library;
    home = join(root, "home");
    await mkdir(home, {recursive: true});
    serve = await startServe(library, {HOME: home, USERPROFILE: home});
    cookie = await loginCookie(serve.login!);
});
afterAll(async () => {
    await serve?.stop();
    if (root !== "") await rm(root, {recursive: true, force: true});
});

const call = (method: string, params: unknown) => rpc(serve.base!, method, params, cookie);
const base64 = (data: string | Uint8Array) => Buffer.from(data).toString("base64");

describe("导入记忆图文件（book.importGraph）", () => {
    test("JSON 与 gzip 压缩的 JSON 都能导入；书名不给时取文件里的；同 id 已存在是 book_exists；不是 V9 记忆图是 unsupported_format", async () => {
        const text = JSON.stringify(await smallDataset(2, "网页导入的小书"));
        const plain = await call("book.importGraph", {content: base64(text), id: "web-plain"});
        expect(plain.status).toBe(200);
        expect(plain.body).toEqual({id: "web-plain"});
        const gz = await call("book.importGraph", {content: base64(gzipSync(text)), id: "web-gz", title: "压缩的"});
        expect(gz.body).toEqual({id: "web-gz"});
        const books = (await call("books.list", {})).body as {books: {id: string; title: string}[]};
        expect(books.books.find(book => book.id === "web-plain")?.title).toBe("网页导入的小书");
        expect(books.books.find(book => book.id === "web-gz")?.title).toBe("压缩的");

        const again = await call("book.importGraph", {content: base64(text), id: "web-plain"});
        expect(again.status).toBe(409);
        expect(again.body).toMatchObject({code: "book_exists"});
        const bad = await call("book.importGraph", {content: base64(JSON.stringify({not: "v9"})), id: "web-bad", title: "坏的"});
        expect(bad.status).toBe(415);
        expect(bad.body).toMatchObject({code: "unsupported_format"});
        // 不给书名时：不是 V9 记忆图（不是 JSON、没有 schema 与 book）报 unsupported_format，补了书名也导不进去；是 V9 但没书名才要用户补。
        for (const content of ["not json", "{}", "null"]) {
            const noTitle = await call("book.importGraph", {content: base64(content)});
            expect(noTitle.status).toBe(415);
            expect(noTitle.body).toMatchObject({code: "unsupported_format"});
        }
        const notBase64 = await call("book.importGraph", {content: "这不是 base64!", id: "web-x"});
        expect(notBase64.status).toBe(400);
        // 导入失败不留下半本书，也不留下临时文件。
        expect((await call("books.list", {})).body).not.toMatchObject({books: expect.arrayContaining([expect.objectContaining({id: "web-bad"})])});
    });
});

describe("安装 Skill（skill.install）", () => {
    const target = (dir: string) => join(home, dir, "skills", "nbstory");

    test("装进固定的位置（claude：~/.claude/skills，codex：~/.agents/skills）；再装是 unchanged；内容被改过是 skill_exists，加 force 才换；不能指定目录", async () => {
        const first = await call("skill.install", {agent: "claude"});
        expect(first.status).toBe(200);
        expect(first.body).toMatchObject({state: "installed", path: target(".claude")});
        expect((await readdir(target(".claude"))).sort()).toContain("SKILL.md");
        expect((await call("skill.install", {agent: "claude"})).body).toMatchObject({state: "unchanged"});

        await writeFile(join(target(".claude"), "SKILL.md"), "被改过\n");
        const exists = await call("skill.install", {agent: "claude"});
        expect(exists.status).toBe(409);
        expect(exists.body).toMatchObject({code: "skill_exists"});
        expect(await readFile(join(target(".claude"), "SKILL.md"), "utf8")).toBe("被改过\n");
        const forced = await call("skill.install", {agent: "claude", force: true});
        expect(forced.body).toMatchObject({state: "replaced"});
        expect(await readFile(join(target(".claude"), "SKILL.md"), "utf8")).not.toBe("被改过\n");

        expect((await call("skill.install", {agent: "codex"})).body).toMatchObject({state: "installed", path: target(".agents")});
        // 网页不能指定目录或别的 agent。
        expect((await call("skill.install", {agent: "claude", dir: "/tmp/evil"})).status).toBe(400);
        expect((await call("skill.install", {agent: "other"})).status).toBe(400);
    });
});

describe("base64 的字节数", () => {
    test("扣掉末尾的填充：恰好 3 的倍数、少 1 字节、少 2 字节的文件算出各自的实际大小", () => {
        for (const size of [3, 4, 5, 6, 33554430, 33554431, 33554432]) {
            expect(base64Bytes(Buffer.alloc(size).toString("base64"))).toBe(size);
        }
    });
});
