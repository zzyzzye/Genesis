"""同一元数据投影服务初始 HTML 与客户端导航，只读取公开文章。"""

import json
from html import escape
from urllib.parse import quote, urljoin, urlsplit

from fastapi import APIRouter, Query, Request, Response
from sqlalchemy import func, select

from genesis_api.api.dependencies import SessionDependency
from genesis_api.blog.comments import utc
from genesis_api.blog.models import BlogPost, BlogPostStatus
from genesis_api.blog.service import get_published_post

router = APIRouter(prefix="/blog/seo", tags=["博客收录"])


def public_origin(request: Request) -> str:
    """使用代理保留的外部主机与协议，不请求任何外部地址。"""
    protocol = request.headers.get("x-forwarded-proto", request.url.scheme)
    scheme = "https" if protocol == "https" else "http"
    host = request.headers.get("x-forwarded-host", request.headers.get("host", "localhost"))
    if any(char in host for char in '/\\<>"\r\n ,@'):
        host = "localhost"
    return f"{scheme}://{host}"


def head_markup(path: str, origin: str, session: SessionDependency) -> str:
    """生成转义后的标题、分享信息与 JSON-LD，后台和不存在文章不收录。"""
    pathname = urlsplit(path).path
    title, description = "Genesis Journal", "技术实践、产品思考与日常随笔。"
    canonical = origin + ("/blog" if pathname in ("/blog", "/blog/") else pathname)
    image = origin + "/images/blog/forest.jpg"
    kind = "website"
    indexable = pathname in ("/", "/blog", "/blog/")
    structured: dict[str, object] | None = None
    if pathname.startswith("/articles/"):
        post = get_published_post(session, pathname.removeprefix("/articles/"))
        if post is not None:
            indexable = True
            title, description = f"{post.title} · Genesis", post.excerpt
            canonical = origin + "/articles/" + quote(post.slug, safe="")
            candidate = urljoin(origin, post.cover_image_url or "/images/blog/forest.jpg")
            if urlsplit(candidate).scheme in ("http", "https"):
                image = candidate
            kind = "article"
            structured = {
                "@context": "https://schema.org",
                "@type": "BlogPosting",
                "headline": post.title,
                "description": post.excerpt,
                "image": [image],
                "mainEntityOfPage": canonical,
                "url": canonical,
                "author": {"@type": "Person", "name": post.author.display_name},
                "dateModified": utc(post.updated_at).isoformat(),
            }
            if post.published_at:
                structured["datePublished"] = utc(post.published_at).isoformat()
        else:
            title, description = "文章暂时无法打开 · Genesis", "文章不存在或尚未公开。"
    tags = [f"<title data-blog-seo>{escape(title)}</title>"]
    for name, content in {
        "description": description,
        "robots": "index, follow" if indexable else "noindex, follow",
        "twitter:card": "summary_large_image",
        "twitter:title": title,
        "twitter:description": description,
        "twitter:image": image,
    }.items():
        tags.append(f'<meta data-blog-seo name="{name}" content="{escape(content, quote=True)}">')
    for name, content in {
        "og:title": title,
        "og:description": description,
        "og:url": canonical,
        "og:type": kind,
        "og:image": image,
        "og:site_name": "Genesis Journal",
        "og:locale": "zh_CN",
    }.items():
        tags.append(
            f'<meta data-blog-seo property="{name}" content="{escape(content, quote=True)}">'
        )
    if indexable:
        tags.append(f'<link data-blog-seo rel="canonical" href="{escape(canonical, quote=True)}">')
    if structured:
        data = (
            json.dumps(structured, ensure_ascii=False)
            .replace("<", "\\u003c")
            .replace(">", "\\u003e")
            .replace("&", "\\u0026")
        )
        tags.append(f'<script data-blog-seo type="application/ld+json">{data}</script>')
    return "\n".join(tags)


@router.get("/head")
def head(
    request: Request, session: SessionDependency, path: str = Query("/", max_length=2048)
) -> Response:
    """初始响应与 SPA 更新共用已转义片段，不缓存私有路径信息。"""
    return Response(
        head_markup(path, public_origin(request), session),
        media_type="text/html",
        headers={"Cache-Control": "no-store"},
    )


@router.get("/sitemap.xml")
def sitemap(request: Request, session: SessionDependency, page: int = Query(0, ge=0)) -> Response:
    """站点地图索引按千篇分片，只列公开文章，撤回后立即移除。"""
    origin = public_origin(request)
    query = select(BlogPost).where(
        BlogPost.status == BlogPostStatus.PUBLISHED, BlogPost.deleted_at.is_(None)
    )
    if page == 0:
        total = session.scalar(select(func.count()).select_from(query.subquery())) or 0
        entries = "".join(
            f"<sitemap><loc>{escape(origin)}/sitemap.xml?page={number}</loc></sitemap>"
            for number in range(1, max(1, (total + 999) // 1000) + 1)
        )
        root = f'<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">{entries}</sitemapindex>'
    else:
        entries = f"<url><loc>{escape(origin)}/blog</loc></url>" if page == 1 else ""
        for post in session.scalars(
            query.order_by(BlogPost.id).offset((page - 1) * 1000).limit(1000)
        ):
            entries += (
                f"<url><loc>{escape(origin)}/articles/{quote(post.slug, safe='')}</loc>"
                f"<lastmod>{utc(post.updated_at).isoformat()}</lastmod></url>"
            )
        root = f'<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">{entries}</urlset>'
    return Response(
        '<?xml version="1.0" encoding="UTF-8"?>' + root,
        media_type="application/xml",
        headers={"Cache-Control": "no-store"},
    )


@router.get("/robots.txt")
def robots(request: Request) -> Response:
    """允许抓取公开页面；后台仍由鉴权控制，不把 robots 当作权限控制。"""
    return Response(
        "User-agent: *\nAllow: /\nDisallow: /api/\nAllow: /api/v1/blog/\nDisallow: /blog/studio\n"
        "Disallow: /admin\nDisallow: /account\n"
        f"Sitemap: {public_origin(request)}/sitemap.xml\n",
        media_type="text/plain",
    )
