/**
 * The model `<select>`'s value encoding: a provider and a model, joined by a
 * NUL separator.
 *
 * ── 为什么它有一个家 ────────────────────────────────────────────────────────
 *
 * 两处下拉框都靠这个编码把「provider + model」装进一个 `<option value>`：运行配置的
 * 编辑器（`RunConfigEditor.tsx`）与会话面板（`session-panel.tsx`）。它们原来各写
 * 了一份 `MODEL_SEP` 与各自的拆法——两份拷贝改一处不动另一处，而 `<select>` 的取值
 * 只是屏上一个**看不见的字符串**：分隔符换了一个，读者选中模型时得到的是空 provider
 * 或空 model，界面上看不出发生了什么，也没有任何一条测试会红。
 *
 * 分隔符用 NUL 是有道理的：它不出现在任何 provider 或 model 的名字里，所以
 * 「拆回来」永远是同一次拆分。
 *
 * 为什么不放在 core：这是**浏览器里一个 `<select>` 的取值编码**，host 与模型都不
 * 认识它——它不是协议，是这一页的界面约定。
 * @module dsh-task-board/client/board/model-select
 */

/** The separator between a provider and a model inside one option value. */
export const MODEL_SEP = '\u0000'

/**
 * Pack a provider and a model into one `<option>` value.
 * @param provider - the provider id.
 * @param model - the model id.
 * @returns the encoded value.
 */
export function modelSelectValue(provider: string, model: string): string {
  return `${provider}${MODEL_SEP}${model}`
}

/**
 * Unpack one `<option>` value back into a provider and a model.
 * @param value - the option value.
 * @returns the pair, or undefined when the value is not one of ours.
 */
export function modelSelectParts(value: string): { provider: string; model: string } | undefined {
  const at = value.indexOf(MODEL_SEP)
  if (at < 0) return undefined
  return { provider: value.slice(0, at), model: value.slice(at + 1) }
}
