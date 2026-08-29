import os
import uuid
import shutil
import traceback
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.responses import JSONResponse
from typing import List, Dict, Any

from .question_service import extract_questions
from .mapping_service import map_answers_to_questions
from .evaluation_service import evaluate_answer
from .report_service import build_answer_sheet_pages
from .assessment_store import create_assessment, get_assessment, update_assessment

app = FastAPI(title="VedaAI Assessment API")

@app.post("/upload")
async def upload_assessment(questionPaper: UploadFile = File(...), answerSheet: UploadFile = File(...)):
    assessment_id = str(uuid.uuid4())
    
    os.makedirs("uploads/questions", exist_ok=True)
    os.makedirs("uploads/answers", exist_ok=True)
    
    question_ext = os.path.splitext(questionPaper.filename or "")[1] or ".pdf"
    answer_ext = os.path.splitext(answerSheet.filename or "")[1] or ".pdf"
    
    question_path = os.path.join("uploads/questions", f"{assessment_id}{question_ext}")
    answer_path = os.path.join("uploads/answers", f"{assessment_id}{answer_ext}")
    
    with open(question_path, "wb") as f:
        shutil.copyfileobj(questionPaper.file, f)
    
    with open(answer_path, "wb") as f:
        shutil.copyfileobj(answerSheet.file, f)
    
    create_assessment(assessment_id, {
        "assessment_id": assessment_id,
        "status": "uploaded",
        "question_path": question_path,
        "answer_path": answer_path
    })
    
    return JSONResponse({
        "assessment_id": assessment_id,
        "status": "uploaded"
    })

@app.post("/{assessment_id}/process")
async def process_assessment(assessment_id: str):
    assessment = get_assessment(assessment_id)
    
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
    assessment["stage"] = "starting"
    assessment["message"] = "Processing started"
    update_assessment(assessment_id, assessment)
    
    import threading
    threading.Thread(target=_run_pipeline, args=(assessment_id,)).start()
    
    return JSONResponse({
        "assessment_id": assessment_id,
        "status": "processing"
    })

@app.get("/{assessment_id}/status")
async def assessment_status(assessment_id: str):
    assessment = get_assessment(assessment_id)
    
    if not assessment:
        raise HTTPException(status_code=404, detail="Assessment not found")
    
    return JSONResponse({
        "assessment_id": assessment_id,
        "status": assessment.get("status", "unknown"),
        "progress": assessment.get("progress", 0),
        "stage": assessment.get("stage", ""),
        "message": assessment.get("message", "")
    })

@app.get("/{assessment_id}")
async def get_result(assessment_id: str):
    assessment = get_assessment(assessment_id)
    
    if not assessment:
        raise HTTPException(status_code=404, detail="Assessment not found")
    
    if "result" in assessment:
        return JSONResponse(assessment["result"])
    else:
        return JSONResponse({
            "assessment_id": assessment_id,
            "status": assessment.get("status", "unknown")
        })

# Pipeline function
def _run_pipeline(assessment_id):
    try:
        assessment = get_assessment(assessment_id)
        
        if not assessment:
            return
        
        question_path = assessment["question_path"]
        answer_path = assessment["answer_path"]
        
        # Extract questions
        _set_status(assessment_id, "processing", 5, "extracting_questions", "Reading question paper")
        questions = extract_questions(question_path)
        
        if not questions:
            _set_status(assessment_id, "failed", 100, "extracting_questions", "No questions could be extracted")
            return
        
        # Map answers
        _set_status(assessment_id, "processing", 30, "ocr_answer_sheet", "Reading answer sheet")
        mapped_results, unmapped = map_answers_to_questions(questions, answer_path)
        
        # Evaluate answers
        _set_status(assessment_id, "processing", 60, "evaluating_answers", "Evaluating answers with Gemini")
        
        question_results = []
        for entry in mapped_results:
            question = entry["question"]
            mapped = entry.get("mapped")
            is_duplicate = entry.get("duplicate", False)
            
            question_text = question.get("question_text", "")
            max_marks = 10
            
            if not mapped or is_duplicate:
                status = "UNMATCHED" if is_duplicate else "MISSING"
                feedback = "No answer was found for this question." if status == "MISSING" else "Multiple answer attempts were found; please review."
                
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
            
            evaluation = evaluate_answer(question_text, mapped["raw_text"])
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
        
        # Build answer sheet pages
        _set_status(assessment_id, "processing", 85, "rendering_pages", "Rendering answer sheet previews")
        answer_sheet_pages = build_answer_sheet_pages(assessment_id, answer_path)
        
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
        update_assessment(assessment_id, assessment)
        
    except Exception as exc:
        traceback.print_exc()
        _set_status(assessment_id, "failed", 100, "error", f"Processing failed: {exc}")

# Helper function
def _set_status(assessment_id, status, progress, stage, message=""):
    assessment = get_assessment(assessment_id) or {}
    assessment.update({
        "status": status,
        "progress": progress,
        "stage": stage,
        "message": message
    })
    update_assessment(assessment_id, assessment)