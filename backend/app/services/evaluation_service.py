import json
import re

from google import genai
from google.genai import types

from app.config import (
    GEMINI_API_KEY,
    GEMINI_MODEL
)


_client = None


def _get_client():
    global _client

    if _client is None:
        if not GEMINI_API_KEY:
            return None

        _client = genai.Client(
            api_key=GEMINI_API_KEY
        )

    return _client


def _grade_by_subject(
    question,
    student_answer
):

    q = question.lower()

    if any(
        k in q
        for k in [
            "newton",
            "force",
            "acceleration",
            "speed",
            "velocity",
            "power",
            "energy",
            "lift",
            "distance",
            "physics",
        ]
    ):

        return _grade_physics(
            question,
            student_answer
        )

    if any(
        k in q
        for k in [
            "chemical",
            "reaction",
            "element",
            "compound",
            "mixture",
            "isotopes",
            "ph",
            "balanced",
            "chemistry",
        ]
    ):

        return _grade_chemistry(
            question,
            student_answer
        )

    if any(
        k in q
        for k in [
            "synonym",
            "passive",
            "tense",
            "preposition",
            "figure of speech",
            "paragraph",
            "english",
        ]
    ):

        return _grade_english(
            question,
            student_answer
        )

    # Hindi / Indian history / social studies detection
    if any(
        k in q
        for k in [
            "विवेचना", "वर्णन", "कीजिए", "करें",
            "सभ्यता", "साम्राज्य", "क्रांति", "आंदोलन",
            "पतन", "कारण", "प्रभाव", "महत्व",
            "तुलना", "विशेषता", "स्थापना",
            "धर्म", "शासन", "प्रशासन",
            "इतिहास", "ऐतिहासिक",
            "भारत", "गांधी", "स्वतंत्रता",
            "द्वितीय विश्व", "प्रथम विश्व",
            "यूनान", "रोमन", "मुगल", "गुप्त",
            "लोकतंत्र", "उपनिवेशवाद",
            "वैश्वीकरण",
        ]
    ):

        return _grade_history(
            question,
            student_answer
        )

    return _grade_generic(
        question,
        student_answer
    )


def _grade_physics(
    question,
    student_answer
):

    prompt = f"""
You are VedaAI, an expert physics examiner.

QUESTION:
{question}

STUDENT ANSWER:
{student_answer}

Evaluate strictly.

PHYSICS GRADING RULES:

1. If the question asks for a law/definition/formula:
   - Must state the law clearly in words.
   - Must include the mathematical formula.
   - Missing formula = max 4/10 even if words are correct.
   - Missing units in numerical = -2 points.

2. If the question asks for a numerical:
   - Check: Given data, Formula used, Substitution, Calculation, Final answer with unit.
   - Any missing step = reduce score.
   - Wrong formula = incorrect.
   - Wrong calculation = partially correct or incorrect.

3. If the question asks for difference/example:
   - Must mention BOTH items clearly.
   - Must give at least one valid example for each.
   - Missing example = max 5/10.

4. If the question asks "explain why":
   - Must include the scientific reason.
   - Must mention the relevant principle/law.
   - Vague answer = max 3/10.

SCORING:
- 9-10: Complete, accurate, all steps/examples present.
- 7-8: Mostly complete, minor omission.
- 5-6: Partially correct, key point missing.
- 3-4: Incomplete, only a few points correct.
- 1-2: Mostly incorrect.
- 0: No relevant content.

Return JSON only.

{{
    "result": "correct",
    "score": 10,
    "feedback": "2-4 sentences referencing the actual answer.",
    "correctAnswer": "Ideal answer or missing key points.",
    "strengths": ["specific strength 1", "specific strength 2"],
    "improvements": ["most critical improvement", "next improvement"]
}}
"""

    return _call_gemini(
        prompt,
        question,
        student_answer
    )


