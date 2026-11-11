// 读一张已造好的页在运行时报了什么错——造页器本身出问题时用它，不要靠猜。
;;(() => {
  const errors = window.__errors ?? []
  const root = document.getElementById('root')
  return {
    errors,
    rootChildren: root === null ? 'no #root' : root.childElementCount,
    mounted: window.__mounted ?? false,
    keys: Object.keys(window).filter(key => key.startsWith('__')).slice(0, 20),
    bodyText: (document.body.innerText ?? '').slice(0, 200),
  }
})()
