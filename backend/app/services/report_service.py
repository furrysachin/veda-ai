import os

from .pdf_service import render_pdf_pages


def build_answer_sheet_pages(assessment_id, answer_pdf_path):
    base_dir = os.path.join(
        "processed",
        assessment_id,
        "answer-sheet"
    )

    rendered = render_pdf_pages(
        answer_pdf_path,
        base_dir
    )

    pages = []

    for entry in rendered:
        page_number = entry["page"]
        image_url = (
            f"/processed/{assessment_id}"
            f"/answer-sheet/page-{page_number}.png"
        )

        pages.append({
            "page": page_number,
            "image_url": image_url
        })

    return pages
