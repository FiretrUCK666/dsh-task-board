// 把工件页里出现的 class 名字按前缀列出来，好让 `run-corner-shots.mjs --selector`
// 有一个真的能匹配上的选择器。
//
// 为什么要这一步：类名带每张表一份的哈希后缀，所以 `[class*="column_"]` 在开发表里匹配
// 得到、在生产构建里匹配不到——而匹配不到时那个探针不报错，它只是**截了整页的左上角**，
// 看上去像一张角。
//
// 用法：node scripts/probes/list-classes.cjs tmp/board3.html column
const fs = require('node:fs')

const [, , file, filter] = process.argv
if (file === undefined) {
  console.error('用法：node scripts/probes/list-classes.cjs <html> [子串]')
  process.exit(2)
}
const source = fs.readFileSync(file, 'utf8')
const names = new Set()
for (const match of source.matchAll(/class="([^"]*)"/g)) {
  for (const token of match[1].split(/\s+/)) {
    if (token === '') continue
    if (filter !== undefined && !token.includes(filter)) continue
    names.add(token)
  }
}
console.log([...names].sort().join('\n'))
