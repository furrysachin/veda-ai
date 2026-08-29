# VedaAI — AI-Powered Assessment Extraction & Answer Mapping

An intelligent web application that extracts questions from question papers, matches them with answers from answer sheets using OCR, and provides AI-powered evaluation with detailed feedback.

## 🚀 Features

- **PDF Upload & Processing** — Upload question papers and answer sheets (PDF, PNG, JPG, WEBP up to 10MB)
- **OCR Text Extraction** — Extract text from PDFs using PyMuPDF with Tesseract fallback
- **Question Detection** — Automatically identify and number questions from the question paper
- **Answer Matching** — Map answers to questions using marker detection + fuzzy matching
- **Multi-page Answer Highlighting** — Highlight complete answers across multiple pages
- **AI Evaluation** — Grade answers using Gemini AI with subject-specific grading rubrics
- **Smart Feedback** — Question-specific strengths, improvements, and detailed analysis
- **Real-time Progress** — Live progress bar with stage indicators during processing
- **Responsive Design** — Mobile-first UI that works on phones, tablets, and desktops
- **Firebase Authentication** — Email/password and Google sign-in
- **School Profiles** — Store school name and logo during signup

---

## 📁 Project Structure

```
veda-ai/
├── public/                    # Static assets (images, favicon)
├── src/                       # Frontend source code
│   ├── App.tsx                # Main app component (all views)
│   ├── main.tsx               # React entry point
│   ├── index.css              # Global styles, scrollbar, animations
│   ├── context/
│   │   └── AuthContext.tsx     # Firebase auth provider
│   └── lib/
│       └── firebase.ts        # Firebase initialization
├── backend/                   # Python FastAPI backend
│   ├── app/
│   │   ├── main.py            # FastAPI app, routes, pipeline
│   │   ├── config.py          # Environment variables
│   │   ├── services/
│   │   │   ├── ocr_service.py         # PDF text extraction (PyMuPDF/Tesseract)
│   │   │   ├── question_service.py    # Question pattern detection
│   │   │   ├── mapping_service.py     # Answer-to-question matching
│   │   │   ├── evaluation_service.py  # AI grading (Gemini + local fallback)
│   │   │   ├── report_service.py      # Answer sheet page rendering
│   │   │   └── pdf_service.py         # PDF to image conversion
│   │   ├── models/
│   │   │   └── schemas.py     # Pydantic models
│   │   ├── routes/
│   │   │   └── assessment.py  # API route definitions
│   │   └── storage/
│   │       └── assessment_store.py  # In-memory assessment storage
│   └── requirements.txt       # Python dependencies
├── .env                       # Environment variables
├── package.json               # Node.js dependencies
├── vite.config.ts             # Vite configuration
├── tsconfig.json              # TypeScript configuration
└── tailwind.config.js         # Tailwind CSS configuration
```

---

## 🛠️ Tech Stack

### Frontend
| Technology | Version | Purpose |
|-----------|---------|---------|
| React | 19.2.6 | UI framework |
| TypeScript | 5.9.3 | Type safety |
| Vite | 7.3.2 | Build tool & dev server |
| Tailwind CSS | 4.1.17 | Utility-first styling |
| Framer Motion | 13.1.1 | Animations & transitions |
| Firebase | 12.18.0 | Authentication |
| PDF.js | 5.6.205 | Client-side PDF rendering |

### Backend
| Technology | Purpose |
|-----------|---------|
| FastAPI | REST API framework |
| Uvicorn | ASGI server |
| PyMuPDF (fitz) | PDF text extraction |
| RapidFuzz | Fuzzy text matching |
| Google Gemini AI | Answer evaluation |
| ReportLab | PDF page rendering |
| Pydantic | Data validation |

---

## ⚡ Quick Start

### Prerequisites
- **Node.js** 18+ and npm
- **Python** 3.10+
- **Tesseract OCR** (optional, for scanned PDFs)

### 1. Clone & Install Frontend

```bash
git clone <repo-url>
cd veda-ai
npm install
```

### 2. Install Backend Dependencies

```bash
cd backend
pip install -r requirements.txt
```

### 3. Configure Environment Variables

Create a `.env` file in the project root:

```env
# Backend API
VITE_API_URL=http://localhost:8001

# Firebase (optional — app works without auth in dev mode)
VITE_FIREBASE_API_KEY=your_api_key
VITE_FIREBASE_AUTH_DOMAIN=your_project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your_project_id
VITE_FIREBASE_STORAGE_BUCKET=your_project.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
VITE_FIREBASE_APP_ID=your_app_id
```

Backend config in `backend/app/config.py` reads from environment:
```env
GEMINI_API_KEY=your_gemini_api_key
GEMINI_MODEL=gemini-3.7-flash
```

### 4. Start Backend Server

```bash
cd backend
uvicorn app.main:app --host 0.0.0.0 --port 8001 --reload
```

Backend runs at `http://localhost:8001`  
API docs at `http://localhost:8001/docs`

### 5. Start Frontend Dev Server

```bash
# From project root
npm run dev
```

Frontend runs at `http://localhost:5173`

---