def _grade_chemistry(
    question,
    student_answer
):

    prompt = f"""
You are VedaAI, an expert chemistry examiner.

QUESTION:
{question}

STUDENT ANSWER:
{student_answer}

Evaluate strictly.

CHEMISTRY GRADING RULES:

1. If the question asks for definitions (element, compound, mixture, isotopes):
   - Must define each term clearly.
   - Must give one correct example for each.
   - Missing example = max 5/10 per item.

2. If the question asks to balance a chemical equation:
   - All atoms must be balanced on both sides.
   - Missing coefficient = incorrect.

3. If the question asks about exothermic/endothermic:
   - Must define each correctly.
   - Must give one correct example for each.
   - Missing example = max 5/10.

4. If the question asks about pH:
   - Must explain what pH measures.
   - Must state what pH 7 means.
   - Partial answer = max 5/10.

5. If the question asks about conservation laws:
   - Must state the law correctly.
   - Must give a suitable example.
   - Missing example = max 5/10.

6. If the question asks for electronic configuration:
   - Must show correct distribution of electrons in shells.
   - Wrong configuration = incorrect.

SCORING:
- 9-10: Complete, accurate, all parts addressed.
- 7-8: Mostly complete, minor omission.
- 5-6: Partially correct, key point missing.
- 3-4: Incomplete, only a few points correct.
- 1-2: Mostly incorrect.
- 0: No relevant content.

Return JSON only.

{{
    "result": "correct",
    "score": 10,
    "feedback": "2-4 sentences referencing the actual answer.",
    "correctAnswer": "Ideal answer or missing key points.",
    "strengths": ["specific strength 1", "specific strength 2"],
    "improvements": ["most critical improvement", "next improvement"]
}}
"""

    return _call_gemini(
        prompt,
        question,
        student_answer
    )


def _grade_english(
    question,
    student_answer
):

    prompt = f"""
You are VedaAI, an expert English language examiner.

QUESTION:
{question}

STUDENT ANSWER:
{student_answer}

Evaluate strictly.

ENGLISH GRADING RULES:

1. If the question asks for tense identification:
   - Must name the correct tense.
   - Wrong tense = incorrect.

2. If the question asks for voice change:
   - Must follow passive voice rules correctly.
   - Must maintain the same tense as original.
   - Wrong voice or tense change = incorrect.

3. If the question asks for synonym/word substitution:
   - Must select the correct option.
   - Wrong option = incorrect.

4. If the question asks for preposition:
   - Must use the correct preposition.
   - Wrong preposition = incorrect.

5. If the question asks for error correction:
   - Must correct the error correctly.
   - Wrong correction = incorrect.

6. If the question asks for figure of speech:
   - Must identify the correct figure.
   - Wrong identification = incorrect.

7. If the question asks for paragraph writing:
   - Must address the topic.
   - Must be coherent.
   - Should have 3-4 sentences.
   - Vague or off-topic = max 5/10.

SCORING:
- 9-10: Complete, accurate, perfect grammar.
- 7-8: Mostly correct, minor error.
- 5-6: Partially correct, key error present.
- 3-4: Incomplete or mostly incorrect.
- 1-2: Wrong answer.
- 0: No relevant content.

Return JSON only.

{{
    "result": "correct",
    "score": 10,
    "feedback": "2-4 sentences referencing the actual answer.",
    "correctAnswer": "Ideal answer or missing key points.",
    "strengths": ["specific strength 1", "specific strength 2"],
    "improvements": ["most critical improvement", "next improvement"]
}}
"""

    return _call_gemini(
        prompt,
        question,
        student_answer
    )



def _grade_history(
    question,
    student_answer
):
    prompt = f"""
You are VedaAI, an expert Indian history and social studies examiner.

QUESTION:
{question}

STUDENT ANSWER:
{student_answer}

Evaluate strictly using these HISTORY GRADING RULES:

1. Descriptive (विवेचना/वर्णन) questions:
   - Must explain with multiple clear points (at least 3-4).
   - Must include specific historical facts, dates, names, or events.
   - Vague general statements without specifics = max 4/10.

2. Comparison (तुलना) questions:
   - Must clearly distinguish between the items being compared.
   - Must mention specific differences with examples.
   - Only similarities without differences = max 5/10.

3. Cause-effect (कारण/प्रभाव) questions:
   - Must list at least 3 distinct causes or effects.
   - Must explain the connection between cause and effect.
   - Only listing causes without explanation = max 5/10.

4. Significance (महत्व/विशेषता) questions:
   - Must mention at least 3 specific features or significance points.
   - Must connect to historical context.

SCORING:
- 9-10: Comprehensive, well-structured, specific facts with dates/names.
- 7-8: Good coverage with most key points present.
- 5-6: Partially correct, some key points missing.
- 3-4: Incomplete, mostly vague statements.
- 1-2: Mostly incorrect or off-topic.
- 0: No relevant content.

Return JSON only.

{{
    "result": "correct",
    "score": 10,
    "feedback": "2-4 sentences referencing the actual answer content.",
    "correctAnswer": "Ideal answer or missing key points.",
    "strengths": ["specific strength 1", "specific strength 2"],
    "improvements": ["most critical improvement", "next improvement"]
}}
"""

    return _call_gemini(
        prompt,
        question,
        student_answer
    )


