import i18next, {type TFunction} from "i18next";
declare const tf: TFunction<"plugin-a">;
declare const tc: TFunction<"plugin-c">;
declare const loose: TFunction;
tf("title");                          // L3 ok
tf("titel");                          // L4 ERR
tf("greeting", {nam: "x"});           // L5 (no error expected: params not inferred from JSON)
tc("anything");                       // L6 unknown ns
loose("plugin-c:anything");           // L7 untyped TFunction
i18next.t("plugin-a:title");          // L8 ok (defaultNS=plugin-a case)
i18next.t("plugin-a:titel");          // L9 ERR
i18next.t("plugin-c:title");          // L10 ERR in map mode
i18next.t("plugin-c:title", {defaultValue: "x"});  // L11 defaultValue escape hatch
i18next.t("plugin-a:titel", {defaultValue: "x"});  // L12 defaultValue on typo
i18next.t("plugin-a:files", {count: "1,234"});     // L13 string count
i18next.t("plugin-a:files", {count: undefined});   // L14 undefined count
