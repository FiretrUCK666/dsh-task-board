/**
 * Requirement-refinement copy: the prompt sent as the first turn of a task's
 * refine session. The agent researches (with whatever tools the harness
 * gives it — web search, page fetch, …), asks the user anything unclear,
 * and finally emits a ready-to-run execution prompt. Pure and framework-free
 * so the template unit-tests in isolation; the same builder serves both
 * languages.
 */
import type { TaskRecord } from './tasks.ts';
/**
 * The first-turn instruction for a task's refine session.
 * @param task - the backlog task whose requirement is being fleshed out.
 * @param english - whether to write the instruction in English.
 */
export declare function buildRefinePrompt(task: TaskRecord, english: boolean): string;
