import re
from rapidfuzz import fuzz

from .ocr_service import (
    extract_words,
    words_bbox,
    normalize_text,
)

# ============================================================
# MARKERS
# ============================================================

ANSWER_MARKER_PATTERN = re.compile(
    r"^\s*(?:Q\s*)?(\d+)"
    r"\s*(?:[\.\:\-\)]\s*)?"
    r"(?:\(\s*([a-zA-Z])\s*\))?"
    r"\s*$",
    re.IGNORECASE,
)

QUESTION_ID_PATTERN = re.compile(
    r"(\d+)"
    r"(?:[_\-]?\(?([a-zA-Z])\)?)?",
    re.IGNORECASE,
)

# ============================================================
# QUESTION ID
# ============================================================

def parse_question_id(question_id):
    if not question_id:
        return None, None

    value = str(question_id).strip()

    match = QUESTION_ID_PATTERN.search(value)

    if not match:
        return None, None

    number = int(match.group(1))

    letter = match.group(2)

    if letter:
        letter = letter.lower()

    return number, letter

# ============================================================
# LABEL
# ============================================================

def marker_label(number, letter=None):

    if letter:
        return f"{number}({letter})"

    return str(number)

# ============================================================
# NORMALIZE MARKER TEXT
# ============================================================

def normalize_marker(text):

    if not text:
        return ""

    text = str(text).strip()

    text = re.sub(
        r"\s+",
        "",
        text,
    )

    text = text.replace(
        "Q",
        "",
    )

    text = text.replace(
        "q",
        "",
    )

    return text

# ============================================================
# PARSE ANSWER MARKER
# ============================================================

def parse_answer_marker(text):

    if not text:
        return None

    original = str(text).strip()

    # Must start with Q, Ans, or be a standalone number
    # Reject if followed by date indicators (ई., ई.पू., AD, BC, etc.)
    date_indicators = re.compile(
        r"(?:ई\.?|ई\.?पू\.?|AD|BC|CE|BCE|th|st|nd|rd|"
        r"को|में|से|तक|तथा|एवं|"
        r"जनवरी|फरवरी|मार्च|अप्रैल|मई|जून|जुलाई|अगस्त|सितंबर|अक्टूबर|नवंबर|दिसंबर|"
        r"January|February|March|April|May|June|July|August|September|October|November|December|"
        r"स्थापनाएँ|स्थापना|स्थायी|अस्थायी|वर्ष|वीटो)",
        re.IGNORECASE,
    )
    if date_indicators.search(original):
        return None

    # Two variants:
    # 1. With prefix (Q, Ans, प्रश्न): punctuation after number is optional
    # 2. Without prefix: punctuation AFTER number is REQUIRED to avoid matching bare numbers in text
    pattern_with_prefix = re.compile(
        r"^(?:Q\s*|Ans(?:wer)?\.?\s*|प्रश्न\s*)"
        r"(\d+)"
        r"\s*"
        r"(?:"
        r"\(\s*([a-zA-Z])\s*\)"
        r"|"
        r"\s*([a-zA-Z])"
        r")?"
        r"\s*"
        r"[\.\:\-]?"
        r"$",
        re.IGNORECASE,
    )
    pattern_bare = re.compile(
        r"^(\d+)"
        r"\s*"
        r"(?:"
        r"\(\s*([a-zA-Z])\s*\)"
        r"|"
        r"\s*([a-zA-Z])"
        r")?"
        r"\s*"
        r"[\.\:\-]"  # Punctuation is REQUIRED for bare numbers
        r"$",
        re.IGNORECASE,
    )
    
    match = pattern_with_prefix.match(original)
    if not match:
        match = pattern_bare.match(original)

    if not match:
        return None

    number = int(match.group(1))

    # Reject years (numbers > 100 are likely years, not question numbers)
    # Questions are typically numbered 1-99
    if number > 99:
        return None

    letter = match.group(2) or match.group(3)

    if letter:
        letter = letter.lower()

    return number, letter

# ============================================================
# BUILD WORD TEXT
# ============================================================

