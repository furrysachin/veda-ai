import re
from .pdf_service import extract_pdf_text, extract_image_text, is_image_file


QUESTION_PATTERN = re.compile(
    r"(?m)^\s*(?:Q|प्रश्न|Question|q)\s*[.:]?\s*(\d+)\s*[.:.\-]\s*"
)

SUBQUESTION_PATTERN = re.compile(
    r"(?m)^\s*\(\s*([a-zA-Z])\s*\)"
)


def normalize_text(text):

    text = text or ""

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


def extract_questions(
    file_path
):

    if is_image_file(file_path):
        pages = extract_image_text(file_path)
    else:
        pages = extract_pdf_text(
            file_path
        )

    questions = []

    for page_data in pages:

        page_number = page_data[
            "page"
        ]

        text = page_data[
            "text"
        ]

        matches = list(
            QUESTION_PATTERN.finditer(
                text
            )
        )

        for i, match in enumerate(
            matches
        ):

            number = int(
                match.group(1)
            )

            start = match.end()

            if i + 1 < len(matches):
                end = matches[
                    i + 1
                ].start()
            else:
                end = len(text)

            block = text[
                start:end
            ].strip()

            block = re.sub(
                r"\b(Physics|Chemistry|English)\b",
                "",
                block,
                flags=re.I
            )

            block = block.strip()

            sub_matches = list(
                SUBQUESTION_PATTERN.finditer(
                    block
                )
            )

            if sub_matches:

                for j, sub in enumerate(
                    sub_matches
                ):

                    letter = sub.group(
                        1
                    ).lower()

                    sub_start = sub.end()

                    if j + 1 < len(
                        sub_matches
                    ):
                        sub_end = sub_matches[
                            j + 1
                        ].start()
                    else:
                        sub_end = len(
                            block
                        )

                    question_text = normalize_text(
                        block[
                            sub_start:sub_end
                        ]
                    )

                    if not question_text:
                        continue

                    questions.append({
                        "question_id":
                            f"q_{number}_{letter}",

                        "display_number":
                            f"{number}({letter})",

                        "question_text":
                            question_text,

                        "page":
                            page_number
                    })

            else:

                question_text = normalize_text(
                    block
                )

                if not question_text:
                    continue

                questions.append({
                    "question_id":
                        f"q_{number}",

                    "display_number":
                        str(number),

                    "question_text":
                        question_text,

                    "page":
                        page_number
                })

    return questions
