"""短期素材授权只用于请求校验，不进入访问日志。"""

import logging


class MediaReferenceLogFilter(logging.Filter):
    """隐藏 Uvicorn 访问记录中的素材授权查询参数。"""

    def filter(self, record: logging.LogRecord) -> bool:
        """保留方法、路径和状态，移除携带授权的查询部分。"""
        if isinstance(record.args, tuple) and len(record.args) == 5:
            args = list(record.args)
            path = args[2]
            if isinstance(path, str) and "/media/video-references/" in path:
                args[2] = path.partition("?")[0]
                record.args = tuple(args)
        return True


def protect_media_reference_logs() -> None:
    """重复装配应用时仍只安装一份日志过滤器。"""
    logger = logging.getLogger("uvicorn.access")
    if not any(isinstance(item, MediaReferenceLogFilter) for item in logger.filters):
        logger.addFilter(MediaReferenceLogFilter())