## 📡 API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/assessment/upload` | Upload question paper + answer sheet |
| `POST` | `/api/assessment/{id}/process` | Start processing pipeline |
| `GET` | `/api/assessment/{id}/status` | Get processing status & progress |
| `GET` | `/api/assessment/{id}` | Get final results |

### Upload Request
```bash
curl -X POST http://localhost:8001/api/assessment/upload \
  -F "questionPaper=@question.pdf" \
  -F "answerSheet=@answer.pdf"
```

Response:
```json
{
  "assessment_id": "uuid-here",
  "status": "uploaded"
}
```

### Process & Poll
```bash
# Start processing
curl -X POST http://localhost:8001/api/assessment/{id}/process

# Poll status (frontend does this every 500ms)
curl http://localhost:8001/api/assessment/{id}/status

# Get results when completed
curl http://localhost:8001/api/assessment/{id}
```

---

## 🔄 Processing Pipeline

```
Upload PDFs
    │
    ▼
┌─────────────────────┐
│ 1. Extract Questions │  question_service.py
│    (Question Paper)  │  Pattern: "Q 1." / "प्रश्न 1."
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│ 2. OCR Answer Sheet  │  ocr_service.py
│    (PyMuPDF/Tesseract)│  Extract words + bounding boxes
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│ 3. Find Markers      │  mapping_service.py
│    (Answer Numbers)  │  Detect "Answer for Question N"
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│ 4. Map Answers       │  mapping_service.py
│    to Questions      │  Marker match + fuzzy scoring
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│ 5. AI Evaluation     │  evaluation_service.py
│    (Gemini + Local)  │  Subject-specific grading
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│ 6. Render Pages      │  report_service.py
│    (Answer Sheet)    │  PDF → PNG for each page
└─────────┬───────────┘
          │
          ▼
      Return Results
```

### Progress Stages
| Progress | Stage | Description |
|----------|-------|-------------|
| 1% | `starting` | Pipeline initialized |
| 5-10% | `extracting_questions` | Reading question paper |
| 30% | `ocr_answer_sheet` | OCR processing answer sheet |
| 35-55% | `mapping_answers` | Matching answers to questions |
| 60-85% | `evaluating_answers` | AI grading each question |
| 90% | `rendering_pages` | Converting PDF pages to images |
| 100% | `completed` | Results ready |

---

## 🧠 Answer Matching Algorithm

### 1. Marker Detection
The system detects answer markers using multi-pass detection:
- **Multi-word patterns**: "Answer for Question N", "for Question N"
- **Single-word patterns**: "Q 1.", "1.", "प्रश्न 1.", "Ans 1."
- **Two-word patterns**: "Q N(a)", "Q N."

### 2. Scoring
Each candidate segment is scored against the question:

| Factor | Weight | Description |
|--------|--------|-------------|
| Question number match | +55 points | Segment number equals question number |
| Letter sub-question match | +35 points | Sub-question letters match |
| Text similarity | variable | Fuzzy matching of question text vs answer text |

### 3. Deduplication
- Segments are deduped by `(number, letter)` — keeping the longest text
- Used segments are tracked to prevent double-matching
- Multi-page answers are merged when a question spans multiple pages

---

## 🎯 AI Evaluation

### Gemini AI (Primary)
When Gemini API is available, uses subject-specific grading prompts:
- **Physics**: Newton's laws, numericals, formulas
- **Chemistry**: Reactions, balancing, pH
- **English**: Grammar, tenses, figures of speech
- **History/Social Studies**: विवेचना, तुलना, कारण analysis

### Local Fallback (Offline)
When Gemini API quota is exceeded, uses intelligent local analysis:
- **Topic relevance**: Extracts question keywords, checks coverage in answer
- **Question-type detection**: Descriptive, comparison, cause-effect, significance
- **Structural analysis**: Bullet points, sentences, dates, reasoning markers
- **Specific feedback**: "Key missing concepts: X, Y, Z"

---

## 🎨 Frontend Views

### Upload View
- Drag-and-drop or click to upload PDFs
- File preview with remove button
- Animated teacher avatar with orbiting badges

### Extracting View
- Animated progress bar (0-100%)
- Stage labels with animated dots
- Real-time status updates via polling

### Result View
- **Desktop**: Side-by-side question list + answer sheet
- **Mobile**: Tabbed interface (Questions / Answer Sheet)
- Click question → highlights answer on answer sheet
- Double-tap → toggle all AI feedback
- Score chips with color coding (green/yellow/red)

---

## 🔧 Development

### Build for Production
```bash
npm run build
```

### Preview Production Build
```bash
npm run preview
```

### Backend Auto-Reload
```bash
cd backend
uvicorn app.main:app --reload --port 8001
```

---

## 📝 Notes

- **Assessment data is in-memory** — restart loses all data
- **Gemini API has daily quota** — falls back to local evaluation when exceeded
- **Firebase auth is optional** — app runs in dev mode without Firebase config
- **Tesseract is optional** — PyMuPDF handles most PDFs; Tesseract is fallback for scanned docs
- Supported file formats: PDF, PNG, JPG, JPEG, WEBP (max 10MB)

---

## 📄 License

Private project — All rights reserved.
