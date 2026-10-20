/**
 * `@notnotype/nb-form` 的核心：按数据 schema 画表单所需的、与界面框架无关的部分（docs/specs/ui/forms.md）。
 * 只依赖 TypeBox；Vue 渲染层另有入口。
 */

export {AGENT_LIMITS, checkDescription} from "./check";
export type {DescriptionCheck, DescriptionProblem} from "./check";
export {fallbackWidget} from "./fallback";
export type {TerminalWidget} from "./fallback";
export {readHints} from "./hints";
export {BUILTIN_WIDGETS, findNode, isBuiltinWidget, itemNode, kindOf, literalValues, MAX_DEPTH, RADIO_ROW_LIMIT, resolveForm, SEARCH_LIMIT, selectWidget, WIDGETS_FOR_KIND} from "./model";
export type {BuiltinWidget, ChoiceValue, FieldKind, FieldNode, FormChoice, FormHints, FormLayout, FormModel, JsonSchema, VisibleWhen} from "./model";
export {optionKey, optionValue} from "./options";
export type {OptionSource} from "./options";
export {fromPointer, getAt, removeAt, setAt, toPointer} from "./path";
export type {FieldPath, PathSegment} from "./path";
export {FALLBACK_LOCALE, isFormText, resolveText} from "./text";
export type {FormText} from "./text";
export {validateForm} from "./validate";
export type {FormIssue, FormMeta} from "./validate";
export {isVisible} from "./visible";
