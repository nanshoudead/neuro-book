import type {FormHints} from "../hints";
import type {JsonSchema} from "../model";

/** 调用方另给的提示盖过 schema 里 `x-form` 的同名键（`SchemaField` 的 `hints`、`widgetLayout` 的第二个参数）。 */
export function withHints(schema: object, hints: FormHints | undefined): JsonSchema {
    const own = schema as JsonSchema;
    if (hints === undefined) return own;
    const written = own["x-form"];
    return {...own, "x-form": {...(typeof written === "object" && written !== null ? written : {}), ...hints}};
}
