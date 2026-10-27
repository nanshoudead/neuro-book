/**
 * `nbook` 的输出约定（docs/specs/runtime/cli.md 的“输出与退出码”）：结果写标准输出，提示与诊断写标准错误；`--json` 时
 * 标准输出只有一个 JSON 对象，成功 `{ok: true, ...}`，失败 `{ok: false, code, message, ...}`。退出码 0 成功、1 失败、
 * 2 用法错误；`start` 运行服务端时透传服务端的退出码。
 */

/** 命令以失败结束：`code` 是给脚本与 Agent 分支用的稳定名称，`message` 给人看。 */
export class CliFailure extends Error {
    constructor(
        readonly code: string,
        message: string,
        readonly exitCode: 1 | 2 = 1,
        readonly fields: Readonly<Record<string, unknown>> = {},
    ) {
        super(message);
        this.name = "CliFailure";
    }
}

export interface Output {
    readonly json: boolean;
    /** 命令的结果：文本模式写 `text`，`--json` 时写 `{ok: true, ...value}`。 */
    result(text: string, value: Readonly<Record<string, unknown>>): void;
    /** 给人看的提示，写标准错误；`--json` 时也写，标准输出不受影响。 */
    hint(text: string): void;
    failure(failure: CliFailure): void;
}

export function createOutput(json: boolean, write: {readonly out: (text: string) => void; readonly err: (text: string) => void} = {out: (text) => void process.stdout.write(text), err: (text) => void process.stderr.write(text)}): Output {
    return {
        json,
        result: (text, value) => write.out(json ? `${JSON.stringify({ok: true, ...value})}\n` : `${text}\n`),
        hint: (text) => write.err(`${text}\n`),
        failure: (failure) => {
            if (json) write.out(`${JSON.stringify({ok: false, code: failure.code, message: failure.message, ...failure.fields})}\n`);
            else write.err(`nbook：${failure.message}\n`);
        },
    };
}