def words_to_text(words):

    return normalize_text(
        " ".join(
            str(w.get("text", ""))
            for w in words
            if w.get("text")
        )
    )

# ============================================================
# FIND MARKERS ON PAGE
# ============================================================

def find_markers(words):

    markers = []
    used_indices = set()  # Track which word indices are part of multi-word markers

    # PASS 1: Multi-word patterns (must come first to claim indices)
    # 'Answer for Question N' / 'Answer for Q N' / 'for Question N' / 'Question N'
    multiword_re = re.compile(
        r"(?:answer\s+for\s+|for\s+)?(?:question|q)\s+(\d+)"
        r"(?:\s*\(.*?\))?",  # optional (topic)
        re.IGNORECASE,
    )
    for i in range(len(words)):
        # Try windows of 5, 4, 3 words starting at i
        for win in range(5, 2, -1):
            if i + win > len(words):
                continue
            phrase = " ".join(
                str(words[j].get("text", "")).strip()
                for j in range(i, i + win)
            )
            m = multiword_re.match(phrase)
            if m:
                num = int(m.group(1))
                if num <= 99:
                    # Mark all indices in this window as used
                    for j in range(i, i + win):
                        used_indices.add(j)
                    markers.append({
                        "number": num,
                        "letter": None,
                        "index": i,  # Start of phrase = segment start
                        "y0": float(words[i].get("y0", 0)),
                    })
                    break

    # PASS 2: Single-word patterns (only for unused indices)
    for index, word in enumerate(words):
        if index in used_indices:
            continue

        text = str(word.get("text", "")).strip()
        if not text:
            continue

        parsed = parse_answer_marker(text)
        if parsed:
            number, letter = parsed
            used_indices.add(index)
            markers.append({
                "number": number,
                "letter": letter,
                "index": index,
                "y0": float(word.get("y0", 0)),
            })

    # PASS 3: Two/three-word patterns for Q + ( + letter
    for i in range(len(words) - 2):
        if i in used_indices or (i + 1) in used_indices or (i + 2) in used_indices:
            continue

        a = str(words[i].get("text", "")).strip()
        b = str(words[i + 1].get("text", "")).strip()
        c = str(words[i + 2].get("text", "")).strip()

        if (
            re.fullmatch(r"(?:Q\s*|Ans(?:wer)?\.?)?\d+", a, re.IGNORECASE)
            and b == "("
            and re.fullmatch(r"[a-zA-Z]", c)
        ):
            number_match = re.search(r"\d+", a)
            if number_match:
                used_indices.update([i, i + 1, i + 2])
                markers.append({
                    "number": int(number_match.group()),
                    "letter": c.lower(),
                    "index": i,
                    "y0": float(words[i].get("y0", 0)),
                })

        # 'Q N' or 'Q N.' as two-word pattern
        if re.fullmatch(r"[Qq]", a) and re.fullmatch(r"\d+[:.]?", b, re.IGNORECASE):
            num_match = re.search(r"\d+", b)
            if num_match:
                num = int(num_match.group())
                if num <= 99:
                    used_indices.update([i, i + 1])
                    markers.append({
                        "number": num,
                        "letter": None,
                        "index": i,
                        "y0": float(words[i].get("y0", 0)),
                    })

    unique = {}

    for marker in markers:

        key = (
            marker["number"],
            marker["letter"],
        )

        if key not in unique:
            unique[key] = marker

    markers = list(
        unique.values()
    )

    markers.sort(
        key=lambda x: (
            x["y0"],
            x["index"],
        )
    )

    return markers

# ============================================================
# EXTRACT ANSWER SEGMENTS
# ============================================================

