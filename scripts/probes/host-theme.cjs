// 宿主的令牌表：本插件每个 `--dsh-tb-*` 都从 `--dsw-*` 派生，缺了它颜色全是空的。
//
// 造出来的工件页不是插件运行时，没有宿主注入的那几层样式表，于是 `--dsw-*` 一个都不存在：
// 文字落回初始的黑色、底落回透明。那种页面上量出来的「角」和「色」跟真机无关，
// 所以每个自造工件页都要先把这一份贴进 `<head>`。
//
// 读的是**实际安装的**那份客户端主题包，不在仓库里存一份副本——宿主的令牌会变，
// 副本只会安静地过时。
//
// 这是唯一一份：`probe-review-panel.cjs` 与 `probe-overlay-corners.cjs` 都 require 它。
const fs = require('node:fs')
const path = require('node:path')

/** 安装根的可能位置。npm 全局装与本地装各一个，命中第一个存在的。 */
function installRoots() {
  return [
    path.join(process.env.APPDATA ?? '', 'npm', 'node_modules'),
    path.join(process.env.HOME ?? '', '.npm', 'node_modules'),
    path.join(process.env.APPDATA ?? '', 'npm'),
  ]
}

function themeBundlePath() {
  return installRoots()
    .map(root => path.join(root, '@deepseek-ai', 'dsh', 'node_modules', '@deepseek-ai', 'dsh-client-ui-theme', 'lib', 'client.js'))
    .find(one => fs.existsSync(one))
}

/**
 * 把主题包里内嵌的每张样式表原样取出来（它们是构建时打进去的字符串常量）。
 * 取不到就返回空串——调用方据此说「这一页没有宿主令牌」，而不是安静地量一张白页。
 */
function hostThemeCss() {
  const bundle = themeBundlePath()
  if (bundle === undefined) return ''
  const source = fs.readFileSync(bundle, 'utf8')
  const sheets = []
  for (const match of source.matchAll(/(\w+)_css_default\s*=\s*"/g)) {
    const open = match.index + match[0].length - 1
    let end = open + 1
    while (end < source.length) {
      if (source[end] === '\\') { end += 2; continue }
      if (source[end] === '"') break
      end += 1
    }
    try { sheets.push(JSON.parse(source.slice(open, end + 1))) } catch { /* 不是样式表，跳过 */ }
  }
  return sheets.join('\n')
}

module.exports = { hostThemeCss, themeBundlePath }
