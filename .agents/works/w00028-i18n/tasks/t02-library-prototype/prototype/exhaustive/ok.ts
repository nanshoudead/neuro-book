import complete from "../locales/plugin-a.zh-CN.json";
import enComplete from "../locales/plugin-a.en-US.json";
import type {ExactCodes} from "./codes";

// 完整的目录：两种语言都通过
export const zh: ExactCodes<typeof complete.errors> = true;
export const en: ExactCodes<typeof enComplete.errors> = true;