def find_answer_segments(pdf_path):

    pages_data = extract_words(
        pdf_path
    )

    segments = []

    pages_with_markers = {}

    for page_data in pages_data:

        page_number = page_data[
            "page"
        ]

        page_width = page_data[
            "width"
        ]

        page_height = page_data[
            "height"
        ]

        words = page_data[
            "words"
        ]

        if not words:
            continue

        markers = find_markers(
            words
        )

        pages_with_markers[page_number] = markers

        if not markers:
            continue

        for i, marker in enumerate(
            markers
        ):

            start = marker[
                "index"
            ]

            if i + 1 < len(markers):

                end = markers[
                    i + 1
                ]["index"]

            else:

                end = len(words)

            segment_words = words[
                start:end
            ]

            if not segment_words:
                continue

            text = words_to_text(
                segment_words
            )

            if len(text) < 2:
                continue

            segments.append(
                {
                    "number":
                        marker[
                            "number"
                        ],

                    "letter":
                        marker[
                            "letter"
                        ],

                    "page_number":
                        page_number,

                    "page_width":
                        page_width,

                    "page_height":
                        page_height,

                    "raw_text":
                        text,

                    "words":
                        segment_words,

                    "start_index":
                        start,

                    "end_index":
                        end,
                }
            )

    all_pages = {p["page"] for p in pages_data}
    pages_without_markers = sorted(all_pages - set(pages_with_markers.keys()))

    for page_num in pages_without_markers:
        page_data = next((p for p in pages_data if p["page"] == page_num), None)
        if not page_data or not page_data["words"]:
            continue

        page_width = page_data["width"]
        page_height = page_data["height"]
        words = page_data["words"]

        text = words_to_text(words)
        if len(text) < 2:
            continue

        segments.append({
            "number": None,
            "letter": None,
            "page_number": page_num,
            "page_width": page_width,
            "page_height": page_height,
            "raw_text": text,
            "words": words,
            "start_index": 0,
            "end_index": len(words),
            "is_continuation": True,
        })

    return segments, pages_with_markers

# ============================================================
# QUESTION TEXT SIMILARITY
# ============================================================

def question_similarity(
    question_text,
    answer_text,
):

    if not question_text or not answer_text:
        return 0.0

    q = normalize_text(
        question_text
    ).lower()

    a = normalize_text(
        answer_text
    ).lower()

    if not q or not a:
        return 0.0

    partial = fuzz.partial_ratio(
        q,
        a,
    )

    token = fuzz.token_set_ratio(
        q,
        a,
    )

    ratio = fuzz.ratio(
        q,
        a,
    )

    return (
        partial * 0.45
        + token * 0.40
        + ratio * 0.15
    )

# ============================================================
# SCORE ANSWER SEGMENT
# ============================================================

def score_segment(
    question,
    segment,
):

    q_number, q_letter = parse_question_id(
        question.get(
            "question_id"
        )
    )

    s_number = segment[
        "number"
    ]

    s_letter = segment[
        "letter"
    ]

    score = 0.0

    if q_number == s_number:

        score += 55

    else:

        score -= 20

    if q_letter:

        if s_letter == q_letter:

            score += 35

        elif s_letter is None:

            score += 5

        else:

            score -= 20

    else:

        if s_letter is None:

            score += 15

    similarity = question_similarity(
        question.get(
            "question_text",
            "",
        ),
        segment.get(
            "raw_text",
            "",
        ),
    )

    score += similarity * 0.35

    return score

# ============================================================
# FIND BEST ANSWER
# ============================================================

def best_match_for_question(
    question,
    segments,
):

    if not segments:
        return None, 0.0

    q_number, q_letter = parse_question_id(
        question.get(
            "question_id"
        )
    )

    # Only consider segments with matching question number
    # This prevents Q24 from getting Q23's answer
    exact_number_segments = [
        s for s in segments
        if s.get("number") == q_number
    ]

    if not exact_number_segments:
        return None, 0.0

    scored = []

    for segment in exact_number_segments:

        score = score_segment(
            question,
            segment,
        )

        scored.append(
            (
                segment,
                score,
            )
        )

    scored.sort(
        key=lambda x: x[1],
        reverse=True,
    )

    best, best_score = scored[0]

    return best, best_score

# ============================================================
# CHECK IF SEGMENT BELONGS TO QUESTION
# ============================================================

