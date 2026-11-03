/** The skill's kebab-case name — the grammar the registry enforces. */
export declare const SKILL_NAME = "taskboard";
/**
 * The description the CATALOG shows, and the only thing the model uses to decide
 * whether to open the skill.
 *
 * The registry caps how much of this is rendered in the session catalog, so it
 * leads with what the skill is FOR and ends with when to reach for it. A
 * description that only names the subject gets skipped on the prompts it was
 * written for.
 */
export declare const SKILL_DESCRIPTION = "\u4EFB\u52A1\u770B\u677F\u4E0E\u6E05\u5355\u7684\u64CD\u4F5C\u624B\u518C\uFF1A\u5EFA\u5361\u3001\u8DD1\u5361\u3001\u6392\u671F\u3001\u770B\u677F\u4E0E\u6E05\u5355\u600E\u4E48\u9009\u3001\u8FD0\u884C\u914D\u7F6E\u8BE5\u95EE\u4E0D\u8BE5\u95EE\u7684\u51B3\u7B56\u3002\u5F53\u7528\u6237\u8981\u6C42\u8BB0\u5F55\u4EFB\u52A1\u3001\u7BA1\u7406\u770B\u677F\u3001\u5904\u7406\u6E05\u5355\u3001\u8BBE\u7F6E\u5B9A\u65F6\u4EFB\u52A1\u65F6\u4F7F\u7528\u3002";
/**
 * The narrow face this module needs from the skill registry.
 *
 * Structural, and only the one method used: the plugin reads no skill VALUE from
 * the host package, so a host that renames its types cannot break this module —
 * the same discipline the other structural faces here follow.
 */
export interface SkillRegistrar {
    register(skill: {
        readonly name: string;
        readonly description: string;
        readonly content: string;
        readonly source?: string;
        readonly resourceBase?: {
            readonly kind: 'directory';
            readonly path: string;
        };
    }): () => void;
}
/**
 * Read the packaged skill, or say why it is absent.
 *
 * @returns the parts the registry takes, or undefined when the files are not
 *   shipped in this build — in which case the caller registers nothing at all.
 */
export declare function bundledSkill(): {
    name: string;
    description: string;
    content: string;
    resourceBase: {
        kind: 'directory';
        path: string;
    };
} | undefined;
/**
 * Register the bundled skill.
 *
 * @param registrar - the skill registry, when the host composes one.
 * @returns the disposer, or a no-op when there is nothing to register.
 */
export declare function registerTaskboardSkill(registrar: SkillRegistrar | undefined): () => void;
