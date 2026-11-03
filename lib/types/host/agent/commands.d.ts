import type { CommandDefinition, CommandResult } from '@deepseek-ai/dsh-commands';
/** The structural face of one agent. The COMMAND types below are the host's
 *  own, imported — a hand-written copy of them compiles just as happily and
 *  fails on the first real invocation, which is exactly what happened. */
export interface CommandAgent {
    followup(message: unknown): void;
}
/** What this module needs from the command registry: one method, taking the
 *  host's own {@link CommandDefinition}. Narrow to a single method so tests
 *  can supply a face — but the DEFINITION it accepts is the real type, so a
 *  face cannot invent a handler contract the host will not honour. */
export interface CommandRegistrar {
    register(definition: CommandDefinition): () => void;
}
/**
 * Hand one sentence to a session's model.
 *
 * THE ONE PATH from this plugin's COMMANDS into a model. All four slash commands
 * call it, so they share one `followup`, one message shape and one failure story —
 * a second copy of these four lines is a second thing to keep in step, and the day
 * they drift is the day one of the paths quietly stops saying what it says. (The
 * checklist panel's 「问 AI」 is a separate path with a different job: it carries a
 * row's own text and starts or continues a card, so it lives in
 * `core/item-ask.ts` rather than being bent into this one.)
 *
 * `lead` is how a caller adds its own instruction without forking the path: the
 * directive travels in the SAME message as the person's words, so the model reads
 * one request rather than two competing ones.
 *
 * Success carries no `text` on purpose: the model answers in the conversation
 * right after this, in its own words and with its own tool cards, and a text
 * here would put a second, weaker rendering of the same turn in front of the
 * person.
 */
export declare function handOver(agent: CommandAgent, text: string, lead?: string): CommandResult;
/** The four command definitions, ready to register. */
export declare function createTaskboardCommands(): readonly CommandDefinition[];
/** Register all four, and return one disposer that takes them all off. */
export declare function registerTaskboardCommands(registry: CommandRegistrar): () => void;