def _grade_generic(
    question,
    student_answer
):

    prompt = f"""
You are VedaAI, an expert teacher.

QUESTION:
{question}

STUDENT ANSWER:
{student_answer}

Evaluate strictly.

RULES:

1. Read the question carefully and identify EVERY requirement.
2. Check if the student answered ALL parts.
3. Check factual accuracy.
4. Accept valid alternative wording.
5. Score from 0 to 10 based on completeness and accuracy.
6. feedback must reference the actual student answer.
7. correctAnswer must provide the ideal answer or missing points.
8. strengths must be specific.
9. improvements must be specific and ordered by priority.

Return JSON only.

{{
    "result": "correct",
    "score": 10,
    "feedback": "...",
    "correctAnswer": "",
    "strengths": [],
    "improvements": []
}}
"""

    return _call_gemini(
        prompt,
        question,
        student_answer
    )


def _call_gemini(
    prompt,
    question,
    student_answer
):

    try:

        client = _get_client()

        if client is None:
            return _local_fallback(
                question,
                student_answer
            )

        response = client.models.generate_content(
            model=GEMINI_MODEL,
            contents=prompt,
            config=types.GenerateContentConfig(
                temperature=0.1,
                max_output_tokens=1200,
                response_mime_type="application/json"
            )
        )

        text = response.text.strip()

        text = re.sub(
            r"^```json\s*",
            "",
            text
        )

        text = re.sub(
            r"\s*```$",
            "",
            text
        )

        result = json.loads(
            text
        )

        score = int(
            result.get(
                "score",
                0
            )
        )

        score = max(
            0,
            min(
                10,
                score
            )
        )

        result["score"] = score

        if score >= 9:
            result["result"] = "correct"
        elif score >= 7:
            result["result"] = "correct"
        elif score >= 5:
            result["result"] = "partially_correct"
        elif score >= 3:
            result["result"] = "partially_correct"
        else:
            result["result"] = "incorrect"

        result.setdefault(
            "feedback",
            ""
        )

        result.setdefault(
            "correctAnswer",
            ""
        )

        result.setdefault(
            "strengths",
            []
        )

        result.setdefault(
            "improvements",
            []
        )

        return result

    except Exception as e:
        return _local_fallback(
            question,
            student_answer
        )


def evaluate_answer(
    question,
    student_answer
):
    return _grade_by_subject(
        question,
        student_answer
    )


