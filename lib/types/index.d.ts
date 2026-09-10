/**
 * Host loader entry for the task-board plugin.
 *
 * Everything the board does is browser work (DOM, localStorage, driving the
 * client runtime's session services over the wire), so the host half's main
 * behavior is a system-prompt section announcing the plugin to every agent,
 * plus an HTTP settings route that serves the plugin's settings namespace to
 * the browser half. The section registers while this plugin is in the host
 * composition (mount / DSH restart) and disappears when the plugin leaves it
 * (unmount / restart), so agents always know the board exists and how to
 * cooperate with it. The announcement can be turned off through the web
 * settings plugin-configuration surface (`announceToAgent`); the section then
 * disappears live.
 */
import type { Context } from '@deepseek-ai/cordis';
import z from 'schemastery';
export declare const inject: string[];
/** Model-facing announcement: plugin presence, capabilities, and limits. */
export declare const TASK_BOARD_GUIDANCE = "\u672C\u673A\u5DF2\u5B89\u88C5 dsh-task-board \u72EC\u7ACB\u63D2\u4EF6\uFF08DSH Web GUI \u7684\u4EFB\u52A1\u770B\u677F\uFF0C\u53EF\u6302\u8F7D\u5230 web profile\uFF09\uFF1A\u4FA7\u8FB9\u680F\u300C\u4EFB\u52A1\u770B\u677F\u300D\u5165\u53E3\u3002\u80FD\u529B\uFF1A\u591A\u5217\u770B\u677F\u7BA1\u7406\u4EFB\u52A1\uFF1B\u4EFB\u52A1\u53EF\u771F\u5B9E\u6267\u884C\uFF08\u9A71\u52A8 agent \u4F1A\u8BDD\uFF09\uFF1B\u4EFB\u52A1\u652F\u6301 5 \u6BB5 cron \u5B9A\u65F6\u6267\u884C\uFF08\u5982 0 23 * * *\uFF09\uFF1B\u770B\u677F\u6570\u636E\uFF08\u4EFB\u52A1/\u5DE1\u822A/\u9884\u8BBE\uFF09\u6301\u4E45\u5316\u5728 DSH host \u7AEF\uFF08\u5B58\u50A8\u5355\u5143 dsh_task_board\uFF09\uFF0C\u4EFB\u610F\u8BBE\u5907\u4EFB\u610F\u6D4F\u89C8\u5668\u6253\u5F00\u540C\u4E00\u90E8\u7F72\u770B\u5230\u7684\u90FD\u662F\u540C\u4E00\u5757\u677F\uFF0C\u6539\u52A8\u7ECF SSE \u5B9E\u65F6\u540C\u6B65\uFF1B\u624B\u673A\u7B49\u7A84\u5C4F\u4E3A\u7D27\u51D1\u5E03\u5C40\u3002\u9650\u5236\uFF1A\u8C03\u5EA6\u5F15\u64CE\u540C\u4E00\u65F6\u523B\u53EA\u7531\u4E00\u4E2A\u6253\u5F00\u7684 GUI \u7AEF\u6301\u6709\uFF08host \u79DF\u7EA6\u4EF2\u88C1\uFF0C\u591A\u7AEF\u540C\u5F00\u4E0D\u4F1A\u53CC\u4EFD\u6267\u884C\uFF09\uFF0C\u81F3\u5C11\u4E00\u4E2A GUI \u6807\u7B7E\u9875\u4FDD\u6301\u6253\u5F00\uFF0C\u5426\u5219\u5B9A\u65F6/\u5DE1\u822A/\u63A5\u7EED\u505C\u6446\u3001\u9519\u8FC7\u5373\u8DF3\u8FC7\uFF1B\u6267\u884C\u6D88\u8017 API \u989D\u5EA6\u3002\u7528\u6237\u63D0\u5230\u300C\u4EFB\u52A1\u770B\u677F / \u770B\u677F / \u5B9A\u65F6\u4EFB\u52A1\u300D\u65F6\u5373\u6307\u672C\u63D2\u4EF6\uFF0C\u8BF7\u636E\u6B64\u534F\u4F5C\u3002";
/**
 * Settings namespace of the board's announcement capability — the section the
 * web settings surface edits, and the namespace the settings route serves.
 * Spelled here rather than imported: the browser half spells the same value
 * and must not depend on a Host package.
 */
export declare const TASK_BOARD_SETTINGS_NAMESPACE: import("@deepseek-ai/dsh-settings").SettingsNamespace;
/** Plugin config, validated by the same-named schemastery schema. */
export interface Config {
    /**
     * When true (default), a system-prompt section announces the board to every
     * agent. Set false to keep the board silent in prompts; agents then learn
     * about it only when the user mentions it.
     */
    announceToAgent?: boolean;
    /** Master switch for the plugin (browser half + host announcement). */
    enabled?: boolean;
}
export declare const Config: z<Config>;
/**
 * Register the board's announcement section, gated on the composition entry's
 * `announceToAgent` (and the live settings value once the web settings
 * surface is served). The section is re-registered whenever the source
 * changes, so a settings edit takes effect without a restart.
 * @param ctx - the plugin context (systemPrompt injected).
 * @param config - resolved plugin config (schema defaults applied by the loader).
 */
export declare function apply(ctx: Context, config?: Config): void;
