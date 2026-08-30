import { motion } from "framer-motion";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "./context/AuthContext";
import { md5 } from "js-md5";

type ViewState = "upload" | "extracting" | "result";
type BBox1000 = [number, number, number, number];

type MappedAnswerFE = {
  page_number: number;
  raw_text: string;
  bounding_box: BBox1000;
  bounding_box_label: string;
  confidence_score: number;
  is_multipage: boolean;
  additional_pages: Array<{ page_number: number; bounding_box: BBox1000; raw_text?: string }>;
};

type ReviewQuestion = {
  id: number;
  questionId: string;
  number: string;
  text: string;
  score: string;
  maxScore: number;
  obtained: number;
  tone: "good" | "bad" | "neutral";
  status: "GRADED" | "MISSING" | "UNMATCHED" | "NEEDS_REVIEW";
  feedback: string;
  strengths: string[];
  improvements: string[];
  mappedAnswer?: MappedAnswerFE;
  highlightPages: Array<{
    page: number;
    imageUrl: string;
    regions: Array<{ page: number; bbox: { x: number; y: number; width: number; height: number } }>;
  }>;
};

type UnmappedSegmentFE = {
  page_number: number;
  raw_text: string;
  bounding_box: BBox1000;
  reason: "DUPLICATE_ATTEMPT" | "UNREADABLE" | "NO_MATCHING_QUESTION";
  confidence_score: number;
};

type AnswerSheetPage = { page: number; image_url: string };
type UploadHistoryItem = {
  id: string;
  questionFileName: string;
  answerFileName: string;
  uploadedAt: string;
  questionFile?: File;
  answerFile?: File;
};

const API_URL = (import.meta.env.VITE_API_URL as string | undefined) || "http://localhost:8001/api";
  const api = (path: string) => `${API_URL}${path}`;

const DEFAULT_REVIEW_QUESTIONS: ReviewQuestion[] = [];

/** sessionStorage helpers for persisting results across reloads */
const STORAGE_KEY = "vedaai_session";

function saveSession(data: { viewState: ViewState; reviewQuestions: ReviewQuestion[]; answerSheetPages: AnswerSheetPage[]; activeQuestionId: number; activeAnswerPage: number; unmappedSegments: UnmappedSegmentFE[] }) {
  try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch { /* quota exceeded */ }
}

function loadSession(): { viewState: ViewState; reviewQuestions: ReviewQuestion[]; answerSheetPages: AnswerSheetPage[]; activeQuestionId: number; activeAnswerPage: number; unmappedSegments: UnmappedSegmentFE[] } | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (data && (data.viewState === "result" || data.viewState === "extracting")) return data;
    return null;
  } catch { return null; }
}

function clearSession() { try { sessionStorage.removeItem(STORAGE_KEY); } catch { /* */ } }

