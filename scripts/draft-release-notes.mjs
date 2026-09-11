#!/usr/bin/env node
/**
 * draft-release-notes.mjs —— 从提交记录起草中文发布说明
 * （与 project-forge skill 同名脚本同源，逻辑一致；两边改动需同步。）
 *
 * 存在的理由：`gh release create --generate-notes` 是 GitHub 服务器按英文模板
 * 渲染的（What's Changed + Full Changelog 链接），它不认识中文，产出的说明
 * 没有一句人话。而我们的提交信息本来就是中文人话——起草只是把它们收集起来，
 * 而不是重新发明内容。
 *
 * 用法：
 *   node scripts/draft-release-notes.mjs <标签> [输出文件]
 *
 *   标签必须已存在（先打标签再起草）。输出文件省略时写到 `./<标签>-notes.md`。
 *   正文写进 UTF-8 文件（无 BOM），再由 gh 或 release-notes.mjs 按字节发送——
 *   中文绝不经 shell 传递的那条规则，在这里同样适用。
 *
 * 退出码：0 = 写好；1 = 失败；2 = 用法或仓库状态错误。
 */

import { spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'

function git(args, cwd) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true })
  if (r.error !== undefined || r.status !== 0) return undefined
  return (r.stdout ?? '').trim()
}

function usage() {
  return '用法：node scripts/draft-release-notes.mjs <标签> [输出文件]\n'
}

function main() {
  const argv = process.argv.slice(2)
  if (argv.includes('--help') || argv.includes('-h') || argv.length === 0) {
    process.stdout.write(usage())
    return argv.length === 0 ? 2 : 0
  }
  const [tag, outPath] = argv
  const cwd = process.cwd()

  if (git(['rev-parse', '--verify', '--quiet', `${tag}^{commit}`], cwd) === undefined) {
    process.stderr.write(`错误：标签 ${tag} 不存在——先打标签再起草。\n`)
    return 2
  }
  // 上一个标签：没有则取全量（上限 100 条，发布说明不是提交编年史）。
  const prev = git(['describe', '--tags', '--abbrev=0', `${tag}^`], cwd)
  const range = prev === undefined ? tag : `${prev}..${tag}`
  const log = git(['log', '--format=%s', '--no-merges', '-n', '100', range], cwd)
  if (log === undefined) {
    process.stderr.write('错误：读取提交记录失败。\n')
    return 1
  }
  const subjects = log.split('\n').map((l) => l.trim()).filter((l) => l !== '')

  // 对比链接：能解析出 GitHub 地址才给，给不出就只写区间（不编地址）。
  let compare = `\`${range}\``
  const remote = git(['remote', 'get-url', 'origin'], cwd)
  const m = remote === undefined ? null : /github\.com[/:]([^/]+)\/([^/.]+)/.exec(remote)
  if (m !== null) compare = `[${prev ?? '初始'}...${tag}](https://github.com/${m[1]}/${m[2]}/compare/${range})`

  const lines = [`## 本次更新`, '']
  if (subjects.length === 0) lines.push('（该区间无提交记录）')
  else for (const s of subjects) lines.push(`- ${s}`)
  lines.push('', `**完整改动**：${compare}`, '')
  const target = outPath ?? `./${tag}-notes.md`
  try {
    writeFileSync(target, lines.join('\n'), { encoding: 'utf8' })
  } catch (error) {
    process.stderr.write(`错误：无法写入 ${target}——${error instanceof Error ? error.message : String(error)}\n`)
    return 1
  }
  process.stdout.write(`已起草：${target}（${subjects.length} 条提交）\n`)
  return 0
}

process.exitCode = main()
