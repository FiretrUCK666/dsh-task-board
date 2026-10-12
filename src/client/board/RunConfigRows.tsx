/**
 * THE run-configuration ROWS (工作区 / Agent / 模型 / 思考程度 / 权限) as one
 * shared component: the five lines a card's configuration reads as, in the task
 * detail and in the checklist's 运行配置 block alike.
 *
 * WHY IT IS SHARED RATHER THAN WRITTEN TWICE. The checklist's block reads a
 * CARD's configuration — it is the same fact the board shows, so it has to be
 * the same words in the same order. Two copies of this list would drift the
 * first time a field is added, and a drifted copy is not a cosmetic problem: a
 * reader comparing the two surfaces would be looking at two answers to one
 * question.
 *
 * The five rows always render: an unset field means "use the deployment
 * default", shown as 默认 — a fresh or dragged-in card reads complete instead
 * of silently missing rows.
 */
import type { RunConfigPresetConfig } from '../../core/run-presets.ts'
import { permissionLabel } from '../permission-label.ts'
import { t } from '../locales.ts'
import css from '../board.module.css'

export function RunConfigRows({ config, workspaceTitleOf }: {
  readonly config: RunConfigPresetConfig
  /** The workspace's display title; absent, or unknown to it = show the id. */
  readonly workspaceTitleOf?: ((workspaceId: string) => string) | undefined
}) {
  const workspaceId = config.workspaceId
  return (
    <dl className={css.configGrid}>
      <div className={css.configRow}>
        <dt className={css.configLabel}>{t('new.workspace')}</dt>
        <dd className={css.configValue}>
          {workspaceId !== undefined
            ? workspaceTitleOf?.(workspaceId) ?? workspaceId
            : t('new.workspaceDefault')}
        </dd>
      </div>
      <div className={css.configRow}>
        <dt className={css.configLabel}>{t('new.agentPreset')}</dt>
        <dd className={css.configValue}>
          {config.agentPreset !== undefined ? config.agentPreset : t('new.agentPresetDefault')}
        </dd>
      </div>
      <div className={css.configRow}>
        <dt className={css.configLabel}>{t('new.model')}</dt>
        <dd className={css.configValue}>
          {config.provider !== undefined && config.model !== undefined
            ? `${config.provider} / ${config.model}`
            : t('new.modelDefault')}
        </dd>
      </div>
      <div className={css.configRow}>
        <dt className={css.configLabel}>{t('new.effort')}</dt>
        <dd className={css.configValue}>
          {config.reasoningEffort !== undefined ? config.reasoningEffort : t('new.effortDefault')}
        </dd>
      </div>
      <div className={css.configRow}>
        <dt className={css.configLabel}>{t('new.permission')}</dt>
        <dd className={css.configValue}>
          {config.permission !== undefined ? permissionLabel(config.permission) : t('new.permissionDefault')}
        </dd>
      </div>
    </dl>
  )
}
