/**
 * Host row: the plugin's whole surface toward models.
 *
 * This module exists so the plugin page can switch the AI interface off in one
 * click. Turning the row off means the loader never evaluates this file, which
 * means `ctx.tools`, `ctx.commands` and `ctx.systemPrompt` are never touched —
 * so the three tools are not registered, the two slash commands do not exist,
 * and the prompt section is absent. Nothing has to check at runtime, so nothing
 * can forget to check.
 *
 * The prompt section is deliberately part of THIS row rather than the package
 * row: a switched-off AI interface that still left a paragraph about task tools
 * in every prompt would be telling the model about tools it cannot call.
 */
import type { Context } from '@deepseek-ai/cordis';
/**
 * Injected for the three registrations below. Each is a liability, so all three
 * travel together: half a surface is worse than none, and a deployment that
 * composes none of them must wait on none of them.
 */
export declare const inject: string[];
/**
 * Declared entry point for the AI surface row.
 * @param ctx - host root context (services: tools, commands, systemPrompt).
 */
export declare function apply(ctx: Context): void;
