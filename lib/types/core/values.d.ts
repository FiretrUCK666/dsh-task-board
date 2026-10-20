/**
 * 读一个来路不明的值时用的小工具——三个读法，一处实现。
 *
 * ── 为什么它们住在一起 ───────────────────────────────────────────────────────
 *
 * 这三个函数各自只有一两行，而它们各自**曾经**在自己所在的文件里抄了一份：
 * `stringOf` 抄了三处（附件的规范化、附件路由、更新执行器），`messageOf` 抄了
 * 三处（目标动词、执行结算、附件路由），`isRecord` 抄了两处（目标动词、投影挑选）。
 *
 * 抄一份的代价不是那几行，是**改一处不报错**：`stringOf` 有一处写着
 * 「非空字符串」，另一处写着「非空字符串」，第三处也写着「非空字符串」——
 * 今天一样，明天有人把其中一处改成「允许空白」，另外两处不会跟着变，
 * 而屏上不会有人说一句话。
 *
 * 它们都属于同一件事：**把一个 `unknown` 读成某种具体的值**。所以它们住在
 * 一个按这个概念命名的模块里，而不是各自寄在某个业务模块下面——否则
 * `update-apply.ts`（更新执行器）得从一个**附件**模块里取一个字符串读法，
 * 那条 import 路径会骗读代码的人。
 *
 * 核心层（framework-free），host 半区与 client 半区都能 import。
 * @module dsh-task-board/core/values
 */
/**
 * 一个非空字符串；别的一律 `undefined`。
 *
 * 「空字符串」与「不是字符串」在这里是**同一件事**：两者都意味着
 * 「这里没有一句话可说」，而下游读法对它们的处理是一样的。
 * @param value - the value to read.
 * @returns the string, or undefined.
 */
export declare function stringOf(value: unknown): string | undefined;
/**
 * 一个错误的可读说明，绝不抛。
 *
 * 抛出来的东西五花八门：一个 `Error`、一个字符串、一个被拒的 Promise 的原因。
 * 读它的调用点要的只是一句话，所以这里把「不是 Error 的东西」也变成一句话
 * （`String(value)`），而不是让调用点自己再判一次。
 * @param error - the thrown value.
 * @returns its message.
 */
export declare function messageOf(error: unknown): string;
/**
 * 一个「普通的对象」（不是数组、不是 null）。
 *
 * 只判**是不是对象**，不判里面有什么——字段由读它的那一处自己负责。
 * @param value - the value to test.
 * @returns whether it is a plain object.
 */
export declare function isRecord(value: unknown): value is Record<string, unknown>;
