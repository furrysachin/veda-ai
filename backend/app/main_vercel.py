"""
VedaAI Backend — Vercel-compatible version
Uses /tmp for file storage, synchronous processing, no background threads.
"""
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import os
import re
import shutil
import uuid
import traceback
from typing import List, Dict, Any

# Import all services
from .services.question_service import extract_questions
from .services.mapping_service import map_answers_to_questions
from .services.evaluation_service import evaluate_answer
from .services.report_service_vercel import build_answer_sheet_pages

app = FastAPI(title="VedaAI Assessment API")

# Allow all origins for Vercel deployment
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Use /tmp for Vercel serverless (ephemeral but writable)
UPLOAD_DIR = "/tmp/uploads"
PROCESSED_DIR = "/tmp/processed"
os.makedirs(UPLOAD_DIR, exist_ok=True)
os.makedirs(PROCESSED_DIR, exist_ok=True)


# In-memory store (resets on cold start, but works for single request)
_assessments: Dict[str, Dict[str, Any]] = {}


def _get_assessment(assessment_id: str):
    return _assessments.get(assessment_id)


def _update_assessment(assessment_id: str, data: Dict[str, Any]):
    _assessments[assessment_id] = data


@app.post("/api/assessment/upload")
async def upload_assessment(
    questionPaper: UploadFile = File(...),
    answerSheet: UploadFile = File(...)
):
    """Upload both files and process synchronously (Vercel-compatible)."""
    assessment_id = str(uuid.uuid4())

    # Create directories
    q_dir = os.path.join(UPLOAD_DIR, "questions")
    a_dir = os.path.join(UPLOAD_DIR, "answers")
    os.makedirs(q_dir, exist_ok=True)
    os.makedirs(a_dir, exist_ok=True)

    # Save files
    question_ext = os.path.splitext(questionPaper.filename or "")[1] or ".pdf"
    answer_ext = os.path.splitext(answerSheet.filename or "")[1] or ".pdf"

    question_path = os.path.join(q_dir, f"{assessment_id}{question_ext}")
    answer_path = os.path.join(a_dir, f"{assessment_id}{answer_ext}")

    with open(question_path, "wb") as f:
        shutil.copyfileobj(questionPaper.file, f)

    with open(answer_path, "wb") as f:
        shutil.copyfileobj(answerSheet.file, f)

    # Store assessment
    assessment = {
        "assessment_id": assessment_id,
        "status": "uploaded",
        "question_path": question_path,
        "answer_path": answer_path,
    }
    _update_assessment(assessment_id, assessment)

    return JSONResponse({
        "assessment_id": assessment_id,
        "status": "uploaded"
    })


@app.post("/api/assessment/{assessment_id}/process")
async def process_assessment(assessment_id: str):
    """Process assessment synchronously (Vercel-compatible)."""
    assessment = _get_assessment(assessment_id)

    if not assessment:
        raise HTTPException(status_code=404, detail="Assessment not found")

    current_status = assessment.get("status")
    if current_status in ("processing", "completed"):
        return JSONResponse({
            "assessment_id": assessment_id,
            "status": current_status
        })

    assessment["status"] = "processing"
    assessment["progress"] = 1
    _update_assessment(assessment_id, assessment)

    try:
        # Run pipeline synchronously
        result = _run_pipeline_sync(assessment_id)
        return JSONResponse(result)
    except Exception as exc:
        traceback.print_exc()
        assessment["status"] = "failed"
        assessment["progress"] = 100
        assessment["message"] = f"Processing failed: {exc}"
        _update_assessment(assessment_id, assessment)
        raise HTTPException(status_code=500, detail=str(exc))


@app.get("/api/assessment/{assessment_id}/status")
async def assessment_status(assessment_id: str):
    """Get processing status."""
    assessment = _get_assessment(assessment_id)

    if not assessment:
        raise HTTPException(status_code=404, detail="Assessment not found")

    return JSONResponse({
        "assessment_id": assessment_id,
        "status": assessment.get("status", "unknown"),
        "progress": assessment.get("progress", 0),
        "stage": assessment.get("stage", ""),
        "message": assessment.get("message", "")
    })


@app.get("/api/assessment/{assessment_id}")
async def get_result(assessment_id: str):
    """Get final results."""
    assessment = _get_assessment(assessment_id)

    if not assessment:
        raise HTTPException(status_code=404, detail="Assessment not found")

    if "result" in assessment:
        return JSONResponse(assessment["result"])
    else:
        return JSONResponse({
            "assessment_id": assessment_id,
            "status": assessment.get("status", "unknown")
        })


