import {mkdir, readFile, writeFile} from "node:fs/promises";
import path from "node:path";
import {RememberedLoginDtoSchema, type RememberedLoginDto} from "nbook/shared/dto/auth.dto";

const REMEMBERED_LOGIN_FILE = "remembered-login.json";

/**
 * 返回本机登录凭据文件路径。Tauri 下 workspace root 是固定产品数据目录，
 * 不依赖随机 localhost 端口，因此重启后仍可读取。
 */
function rememberedLoginPath(): string {
    const workspaceRoot = process.env.NEURO_BOOK_WORKSPACE_ROOT?.trim() || path.resolve(process.cwd(), "workspace");
    return path.resolve(workspaceRoot, ".nbook", REMEMBERED_LOGIN_FILE);
}

/** 读取本机记住的登录凭据。 */
export async function readRememberedLogin(): Promise<RememberedLoginDto> {
    try {
        const text = await readFile(rememberedLoginPath(), "utf8");
        return RememberedLoginDtoSchema.parse(JSON.parse(text));
    } catch {
        return {username: "", password: ""};
    }
}

/** 写入本机记住的登录凭据。 */
export async function writeRememberedLogin(input: RememberedLoginDto): Promise<RememberedLoginDto> {
    const payload = RememberedLoginDtoSchema.parse(input);
    const filePath = rememberedLoginPath();
    await mkdir(path.dirname(filePath), {recursive: true});
    await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    return payload;
}
