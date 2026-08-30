import fitz
import os
import base64
import mimetypes
from ..config import GEMINI_API_KEY, GEMINI_MODEL


IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tiff"}


def is_image_file(path: str) -> bool:
    ext = os.path.splitext(path)[1].lower()
    return ext in IMAGE_EXTENSIONS


def _gemini_ocr_image(image_path: str) -> str:
    """Use Gemini Vision API to extract text from a single image."""
    import google.generativeai as genai

    if not GEMINI_API_KEY:
        raise RuntimeError("GEMINI_API_KEY not set for image OCR")

    genai.configure(api_key=GEMINI_API_KEY)
    model = genai.GenerativeModel(GEMINI_MODEL)

    with open(image_path, "rb") as f:
        image_data = f.read()

    mime, _ = mimetypes.guess_type(image_path)
    mime = mime or "image/png"

    response = model.generate_content([
        {"inline_data": {"mime_type": mime, "data": base64.b64encode(image_data).decode()}},
        "Extract ALL text from this image exactly as it appears. Preserve the original layout, line breaks, and formatting. Return ONLY the extracted text with no commentary."
    ])

    return response.text if response.text else ""


def extract_image_text(image_path: str) -> list:
    """Extract text from a single image file using Gemini Vision."""
    text = _gemini_ocr_image(image_path)
    return [{"page": 1, "text": text}]


def render_image_to_page(image_path: str, output_dir: str) -> list:
    """Copy an image file as a page into output_dir."""
    os.makedirs(output_dir, exist_ok=True)
    import shutil
    ext = os.path.splitext(image_path)[1].lower()
    filename = f"page-1{ext}"
    output_path = os.path.join(output_dir, filename)
    shutil.copy2(image_path, output_path)
    # Also save as PNG for consistent serving
    png_path = os.path.join(output_dir, "page-1.png")
    if ext != ".png":
        try:
            from PIL import Image
            img = Image.open(image_path)
            img.save(png_path, "PNG")
        except Exception:
            pass
    return [{"page": 1, "path": png_path}]


def extract_pdf_text(
    pdf_path
):
    doc = fitz.open(pdf_path)

    pages = []

    for index, page in enumerate(
        doc,
        start=1
    ):
        pages.append({
            "page": index,
            "text": page.get_text(
                "text"
            )
        })

    doc.close()

    return pages


def render_pdf_pages(
    pdf_path,
    output_dir
):
    os.makedirs(
        output_dir,
        exist_ok=True
    )

    doc = fitz.open(pdf_path)

    pages = []

    for index, page in enumerate(
        doc,
        start=1
    ):

        pix = page.get_pixmap(
            matrix=fitz.Matrix(
                2,
                2
            ),
            alpha=False
        )

        filename = (
            f"page-{index}.png"
        )

        output_path = os.path.join(
            output_dir,
            filename
        )

        pix.save(
            output_path
        )

        pages.append({
            "page": index,
            "path": output_path
        })

    doc.close()

    return pages