def _run_pipeline_sync(assessment_id: str):
    """Synchronous pipeline for Vercel serverless."""
    assessment = _get_assessment(assessment_id)

    if not assessment:
        return {"error": "Assessment not found"}

    question_path = assessment["question_path"]
    answer_path = assessment["answer_path"]

    # Step 1: Extract questions
    _set_status(assessment_id, "processing", 10, "extracting_questions", "Reading question paper")
    questions = extract_questions(question_path)

    if not questions:
        _set_status(assessment_id, "failed", 100, "error", "No questions could be extracted")
        return {"error": "No questions could be extracted"}

    # Step 2: Map answers
    _set_status(assessment_id, "processing", 30, "ocr_answer_sheet", "Reading answer sheet")
    mapped_results, unmapped = map_answers_to_questions(questions, answer_path)

    # Step 3: Evaluate answers
    question_results = []
    total_questions = len(mapped_results)

    for idx, entry in enumerate(mapped_results):
        question = entry["question"]
        mapped = entry.get("mapped")
        is_duplicate = entry.get("duplicate", False)

        question_text = question.get("question_text", "")
        max_marks = 10

        if not mapped or is_duplicate:
            status = "UNMATCHED" if is_duplicate else "MISSING"
            feedback = "No answer was found for this question." if status == "MISSING" else "Multiple answer attempts were found; please review."

            eval_progress = 60 + int((idx + 1) / max(total_questions, 1) * 25)
            _set_status(assessment_id, "processing", eval_progress, "evaluating_answers", f"Question {idx + 1} of {total_questions}")

            question_results.append({
                "question_id": question.get("question_id"),
                "display_number": question.get("display_number"),
                "question_text": question_text,
                "max_marks": max_marks,
                "obtained_marks": 0.0,
                "status": status,
                "ai_feedback": feedback,
                "strengths": [],
                "improvements": [],
                "mapped_answer": mapped
            })
            continue

        # Get answer text for grading
        answer_text = mapped["raw_text"]

        # Remove question heading from answer text
        heading_pattern = re.compile(
            r"^\s*(?:Q\s*|प्रश्न\s*)?\d+\s*[.\:\-]\s*",
            re.IGNORECASE,
        )
        answer_text = heading_pattern.sub("", answer_text).strip()

        if not answer_text:
            answer_text = mapped["raw_text"]

        # Evaluate
        _set_status(assessment_id, "processing", 60 + int((idx + 1) / max(total_questions, 1) * 25), "evaluating_answers", f"Evaluating question {idx + 1} of {total_questions}")

        evaluation = evaluate_answer(question_text, answer_text)
        raw_score = evaluation.get("score", 0)

        try:
            score_value = float(raw_score)
        except (TypeError, ValueError):
            score_value = 0.0

        obtained = max(0.0, min(max_marks, round((score_value / 10.0) * max_marks, 2)))

        result_label = evaluation.get("result", "incorrect")

        if result_label == "evaluation_error":
            status = "NEEDS_REVIEW"
        elif obtained >= max_marks:
            status = "GRADED"
        elif obtained > 0:
            status = "GRADED"
        else:
            status = "NEEDS_REVIEW"

        question_results.append({
            "question_id": question.get("question_id"),
            "display_number": question.get("display_number"),
            "question_text": question_text,
            "max_marks": max_marks,
            "obtained_marks": obtained,
            "status": status,
            "ai_feedback": evaluation.get("feedback", ""),
            "strengths": evaluation.get("strengths", []) or [],
            "improvements": evaluation.get("improvements", []) or [],
            "mapped_answer": mapped
        })

    # Step 4: Build answer sheet pages
    _set_status(assessment_id, "processing", 85, "rendering_pages", "Rendering answer sheet previews")
    answer_sheet_pages = build_answer_sheet_pages(assessment_id, answer_path)

    # Convert page images to base64 for Vercel (no static file serving)
    import base64
    for page in answer_sheet_pages:
        image_path = page.get("image_path", "")
        if image_path and os.path.exists(image_path):
            with open(image_path, "rb") as f:
                page["image_data"] = base64.b64encode(f.read()).decode("utf-8")
            page["image_url"] = f"data:image/png;base64,{page['image_data']}"
        else:
            page["image_url"] = ""

    result = {
        "assessment_id": assessment_id,
        "status": "completed",
        "questions": question_results,
        "answer_sheet_pages": answer_sheet_pages
    }

    assessment["status"] = "completed"
    assessment["progress"] = 100
    assessment["stage"] = "completed"
    assessment["message"] = "Assessment ready"
    assessment["result"] = result
    _update_assessment(assessment_id, assessment)

    return result


def _set_status(assessment_id: str, status: str, progress: int, stage: str, message: str = ""):
    assessment = _get_assessment(assessment_id) or {}
    assessment.update({
        "status": status,
        "progress": progress,
        "stage": stage,
        "message": message
    })
    _update_assessment(assessment_id, assessment)