def same_question(
    question,
    segment,
):

    q_number, q_letter = parse_question_id(
        question.get(
            "question_id"
        )
    )

    if q_number != segment[
        "number"
    ]:
        return False

    if not q_letter:
        return segment[
            "letter"
        ] is None

    return (
        segment["letter"]
        == q_letter
    )

# ============================================================
# BUILD MAPPED ANSWER
# ============================================================

def build_mapped_answer(
    segment,
    question,
    mapping_method="question_marker",
):

    bbox_words = segment["words"][1:] if len(segment["words"]) > 1 else segment["words"]
    bbox = words_bbox(
        bbox_words,
        segment["page_width"],
        segment["page_height"],
    )

    number, letter = parse_question_id(
        question.get(
            "question_id"
        )
    )

    label = marker_label(
        number,
        letter,
    )

    confidence = 0.0
    if mapping_method == "question_marker":
        confidence = 0.90
    elif mapping_method == "fuzzy_match":
        confidence = 0.70
    elif mapping_method == "continuation":
        confidence = 0.80

    return {
        "page_number":
            segment[
                "page_number"
            ],

        "raw_text":
            segment[
                "raw_text"
            ],

        "bounding_box":
            bbox,

        "bounding_box_label":
            label,

        "confidence_score":
            confidence,

        "is_multipage":
            False,

        "additional_pages":
            [],

        "mapping_method":
            mapping_method,
    }

# ============================================================
# MERGE MULTI-PAGE ANSWER
# ============================================================

def merge_multipage_segments(
    question,
    first_segment,
    segments,
    pages_with_markers,
):

    q_number, q_letter = parse_question_id(
        question.get(
            "question_id"
        )
    )

    if not first_segment:
        return None

    selected = [
        first_segment
    ]

    first_page = first_segment[
        "page_number"
    ]

    for segment in segments:

        if segment is first_segment:
            continue

        if segment[
            "number"
        ] != q_number:
            continue

        if q_letter:

            if segment[
                "letter"
            ] != q_letter:
                continue

        else:

            if segment[
                "letter"
            ] is not None:
                continue

        if segment[
            "page_number"
        ] == first_page:
            continue

        selected.append(
            segment
        )

    for page_num in sorted(pages_with_markers.keys()):
        if page_num <= first_page:
            continue

        markers = pages_with_markers[page_num]
        has_marker = any(
            m["number"] == q_number and (q_letter is None or m["letter"] == q_letter)
            for m in markers
        )

        if not has_marker:
            page_data = next((s for s in segments if s["page_number"] == page_num and s.get("is_continuation")), None)
            if page_data:
                selected.append(page_data)

    selected.sort(
        key=lambda x: x[
            "page_number"
        ]
    )

    if len(selected) == 1:

        mapped = build_mapped_answer(
            selected[0],
            question,
            "question_marker",
        )

        mapped[
            "confidence_score"
        ] = 0.90

        return mapped

    main = selected[0]

    main_bbox = words_bbox(
        main["words"],
        main["page_width"],
        main["page_height"],
    )

    additional_pages = []

    all_text = []

    for segment in selected:

        all_text.append(
            segment[
                "raw_text"
            ]
        )

    for segment in selected[1:]:

        bbox = words_bbox(
            segment["words"],
            segment["page_width"],
            segment["page_height"],
        )

        method = "continuation" if segment.get("is_continuation") else "question_marker"

        additional_pages.append(
            {
                "page_number":
                    segment[
                        "page_number"
                    ],

                "bounding_box":
                    bbox,

                "raw_text":
                    segment[
                        "raw_text"
                    ],

                "mapping_method":
                    method,
            }
        )

    return {
        "page_number":
            main[
                "page_number"
            ],

        "raw_text":
            normalize_text(
                " ".join(
                    all_text
                )
            ),

        "bounding_box":
            main_bbox,

        "bounding_box_label":
            marker_label(
                q_number,
                q_letter,
            ),

        "confidence_score":
            0.92,

        "is_multipage":
            True,

        "additional_pages":
            additional_pages,

        "mapping_method":
            "question_marker",
    }

