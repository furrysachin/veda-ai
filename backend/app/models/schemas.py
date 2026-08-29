from pydantic import BaseModel
from typing import Literal, List


class QuestionResult(BaseModel):
    question_id: str

    display_number: str

    question_text: str

    max_marks: float

    obtained_marks: float

    status: Literal[
        "GRADED",
        "MISSING",
        "UNMATCHED",
        "NEEDS_REVIEW"
    ]

    ai_feedback: str

    strengths: List[
        str
    ]

    improvements: List[
        str
    ]

    mapped_answer: dict = {}


class AnswerSheetPage(BaseModel):
    page: int
    image_url: str


class AssessmentResult(BaseModel):
    assessment_id: str

    status: Literal[
        "completed",
        "processing",
        "failed"
    ]

    questions: List[
        QuestionResult
    ]

    answer_sheet_pages: List[
        AnswerSheetPage
    ]
