/**
 * ONE human-readable cron label for every surface that shows an expression
 * (the task detail's schedule meta, the automation overview's rule rows, the
 * preset manager's rows, the session-rule rows): the describeCron shape
 * mapped to locale-aware text. Parsing stays in core/schedule.ts; this is
 * purely the presentation mapping, so no surface can ever render a slightly
 * different "daily at 09:00" again.
 */
import { describeCron } from '../../core/schedule.ts'
import { isEnglish, t } from '../locales.ts'

/** Short weekday names (0 = Sunday), locale-aware. */
const WEEKDAYS_ZH = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
const WEEKDAYS_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/**
 * The human label of a cron expression. An unparseable expression falls back
 * to the raw text (or to `invalid` when the caller wants an explicit silent
 * swap — the preset manager rows show '' instead of the raw expression).
 */
export function cronHumanLabel(expr: string, invalid?: string): string {
  const description = describeCron(expr)
  if (description === undefined) return invalid ?? expr
  switch (description.kind) {
    case 'everyMinute': return t('schedule.desc.everyMinute')
    case 'everyMinutes': return t('schedule.desc.everyMinutes', { n: String(description.minutes) })
    case 'everyHours': return t('schedule.desc.everyHours', { n: String(description.hours) })
    case 'dailyAt': return t('schedule.desc.dailyAt', { time: description.time })
    case 'weekdaysAt': return t('schedule.desc.weekdaysAt', { time: description.time })
    case 'weeklyAt': return t('schedule.desc.weeklyAt', {
      days: description.weekdays
        .map(day => (isEnglish() ? WEEKDAYS_EN : WEEKDAYS_ZH)[day] ?? String(day))
        .join(isEnglish() ? ', ' : '、'),
      time: description.time,
    })
    case 'monthlyAt': return t('schedule.desc.monthlyAt', {
      days: description.days.map(String).join(isEnglish() ? ', ' : '、'),
      time: description.time,
    })
    case 'custom': return t('schedule.desc.custom')
  }
}
