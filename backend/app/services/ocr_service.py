import fitz
import re
import io
from typing import Optional

try:
    import pytesseract
    from pdf2image import convert_from_path
    from PIL import Image
    TESSERACT_AVAILABLE = True
except ImportError:
    TESSERACT_AVAILABLE = False


def normalize_text(text):
    if not text:
        return ""

    text = str(text)

    text = text.replace(
        "\u00a0",
        " "
    )

    text = re.sub(
        r"\s+",
        " ",
        text
    )

    return text.strip()


def extract_words_pymupdf(pdf_path):
    doc = fitz.open(pdf_path)

    pages = []

    for page_number, page in enumerate(doc, start=1):
        words = page.get_text("words")

        page_words = []

        for word in words:
            x0, y0, x1, y1, text, block, line, word_no = word

            page_words.append({
                "text": text,
                "x0": x0,
                "y0": y0,
                "x1": x1,
                "y1": y1,
                "block": block,
                "line": line,
                "word": word_no
            })

        pages.append({
            "page": page_number,
            "words": page_words,
            "width": page.rect.width,
            "height": page.rect.height
        })

    doc.close()
    return pages


def extract_words_tesseract(pdf_path, dpi=300):
    if not TESSERACT_AVAILABLE:
        return []

    pages = []

    images = convert_from_path(pdf_path, dpi=dpi)

    for page_number, image in enumerate(images, start=1):
        img_width, img_height = image.size

        ocr_data = pytesseract.image_to_data(
            image,
            output_type=pytesseract.Output.DICT,
            config="--psm 6"
        )

        page_words = []
        n_boxes = len(ocr_data["text"])

        for i in range(n_boxes):
            text = ocr_data["text"][i].strip()
            if not text:
                continue

            conf = int(ocr_data["conf"][i]) if ocr_data["conf"][i] != "-1" else 0
            if conf < 30:
                continue

            x = ocr_data["left"][i]
            y = ocr_data["top"][i]
            w = ocr_data["width"][i]
            h = ocr_data["height"][i]

            page_words.append({
                "text": text,
                "x0": x,
                "y0": y,
                "x1": x + w,
                "y1": y + h,
                "block": ocr_data["block_num"][i],
                "line": ocr_data["line_num"][i],
                "word": ocr_data["word_num"][i],
                "confidence": conf
            })

        pages.append({
            "page": page_number,
            "words": page_words,
            "width": img_width,
            "height": img_height
        })

    return pages


def extract_words_image(image_path):
    """Extract words from a single image using Gemini Vision."""
    import base64
    import mimetypes
    from ..config import GEMINI_API_KEY, GEMINI_MODEL

    if not GEMINI_API_KEY:
        return []

    try:
        import google.generativeai as genai
        genai.configure(api_key=GEMINI_API_KEY)
        model = genai.GenerativeModel(GEMINI_MODEL)

        with open(image_path, "rb") as f:
            image_data = f.read()

        mime, _ = mimetypes.guess_type(image_path)
        mime = mime or "image/png"

        response = model.generate_content([
            {"inline_data": {"mime_type": mime, "data": base64.b64encode(image_data).decode()}},
            "Extract ALL text from this image. For each word or text fragment, return a JSON array like: [{\"text\": \"word\", \"x0\": 10, \"y0\": 20, \"x1\": 50, \"y1\": 35}]. Use pixel coordinates relative to the image. Return ONLY the JSON array."
        ])

        import json
        text = response.text.strip()
        if text.startswith("["):
            words = json.loads(text)
        else:
            # Fallback: treat whole text as one block
            words = [{"text": text, "x0": 0, "y0": 0, "x1": 100, "y1": 100}]

        from PIL import Image
        img = Image.open(image_path)
        img_w, img_h = img.size

        page_words = []
        for w in words:
            page_words.append({
                "text": w.get("text", ""),
                "x0": float(w.get("x0", 0)),
                "y0": float(w.get("y0", 0)),
                "x1": float(w.get("x1", img_w)),
                "y1": float(w.get("y1", img_h)),
                "block": 0,
                "line": 0,
                "word": len(page_words),
            })

        return [{"page": 1, "words": page_words, "width": img_w, "height": img_h}]
    except Exception as e:
        print(f"[OCR] Image extraction failed: {e}")
        return []


def extract_words(pdf_path, force_ocr=False):
    # Handle image files directly
    from .pdf_service import is_image_file
    if is_image_file(pdf_path):
        return extract_words_image(pdf_path)

    if force_ocr:
        tesseract_pages = extract_words_tesseract(pdf_path)
        if tesseract_pages:
            return tesseract_pages

    pymupdf_pages = extract_words_pymupdf(pdf_path)

    total_words = sum(len(p["words"]) for p in pymupdf_pages)
    total_chars = sum(len(" ".join(w["text"] for w in p["words"])) for p in pymupdf_pages)

    if total_chars < 100 and TESSERACT_AVAILABLE:
        tesseract_pages = extract_words_tesseract(pdf_path)
        if tesseract_pages:
            tesseract_chars = sum(len(" ".join(w["text"] for w in p["words"])) for p in tesseract_pages)
            if tesseract_chars > total_chars:
                return tesseract_pages

    return pymupdf_pages


def words_bbox(words, page_width, page_height):
    if not words:
        return [0, 0, 0, 0]

    x0 = min(w["x0"] for w in words)
    y0 = min(w["y0"] for w in words)
    x1 = max(w["x1"] for w in words)
    y1 = max(w["y1"] for w in words)

    ymin = (y0 / page_height) * 1000
    xmin = (x0 / page_width) * 1000
    ymax = (y1 / page_height) * 1000
    xmax = (x1 / page_width) * 1000

    return [ymin, xmin, ymax, xmax]


def get_page_image(pdf_path, page_number, dpi=300):
    if not TESSERACT_AVAILABLE:
        return None

    images = convert_from_path(pdf_path, dpi=dpi, first_page=page_number, last_page=page_number)
    return images[0] if images else None