# ============================================================
# MAIN MAPPING
# ============================================================

def map_answers_to_questions(
    questions,
    pdf_path,
):

    segments, pages_with_markers = find_answer_segments(
        pdf_path
    )

    deduped = []

    seen = {}

    for segment in segments:

        key = (
            segment["number"],
            segment["letter"],
            segment["page_number"],
        )

        if key not in seen:

            seen[key] = segment

            deduped.append(
                segment
            )

        else:

            existing = seen[key]

            if len(
                segment.get(
                    "raw_text",
                    ""
                )
            ) > len(
                existing.get(
                    "raw_text",
                    ""
                )
            ):

                seen[key] = segment

                deduped = [
                    s for s in deduped
                    if not (
                        s["number"] == key[0]
                        and s["letter"] == key[1]
                        and s["page_number"] == key[2]
                    )
                ]

                deduped.append(
                    segment
                )

    segments = deduped

    results = []

    used_segment_keys = set()

    for question in questions:

        q_number, q_letter = parse_question_id(
            question.get(
                "question_id"
            )
        )

        exact_candidates = [
            s
            for s in segments
            if same_question(
                question,
                s
            )
        ]

        if exact_candidates:

            scored = []

            for segment in exact_candidates:

                similarity = question_similarity(
                    question.get(
                        "question_text",
                        "",
                    ),
                    segment.get(
                        "raw_text",
                        "",
                    ),
                )

                scored.append(
                    (
                        segment,
                        similarity,
                    )
                )

            scored.sort(
                key=lambda x: x[1],
                reverse=True,
            )

            best = scored[0][0]

            mapped = merge_multipage_segments(
                question,
                best,
                segments,
                pages_with_markers,
            )

            if mapped:

                used_segment_keys.add(
                    (
                        best[
                            "page_number"
                        ],
                        best[
                            "number"
                        ],
                        best[
                            "letter"
                        ],
                    )
                )

                for extra in mapped.get(
                    "additional_pages",
                    []
                ):

                    used_segment_keys.add(
                        (
                            extra[
                                "page_number"
                            ],
                            q_number,
                            q_letter,
                        )
                    )

                results.append(
                    {
                        "question":
                            question,

                        "mapped":
                            mapped,
                    }
                )

                continue

        best, best_score = best_match_for_question(
            question,
            segments,
        )

        if (
            best is None
            or best_score < 45
        ):

            results.append(
                {
                    "question":
                        question,

                    "mapped":
                        None,
                }
            )

            continue

        key = (
            best[
                "page_number"
            ],
            best[
                "number"
            ],
            best[
                "letter"
            ],
        )

        if key in used_segment_keys:

            results.append(
                {
                    "question":
                        question,

                    "mapped":
                        None,

                    "duplicate":
                        True,
                }
            )

            continue

        mapped = merge_multipage_segments(
            question,
            best,
            segments,
            pages_with_markers,
        )

        if mapped:

            used_segment_keys.add(
                key
            )

            confidence = min(
                0.98,
                max(
                    0.55,
                    best_score / 100,
                ),
            )

            mapped[
                "confidence_score"
            ] = round(
                confidence,
                2,
            )

            mapped[
                "mapping_method"
            ] = "fuzzy_match"

        results.append(
            {
                "question":
                    question,

                "mapped":
                    mapped,
            }
        )

    unmapped = []

    for segment in segments:

        key = (
            segment[
                "page_number"
            ],
            segment[
                "number"
            ],
            segment[
                "letter"
            ],
        )

        if key in used_segment_keys:
            continue

        if segment.get("is_continuation"):
            continue

        bbox = words_bbox(
            segment["words"],
            segment["page_width"],
            segment["page_height"],
        )

        unmapped.append(
            {
                "page_number":
                    segment[
                        "page_number"
                    ],

                "raw_text":
                    segment[
                        "raw_text"
                    ],

                "bounding_box":
                    bbox,

                "reason":
                    "NO_MATCHING_QUESTION",

                "confidence_score":
                    0.30,
            }
        )

    return results, unmapped