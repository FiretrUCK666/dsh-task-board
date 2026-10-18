/**
 * 把「第三方皮肤壁纸模式」打在页面上的那几枚变量模拟出来。
 *
 * 为什么需要它：本插件的截图台架用的是宿主自己的令牌表（浅色四层全白），而真实运行时
 * 皮肤会改写 `--dsw-alias-bg-base`（半透明浅蓝，压在壁纸上看），同时保持各层与边框不变。
 * 「浅蓝页 + 纯白层 + 4% 黑发丝线」正是读者报「白色背景下全都看不见」时的那套组合，
 * 而它在默认台架里根本不会出现——不把它摆出来，就没有任何一张图能证明修好了。
 *
 * 这不是产品的第二套主题：它只在截图时被注入，值全部来自 skin 的实测行为，
 * 产品代码里没有一行知道它的存在。
 *
 * 用法：
 *   node scripts/shot-panel.mjs --url file:///... --eval-file scripts/probes/skin-fixture.js
 */
(() => {
  const body = document.body
  const set = (name, value) => { body.style.setProperty(name, value) }
  // 壁纸：斜向的三色渐变，模拟用户的壁纸在页底透出来。
  body.style.backgroundImage = 'linear-gradient(135deg, #b9cdf3 0%, #d9d2f4 45%, #f3dcc8 100%)'
  body.style.backgroundAttachment = 'fixed'
  body.style.backgroundSize = 'cover'
  // 皮肤写的那几枚（壁纸不透明度 0.35，层保持白）。
  set('--dsw-alias-bg-base', 'rgba(224, 234, 255, 0.35)')
  set('--dsw-alias-bg-layer-1', 'rgba(255, 255, 255, 1)')
  set('--dsw-alias-bg-layer-2', 'rgba(255, 255, 255, 0.94)')
  set('--dsw-alias-bg-layer-3', 'rgba(255, 255, 255, 1)')
  set('--dsw-specific-menu', 'rgba(255, 255, 255, 0.94)')
  set('--dsw-specific-input-major', 'rgba(255, 255, 255, 1)')
  return 'skin fixture applied'
})()
