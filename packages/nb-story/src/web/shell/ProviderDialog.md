---
标签: [state:local, env:portal]
---

# ProviderDialog

设置页里添加或编辑一个自定义服务商的对话框（docs/specs/story/viewer.md 输出 48 的“服务商表单”）：名称、接口、服务地址、存密钥的环境变量名，加一张模型表。和 OMP 自己的 `models.yml` 不同，密钥只写变量名，不能贴密钥本身；模型表里没填的参数写“自动”，按模型名在 OMP 目录里认得时写出参照的值，只是提示，不写进配置（运行时由服务按模型名补）。“从服务读取”用表单里正在编辑的地址与变量读 `/models`（不读配置文件），读到的勾选后加进模型表。它是受控零件：读 `/models` 与按模型名找参照的能力由页面经 props 给，保存只发出 `save`，由页面写进整份配置。

## 布局

- 对话框 `lg`。上面两列的表单：名称（新建时下面写由它生成的 id，建好后不能改）、接口、服务地址（占整行）、密钥环境变量（旁边写服务启动时它有没有值，改了名的写“保存后才知道”）。
- 下面是模型表：模型名、上下文、单次输出上限、推理、图片、删除。数字留空时占位写“自动”或“自动（目录 1.05M）”；推理与图片是“自动 / 是 / 否”三选一。表头上方一行：读取的状态说明、“从服务读取”、“手动添加”。
- 读到模型时表下面列出读到的模型名（表里已有的不列），每个一个复选框，“加入（N）”把勾选的加进表。
- 页脚：错误原因在左，右边“取消”“保存”。

## 交互

- “从服务读取”只对 `openai-completions`、`openai-responses` 两种接口可用（其余接口的服务商只能手动添加），要先填好地址与变量名。结果按 `models.discover` 写：读到几个、空的、服务不支持（404）、密钥不对（401、403）、连不上、其它失败。读取中按钮不可用。
- “保存”：按配置 schema 校验这个服务商（`ProviderSchema`），另查 id 的写法、不与目录或别的自定义服务商重名、模型名不重复；不过时在页脚写明原因（变量名像密钥时不回显它），不关闭。通过就发出 `save` 并关闭。
- “取消”、Escape、点遮罩关闭，不保存。每次打开按 `provider` 重新填表。

## 数据

```ts
import type {ProviderConfig} from "../../contract/config-schema";

type Discovered = {state: "found" | "empty" | "not_supported" | "auth" | "unreachable" | "failed"; status: number | null; message: string | null; models: {id: string}[]; keySet: boolean};
type Suggestion = {from: string; contextWindow: number | null; maxTokens: number | null; reasoning: boolean; images: boolean};

interface ProviderDialogProps {
    /** 必填，受控（v-model:open）。 */
    open: boolean;
    /** 必填：要编辑的服务商；新建时为 null。 */
    provider: {id: string; config: ProviderConfig} | null;
    /** 必填：已经用掉的 id（OMP 目录的服务商与别的自定义服务商）。 */
    takenIds: readonly string[];
    /** 必填：服务启动时各环境变量有没有值；不在表里的写“保存后才知道”。 */
    keys: Readonly<Record<string, boolean>>;
    /** 必填：读 `/models`（页面调 `models.discover`）。 */
    discover: (input: {api: "openai-completions" | "openai-responses"; baseUrl: string; apiKeyEnv: string}) => Promise<Discovered>;
    /** 必填：按模型名在目录里找参照；认不得时为 null。 */
    suggest: (modelId: string) => Suggestion | null;
}

interface ProviderDialogEmits {
    (e: "update:open", open: boolean): void;
    /** 通过校验的服务商；`id` 新建时由名称生成。 */
    (e: "save", value: {id: string; config: ProviderConfig}): void;
}
```

没有 slot 与 expose；attrs 不透传。

## 不支持

- 不能填单价：单价在命令行（`nbstory config set providers.<id>.models`）或配置文件里写，编辑时原样保留。
- 不测密钥、不写配置文件：都由页面做。

## 隐藏通道理由

`env:portal` 来自 nb-ui 的 Dialog，渲染到 body。读 `/models` 的请求由页面经 `discover` 给，组件本身不发请求。
