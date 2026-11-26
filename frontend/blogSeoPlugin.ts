import type { Plugin } from 'vite'

const fallback = '<title data-blog-seo>Genesis</title><meta data-blog-seo name="robots" content="noindex, follow">'
export function blogSeoPlugin(target: string): Plugin {
  return {
    name: 'genesis-blog-seo',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!/^\/(?:sitemap\.xml|robots\.txt)(?:\?|$)/.test(req.url ?? '')) { next(); return }
        void (async () => {
          try {
            const response = await fetch(`${target}/api/v1/blog/seo${req.url}`, { headers: { 'x-forwarded-host': req.headers.host ?? 'localhost:5173', 'x-forwarded-proto': 'http' }, signal: AbortSignal.timeout(5000) })
            res.statusCode = response.status
            res.setHeader('Content-Type', response.headers.get('Content-Type') ?? 'text/plain')
            res.setHeader('Cache-Control', 'no-store')
            res.end(await response.text())
          } catch { res.statusCode = 503; res.end('暂时无法读取站点地图，请稍后重试。') }
        })()
      })
    },
    transformIndexHtml: {
      order: 'post',
      async handler(html, context) {
        let head = fallback
        if (context.server) {
          try {
            const response = await fetch(`${target}/api/v1/blog/seo/head?${new URLSearchParams({ path: context.originalUrl ?? context.path }).toString()}`, { headers: { 'x-forwarded-host': 'localhost:5173', 'x-forwarded-proto': 'http' }, signal: AbortSignal.timeout(3000) })
            if (response.ok) head = await response.text()
          } catch { /* 元数据读取失败不阻止开发页面加载。 */ }
        } else {
          head = `<!--# block name="seo_fallback" -->${fallback}<!--# endblock --><!--# include virtual="/api/v1/blog/seo/head?path=$request_uri" stub="seo_fallback" -->`
        }
        return html.replace(/<title>Genesis<\/title>/, head).replace(/\s*<meta name="description" content="Genesis 应用" \/>/, '')
      },
    },
  }
}
