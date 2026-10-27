import extra from "./extra-code.json";
import missing from "./missing-code.json";
import type {ExactCodes} from "./codes";

export const m: ExactCodes<typeof missing.errors> = true;   // EXPECT-ERROR: 缺 unknown-outcome
export const e: ExactCodes<typeof extra.errors> = true;     // EXPECT-ERROR: 多 legacy-code

// 只做单向检查的最简写法（只报缺，不报多）：
import type {ErrorCode} from "./codes";
export const onlyMissing: Record<ErrorCode, string> = missing.errors;  // EXPECT-ERROR: 缺 unknown-outcome