export default function App() {
  const { user, loading: authLoading, logout } = useAuth();

  const savedSession = useMemo(() => loadSession(), []);

  const [questionFile, setQuestionFile] = useState<File | null>(null);
  const [answerFile, setAnswerFile] = useState<File | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  const [viewState, setViewState] = useState<ViewState>(savedSession?.viewState === "result" ? "result" : "upload");
  const [activeNav, setActiveNav] = useState<"home" | "exams" | "library">("exams");
  const [activeQuestionId, setActiveQuestionId] = useState(savedSession?.activeQuestionId ?? 2);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [schoolName, setSchoolName] = useState(() => localStorage.getItem("vedaai_school") || "");
  const [schoolLogo, setSchoolLogo] = useState(() => localStorage.getItem("vedaai_school_logo") || "");

  const mainRef = useRef<HTMLDivElement>(null);
  const fakeProgressRef = useRef(0);




  const [authMode, setAuthMode] = useState<"signup" | "login">("signup");
  const [authError, setAuthError] = useState("");
  const [uploadHistory, setUploadHistory] = useState<UploadHistoryItem[]>([]);
  const [reviewQuestions, setReviewQuestions] = useState<ReviewQuestion[]>(savedSession?.reviewQuestions ?? DEFAULT_REVIEW_QUESTIONS);
  const [answerSheetPages, setAnswerSheetPages] = useState<AnswerSheetPage[]>(savedSession?.answerSheetPages ?? []);
  const [activeAnswerPage, setActiveAnswerPage] = useState<number>(savedSession?.activeAnswerPage ?? 1);
  const [extractingError, setExtractingError] = useState<string | null>(null);
  const [extractingProgress, setExtractingProgress] = useState<{ progress: number; stage: string; message: string }>({ progress: 0, stage: "", message: "" });
  const [unmappedSegments, setUnmappedSegments] = useState<UnmappedSegmentFE[]>(savedSession?.unmappedSegments ?? []);

  const isSignedIn = !!user;

  // Refresh school data from localStorage when user changes
  useEffect(() => {
    if (user) {
      const name = localStorage.getItem("vedaai_school") || "";
      const logo = localStorage.getItem("vedaai_school_logo") || "";
      setSchoolName(name);
      setSchoolLogo(logo);
    } else {
      setSchoolName("");
      setSchoolLogo("");
    }
  }, [user]);

  // Persist result state to sessionStorage so reload preserves it
  useEffect(() => {
    if (viewState === "result" && reviewQuestions.length > 0) {
      saveSession({ viewState, reviewQuestions, answerSheetPages, activeQuestionId, activeAnswerPage, unmappedSegments });
    }
  }, [viewState, reviewQuestions, answerSheetPages, activeQuestionId, activeAnswerPage, unmappedSegments]);

  const displayName = user?.displayName || user?.email?.split("@")[0] || "User";
  const avatarSrc = user?.photoURL || (user?.email ? `https://www.gravatar.com/avatar/${md5(user.email.trim().toLowerCase())}?s=160&d=identicon` : "");

  const canStart = useMemo(() => Boolean(questionFile && answerFile), [questionFile, answerFile]);

  const processFiles = async (qFile: File, aFile: File) => {
    setExtractingError(null);
    const formData = new FormData();
    formData.append("questionPaper", qFile);
    formData.append("answerSheet", aFile);

    // Start fake progress animation (runs independently of API)
    fakeProgressRef.current = 0;
    let fakeProgressDone = false;
    const stages = [
      { at: 0, stage: "extracting_questions", msg: "Reading question paper..." },
      { at: 18, stage: "ocr_answer_sheet", msg: "Reading answer sheet..." },
      { at: 40, stage: "mapping_answers", msg: "Matching answers to questions..." },
      { at: 62, stage: "evaluating_answers", msg: "AI evaluating answers..." },
      { at: 82, stage: "rendering_pages", msg: "Preparing answer sheet previews..." },
    ];
    const fakeInterval = setInterval(() => {
      if (fakeProgressDone) return;
      fakeProgressRef.current += Math.max(1, Math.floor(Math.random() * 3));
      if (fakeProgressRef.current >= 99) fakeProgressRef.current = 99;
      const currentStage = [...stages].reverse().find((s) => fakeProgressRef.current >= s.at) || stages[0];
      setExtractingProgress({ progress: fakeProgressRef.current, stage: currentStage.stage, message: currentStage.msg });
    }, 600);

    try {
      console.log("[VedaAI] Uploading to", API_URL);
      const uploadRes = await fetch(api("/assessment/upload"), {
        method: "POST",
        body: formData,
      });
      if (!uploadRes.ok) {
        const text = await uploadRes.text().catch(() => "");
        throw new Error(`Upload failed (${uploadRes.status}): ${text || uploadRes.statusText}`);
      }
      const uploadJson = await uploadRes.json();
      const assessmentId: string = uploadJson.assessment_id;
      console.log("[VedaAI] Uploaded", assessmentId);

      const processRes = await fetch(api(`/assessment/${assessmentId}/process`), {
        method: "POST",
      });
      if (!processRes.ok) {
        const text = await processRes.text().catch(() => "");
        throw new Error(`Process start failed (${processRes.status}): ${text || processRes.statusText}`);
      }

      const finalJson = await pollUntilDone(assessmentId);

      // API done — finish fake progress to 100%
      fakeProgressDone = true;
      clearInterval(fakeInterval);
      setExtractingProgress({ progress: 100, stage: "completed", message: "Done!" });

      // Wait 400ms so user sees 100% before switching
      await new Promise((r) => setTimeout(r, 400));

      applyResult(finalJson);
    } catch (err: any) {
      console.error("[VedaAI] API call failed:", err);
      fakeProgressDone = true;
      clearInterval(fakeInterval);
      setExtractingError(err?.message || String(err));
      setReviewQuestions(DEFAULT_REVIEW_QUESTIONS);
      setAnswerSheetPages([]);
    } finally {
      setViewState("result");
    }
  };

  const pollUntilDone = async (assessmentId: string): Promise<any> => {
    const startedAt = Date.now();
    const maxWaitMs = 30 * 60 * 1000;
    let attempt = 0;
    while (Date.now() - startedAt < maxWaitMs) {
      attempt += 1;
      const statusRes = await fetch(api(`/assessment/${assessmentId}/status`));
      if (!statusRes.ok) {
        throw new Error(`Status check failed (${statusRes.status})`);
      }
      const status = await statusRes.json();
      console.log(`[VedaAI] Status #${attempt}:`, status.status, status.progress, status.stage, status.message);
      if (status.status === "completed") {
        const resultRes = await fetch(api(`/assessment/${assessmentId}`));
        if (!resultRes.ok) throw new Error(`Result fetch failed (${resultRes.status})`);
        return await resultRes.json();
      }
      if (status.status === "failed") {
        throw new Error(status.message || "Processing failed on the server.");
      }
      // Only update from server progress if it's ahead of our fake progress
      const serverProgress = typeof status.progress === "number" ? status.progress : 0;
      if (serverProgress > fakeProgressRef.current) {
        setExtractingProgress({
          progress: serverProgress,
          stage: status.stage || "",
          message: status.message || "",
        });
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error("Processing timed out after 30 minutes.");
  };

  const applyResult = (json: any) => {
    if (!json || !Array.isArray(json.questions) || json.questions.length === 0) {
      console.warn("[VedaAI] No questions in response, using defaults");
      setReviewQuestions(DEFAULT_REVIEW_QUESTIONS);
      setAnswerSheetPages([]);
      setUnmappedSegments([]);
      return;
    }

    const assessmentId: string = json.assessment_id || "";
    const answerSheetBase = `/processed/${assessmentId}/answer-sheet/`;

    const mapped: ReviewQuestion[] = (json.questions as any[]).map((q: any, i: number) => {
      const obtained = Number(q?.obtained_marks ?? 0);
      const max = Number(q?.max_marks ?? 0);
      const status = (q?.status as ReviewQuestion["status"]) || "MISSING";
      const strengths: string[] = Array.isArray(q?.strengths) ? q.strengths : [];
      const improvements: string[] = Array.isArray(q?.improvements) ? q.improvements : [];
      const feedback: string = (q?.ai_feedback || "").toString();

      const mappedAnswer: MappedAnswerFE | undefined = q?.mapped_answer
        ? {
            page_number: Number(q.mapped_answer.page_number || 1),
            raw_text: String(q.mapped_answer.raw_text || ""),
            bounding_box: (q.mapped_answer.bounding_box || [0, 0, 1000, 1000]) as BBox1000,
            bounding_box_label: String(q.mapped_answer.bounding_box_label || ""),
            confidence_score: Number(q.mapped_answer.confidence_score || 0),
            is_multipage: Boolean(q.mapped_answer.is_multipage),
            additional_pages: Array.isArray(q.mapped_answer.additional_pages)
              ? q.mapped_answer.additional_pages.map((p: any) => ({
                  page_number: Number(p.page_number || 1),
                  bounding_box: (p.bounding_box || [0, 0, 1000, 1000]) as BBox1000,
                  raw_text: String(p.raw_text || ""),
                }))
              : [],
          }
        : undefined;

      let tone: "good" | "bad" | "neutral" = "neutral";
      if (status === "GRADED") tone = obtained >= max && max > 0 ? "good" : obtained > 0 ? "neutral" : "bad";
      else if (status === "MISSING" || status === "UNMATCHED") tone = "bad";
      else if (status === "NEEDS_REVIEW") tone = "neutral";

      const pageMap = new Map<number, Array<{ page: number; bbox: { x: number; y: number; width: number; height: number } }>>();
      const pushRegion = (pageNo: number, bbox: BBox1000) => {
        const [ymin, xmin, ymax, xmax] = bbox;
        const region = {
          page: pageNo,
          bbox: {
            x: Math.max(0, Math.min(1, xmin / 1000)),
            y: Math.max(0, Math.min(1, ymin / 1000)),
            width: Math.max(0, Math.min(1, (xmax - xmin) / 1000)),
            height: Math.max(0, Math.min(1, (ymax - ymin) / 1000)),
          },
        };
        if (!pageMap.has(pageNo)) pageMap.set(pageNo, []);
        pageMap.get(pageNo)!.push(region);
      };
      if (mappedAnswer) {
        pushRegion(mappedAnswer.page_number, mappedAnswer.bounding_box);
        for (const ap of mappedAnswer.additional_pages) pushRegion(ap.page_number, ap.bounding_box);
      }
      const highlightPages = Array.from(pageMap.entries())
        .sort((a, b) => a[0] - b[0])
        .map(([page, regions]) => ({ page, imageUrl: `${answerSheetBase}page-${page}.png`, regions }));

      return {
        id: i + 1,
        questionId: String(q?.question_id || `q_${i + 1}`),
        number: String(q?.display_number || q?.question_id || (i + 1)),
        text: String(q?.question_text || `Question ${i + 1}`),
        score: `${obtained} / ${max}`,
        maxScore: max,
        obtained,
        tone,
        status,
        feedback: feedback || (status === "MISSING" ? "No answer was provided for this question." : "No AI feedback available."),
        strengths,
        improvements,
        mappedAnswer,
        highlightPages,
      };
    });

    setReviewQuestions(mapped);
    const sheetPages = (json.answer_sheet_pages as any[] | undefined) || [];
    setAnswerSheetPages(sheetPages.map((p: any) => ({ page: p.page, image_url: p.image_url })));
    setActiveAnswerPage(sheetPages[0]?.page ?? 1);

    const ums: UnmappedSegmentFE[] = Array.isArray(json.unmapped_segments)
      ? (json.unmapped_segments as any[]).map((s: any) => ({
          page_number: Number(s.page_number || 1),
          raw_text: String(s.raw_text || ""),
          bounding_box: (s.bounding_box || [0, 0, 1000, 1000]) as BBox1000,
          reason: (s.reason || "NO_MATCHING_QUESTION") as UnmappedSegmentFE["reason"],
          confidence_score: Number(s.confidence_score || 0),
        }))
      : [];
    setUnmappedSegments(ums);
  };

  const startMapping = () => {
    if (!canStart || !questionFile || !answerFile) return;
    setUploadHistory((previous) => [
      { id: crypto.randomUUID(), questionFileName: questionFile.name, answerFileName: answerFile.name, uploadedAt: new Date().toISOString(), questionFile, answerFile },
      ...previous,
    ]);
    setActiveNav("home");
    setViewState("extracting");
    setPanelCollapsed(true);
    void processFiles(questionFile, answerFile);
  };

  const resetToUpload = () => {
    clearSession();
    setViewState("upload");
    setPanelCollapsed(false);
    setMenuOpen(false);
    setSettingsOpen(false);
    setLibraryOpen(false);
  };

  const goToExams = () => {
    clearSession();
    setActiveNav("exams");
    setViewState("upload");
    setMenuOpen(false);
    setSettingsOpen(false);
    setLibraryOpen(false);
    setPanelCollapsed(false);
  };

  const goToHome = () => {
    setActiveNav("home");
    setMenuOpen(false);
    setSettingsOpen(false);
    setLibraryOpen(false);
    setPanelCollapsed(false);
    if (viewState === "extracting") return;
    if (viewState === "upload") return;
    setViewState("result");
  };

  const openLibrary = () => {
    setActiveNav("library");
    setLibraryOpen(true);
    setMenuOpen(false);
    setSettingsOpen(false);
  };

  const openHistoryInHome = (item: UploadHistoryItem) => {
    if (item.questionFile) setQuestionFile(item.questionFile);
    if (item.answerFile) setAnswerFile(item.answerFile);
    setActiveNav("home");
    setLibraryOpen(false);
    setMenuOpen(false);
    setSettingsOpen(false);
    setPanelCollapsed(true);
    setViewState("result");
  };

  const openAuthModal = (mode: "signup" | "login") => {
    setAuthMode(mode);
    setAuthError("");
    setAuthOpen(true);
  };

  const handleLogout = async () => {
    await logout();
    clearSession();
    setMenuOpen(false);
    localStorage.removeItem("vedaai_school");
    localStorage.removeItem("vedaai_school_logo");
    setSchoolName("");
    setSchoolLogo("");
  };

  if (authLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#dcdcdc]">
        <div className="text-center">
          <motion.div animate={{ scale: [1, 1.06, 1] }} transition={{ repeat: Infinity, duration: 1.8 }} className="mx-auto text-[#ff5b2a]">
            <SparkIcon className="h-12 w-12" />
          </motion.div>
          <p className="mt-3 text-sm text-[#6f7278]">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen overflow-hidden bg-[#dcdcdc] p-2">
      <div className="mx-auto flex h-full max-w-[1820px] gap-3">
        <aside className={`hidden rounded-[24px] bg-white shadow-[inset_0_24px_60px_rgba(120,120,120,0.08)] transition-all duration-300 lg:flex lg:flex-col ${panelCollapsed ? "w-[94px] px-3 pb-3 pt-4" : "w-[396px] px-8 pb-4 pt-7"}`}>
          {panelCollapsed ? (
            <CompactSidebar onTogglePanel={() => setPanelCollapsed(false)} onOpenSettings={() => setSettingsOpen(true)} onOpenExams={goToExams} onOpenHome={goToHome} onOpenLibrary={openLibrary} activeNav={activeNav} />
          ) : (
            <SidebarContent desktop onTogglePanel={() => setPanelCollapsed(true)} onClose={() => {}} onOpenSettings={() => setSettingsOpen(true)} onOpenExams={goToExams} onOpenHome={goToHome} onOpenLibrary={openLibrary} activeNav={activeNav} />
          )}
        </aside>

        <section className="flex min-w-0 flex-1 flex-col gap-3">
          <header className="flex h-[72px] items-center justify-between rounded-[20px] border border-[#ececec] bg-white px-4 shadow-sm sm:px-5 lg:rounded-[24px] lg:px-8">
            <div className="flex items-center gap-2 text-[#9ea1a7] sm:gap-4">
              <button className="rounded-full p-1 text-[#2f3135] shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:bg-[#f3f3f3] hover:shadow-[0_4px_12px_rgba(0,0,0,0.08)] active:scale-95" aria-label="Back" onClick={resetToUpload}>
                <ArrowLeftIcon className="h-8 w-8" />
              </button>
              <span className="text-base font-semibold text-[#2f3135] sm:hidden">VedaAI</span>
              <button onClick={goToExams} className="hidden items-center gap-2 rounded-xl px-3 py-2 text-[#9ea1a7] shadow-[0_6px_14px_rgba(0,0,0,0.03)] transition-all duration-300 ease-out hover:-translate-y-0.5 hover:bg-[#f7f7f7] hover:shadow-[0_10px_18px_rgba(0,0,0,0.1)] active:scale-[0.97] sm:flex">
                <BagIcon className="h-6 w-6" />
                <span className="text-sm font-medium sm:text-base">Exams</span>
              </button>
            </div>

            <div className="flex items-center gap-2 sm:gap-3 lg:gap-4">
              <button className="hidden lg:flex h-10 w-10 items-center justify-center rounded-full bg-white text-[#2d2f32] text-lg font-bold shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:bg-[#f0f0f0] hover:shadow-[0_4px_12px_rgba(0,0,0,0.15)] active:scale-90">?</button>
              <div className="relative">
                <button className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-[#2d2f32] shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:bg-[#f0f0f0] hover:shadow-[0_4px_12px_rgba(0,0,0,0.15)] active:scale-90"><BellIcon className="h-6 w-6" /></button>
                <span className="absolute right-2 top-1.5 h-2.5 w-2.5 rounded-full bg-[#ff5a27]" />
              </div>
              <button className="hidden lg:flex h-10 w-10 items-center justify-center rounded-full bg-white text-[#2d2f32] shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:bg-[#f0f0f0] hover:shadow-[0_4px_12px_rgba(0,0,0,0.15)] active:scale-90"><SparkIcon className="h-6 w-6" /></button>
              {isSignedIn ? (
                <>
                  <UserAvatar src={avatarSrc} className="h-9 w-9 sm:hidden" />
                  <UserAvatar src={avatarSrc} className="hidden h-9 w-9 lg:block" />
                  <span className="hidden text-sm font-medium text-[#2f3135] lg:block">{displayName}</span>
                  <ChevronDown className="hidden h-5 w-5 text-[#2f3135] lg:block" />
                </>
              ) : (
                <div className="flex items-center gap-2">
                  <button onClick={() => openAuthModal("login")} className="rounded-full border border-[#d4d6db] bg-white px-3 py-1.5 text-xs font-medium text-[#303030] shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:bg-[#f5f6f7] hover:shadow-[0_4px_14px_rgba(0,0,0,0.1)] active:scale-[0.97] sm:px-4 sm:py-2 sm:text-sm">Sign In</button>
                  <button onClick={() => openAuthModal("signup")} className="rounded-full bg-[#303030] px-3 py-1.5 text-xs font-medium text-white shadow-[0_4px_14px_rgba(0,0,0,0.25)] transition-all duration-200 hover:-translate-y-0.5 hover:bg-[#1f1f1f] hover:shadow-[0_6px_20px_rgba(0,0,0,0.35)] active:scale-[0.97] sm:px-4 sm:py-2 sm:text-sm">Sign Up</button>
                </div>
              )}
              <button onClick={() => setMenuOpen(true)} className="rounded-full bg-[#f7f7f7] p-2 text-[#2f3135] shadow-sm transition-all duration-200 hover:bg-[#efefef] hover:shadow-[0_4px_12px_rgba(0,0,0,0.08)] active:scale-95 lg:hidden" aria-label="Open menu">
                <MenuIcon className="h-6 w-6" />
              </button>
            </div>
          </header>

          <main ref={mainRef} className="hide-scrollbar relative flex min-h-0 flex-1 items-start justify-center overflow-auto rounded-[24px] border border-[#ececec] bg-[#f6f6f6] px-3 pb-8 pt-6 shadow-[inset_0_10px_35px_rgba(120,120,120,0.08)] sm:px-5 sm:pt-8 lg:rounded-[30px] lg:px-8 lg:pt-10">
            {viewState === "upload" ? (
              <div className="w-full max-w-[1020px]">
                <h2 className="mx-auto max-w-[460px] text-center text-xl font-semibold leading-tight text-[#2f3135] sm:max-w-none sm:text-3xl md:text-4xl lg:whitespace-nowrap lg:text-5xl lg:leading-tight">
                  <span className="text-[#2f3135]">Upload </span>
                  <span className="rounded-xl bg-[#ffe9df] px-2 text-[#ff5524]">Question Paper <br className="sm:hidden" />&amp; Answer Sheets</span>
                </h2>
                <p className="mt-3 text-center text-sm text-[#5a5d62] sm:text-base lg:text-lg">Upload both files to get started</p>
                <motion.div className="relative mx-auto mt-6 h-36 w-36 sm:mt-8 sm:h-44 sm:w-44 md:mt-10 md:h-52 md:w-52 lg:h-60 lg:w-60" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                  <div className="absolute inset-0 rounded-full bg-[#f8e7e1]" />
                  <div className="absolute inset-[22px] rounded-full bg-[#f9b9a4]" />
                  <div className="absolute inset-[46px] overflow-hidden rounded-full bg-white shadow-[0_8px_20px_rgba(0,0,0,0.16)]">
                    <img src="/images/teacher-avatar.png" alt="Teacher" className="h-full w-full object-cover object-center" />
                  </div>
                  <OrbitBadge className="left-2 top-[52px] sm:left-[18px] sm:top-[82px]"><DocIcon className="h-3.5 w-3.5" /></OrbitBadge>
                  <OrbitBadge className="right-4 top-2 sm:right-[42px] sm:top-[16px]"><ClockIcon className="h-3.5 w-3.5" /></OrbitBadge>
                  <OrbitBadge className="right-1 top-[88px] sm:right-[6px] sm:top-[138px]"><SparkIcon className="h-3.5 w-3.5" /></OrbitBadge>
                  <OrbitBadge className="left-6 bottom-1 sm:left-[48px] sm:bottom-[14px]"><SettingsIcon className="h-3.5 w-3.5" /></OrbitBadge>
                </motion.div>
                <div className="mx-auto mt-5 w-full max-w-[600px] rounded-2xl border border-[#ececec] bg-[#efefef] p-2 shadow-[0_4px_12px_rgba(0,0,0,0.05)] sm:mt-6 sm:max-w-[700px] sm:rounded-[28px] sm:p-3 md:max-w-[800px] md:rounded-[34px] md:p-4 lg:max-w-[980px]">
                  <div className="grid gap-4 md:grid-cols-2">
                    <UploadBox label="Question Paper" file={questionFile} onPick={setQuestionFile} />
                    <UploadBox label="Answer Sheet" file={answerFile} onPick={setAnswerFile} />
                  </div>
                </div>
                <motion.button onClick={startMapping} whileHover={canStart ? { y: -2, boxShadow: "0 8px 25px rgba(0,0,0,0.35)" } : undefined} whileTap={canStart ? { scale: 0.97 } : undefined} disabled={!canStart} className={`mx-auto mt-6 flex items-center gap-2 rounded-full border border-transparent px-6 py-2.5 text-sm font-medium shadow-[0_4px_16px_rgba(0,0,0,0.25)] sm:mt-8 sm:px-7 sm:py-3 sm:text-base transition-all duration-300 ease-out sm:px-9 sm:text-lg lg:mt-10 lg:gap-3 lg:px-11 ${canStart ? "border-[#303030] bg-[#303030] text-white shadow-[0_4px_16px_rgba(0,0,0,0.25)]" : "border-[#d0d0d0] bg-[#e0e0e0] text-[#999] cursor-not-allowed"}`}>
                  Start Mapping
                  <ArrowRightIcon className="h-5 w-5 sm:h-6 sm:w-6" />
                </motion.button>
                <p className="mx-auto mt-3 text-center text-sm text-[#72757a] sm:whitespace-nowrap">Once both files are uploaded you'll able to map<br className="sm:hidden" /> answers with questions.</p>
              </div>
            ) : viewState === "extracting" ? (
              <ExtractingState
                error={extractingError}
                progress={extractingProgress.progress}
                stage={extractingProgress.stage}
                message={extractingProgress.message}
              />
            ) : (
              <ResultState
                activeQuestionId={activeQuestionId}
                onPick={setActiveQuestionId}
                answerFile={answerFile}
                questions={reviewQuestions}
                answerSheetPages={answerSheetPages}
                activeAnswerPage={activeAnswerPage}
                onPickPage={setActiveAnswerPage}
                unmappedSegments={unmappedSegments}
              />
            )}
            <div className="pointer-events-none fixed bottom-2 left-1/2 z-50 h-1.5 w-32 -translate-x-1/2 rounded-full bg-[#9e9fa2] sm:hidden" />
          </main>
        </section>
      </div>

      {menuOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 p-3 lg:hidden" onClick={() => setMenuOpen(false)}>
          <motion.aside initial={{ x: 32, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ duration: 0.2 }} onClick={(e) => e.stopPropagation()} className="flex h-full max-w-[396px] flex-col rounded-[24px] bg-white px-5 pb-4 pt-6 shadow-[inset_0_24px_60px_rgba(120,120,120,0.08)] sm:px-8 sm:pt-7">
            <SidebarContent onClose={() => setMenuOpen(false)} onOpenSettings={() => setSettingsOpen(true)} onOpenExams={goToExams} onOpenHome={goToHome} onOpenLibrary={openLibrary} activeNav={activeNav} schoolName={schoolName} schoolLogo={schoolLogo} userPhoto={avatarSrc} />
          </motion.aside>
        </div>
      )}

      {settingsOpen && (
        <SettingsModal onClose={() => setSettingsOpen(false)} userName={isSignedIn ? displayName : "Guest User"} email={user?.email || "Not set"} onLogout={isSignedIn ? handleLogout : undefined} schoolName={schoolName} schoolLogo={schoolLogo} userPhoto={avatarSrc} />
      )}
      {libraryOpen && <LibraryModal onClose={() => setLibraryOpen(false)} items={uploadHistory} onOpenHome={openHistoryInHome} />}
      {authOpen && <AuthModal mode={authMode} onClose={() => setAuthOpen(false)} error={authError} onSwitchMode={setAuthMode} onError={setAuthError} onSchoolSave={(name: string, logo: string) => { setSchoolName(name); setSchoolLogo(logo); }} />}
    </div>
  );
}

function ExtractingState({ error, progress, stage, message }: { error?: string | null; progress?: number; stage?: string; message?: string }) {
  const pct = typeof progress === "number" ? Math.max(0, Math.min(100, progress)) : null;
  const stageLabels: Record<string, string> = {
    starting: "Initializing...",
    extracting_questions: "Extracting questions from paper...",
    ocr_answer_sheet: "Reading answer sheet with OCR...",
    evaluating_answers: "AI is evaluating your answers...",
    rendering_pages: "Preparing answer sheet previews...",
    completed: "Done!",
  };
  const displayStage = stage ? (stageLabels[stage] || stage.replace(/_/g, " ")) : "";
  const displayMsg = error || displayStage || (pct != null ? "Processing..." : "Starting...");
  return (
    <div className="flex min-h-full w-full items-center justify-center py-16">
      <div className="w-full max-w-md text-center">
        <div className="flex items-center justify-center gap-3">
          <motion.div animate={{ scale: [1, 1.08, 1] }} transition={{ repeat: Infinity, duration: 2, ease: "easeInOut" }} className="text-[#ff5b2a]">
            <SparkIcon className="h-8 w-8" />
          </motion.div>
          <h3 className="text-xl font-semibold text-[#33363a]">{error ? "Something went wrong" : <>Extracting<span className="animate-dots"><span>.</span><span>.</span><span>.</span></span></>}</h3>
        </div>
        <p className="mt-1 text-sm text-[#66696e]">{displayMsg}</p>
        {!error && (
          <div className="mx-auto mt-6 h-2.5 w-full overflow-hidden rounded-full bg-[#e5e7eb]">
            <motion.div
              className="h-full rounded-full bg-gradient-to-r from-[#ff7a4d] to-[#ff5a2b]"
              initial={{ width: "0%" }}
              animate={{ width: `${pct ?? 5}%` }}
              transition={{ duration: 0.8, ease: "easeOut" }}
            />
          </div>
        )}
        {!error && pct != null && (
          <p className="mt-3 text-sm font-medium text-[#33363a]">{`${pct}% complete`}</p>
        )}
        {!error && pct == null && (
          <p className="mt-3 text-sm text-[#8a8d93]">Please wait...</p>
        )}
      </div>
    </div>
  );
}

function ResultState({
  activeQuestionId,
  onPick,
  answerFile,
  questions,
  answerSheetPages,
  activeAnswerPage,
  onPickPage,
  unmappedSegments,
}: {
  activeQuestionId: number;
  onPick: (id: number) => void;
  answerFile: File | null;
  questions: ReviewQuestion[];
  answerSheetPages: AnswerSheetPage[];
  activeAnswerPage: number;
  onPickPage: (p: number) => void;
  unmappedSegments: UnmappedSegmentFE[];
}) {
  const [showAllFeedback, setShowAllFeedback] = useState(false);
  const [mobileTab, setMobileTab] = useState<"questions" | "sheet">("questions");
  const lastTapRef = useRef(0);
  const [fallbackUrl, setFallbackUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!answerFile) { setFallbackUrl(null); return; }
    if (answerSheetPages.length > 0) { setFallbackUrl(null); return; }
    const url = URL.createObjectURL(answerFile);
    setFallbackUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [answerFile, answerSheetPages.length]);

  const isPdf = answerFile?.name.toLowerCase().endsWith(".pdf") ?? false;
  const activeQuestion = questions.find((q) => q.id === activeQuestionId);
  const activeHighlightPages = activeQuestion?.highlightPages || [];
  const activeRegions = activeHighlightPages
    .filter((p) => p.page === activeAnswerPage)
    .flatMap((p) => p.regions);
  const activePage = answerSheetPages.find((p) => p.page === activeAnswerPage) || answerSheetPages[0];

  const handleTap = () => { const now = Date.now(); if (now - lastTapRef.current < 320) setShowAllFeedback((p) => !p); lastTapRef.current = now; };
  const handlePick = (id: number) => {
    onPick(id);
    const q = questions.find((x) => x.id === id);
    if (q && q.highlightPages && q.highlightPages.length > 0) {
      onPickPage(q.highlightPages[0].page);
    }
  };

  useEffect(() => {
    const targetPage = activeHighlightPages?.[0]?.page;
    if (!targetPage) return;
    const el = document.getElementById(`answer-page-${targetPage}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [activeQuestionId, activeHighlightPages]);
  const feedbackFor = (q: ReviewQuestion) => q.feedback;
  const statusLabel = (q: ReviewQuestion) => {
    if (q.status === "MISSING") return "Not answered";
    if (q.status === "UNMATCHED") return "Unmatched";
    if (q.status === "NEEDS_REVIEW") return "Needs review";
    if (q.obtained >= q.maxScore && q.maxScore > 0) return "Correct";
    if (q.obtained > 0) return "Partially correct";
    return "Incorrect";
  };
  const toneChipClass = (tone: "good" | "bad" | "neutral") => {
    if (tone === "good") return "bg-[#e8f8e7] text-[#33a631] border border-[#bfe5bd]";
    if (tone === "bad") return "bg-[#ffe8e1] text-[#cb431e] border border-[#f5c8b6]";
    return "bg-[#fff4d6] text-[#9a7b0a] border border-[#ecd999]";
  };

  const renderQuestionCard = (question: ReviewQuestion, isMobile: boolean) => {
    const active = question.id === activeQuestionId;
    const showFeedback = active || showAllFeedback;
    const pageNums = (question.highlightPages || []).map((p) => p.page);
    return (
      <div key={question.id} className={`rounded-[18px] border bg-white p-3 ${active ? "border-[#ff7b4f] shadow-[0_4px_12px_rgba(255,123,79,0.15)]" : "border-[#ececec]"}`}>
        <button onClick={() => handlePick(question.id)} onDoubleClick={() => setShowAllFeedback((p) => !p)} onTouchEnd={handleTap} className="flex w-full items-start gap-3 text-left">
          <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-lg font-semibold text-white ${active ? "bg-[#ff5a2b]" : "bg-[#5f6165]"}`}>{question.number || question.id}</div>
          <div className="min-w-0 flex-1">
            <p className="break-words text-[15px] font-medium leading-snug text-[#313236]">{question.text}</p>
            {pageNums.length > 0 && (
              <p className="mt-1 text-xs text-[#8a8d93]">Answer found on page {pageNums.join(", ")}{question.mappedAnswer?.is_multipage ? " · multi-page" : ""}</p>
            )}
          </div>
          <span className={`shrink-0 rounded-full px-3 py-1 text-sm font-semibold ${toneChipClass(question.tone)}`}>{question.score}</span>
        </button>
        <div className="mt-2 flex items-center gap-2 pl-[52px]">
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${toneChipClass(question.tone)}`}>{statusLabel(question)}</span>
          {question.status === "NEEDS_REVIEW" && (
            <span className="rounded-full bg-[#fff4d6] px-2.5 py-0.5 text-xs font-medium text-[#9a7b0a] border border-[#ecd999]">Reviewer needed</span>
          )}
        </div>
        {showFeedback && (
          <div className="mt-3 space-y-3 rounded-2xl bg-[#f2f2f3] p-4 text-sm">
            <div>
              <p className="text-sm font-semibold uppercase tracking-wide text-[#6f7278]">AI Feedback</p>
              <p className="mt-1 text-[15px] leading-relaxed text-[#1f2226]">{feedbackFor(question)}</p>
            </div>
            {question.strengths && question.strengths.length > 0 && (
              <div>
                <p className="text-sm font-semibold uppercase tracking-wide text-[#33a631]">Strengths</p>
                <ul className="mt-1 list-disc space-y-1 pl-5 text-[15px] leading-relaxed text-[#1f2226]">
                  {question.strengths.map((s, idx) => <li key={idx}>{s}</li>)}
                </ul>
              </div>
            )}
            {question.improvements && question.improvements.length > 0 && (
              <div>
                <p className="text-sm font-semibold uppercase tracking-wide text-[#cb431e]">Improvements</p>
                <ul className="mt-1 list-disc space-y-1 pl-5 text-[15px] leading-relaxed text-[#1f2226]">
                  {question.improvements.map((s, idx) => <li key={idx}>{s}</li>)}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

   const answerSheetPanel = (
    <section className="flex flex-col overflow-hidden rounded-[24px] bg-white shadow-[inset_0_14px_35px_rgba(130,130,130,0.08)]">
      <div className="shrink-0 bg-[#333436] p-4 text-white">
        <h3 className="text-base font-semibold text-white lg:block">Answer Sheet</h3>
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-auto bg-[#f4f4f4] p-3 sm:p-4 custom-scrollbar">
        {answerSheetPages.length === 0 && !fallbackUrl && <div className="flex h-full items-center justify-center text-sm text-[#72757a]">No answer sheet preview available.</div>}
        {answerSheetPages.length === 0 && fallbackUrl && isPdf && (
          <embed src={fallbackUrl} type="application/pdf" className="min-h-full w-full" />
        )}
        {answerSheetPages.length === 0 && fallbackUrl && !isPdf && <img src={fallbackUrl} alt="Uploaded answer sheet" className="h-full w-full object-contain" />}
        {answerSheetPages.length > 0 && answerSheetPages.map((page) => {
          const pageRegions = (activeHighlightPages || [])
            .filter((p) => p.page === page.page)
            .flatMap((p) => p.regions);
          return (
            <div key={page.page} id={`answer-page-${page.page}`} className="relative block w-full">
              <img
                src={page.image_url.startsWith("data:") ? page.image_url : api(page.image_url)}
                alt={`Answer sheet page ${page.page}`}
                className="block w-full select-none"
                draggable={false}
              />
              {pageRegions.map((r, idx) => {
                const b = r.bbox || {};
                const x = (b.x ?? 0) * 100;
                const y = (b.y ?? 0) * 100;
                const w = (b.width ?? 0) * 100;
                const h = (b.height ?? 0) * 100;
                return (
                  <div
                    key={idx}
                    className="pointer-events-none absolute rounded-lg border-2 border-[#ff5a2b] bg-[#ff5a2b]/30 shadow-[0_0_0_3px_rgba(255,90,43,0.4),0_0_12px_rgba(255,90,43,0.25)]"
                    style={{ left: `${x}%`, top: `${y}%`, width: `${w}%`, height: `${h}%` }}
                  />
                );
              })}
            </div>
          );
        })}
      </div>
    </section>
  );

   return (
    <>
      <div className="w-full lg:hidden">
        <div className="mb-3 rounded-full bg-white p-1.5">
          <div className="grid grid-cols-2 gap-1">
            <button onClick={() => setMobileTab("questions")} className={`rounded-full py-2.5 text-xl font-medium transition-all duration-300 ease-out ${mobileTab === "questions" ? "bg-[#313234] text-white shadow-[0_8px_20px_rgba(0,0,0,0.35)]" : "text-[#3f4042] hover:bg-[#f4f4f4] hover:shadow-[0_6px_14px_rgba(0,0,0,0.1)] active:scale-[0.97]"}`}>Questions</button>
            <button onClick={() => setMobileTab("sheet")} className={`rounded-full py-2.5 text-xl font-medium transition-all duration-300 ease-out ${mobileTab === "sheet" ? "bg-[#313234] text-white shadow-[0_8px_20px_rgba(0,0,0,0.35)]" : "text-[#3f4042] hover:bg-[#f4f4f4] hover:shadow-[0_6px_14px_rgba(0,0,0,0.1)] active:scale-[0.97]"}`}>Answer Sheet</button>
          </div>
        </div>
        {mobileTab === "questions" ? (
          <section className="rounded-[24px] bg-[#ececec] p-3">
            <h3 className="mb-3 px-1 text-center text-base font-semibold leading-tight text-[#2f3135]">Extracted Questions ({questions.length} total)</h3>
            {questions.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-[#d4d7dd] bg-white p-8 text-center">
                <p className="text-base font-semibold text-[#2f3135]">No questions to display yet.</p>
                <p className="mt-2 text-sm text-[#6f7278]">Upload a question paper and answer sheet, then click Start Mapping. The AI will extract every question from your paper and match it with the answer in the answer sheet.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {questions.map((question) => renderQuestionCard(question, true))}
              </div>
            )}
          </section>
        ) : <div className="flex h-[calc(100vh-180px)] flex-col rounded-[24px] overflow-hidden">{answerSheetPanel}</div>}
      </div>

      <div className="hidden w-full gap-3 lg:grid lg:grid-cols-2 lg:h-[calc(100vh-160px)]">
        <section className="flex min-h-0 flex-col overflow-hidden rounded-[24px] bg-white p-4 shadow-[inset_0_14px_35px_rgba(130,130,130,0.08)]">
          <div className="mb-4 flex shrink-0 items-center justify-between">
            <h3 className="text-xl font-semibold tracking-tight text-[#2f3135]">Extracted Questions ({questions.length} total)</h3>
            <button className="rounded-full border border-[#e7e7e8] bg-white px-5 py-2 text-sm font-medium text-[#2f3135] shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:bg-[#fafafa] hover:shadow-[0_4px_12px_rgba(0,0,0,0.08)] active:scale-[0.97]">Expand All</button>
          </div>
          <p className="mb-3 shrink-0 text-xs text-[#84868b]">Double tap any question to show or hide AI feedback for all questions.</p>
          {questions.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-[#d4d7dd] bg-[#fafafa] p-8 text-center">
              <p className="text-base font-semibold text-[#2f3135]">No questions to display yet.</p>
              <p className="mt-2 text-sm text-[#6f7278]">Upload a question paper and answer sheet, then click Start Mapping. The AI will extract every question from your paper and match it with the answer in the answer sheet.</p>
            </div>
          ) : (
            <div className="min-h-0 flex-1 space-y-3 overflow-auto pr-1 custom-scrollbar">
              {questions.map((question) => renderQuestionCard(question, false))}
            </div>
          )}
        </section>
        {answerSheetPanel}
      </div>
    </>
  );
}

function SidebarContent({ onClose, desktop, onTogglePanel, onOpenSettings, onOpenExams, onOpenHome, onOpenLibrary, activeNav, schoolName, schoolLogo, userPhoto }: { onClose: () => void; desktop?: boolean; onTogglePanel?: () => void; onOpenSettings: () => void; onOpenExams: () => void; onOpenHome: () => void; onOpenLibrary: () => void; activeNav: string; schoolName?: string; schoolLogo?: string; userPhoto?: string }) {
  return (
    <>
      <div className="flex items-center justify-between gap-3 rounded-2xl border border-[#eceef2] bg-white px-3 py-2 shadow-[0_4px_12px_rgba(0,0,0,0.04)]">
        <div className="flex items-center gap-2">
          <button className="flex h-10 w-10 items-center justify-center rounded-[10px] bg-[#2d2f32] text-lg font-black text-white shadow-[0_4px_12px_rgba(0,0,0,0.3)] transition-all duration-200 hover:shadow-[0_6px_18px_rgba(0,0,0,0.4)] active:scale-95">V</button>
          <button className="rounded-xl px-2 py-1 text-sm font-semibold text-[#2f3135] transition-all duration-200 hover:bg-[#f4f4f4] active:scale-95">VedaAI</button>
        </div>
        {desktop ? (
          <button onClick={onTogglePanel} className="rounded-lg p-2 text-[#7f8186] shadow-sm transition-all duration-200 hover:bg-[#f4f4f4] hover:shadow-[0_4px_10px_rgba(0,0,0,0.06)] active:scale-90" aria-label="Toggle panel"><PanelIcon className="h-6 w-6" /></button>
        ) : (
          <button onClick={onClose} className="rounded-lg p-1.5 text-[#7f8186] transition-all duration-200 hover:bg-[#f3f3f4] hover:text-[#2f3135] active:scale-90" aria-label="Close menu"><CloseIcon className="h-6 w-6" /></button>
        )}
      </div>
      <button className="mt-6 inline-flex items-center gap-2 self-start rounded-full border-2 border-[#ef7f56] bg-[#35363a] px-4 py-2 text-white shadow-[0_4px_14px_rgba(0,0,0,0.2)] transition-all duration-300 ease-out hover:-translate-y-0.5 hover:shadow-[0_8px_24px_rgba(0,0,0,0.3)] active:scale-[0.97]">
        <SparkIcon className="h-5 w-5" />
        <span className="text-sm">AI Teacher&apos;s Toolkit</span>
      </button>
      <nav className="mt-16 space-y-4">
        <NavItem icon={<GridIcon className="h-6 w-6" />} label="Home" onClick={onOpenHome} active={activeNav === "home"} />
        <NavItem icon={<ClassIcon className="h-6 w-6" />} label="My Classroom" />
        <NavItem icon={<DocIcon className="h-6 w-6" />} label="Assignments" />
        <NavItem icon={<BagIcon className="h-6 w-6" />} label="Exams" active={activeNav === "exams"} onClick={onOpenExams} />
        <NavItem icon={<ClockIcon className="h-6 w-6" />} label="My Library" onClick={onOpenLibrary} active={activeNav === "library"} />
      </nav>
      <div className="mt-auto pb-1">
        <button onClick={onOpenSettings} className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left transition-all duration-300 ease-out hover:-translate-y-0.5 hover:bg-[#f6f6f6] hover:shadow-[0_10px_20px_rgba(0,0,0,0.1)] active:scale-[0.97]">
          {schoolLogo ? (
              <img src={schoolLogo} alt="School" className="h-10 w-10 shrink-0 rounded-full object-cover" />
            ) : (
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#e8f0fe] text-[#3b82f6]"><span className="text-lg font-bold">{schoolName ? schoolName.charAt(0).toUpperCase() : "S"}</span></div>
            )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-[#2f3135]">{schoolName || "Your School"}</p>
            <p className="truncate text-xs text-[#73767a]">Tap to open settings</p>
          </div>
          <SettingsIcon className="h-5 w-5 shrink-0 text-[#73767a]" />
        </button>
      </div>
    </>
  );
}

function CompactSidebar({ onTogglePanel, onOpenSettings, onOpenExams, onOpenHome, onOpenLibrary, activeNav }: { onTogglePanel: () => void; onOpenSettings: () => void; onOpenExams: () => void; onOpenHome: () => void; onOpenLibrary: () => void; activeNav: string }) {
  return (
    <div className="flex h-full flex-col items-center">
      <button onClick={onTogglePanel} className="flex h-10 w-10 items-center justify-center rounded-[10px] bg-[#2d2f32] text-lg font-black text-white shadow-[0_4px_12px_rgba(0,0,0,0.3)] transition-all duration-200 hover:shadow-[0_6px_18px_rgba(0,0,0,0.4)] active:scale-90" aria-label="Expand sidebar">V</button>
      <div className="mt-16 rounded-full border-4 border-[#ef7f56] bg-[#35363a] p-3 text-white"><SparkIcon className="h-4 w-4" /></div>
      <nav className="mt-16 flex flex-col gap-5 text-[#8f9196]">
        <IconNav icon={<GridIcon className="h-5 w-5" />} active={activeNav === "home"} onClick={onOpenHome} />
        <IconNav icon={<ClassIcon className="h-5 w-5" />} />
        <IconNav icon={<DocIcon className="h-5 w-5" />} />
        <IconNav icon={<BagIcon className="h-5 w-5" />} onClick={onOpenExams} active={activeNav === "exams"} />
        <IconNav icon={<ClockIcon className="h-5 w-5" />} onClick={onOpenLibrary} active={activeNav === "library"} />
      </nav>
      <div className="mt-auto mb-1 flex flex-col items-center gap-2">
        <button onClick={onOpenSettings} className="rounded-xl bg-[#f3f3f3] p-2 text-[#73767a] shadow-sm transition-all duration-200 hover:bg-[#e9eaec] hover:text-[#2f3135] hover:shadow-[0_4px_10px_rgba(0,0,0,0.06)] active:scale-90"><SettingsIcon className="h-4 w-4" /></button>
      </div>
    </div>
  );
}

function SettingsModal({ onClose, userName, email, onLogout, schoolName, schoolLogo, userPhoto }: { onClose: () => void; userName: string; email: string; onLogout?: () => void; schoolName?: string; schoolLogo?: string; userPhoto?: string }) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/35 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-3xl bg-white shadow-[0_25px_60px_rgba(0,0,0,0.25)]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-[#ececec] px-6 py-4">
          <div className="flex items-center gap-2">
            <SettingsIcon className="h-5 w-5 text-[#ff5a2b]" />
            <h3 className="text-lg font-semibold text-[#2f3135]">Settings</h3>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-[#6f7278] shadow-sm transition-all duration-200 hover:bg-[#f3f3f4] hover:text-[#2f3135] hover:shadow-[0_2px_8px_rgba(0,0,0,0.06)] active:scale-90" aria-label="Close settings"><CloseIcon className="h-5 w-5" /></button>
        </div>
        <div className="max-h-[70vh] space-y-4 overflow-y-auto p-6">
          <div className="rounded-2xl border border-[#ececec] bg-gradient-to-br from-[#fff8f7] to-white p-5">
            <div className="mb-3 flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#ff5a2b]/10 text-[#ff5a2b]">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
              </div>
              <p className="text-sm font-semibold uppercase tracking-wide text-[#2f3135]">Profile</p>
            </div>
            <div className="flex items-center gap-4 mb-4">
              {userPhoto ? (
                <img src={userPhoto} alt="Profile" className="h-16 w-16 rounded-full object-cover ring-2 ring-[#ff5a2b]/20" />
              ) : (
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[#ff5a2b] text-2xl font-bold text-white">{userName?.charAt(0)?.toUpperCase() || "U"}</div>
              )}
              <div>
                <p className="text-lg font-semibold text-[#2f3135]">{userName || "Guest User"}</p>
                <p className="text-sm text-[#73767a]">{email}</p>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
              <div className="rounded-xl bg-white p-3">
                <p className="text-xs text-[#8a8d93]">Name</p>
                <p className="mt-0.5 font-medium text-[#2f3135]">{userName}</p>
              </div>
              <div className="rounded-xl bg-white p-3">
                <p className="text-xs text-[#8a8d93]">Email</p>
                <p className="mt-0.5 font-medium text-[#2f3135] break-all">{email}</p>
              </div>
              <div className="rounded-xl bg-white p-3 sm:col-span-2">
                <p className="text-xs text-[#8a8d93]">School</p>
                <div className="mt-0.5 flex items-center gap-2">
                  {schoolLogo ? (
                    <img src={schoolLogo} alt="School" className="h-6 w-6 rounded-full object-cover" />
                  ) : (
                    <div className="flex h-6 w-6 items-center justify-center rounded-full bg-[#3b82f6] text-xs font-bold text-white">{schoolName ? schoolName.charAt(0).toUpperCase() : "S"}</div>
                  )}
                  <p className="font-medium text-[#2f3135]">{schoolName || "Not set"}</p>
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-[#ececec] bg-gradient-to-br from-[#f8f9ff] to-white p-5">
            <div className="mb-3 flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#4f46e5]/10 text-[#4f46e5]">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4"><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
              </div>
              <p className="text-sm font-semibold uppercase tracking-wide text-[#2f3135]">Assessment Preferences</p>
            </div>
            <div className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
              <div className="rounded-xl bg-white p-3">
                <p className="text-xs text-[#8a8d93]">Auto-highlight mapped answers</p>
                <p className="mt-0.5 font-medium text-[#2f3135]">Enabled</p>
              </div>
              <div className="rounded-xl bg-white p-3">
                <p className="text-xs text-[#8a8d93]">AI Feedback Detail</p>
                <p className="mt-0.5 font-medium text-[#2f3135]">Standard</p>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-[#ececec] bg-gradient-to-br from-[#f7fbf7] to-white p-5">
            <div className="mb-3 flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#16a34a]/10 text-[#16a34a]">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" /><path d="M14 2v6h6" /></svg>
              </div>
              <p className="text-sm font-semibold uppercase tracking-wide text-[#2f3135]">File Rules</p>
            </div>
            <div className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
              <div className="rounded-xl bg-white p-3">
                <p className="text-xs text-[#8a8d93]">Allowed formats</p>
                <p className="mt-0.5 font-medium text-[#2f3135]">PDF, PNG, JPG, JPEG, WEBP</p>
              </div>
              <div className="rounded-xl bg-white p-3">
                <p className="text-xs text-[#8a8d93]">Max upload size</p>
                <p className="mt-0.5 font-medium text-[#2f3135]">10MB</p>
              </div>
            </div>
          </div>

          {onLogout && (
            <button onClick={onLogout} className="w-full rounded-xl border border-[#fecaca] bg-[#fef2f2] px-4 py-3 text-sm font-semibold text-[#dc2626] shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:bg-[#fee2e2] hover:shadow-[0_4px_12px_rgba(220,38,38,0.12)] active:scale-[0.97]">Logout</button>
          )}
        </div>
      </div>
    </div>
  );
}

function AuthModal({ mode, onClose, onSwitchMode, error, onError, onSchoolSave }: { mode: "signup" | "login"; onClose: () => void; onSwitchMode: (mode: "signup" | "login") => void; error: string; onError: (error: string) => void; onSchoolSave?: (name: string, logo: string) => void }) {
  const { signup, login, loginWithGoogle } = useAuth();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [school, setSchool] = useState("");
  const [schoolPhoto, setSchoolPhoto] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  const validate = (): string | null => {
    if (mode === "signup") { if (!school.trim()) return "Please enter your school name."; if (!name.trim()) return "Please enter your name."; if (name.trim().length < 2) return "Name must be at least 2 characters."; }
    if (!email.trim()) return "Please enter your email address.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return "Please enter a valid email address.";
    if (!password) return "Please enter your password.";
    if (password.length < 8) return "Password must be at least 8 characters.";
    if (mode === "signup" && password !== confirmPassword) return "Passwords do not match.";
    return null;
  };

  const handleSubmit = async () => {
    onError("");
    const v = validate();
    if (v) { onError(v); return; }
    setLoading(true);
    try {
      if (mode === "signup") { await signup(email.trim(), password, name.trim()); localStorage.setItem('vedaai_school', school.trim()); if (schoolPhoto) localStorage.setItem('vedaai_school_logo', schoolPhoto); onSchoolSave?.(school.trim(), schoolPhoto || ''); }
      else { await login(email.trim(), password); const sName = localStorage.getItem("vedaai_school") || ""; const sLogo = localStorage.getItem("vedaai_school_logo") || ""; onSchoolSave?.(sName, sLogo); }
      onClose();
    } catch (err: any) {
      const code = err?.code ?? "";
      console.error("Auth error:", code, err?.message);
      if (code === "auth/email-already-in-use") onError("Email already registered. Please sign in.");
      else if (code === "auth/invalid-credential" || code === "auth/wrong-password" || code === "auth/user-not-found") onError("Invalid email or password.");
      else if (code === "auth/too-many-requests") onError("Too many attempts. Please try again later.");
      else if (code === "auth/network-request-failed") onError("Network error. Check your connection.");
      else if (code === "auth/operation-not-allowed") onError("Email/Password sign-in is not enabled. Enable it in Firebase Console > Authentication > Sign-in method.");
      else if (code === "auth/weak-password") onError("Password is too weak. Use at least 6 characters.");
      else onError(`Error: ${code || err?.message || "Unknown error"}`);
    } finally { setLoading(false); }
  };

  const handleGoogle = async () => {
    onError("");
    setGoogleLoading(true);
    try { await loginWithGoogle(); onClose(); } catch (err: any) {
      const code = err?.code ?? "";
      console.error("[VedaAI] Google sign-in error:", code, err?.message);
      if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") onError("");
      else if (code === "auth/operation-not-allowed") onError("Google sign-in is not enabled. Enable it in Firebase Console > Authentication > Sign-in method > Google.");
      else if (code === "auth/unauthorized-domain") onError("This domain is not authorized. Add it in Firebase Console > Authentication > Settings > Authorized domains.");
      else onError(`Google sign-in failed: ${code || err?.message || "Unknown error"}`);
    } finally { setGoogleLoading(false); }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => { if (e.key === "Enter") handleSubmit(); };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/35 p-4" onClick={onClose}>
      <div className="w-full max-w-xs rounded-2xl bg-white p-5 shadow-[0_20px_50px_rgba(0,0,0,0.25)]" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-semibold text-[#2f3135]">{mode === "signup" ? "Create Account" : "Welcome Back"}</h3>
        <p className="mt-0.5 text-xs text-[#6f7278]">{mode === "signup" ? "Sign up to get started." : "Sign in to continue"}</p>
        <div className="mt-3 space-y-2" onKeyDown={handleKeyDown}>
          {mode === "signup" && <div><label className="mb-0.5 block text-xs font-medium text-[#3a3d42]">Full Name</label><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Enter your full name" className="w-full rounded-lg border border-[#d8dae0] px-3 py-2 text-xs outline-none transition focus:border-[#303030] focus:ring-1 focus:ring-[#303030]" /></div>}{mode === "signup" && <div><label className="mb-0.5 block text-xs font-medium text-[#3a3d42]">School Name</label><input value={school} onChange={(e) => setSchool(e.target.value)} placeholder="Enter your school name" className="w-full rounded-lg border border-[#d8dae0] px-3 py-2 text-xs outline-none transition focus:border-[#303030] focus:ring-1 focus:ring-[#303030]" /></div>}{mode === "signup" && <div><label className="mb-0.5 block text-xs font-medium text-[#3a3d42]">School Logo</label><label className="flex cursor-pointer items-center gap-3 rounded-lg border border-dashed border-[#d8dae0] bg-[#fafafa] px-4 py-3 text-sm text-[#6f7278] transition hover:bg-[#f3f3f4] hover:border-[#b0b3b8]"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5 text-[#9ea1a7]"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>{schoolPhoto ? "Change logo" : "Upload school logo"}<input type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) { const reader = new FileReader(); reader.onload = (ev) => setSchoolPhoto(ev.target?.result as string); reader.readAsDataURL(f); } }} /></label>{schoolPhoto && <div className="mt-2 flex items-center gap-2"><img src={schoolPhoto} alt="School logo" className="h-10 w-10 rounded-lg object-cover" /><button type="button" onClick={() => setSchoolPhoto(null)} className="text-xs text-[#c2410c] underline">Remove</button></div>}</div>}
          <div><label className="mb-0.5 block text-xs font-medium text-[#3a3d42]">Email Address</label><input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Enter your email" type="email" className="w-full rounded-lg border border-[#d8dae0] px-3 py-2 text-xs outline-none transition focus:border-[#303030] focus:ring-1 focus:ring-[#303030]" /></div>
          <div><label className="mb-0.5 block text-xs font-medium text-[#3a3d42]">Password</label><div className="relative"><input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Enter your password" type={showPassword ? "text" : "password"} className="w-full rounded-lg border border-[#d8dae0] px-3 py-2.5 pr-10 text-sm outline-none transition focus:border-[#303030] focus:ring-1 focus:ring-[#303030]" /><button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-[#9ea1a7] transition-all duration-200 hover:bg-[#f3f3f4] hover:text-[#303030] active:scale-90" tabIndex={-1}>{showPassword ? <EyeOffIcon className="h-4 w-4" /> : <EyeIcon className="h-4 w-4" />}</button></div></div>
          {mode === "signup" && <div><label className="mb-0.5 block text-xs font-medium text-[#3a3d42]">Confirm Password</label><input value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="Confirm your password" type={showPassword ? "text" : "password"} className="w-full rounded-lg border border-[#d8dae0] px-3 py-2 text-xs outline-none transition focus:border-[#303030] focus:ring-1 focus:ring-[#303030]" /></div>}
        </div>
        {error && <p className="mt-3 text-sm text-[#c2410c]">{error}</p>}
        <button onClick={handleSubmit} disabled={loading || googleLoading} className="mt-3 w-full rounded-lg bg-[#303030] px-4 py-2 text-xs font-medium text-white shadow-[0_4px_14px_rgba(0,0,0,0.25)] transition-all duration-200 hover:-translate-y-0.5 hover:bg-[#1f1f1f] hover:shadow-[0_6px_20px_rgba(0,0,0,0.35)] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none disabled:hover:translate-y-0">
          {loading ? (mode === "signup" ? "Creating account..." : "Signing in...") : (mode === "signup" ? "Create Account" : "Sign In")}
        </button>
        <div className="my-3 flex items-center gap-2"><div className="h-px flex-1 bg-[#e5e7eb]" /><span className="text-xs text-[#9ea1a7]">OR</span><div className="h-px flex-1 bg-[#e5e7eb]" /></div>
        <button onClick={handleGoogle} disabled={loading || googleLoading} className="flex w-full items-center justify-center gap-2 rounded-lg border border-[#d8dae0] bg-white px-4 py-2 text-xs font-medium text-[#303030] shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:bg-[#f9fafb] hover:shadow-[0_4px_12px_rgba(0,0,0,0.08)] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none disabled:hover:translate-y-0">
          <GoogleIcon className="h-5 w-5" />{googleLoading ? "Connecting to Google..." : "Continue with Google"}
        </button>
        <div className="mt-3 text-center text-xs text-[#6f7278]">
          {mode === "signup" ? <>Already have an account? <button onClick={() => { onError(""); onSwitchMode("login"); }} className="font-medium text-[#303030] underline transition-colors duration-200 hover:text-[#ff5a2b]">Sign In</button></> : <>Don&apos;t have an account? <button onClick={() => { onError(""); onSwitchMode("signup"); }} className="font-medium text-[#303030] underline transition-colors duration-200 hover:text-[#ff5a2b]">Create Account</button></>}
        </div>
        {mode === "login" && <p className="mt-2 text-center text-xs text-[#9ea1a7]"><button className="underline transition-colors duration-200 hover:text-[#303030]">Forgot Password?</button></p>}
      </div>
    </div>
  );
}

function LibraryModal({ onClose, items, onOpenHome }: { onClose: () => void; items: UploadHistoryItem[]; onOpenHome: (item: UploadHistoryItem) => void }) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/35 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-[0_20px_50px_rgba(0,0,0,0.25)]" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2"><ClockIcon className="h-5 w-5 text-[#2f3135]" /><h3 className="text-lg font-semibold text-[#2f3135]">My Library - Upload History</h3></div>
          <button onClick={onClose} className="rounded-md p-1 text-[#6f7278] transition-all duration-200 hover:bg-[#f3f3f4] hover:text-[#2f3135] active:scale-90" aria-label="Close library"><CloseIcon className="h-5 w-5" /></button>
        </div>
        {items.length === 0 ? (
          <div className="rounded-xl border border-dashed border-[#d4d7dd] bg-[#fafafa] p-6 text-center text-sm text-[#7a7f87]">No upload history yet. Upload question paper and answer sheet to see records here.</div>
        ) : (
          <div className="max-h-[380px] space-y-3 overflow-auto pr-1">
            {items.map((item) => (
              <div key={item.id} className="rounded-xl border border-[#eceef2] p-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-[#2f3135]">{new Date(item.uploadedAt).toLocaleString()}</p>
                    <p className="mt-1 text-sm text-[#5e636b]">Question Paper: {item.questionFileName}</p>
                    <p className="text-sm text-[#5e636b]">Answer Sheet: {item.answerFileName}</p>
                  </div>
                  <button onClick={() => onOpenHome(item)} className="rounded-lg bg-[#303030] px-3 py-1.5 text-xs font-medium text-white shadow-[0_3px_10px_rgba(0,0,0,0.2)] transition-all duration-200 hover:-translate-y-0.5 hover:bg-[#1f1f1f] hover:shadow-[0_5px_16px_rgba(0,0,0,0.3)] active:scale-[0.95]">Open Home</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function IconNav({ icon, active, onClick }: { icon: ReactNode; active?: boolean; onClick?: () => void }) {
  return <button onClick={onClick} className={`rounded-xl p-2 transition-all duration-300 ease-out ${active ? "bg-[#eff0f1] text-[#2f3135] shadow-[0_8px_16px_rgba(0,0,0,0.1)]" : "text-[#8f9196] hover:-translate-y-0.5 hover:bg-[#f4f5f6] hover:text-[#2f3135] hover:shadow-[0_10px_18px_rgba(0,0,0,0.12)] active:scale-90"}`}>{icon}</button>;
}

function OrbitBadge({ className, children }: { className: string; children: ReactNode }) {
  return <span className={`absolute rounded-full bg-[#ff6d3c] p-1.5 text-white shadow-[0_6px_12px_rgba(255,109,60,0.45)] ${className}`}>{children}</span>;
}

function UploadBox({ label, file, onPick }: { label: string; file: File | null; onPick: (file: File | null) => void }) {
  return (
    <label className="relative isolate flex min-h-[190px] cursor-pointer flex-col items-center justify-center rounded-[24px] border-2 border-dashed border-[#d4d6da] bg-white px-4 text-center shadow-[0_10px_24px_rgba(0,0,0,0.08)] transition hover:-translate-y-0.5 hover:shadow-[0_14px_30px_rgba(0,0,0,0.12)] sm:min-h-[222px] sm:rounded-[30px]">
      <span className="pointer-events-none absolute inset-[6px] -z-10 rounded-[20px] bg-white/70 backdrop-blur-[1px] sm:rounded-[26px]" />
      <span className="pointer-events-none absolute -bottom-4 left-6 right-6 -z-20 h-7 rounded-full bg-white/80 blur-md shadow-[0_10px_20px_rgba(0,0,0,0.16)]" />
      <input type="file" className="hidden" accept=".pdf,.jpg,.jpeg,.png,.webp,.bmp,.tiff" onChange={(e) => onPick(e.target.files?.[0] ?? null)} />
      <UploadIcon className="h-8 w-8 text-[#36383c]" />
      <p className="mt-4 text-lg font-semibold text-[#2f3135] sm:text-xl md:text-2xl">Upload <span className="text-[#ff5524]">{label}</span></p>
      <p className="text-xs text-[#9c9ea4] sm:text-sm">PDF, PNG, JPG, JPEG, WEBP (max 10MB)</p>
      {file && <div className="mt-2 flex items-center gap-2 rounded-full border border-[#e0e0e0] bg-[#f5f5f5] px-3 py-1"><span className="max-w-[160px] truncate text-sm text-[#3f4247]">{file.name}</span><button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); onPick(null); }} className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#d4d4d4] text-[#666] transition-all duration-200 hover:bg-[#ff5a2b] hover:text-white active:scale-90"><CloseIcon className="h-3 w-3" /></button></div>}
    </label>
  );
}

function NavItem({ icon, label, active, onClick }: { icon: ReactNode; label: string; active?: boolean; onClick?: () => void }) {
  return <button onClick={onClick} className={`flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left shadow-[0_6px_14px_rgba(0,0,0,0.03)] transition-all duration-300 ease-out ${active ? "bg-[#f2f2f2] text-[#2f3135] shadow-[0_8px_20px_rgba(0,0,0,0.09)]" : "text-[#73767a] hover:-translate-y-0.5 hover:bg-[#f6f6f6] hover:shadow-[0_10px_20px_rgba(0,0,0,0.1)] active:scale-[0.97]"}`}>{icon}<span className="text-sm">{label}</span></button>;
}

function CircleBtn({ children, className }: { children: ReactNode; className?: string }) {
  return <button className={`rounded-full bg-[#f7f7f7] p-2 text-[#2f3135] shadow-sm transition-all duration-200 hover:bg-[#efefef] hover:shadow-[0_4px_10px_rgba(0,0,0,0.06)] active:scale-90 ${className || ""}`}>{children}</button>;
}

function UserAvatar({ src, className }: { src?: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) return <div className={`rounded-full bg-[radial-gradient(circle_at_30%_30%,#ff7f58,#2b2d31)] ${className ?? "h-9 w-9"}`} />;
  return <img src={src} alt="User avatar" onError={() => setFailed(true)} className={`rounded-full object-cover ${className ?? "h-9 w-9"}`} />;
}

function iconProps() {
  return { fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
}

function ArrowLeftIcon({ className }: { className?: string }) { return <svg className={className} viewBox="0 0 24 24" {...iconProps()}><path d="M19 12H5" /><path d="m12 19-7-7 7-7" /></svg>; }
function ArrowRightIcon({ className }: { className?: string }) { return <svg className={className} viewBox="0 0 24 24" {...iconProps()}><path d="M5 12h14" /><path d="m12 5 7 7-7 7" /></svg>; }
function UploadIcon({ className }: { className?: string }) { return <svg className={className} viewBox="0 0 24 24" {...iconProps()}><path d="M12 3v12" /><path d="m17 8-5-5-5 5" /><path d="M4 14v5h16v-5" /></svg>; }
function BellIcon({ className }: { className?: string }) { return <svg className={className} viewBox="0 0 24 24" {...iconProps()}><path d="M15 17h5l-1.4-1.4A2 2 0 0 1 18 14.2V10a6 6 0 1 0-12 0v4.2a2 2 0 0 1-.6 1.4L4 17h5" /><path d="M10 20a2 2 0 0 0 4 0" /></svg>; }
function SparkIcon({ className }: { className?: string }) { return <svg className={className} viewBox="0 0 24 24" fill="currentColor"><path d="M12 2 13.8 8.2 20 10l-6.2 1.8L12 18l-1.8-6.2L4 10l6.2-1.8z" /></svg>; }
function GridIcon({ className }: { className?: string }) { return <svg className={className} viewBox="0 0 24 24" {...iconProps()}><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /></svg>; }
function ClassIcon({ className }: { className?: string }) { return <svg className={className} viewBox="0 0 24 24" {...iconProps()}><path d="M4 5h16v9H4z" /><path d="m4 14 4 5" /><circle cx="18" cy="8" r="1.5" fill="currentColor" stroke="none" /></svg>; }
function DocIcon({ className }: { className?: string }) { return <svg className={className} viewBox="0 0 24 24" {...iconProps()}><rect x="6" y="3" width="12" height="18" rx="2" /><path d="M9 8h6" /><path d="M9 12h6" /><path d="M9 16h6" /></svg>; }
function BagIcon({ className }: { className?: string }) { return <svg className={className} viewBox="0 0 24 24" {...iconProps()}><rect x="5" y="4" width="14" height="17" rx="2" /><path d="M9 2v4" /><path d="M15 2v4" /></svg>; }
function ClockIcon({ className }: { className?: string }) { return <svg className={className} viewBox="0 0 24 24" {...iconProps()}><circle cx="12" cy="12" r="9" /><path d="M12 7v6l4 2" /></svg>; }
function SettingsIcon({ className }: { className?: string }) { return <svg className={className} viewBox="0 0 24 24" {...iconProps()}><path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.82.33Z" /></svg>; }
function PanelIcon({ className }: { className?: string }) { return <svg className={className} viewBox="0 0 24 24" {...iconProps()}><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M12 5v14" /></svg>; }
function MenuIcon({ className }: { className?: string }) { return <svg className={className} viewBox="0 0 24 24" {...iconProps()}><path d="M4 6h16" /><path d="M4 12h16" /><path d="M4 18h16" /></svg>; }
function CloseIcon({ className }: { className?: string }) { return <svg className={className} viewBox="0 0 24 24" {...iconProps()}><path d="m18 6-12 12" /><path d="m6 6 12 12" /></svg>; }
function ChevronDown({ className }: { className?: string }) { return <svg className={className} viewBox="0 0 24 24" {...iconProps()}><path d="m6 9 6 6 6-6" /></svg>; }
function ChevronRight({ className }: { className?: string }) { return <svg className={className} viewBox="0 0 24 24" {...iconProps()}><path d="m9 18 6-6-6-6" /></svg>; }
function EyeIcon({ className }: { className?: string }) { return <svg className={className} viewBox="0 0 24 24" {...iconProps()}><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>; }
function EyeOffIcon({ className }: { className?: string }) { return <svg className={className} viewBox="0 0 24 24" {...iconProps()}><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" /><line x1="1" y1="1" x2="23" y2="23" /></svg>; }
function GoogleIcon({ className }: { className?: string }) { return <svg className={className} viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" /><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" /><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" /><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" /></svg>; }
