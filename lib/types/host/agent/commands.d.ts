/** The structural face of one agent (no SDK import beyond the message factory). */
export interface CommandAgent {
    followup(message: unknown): void;
}
/** The structural face of the command registry. */
export interface CommandRegistry {
    register(definition: {
        name: string;
        description: string;
        recordInput?: boolean;
        handler(invocation: {
            agent: CommandAgent;
            rawInput: string;
        }): {
            ok: true;
        } | {
            ok: false;
            error: {
                message: string;
            };
        };
    }): () => void;
}
/** The two command definitions, ready to register. */
export declare function createTaskboardCommands(): readonly Parameters<CommandRegistry['register']>[0][];
/** Register both, and return one disposer that takes them both off. */
export declare function registerTaskboardCommands(registry: CommandRegistry): () => void;
