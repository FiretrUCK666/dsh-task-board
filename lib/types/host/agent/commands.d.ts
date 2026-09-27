import type { CommandDefinition } from '@deepseek-ai/dsh-commands';
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
/** The two command definitions, ready to register. */
export declare function createTaskboardCommands(): readonly CommandDefinition[];
/** Register both, and return one disposer that takes them both off. */
export declare function registerTaskboardCommands(registry: CommandRegistrar): () => void;
