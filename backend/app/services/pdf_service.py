import fitz
import os


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