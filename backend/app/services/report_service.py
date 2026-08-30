import os

from .pdf_service import render_pdf_pages


def build_answer_sheet_pages(assessment_id, answer_path):
    from .pdf_service import is_image_file, render_image_to_page, render_pdf_pages

    base_dir = os.path.join(
        "processed",
        assessment_id,
        "answer-sheet"
    )

    if is_image_file(answer_path):
        rendered = render_image_to_page(answer_path, base_dir)
    else:
        rendered = render_pdf_pages(
            answer_path,
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
