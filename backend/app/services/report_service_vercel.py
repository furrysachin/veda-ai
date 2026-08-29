import os

from .pdf_service import render_pdf_pages

# Use /tmp for Vercel serverless
PROCESSED_DIR = "/tmp/processed"


def build_answer_sheet_pages(assessment_id, answer_pdf_path):
    """Build answer sheet pages using /tmp directory (Vercel-compatible)."""
    base_dir = os.path.join(
        PROCESSED_DIR,
        assessment_id,
        "answer-sheet"
    )
    
    # Ensure directory exists
    os.makedirs(base_dir, exist_ok=True)

    rendered = render_pdf_pages(
        answer_pdf_path,
        base_dir
    )

    pages = []

    for entry in rendered:
        page_number = entry["page"]
        image_path = entry["path"]
        
        # For Vercel, we'll read the image and convert to base64 in main_vercel.py
        # Here just return the path
        pages.append({
            "page": page_number,
            "image_path": image_path,
            "image_url": ""  # Will be set in main_vercel.py
        })

    return pages