def _local_fallback(
    question,
    student_answer
):
    """Truly question-specific local fallback for Hindi history questions.
    
    Instead of generic word-count heuristics, this analyzes:
    1. What the question specifically asks about
    2. Whether the answer covers those specific topics
    3. Quality markers (dates, names, structure, reasoning)
    """
    answer = (student_answer or "").strip()
    q_lower = question.lower()
    a_lower = answer.lower()

    if not answer:
        return {
            "result": "incorrect",
            "score": 0,
            "feedback": "No answer was provided for this question.",
            "correctAnswer": "",
            "strengths": [],
            "improvements": ["Write a complete answer addressing all parts of the question."]
        }

    # --- Extract question topic ---
    # Remove question number prefix (e.g., "1." or "q_1")
    q_clean = re.sub(r"^\s*(?:\d+\.?\s*|Q\s*\d+\s*[.:\-]?\s*)", "", q_lower).strip()
    q_clean = re.sub(r"[?।!]+.*$", "", q_clean).strip()

    # Extract meaningful words from question (>= 3 chars, skip common Hindi stop words)
    stop_words = {
        "की", "के", "का", "है", "में", "से", "को", "पर", "ने", "और", "एवं",
        "तथा", "कि", "यह", "वह", "इस", "उस", "एक", "भी", "ही", "तो", "था",
        "थे", "हो", "हुआ", "हुए", "करें", "कीजिए", "करें।", "आप",
        "the", "and", "of", "in", "for", "is", "are", "was", "were",
        "to", "with", "by", "on", "at", "from", "that", "this",
    }
    q_words = [w for w in re.findall(r"[\u0900-\u097Fa-zA-Z]{2,}", q_clean) if w not in stop_words]

    # --- Analyze question type ---
    asks_describe = bool(re.search(r"विवेचना|वर्णन|कीजिए|describe|explain|elaborate", q_lower))
    asks_compare = bool(re.search(r"तुलना|तुलनात्मक|compare|difference|distinguish|विशेषताओं", q_lower))
    asks_causes = bool(re.search(r"कारण|प्रभाव|कारणों|reason|cause|effect|impact", q_lower))
    asks_why = bool(re.search(r"क्यों|why|reason|कारण", q_lower))
    asks_features = bool(re.search(r"विशेषता|feature|characteristic|nature", q_lower))
    asks_role = bool(re.search(r"भूमिका|role|contribution", q_lower))
    asks_importance = bool(re.search(r"महत्व|importance|significance", q_lower))

    # --- Analyze answer content ---
    a_words = [w for w in re.findall(r"[\u0900-\u097Fa-zA-Z]{2,}", a_lower) if w not in stop_words]
    a_word_count = len(answer.split())
    a_char_count = len(answer)

    # Count question keywords found in answer
    if q_words:
        q_keywords_found = [w for w in q_words if w in a_lower]
        keyword_coverage = len(q_keywords_found) / len(q_words)
    else:
        q_keywords_found = []
        keyword_coverage = 0.5

    # Structural markers
    bullet_count = len(re.findall(r"[•●○◦▪\-]\s|^\s*\d+[.)]\s", answer, re.MULTILINE))
    sentence_markers = len(re.split(r"[।.!?]+", answer))
    has_dates = bool(re.search(r"\b\d{3,4}\b", answer))
    has_names = bool(re.search(r"[\u0900-\u097F]{4,}", answer))  # Long Hindi words = likely names/terms
    has_reasoning = bool(re.search(
        r"क्योंकि|इसलिए|अतः|परिणामस्वरूप|जिससे|फलस्वरूप|"
        r"because|therefore|thus|hence|consequently",
        a_lower
    ))
    has_comparison = bool(re.search(
        r"जबकि|वहीं|इसके विपरीत|दूसरी ओर|तुलना में|"
        r"whereas|while|on the other hand|in contrast|however|unlike",
        a_lower
    ))
    has_examples = bool(re.search(
        r"उदाहरण|जैसे|मसलन|"
        r"example|such as|for instance|e\.g\.",
        a_lower
    ))

    # --- Score each dimension independently ---
    strengths = []
    improvements = []
    total = 0

    # 1. TOPIC RELEVANCE (0-3 points) — Does answer address what question asks?
    if keyword_coverage >= 0.5:
        total += 3
        strengths.append(f"Answer addresses the core topic well ({len(q_keywords_found)}/{len(q_words)} key terms covered)")
    elif keyword_coverage >= 0.3:
        total += 2
        strengths.append(f"Partially addresses the question topic ({len(q_keywords_found)}/{len(q_words)} key terms found)")
        missing = [w for w in q_words if w not in a_lower][:3]
        if missing:
            improvements.append(f"Include discussion of: {', '.join(missing)}")
    else:
        total += 1
        improvements.append(f"Answer does not adequately cover the question's main topic. Key missing concepts: {', '.join(q_words[:3])}")

    # 2. DEPTH & DETAIL (0-3 points)
    if a_word_count >= 100 or a_char_count >= 500:
        total += 3
        strengths.append("Detailed and comprehensive with extensive coverage")
    elif a_word_count >= 50 or a_char_count >= 250:
        total += 2
        strengths.append("Good depth with adequate explanation")
    elif a_word_count >= 25 or a_char_count >= 100:
        total += 1
        strengths.append("Basic answer present but needs more elaboration")
    else:
        improvements.append("Answer is too brief — expand with detailed points and explanations")

    # 3. STRUCTURE & ORGANIZATION (0-2 points)
    if bullet_count >= 3 or sentence_markers >= 5:
        total += 2
        strengths.append("Well-organized with clear structure and multiple points")
    elif bullet_count >= 1 or sentence_markers >= 3:
        total += 1
        strengths.append("Shows reasonable structure")
    else:
        improvements.append("Organize the answer using bullet points or numbered sections")

    # 4. QUESTION-TYPE SPECIFIC (0-2 points)
    type_score = 0
    if asks_describe:
        if has_dates and has_reasoning:
            type_score = 2
            strengths.append("Includes historical dates and cause-effect reasoning for descriptive answer")
        elif has_dates or has_reasoning:
            type_score = 1
            if not has_dates:
                improvements.append("Add specific dates and time periods to strengthen the descriptive answer")
            if not has_reasoning:
                improvements.append("Include cause-effect analysis (क्योंकि/इसलिए) for deeper explanation")
        else:
            improvements.append("Add specific dates, events, and reasoning for a stronger descriptive answer")

    elif asks_compare:
        if has_comparison:
            type_score = 2
            strengths.append("Uses comparison words to clearly distinguish concepts")
        else:
            improvements.append("Use comparison words (जबकि/वहीं/whereas) to clearly differentiate")

    elif asks_causes:
        cause_count = len(re.findall(r"कारण|reason|cause|प्रभाव|effect|impact", a_lower))
        if cause_count >= 3:
            type_score = 2
            strengths.append("Lists multiple causes/effects with analysis")
        elif cause_count >= 1:
            type_score = 1
            improvements.append("List more distinct causes or effects with separate points")
        else:
            improvements.append("Address specific causes and effects as asked in the question")

    elif asks_why:
        if has_reasoning:
            type_score = 2
            strengths.append("Provides clear reasoning for why")
        else:
            improvements.append("Explain the 'why' with explicit reasoning (क्योंकि/इसलिए)")

    elif asks_features or asks_importance:
        feature_count = len(re.findall(r"विशेषता|feature|महत्व|importance|प्रमुख|main|key", a_lower))
        if feature_count >= 2:
            type_score = 2
            strengths.append("Lists key features/significance points")
        else:
            improvements.append("List more specific features or points of significance")

    elif asks_role:
        if any(w in a_lower for w in ["भूमिका", "role", "योगदान", "contribution"]):
            type_score = 2
            strengths.append("Addresses the role/contribution asked in the question")
        else:
            improvements.append("Directly address the specific role or contribution asked")

    total += type_score

    # 5. EVIDENCE & EXAMPLES (0-1 point)
    if has_examples:
        total += 1
        strengths.append("Provides supporting examples")
    elif has_dates:
        total += 1
        strengths.append("References specific dates/historical events")
    elif a_word_count > 40:
        improvements.append("Add specific examples, dates, or historical references to support your points")

    # Clamp score 0-10
    score = max(0, min(10, total))

    # Build UNIQUE, SPECIFIC feedback for each question
    q_topic = q_words[0] if q_words else question[:30]
    first_sentence = answer.split("।")[0].strip()[:80] if answer else ""
    answer_summary = answer[:100].strip() + ("..." if len(answer) > 100 else "")

    # Count unique Hindi terms in answer (not in question) as bonus knowledge
    answer_only_terms = [w for w in a_words if w not in q_lower and len(w) >= 3]
    unique_knowledge = answer_only_terms[:5]

    if score >= 8:
        result = "correct"
        fb_parts = [f"Excellent answer on '{q_topic}'."]
        if has_dates:
            date_matches = re.findall(r"\b\d{3,4}\b", answer)
            fb_parts.append(f"Good use of historical dates ({', '.join(date_matches[:3])}).")
        if has_reasoning:
            fb_parts.append("Includes cause-effect reasoning which strengthens the answer.")
        if has_examples:
            fb_parts.append("Well supported with examples.")
        if unique_knowledge:
            fb_parts.append(f"References: {', '.join(unique_knowledge[:3])}.")
        elif first_sentence:
            fb_parts.append(f"Answer opens with: '{first_sentence}.'")
        feedback = " ".join(fb_parts)
    elif score >= 5:
        result = "partially_correct"
        fb_parts = [f"Answer partially covers '{q_topic}'."]
        missing = [w for w in q_words if w not in a_lower][:2]
        if missing:
            fb_parts.append(f"Missing key concepts: {', '.join(missing)}.")
        if not has_dates and asks_describe:
            fb_parts.append("No specific dates or time periods mentioned.")
        if not has_reasoning and asks_causes:
            fb_parts.append("Cause-effect relationships not clearly explained.")
        if not has_comparison and asks_compare:
            fb_parts.append("Comparison between items is not explicit.")
        if a_word_count < 30:
            fb_parts.append(f"Only {a_word_count} words — too brief for a complete answer.")
        elif unique_knowledge:
            fb_parts.append(f"Includes some relevant terms: {', '.join(unique_knowledge[:2])}.")
        feedback = " ".join(fb_parts)
    else:
        result = "incorrect"
        fb_parts = [f"Answer does not adequately address '{q_topic}'."]
        if not answer.strip():
            fb_parts.append("No answer content found.")
        elif a_word_count < 10:
            fb_parts.append(f"Answer is only {a_word_count} words — far too brief.")
            fb_parts.append(f"Current content: '{answer_summary}'.")
        else:
            fb_parts.append(f"Content found but does not match what was asked.")
        missing = q_words[:3]
        if missing:
            fb_parts.append(f"Expected discussion about: {', '.join(missing)}.")
        feedback = " ".join(fb_parts)

    # Ensure at least one improvement
    if not improvements:
        improvements = ["Add more specific facts, dates, and examples to strengthen the answer"]

    # Ensure at least one strength if score > 0
    if not strengths and score > 0:
        strengths = ["Attempted to answer the question"]

    return {
        "result": result,
        "score": score,
        "feedback": feedback,
        "correctAnswer": "",
        "strengths": strengths[:3],
        "improvements": improvements[:3]
    }
