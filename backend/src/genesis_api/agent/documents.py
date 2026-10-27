"""在模型无法原生读取文档时，复用 Docling 转换为会话文件。"""

from pathlib import Path
from zipfile import BadZipFile, ZipFile

MAX_BYTES = 20 * 1024 * 1024
MAX_TEXT_CHARS = 500_000


def validate_document(path: Path, mime_type: str) -> None:
    """限制文档大小和 DOCX 解压体积，不执行或访问文档内的引用。"""
    if not 0 < path.stat().st_size <= MAX_BYTES:
        raise ValueError("文档不能为空，且不能超过 20 MiB")
    if mime_type.endswith("wordprocessingml.document"):
        try:
            with ZipFile(path) as archive:
                if (
                    "word/document.xml" not in archive.namelist()
                    or sum(entry.file_size for entry in archive.infolist()) > MAX_BYTES
                ):
                    raise ValueError("DOCX 内容无效或解压后超过 20 MiB")
        except BadZipFile as error:
            raise ValueError("DOCX 文件内容无效") from error


def document_text(path: Path, mime_type: str) -> str:
    """通过 DoclingLoader 将 PDF/DOCX 转为 Markdown，纯文本保留原文。

    PDF 使用无需下载模型的原生文本管线，扫描件需改传页面图片。
    转换前限制为 200 页，转换后限制为 50 万字，不调用外部服务。

    Args:
        path: 已鉴权并校验的本地文档路径。
        mime_type: 由服务端验证的文档 MIME。

    Returns:
        供 DeepAgents read_file 分段阅读的文本。

    Raises:
        ValueError: 文件无效、为空或超过大小、页数、文字限制。
    """
    validate_document(path, mime_type)
    if mime_type == "text/plain":
        text = path.read_text(encoding="utf-8-sig").strip()
    else:
        from docling.datamodel.base_models import InputFormat
        from docling.document_converter import DocumentConverter, PdfFormatOption
        from docling.pipeline.native_pdf_pipeline import NativePdfPipeline
        from langchain_docling import DoclingLoader
        from langchain_docling.loader import ExportType

        converter = DocumentConverter(
            allowed_formats=[InputFormat.PDF, InputFormat.DOCX],
            format_options={InputFormat.PDF: PdfFormatOption(pipeline_cls=NativePdfPipeline)},
        )
        loader = DoclingLoader(
            file_path=str(path),
            converter=converter,
            export_type=ExportType.MARKDOWN,
            convert_kwargs={"max_num_pages": 200, "max_file_size": MAX_BYTES},
        )
        text = "\n\n".join(document.page_content for document in loader.lazy_load()).strip()
    if len(text) > MAX_TEXT_CHARS:
        raise ValueError("文档最多 200 页、50 万字，请拆分后上传")
    if not text:
        raise ValueError("未提取到文字，请使用可选取文字的文档，或上传页面图片")
    return text
