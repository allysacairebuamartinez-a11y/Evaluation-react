import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import { useEffect, useMemo, useRef, useState } from "react";
import { createDemoApi } from "./demo-api";
import { BarChart3, BookOpen, CalendarDays, Check, ClipboardCheck, Download, FileText, LogIn, Printer, Search, ShieldCheck, Users } from "lucide-react";
import "./flow.css";
import "./flow-extra.css";
const API = "/api";
const DEMO_MODE = import.meta.env.DEV && import.meta.env.VITE_DEMO_MODE === "true";
const SEMESTERS = ["1st Semester", "2nd Semester", "Summer"];
const QUESTION_DATA = [
  { id: 1, text: "Starts the class and ends the class with prayer." },
  { id: 2, text: "Course objectives were explained clearly at the beginning of the course/subject." },
  { id: 3, text: "Gives relevant assignments and requirements to reinforce learning." },
  { id: 4, text: "Injects a sense of humor in his/her teaching without being vulgar." },
  { id: 5, text: "Has a democratic way in dealing with students' behavior." },
  { id: 6, text: "Meet class regularly." },
  { id: 7, text: "Employs an acceptable way of handling different types of students." },
  { id: 8, text: "Relates subject matter to relevant topics of interest of students." },
  { id: 9, text: "Entertains and answers students' questions." },
  { id: 10, text: "Relates subject matter to real life or practical situations." },
  { id: 11, text: "Explains clearly the policies pertaining to the grading system." },
  { id: 12, text: "Provides students opportunity to recheck their scores/ratings and verify grades." },
  { id: 13, text: "Gives students constructive feedbacks on their performance in class." },
  { id: 14, text: "Informs students of their scores/ratings and grades punctually." },
  { id: 15, text: "Gives quizzes, examinations, assessments and/or performance evaluation in a systematic manner." },
  { id: 16, text: "Engages students to get involved in interactive and independent learning." },
  { id: 17, text: "Shows vitality, enthusiasm and dynamism in teaching." },
  { id: 18, text: "Asks questions that promote critical and creative thinking." },
  { id: 19, text: "Manifests Pillarican spirituality through acts of humility, service and compassion." },
  { id: 20, text: "Makes favorable or encouraging response to students' opinions, comments and suggestions." },
  { id: 21, text: "Practices a sense of propriety in speech, actions, grooming and attire." },
  { id: 22, text: "Acts as a witness to the Catholic faith by integrating Christian value in lessons." },
  { id: 23, text: "Models respect and courtesy in the online class." },
  { id: 24, text: "Shows concern for students." },
  { id: 25, text: "Uses variety of instructional strategies and resources to respond to students' diverse needs." },
  { id: 26, text: "Incorporates multimedia and visual resources into online teaching." },
  { id: 27, text: "Understands and is responsive to students with special needs in the online classroom." },
  { id: 28, text: "Compared to course taught using classroom format, I found the distance education format to be equally effective.", type: "agree" },
  { id: 29, text: "Would you like to be in another class of this teacher/instructor again in later school year/semester?", type: "yesno" }
];
const DEFAULT_CRITERIA = [
  { name: "Teaching effectiveness", questionIds: [2, 3, 8, 10, 15, 16, 17, 18, 25, 26] },
  { name: "Communication", questionIds: [4, 9, 20] },
  { name: "Classroom management", questionIds: [1, 5, 7, 21, 23] },
  { name: "Punctuality and grading", questionIds: [6, 11, 12, 13, 14] },
  { name: "Student engagement", questionIds: [19, 22, 24, 27, 28, 29] }
];
const roles = {
  admin: { label: "Admin" },
  student: { label: "Student" },
  dean: { label: "Dean" }
};
const standardScale = [
  { value: 5, label: "Always" },
  { value: 4, label: "Frequently" },
  { value: 3, label: "Sometimes" },
  { value: 2, label: "Rarely" },
  { value: 1, label: "Never" }
];
const agreeScale = [
  { value: 5, label: "Strongly Agree" },
  { value: 4, label: "Agree" },
  { value: 3, label: "Neutral" },
  { value: 2, label: "Disagree" },
  { value: 1, label: "Strongly Disagree" }
];
const yesNoScale = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" }
];
function buildInitialRatings() {
  return QUESTION_DATA.reduce((accumulator, question) => {
    const key = String(question.id);
    accumulator[key] = question.type === "yesno" ? "" : 0;
    return accumulator;
  }, {});
}
function asDateTimeLocal(value) {
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
function App() {
  const demoApi = useRef(null);
  if (!demoApi.current) demoApi.current = createDemoApi(QUESTION_DATA, DEFAULT_CRITERIA);
  const [step, setStep] = useState(1);
  const [loginName, setLoginName] = useState("");
  const [selectedRole, setSelectedRole] = useState("");
  const [password, setPassword] = useState("");
  const [user, setUser] = useState(null);
  const [demoMode, setDemoMode] = useState(false);
  const [csrfToken, setCsrfToken] = useState("");
  const [authChecking, setAuthChecking] = useState(true);
  const [authError, setAuthError] = useState("");
  const [busy, setBusy] = useState(false);
  const [evaluationSubmitting, setEvaluationSubmitting] = useState(false);
  const evaluationSubmissionLock = useRef(false);
  const [notice, setNotice] = useState("");
  const [responses, setResponses] = useState([]);
  const [catalog, setCatalog] = useState({ teachers: [], subjects: [], assignments: [], courses: [], courseSubjects: [], studentCourse: null, periods: [], departments: [] });
  const [submissions, setSubmissions] = useState([]);
  const [form, setForm] = useState({ teacher: "", subject: "", periodId: "", ratings: buildInitialRatings() });
  const [criteria, setCriteria] = useState(DEFAULT_CRITERIA);
  const [questions, setQuestions] = useState(QUESTION_DATA);
  const flash = (message) => {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 2800);
  };
  const apiRequest = async (path, options = {}) => {
    if (DEMO_MODE && demoMode) {
      if (!demoApi.current) throw new Error("Demo mode is unavailable. Restart the development server and try again.");
      return demoApi.current(path, options, user?.role);
    }
    const headers = new Headers(options.headers);
    if (options.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    if (csrfToken && options.method && options.method !== "GET") headers.set("X-CSRF-Token", csrfToken);
    const result = await fetch(`${API}${path}`, { ...options, headers, credentials: "same-origin" });
    const data = await result.json().catch(() => ({}));
    if (!result.ok) throw new Error(data.error || "The request could not be completed.");
    return data;
  };
  useEffect(() => {
    if (DEMO_MODE) {
      setAuthChecking(false);
      return () => {};
    }
    let active = true;
    fetch(`${API}/auth/me`, { credentials: "same-origin" }).then(async (response) => {
      if (response.status === 401) return null;
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to verify your session.");
      return data;
    }).then((session) => {
      if (!active) return;
      if (session) {
        setUser(session.user);
        setLoginName(session.user.username);
        setCsrfToken(session.csrfToken);
      }
    }).catch((error) => {
      if (active) setAuthError(error instanceof Error ? error.message : "Unable to connect to the evaluation server.");
    }).finally(() => {
      if (active) setAuthChecking(false);
    });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (!user) return void 0;
    let active = true;
    const loadDashboardData = async () => {
      try {
        const [nextCatalog, reports] = await Promise.all([
          apiRequest("/catalog"),
          user.role === "student" ? Promise.resolve([]) : apiRequest("/reports")
        ]);
        if (!active) return;
        setCatalog(nextCatalog);
        setResponses(reports);
        if (user.role === "student") {
          const mine = await apiRequest("/my-submissions");
          if (active) setSubmissions(mine);
        }
      } catch (error) {
        if (active) flash(error instanceof Error ? error.message : "Unable to load dashboard data.");
      }
    };
    void loadDashboardData();
    const timer = window.setInterval(loadDashboardData, user.role === "student" ? 30e3 : 15e3);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [user, csrfToken, demoMode]);
  useEffect(() => {
    if (!user) return;
    let active = true;
    Promise.all([apiRequest("/settings/criteria"), apiRequest("/settings/questions")])
      .then(([criteriaData, questionData]) => {
        if (!active) return;
        setCriteria(criteriaData.criteria);
        setQuestions(questionData.questions);
      })
      .catch((error) => {
        if (active) flash(error instanceof Error ? error.message : "Unable to load evaluation questions and criteria.");
      });
    return () => {
      active = false;
    };
  }, [user, csrfToken, demoMode]);
  const login = async (event) => {
    event.preventDefault();
    const trimmedUsername = loginName.trim();
    if (!selectedRole) {
      setAuthError("Select Admin, Dean, or Student.");
      return;
    }
    if (DEMO_MODE) {
      setBusy(true);
      setAuthError("");
      try {
        if (!demoApi.current) demoApi.current = createDemoApi(QUESTION_DATA, DEFAULT_CRITERIA);
        setDemoMode(true);
        setUser({
          id: 0,
          username: trimmedUsername || "demo",
          displayName: trimmedUsername || `Demo ${roles[selectedRole].label}`,
          role: selectedRole,
          department: selectedRole === "dean" ? "" : "College of Teacher Education"
        });
        setPassword("");
        setStep(1);
      } catch (error) {
        setAuthError(error instanceof Error ? error.message : "Unable to start Demo Mode.");
      } finally {
        setBusy(false);
      }
      return;
    }
    if (!trimmedUsername || trimmedUsername.length > 120 || trimmedUsername.length < 3) {
      setAuthError("Enter a valid username or school ID.");
      return;
    }
    if (!password || password.length > 256) {
      setAuthError("Enter your password.");
      return;
    }
    setBusy(true);
    setAuthError("");
    try {
      const data = await apiRequest("/auth/login", {
        method: "POST",
        body: JSON.stringify({ username: trimmedUsername, password, role: selectedRole })
      });
      if (!data.user || !Object.hasOwn(roles, data.user.role)) {
        throw new Error("This account does not have a supported role.");
      }
      setDemoMode(false);
      setUser(data.user);
      setCsrfToken(data.csrfToken);
      setLoginName(data.user.username);
      setPassword("");
      setStep(1);
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Sign-in failed. Please try again.");
    } finally {
      setBusy(false);
    }
  };
  const submit = async (event) => {
    event.preventDefault();
    const teacher = form.teacher.trim();
    const subject = form.subject.trim();
    const missingQuestion = questions.find((question) => {
      const value = form.ratings[String(question.id)];
      if (question.type === "yesno") {
        return value !== "yes" && value !== "no";
      }
      return Number(value) < 1 || Number(value) > 5;
    });
    if (!teacher || !subject || !form.periodId) {
      flash("Please select the teacher, subject, and evaluation period.");
      return;
    }
    if (form.periodId && !catalog.periods.some((period) => String(period.id) === form.periodId && period.status === "open")) {
      flash("The selected evaluation period is not currently open.");
      return;
    }
    if (missingQuestion) {
      flash(`Please answer question ${missingQuestion.id} before submitting.`);
      return;
    }
    const period = catalog.periods.find((item) => String(item.id) === form.periodId);
    if (evaluationSubmissionLock.current) return;
    if (!window.confirm(`Submit your evaluation for ${teacher} in ${subject} for ${period?.name || "this evaluation period"}? You cannot edit or submit it again after confirmation.`)) {
      return;
    }
    evaluationSubmissionLock.current = true;
    setEvaluationSubmitting(true);
    try {
      await apiRequest("/responses", {
        method: "POST",
        body: JSON.stringify({ teacher, subject, periodId: Number(form.periodId), ratings: form.ratings })
      });
      setStep(3);
      setForm({ teacher: "", subject: "", periodId: "", ratings: buildInitialRatings() });
      setSubmissions((current) => [...current, {
        teacher,
        subject,
        period: period?.name || "",
        periodId: Number(form.periodId)
      }]);
      flash("Evaluation submitted successfully.");
      try {
        setSubmissions(await apiRequest("/my-submissions"));
      } catch (error) {
        flash(`Your evaluation was submitted, but status could not be refreshed: ${error instanceof Error ? error.message : "Please reload the page."}`);
      }
    } catch (error) {
      flash(error instanceof Error ? error.message : "Unable to submit evaluation.");
    } finally {
      evaluationSubmissionLock.current = false;
      setEvaluationSubmitting(false);
    }
  };
  const logout = async () => {
    if (!(DEMO_MODE && demoMode)) {
      try {
        await apiRequest("/auth/logout", { method: "POST", body: "{}" });
      } catch (error) {
        flash(error instanceof Error ? error.message : "Unable to sign out safely.");
        return;
      }
    }
    setDemoMode(false);
    setUser(null);
    setLoginName("");
    setSelectedRole("");
    setPassword("");
    setResponses([]);
    setCatalog({ teachers: [], subjects: [], assignments: [], courses: [], courseSubjects: [], studentCourse: null, periods: [], departments: [] });
  };
  if (authChecking) {
    return /* @__PURE__ */ jsxs("div", { className: "auth-check", children: [
      /* @__PURE__ */ jsx(SchoolMark, { size: "small" }),
      /* @__PURE__ */ jsx("span", { children: "Checking secure session\u2026" })
    ] });
  }
  if (!user) {
    return /* @__PURE__ */ jsx(
      LoginScreen,
      {
        loginName,
        setLoginName,
        selectedRole,
        setSelectedRole: (role) => {
          setSelectedRole(role);
          setAuthError("");
        },
        demoMode: DEMO_MODE,
        password,
        setPassword,
        login,
        busy,
        error: authError
      }
    );
  }
  return /* @__PURE__ */ jsxs("div", { className: "flow-shell", children: [
    /* @__PURE__ */ jsxs("header", { className: "flow-topbar", children: [
      /* @__PURE__ */ jsxs("div", { className: "flow-brand", children: [
        /* @__PURE__ */ jsx(SchoolMark, { size: "small" }),
        /* @__PURE__ */ jsxs("div", { children: [
          /* @__PURE__ */ jsx("strong", { children: "OLPC-SMI" }),
          /* @__PURE__ */ jsx("small", { children: "Evaluation System" })
        ] })
      ] }),
      /* @__PURE__ */ jsxs("div", { className: "live-pill", children: [
        /* @__PURE__ */ jsx("i", {}),
        DEMO_MODE && demoMode ? " DEMO MODE" : " Live data"
      ] }),
      /* @__PURE__ */ jsxs("div", { className: "account-chip", children: [
        /* @__PURE__ */ jsx("strong", { children: user.displayName }),
        /* @__PURE__ */ jsx("small", { children: roles[user.role].label })
      ] }),
      /* @__PURE__ */ jsx("button", { className: "logout", onClick: () => void logout(), children: "Sign out" })
    ] }),
    user.role === "student" && /* @__PURE__ */ jsx(ClientFlow, { step, setStep, form, setForm, submit, catalog, submissions, questions, criteria, evaluationSubmitting }),
    (user.role === "admin" || user.role === "dean") && /* @__PURE__ */ jsx(AdminDashboard, { role: user.role, userId: user.id, responses, catalog, apiRequest, refreshCatalog: async () => setCatalog(await apiRequest("/catalog")), flash, questions, setQuestions, onAccountUpdated: (displayName, department) => setUser((current) => current ? { ...current, displayName, department } : current) }),
    notice && /* @__PURE__ */ jsxs("div", { className: "toast", children: [
      /* @__PURE__ */ jsx(Check, { size: 16 }),
      " ",
      notice
    ] })
  ] });
}
function SchoolMark({ size }) {
  return /* @__PURE__ */ jsx("img", { className: `school-mark school-mark-${size}`, src: "/olpc-logo.png", alt: "OLPC-SMI official school logo" });
}
function TeacherIllustration() {
  return /* @__PURE__ */ jsxs("svg", { className: "teacher-illustration", viewBox: "0 0 360 230", role: "img", "aria-label": "Teacher presenting a lesson at a chalkboard", children: [
    /* @__PURE__ */ jsx("rect", { x: "12", y: "42", width: "205", height: "137", rx: "4", fill: "#d7a52d" }),
    /* @__PURE__ */ jsx("rect", { x: "20", y: "50", width: "189", height: "120", fill: "#163c35" }),
    /* @__PURE__ */ jsx("path", { d: "M34 151h158", stroke: "#e8dfc2", strokeWidth: "3", strokeLinecap: "round", opacity: ".8" }),
    /* @__PURE__ */ jsx("path", { d: "M57 80h66m-66 16h94m-94 16h75", stroke: "#dce6d7", strokeWidth: "3", strokeLinecap: "round", opacity: ".7" }),
    /* @__PURE__ */ jsx("path", { d: "M8 181h214l-12 10H20z", fill: "#b78121" }),
    /* @__PURE__ */ jsx("circle", { cx: "272", cy: "55", r: "31", fill: "#f2bd8d" }),
    /* @__PURE__ */ jsx("path", { d: "M241 56c-4-29 13-48 35-48 20 0 34 16 33 40-8-8-14-18-17-27-11 15-27 23-51 25z", fill: "#392321" }),
    /* @__PURE__ */ jsx("path", { d: "M246 49c4-20 18-32 34-32 14 0 23 9 27 22-12-4-21-11-27-20-8 15-20 24-34 30z", fill: "#513027" }),
    /* @__PURE__ */ jsx("path", { d: "M263 59h2m18 0h2", stroke: "#36211c", strokeWidth: "3", strokeLinecap: "round" }),
    /* @__PURE__ */ jsx("path", { d: "M267 72c5 4 11 4 16 0", stroke: "#a7564c", strokeWidth: "2.5", strokeLinecap: "round" }),
    /* @__PURE__ */ jsx("path", { d: "M251 91c11-10 32-10 43 0l12 60h-67z", fill: "#d45c53" }),
    /* @__PURE__ */ jsx("path", { d: "m261 99 24 27 12-9-22-24z", fill: "#fff2d4" }),
    /* @__PURE__ */ jsx("path", { d: "m248 103-29 27-5-7 23-37m60 18 28 24-5 7-31-17", fill: "#f2bd8d", stroke: "#e7ab79", strokeWidth: "4", strokeLinecap: "round", strokeLinejoin: "round" }),
    /* @__PURE__ */ jsx("path", { d: "M244 149h60l-5 40h-21l-6-28-8 28h-21z", fill: "#345a8b" }),
    /* @__PURE__ */ jsx("path", { d: "m247 186-6 25h18l7-24m23 0 8 24h18l-10-25", fill: "#f2bd8d" }),
    /* @__PURE__ */ jsx("path", { d: "M238 212h23m31 0h24", stroke: "#f1d49a", strokeWidth: "5", strokeLinecap: "round" }),
    /* @__PURE__ */ jsx("path", { d: "m217 127 7-7 7 8-8 5z", fill: "#f4e7c6" }),
    /* @__PURE__ */ jsx("path", { d: "M226 119 243 100", stroke: "#f2bd8d", strokeWidth: "5", strokeLinecap: "round" })
  ] });
}
function LoginScreen({ loginName, setLoginName, selectedRole, setSelectedRole, password, setPassword, login, demoMode, busy, error }) {
  return /* @__PURE__ */ jsxs("div", { className: "auth-screen", children: [
    /* @__PURE__ */ jsx("a", { className: "auth-school-logo", href: "#", "aria-label": "OLPC-SMI", children: /* @__PURE__ */ jsx(SchoolMark, { size: "large" }) }),
    /* @__PURE__ */ jsxs("div", { className: "auth-card", children: [
      /* @__PURE__ */ jsxs("div", { className: "auth-intro", children: [
        /* @__PURE__ */ jsx("span", { className: "auth-kicker", children: "OLPC-SMI \xB7 SAN MANUEL, ISABELA" }),
        /* @__PURE__ */ jsxs("h1", { children: [
          "Online Teachers",
          /* @__PURE__ */ jsx("br", {}),
          "Evaluation System"
        ] }),
        /* @__PURE__ */ jsx(TeacherIllustration, {})
      ] }),
      /* @__PURE__ */ jsxs("form", { className: "auth-form", onSubmit: login, children: [
        /* @__PURE__ */ jsx("h2", { children: "Login" }),
        /* @__PURE__ */ jsx("p", { children: "Sign in with your school account." }),
        /* @__PURE__ */ jsx("div", { className: "auth-status-row", children: /* @__PURE__ */ jsxs("span", { className: "status-pill", children: [
          /* @__PURE__ */ jsx(ShieldCheck, { size: 13 }),
          demoMode ? " Demo mode" : " Secure portal"
        ] }) }),
        /* @__PURE__ */ jsx("div", { className: "role-grid", "aria-label": "Choose your role", children: Object.entries(roles).map(([role, details]) => {
          const Icon = role === "admin" ? ShieldCheck : role === "student" ? BookOpen : BarChart3;
          return /* @__PURE__ */ jsxs(
            "button",
            {
              className: `role-button ${selectedRole === role ? "selected" : ""}`,
              type: "button",
              "aria-pressed": selectedRole === role,
              onClick: () => setSelectedRole(role),
              children: [
                /* @__PURE__ */ jsx(Icon, { size: 16 }),
                " ",
                details.label
              ]
            },
            role
          );
        }) }),
        /* @__PURE__ */ jsxs("label", { children: [
          "Username or school ID",
          /* @__PURE__ */ jsx(
            "input",
            {
              autoComplete: "username",
              required: !demoMode,
              maxLength: demoMode ? undefined : 120,
              value: loginName,
              onChange: (event) => {
                setLoginName(event.target.value);
              },
              placeholder: "Account username"
            }
          )
        ] }),
        /* @__PURE__ */ jsxs("label", { children: [
          "Password",
          /* @__PURE__ */ jsx("input", { autoComplete: "current-password", required: !demoMode, type: "password", maxLength: demoMode ? undefined : 256, value: password, onChange: (event) => setPassword(event.target.value), placeholder: "Enter your password" })
        ] }),
        error && /* @__PURE__ */ jsx("div", { className: "auth-error", role: "alert", children: error }),
        /* @__PURE__ */ jsxs("button", { className: "primary full", disabled: busy, children: [
          /* @__PURE__ */ jsx(LogIn, { size: 16 }),
          " ",
          busy ? "Signing in\u2026" : "Sign in"
        ] }),
        /* @__PURE__ */ jsx("small", { className: "auth-help", children: demoMode ? "Demo Mode is enabled. Choose a role; credentials are not verified." : "Your role and dashboard are determined automatically from your account." })
      ] }),
    ] })
  ] });
}
function Steps({ current, labels }) {
  return /* @__PURE__ */ jsx("div", { className: "stepper", children: labels.map((label, index) => /* @__PURE__ */ jsxs("span", { className: "step-wrap", children: [
    /* @__PURE__ */ jsxs("span", { className: `step ${current > index + 1 ? "done" : ""} ${current === index + 1 ? "current" : ""}`, children: [
      /* @__PURE__ */ jsx("span", { children: current > index + 1 ? /* @__PURE__ */ jsx(Check, { size: 14 }) : index + 1 }),
      label
    ] }),
    index < labels.length - 1 && /* @__PURE__ */ jsx("i", { className: "step-bar" })
  ] }, label)) });
}
function getScaleForQuestion(questionId) {
  if (questionId === 28) return agreeScale;
  if (questionId === 29) return yesNoScale;
  return standardScale;
}
function ClientFlow({ step, setStep, form, setForm, submit, catalog, submissions, questions, criteria, evaluationSubmitting }) {
  const openPeriods = catalog.periods.filter((period) => period.status === "open" && Date.parse(period.starts_at) <= Date.now() && Date.parse(period.ends_at) >= Date.now());
  const orderedQuestions = [...questions].sort((first, second) => first.id - second.id);
  const selectedPeriod = openPeriods.find((period) => String(period.id) === form.periodId)?.name;
  const matchesPeriod = (assignment, period) => (!assignment.semester || assignment.semester === period.semester) && (!assignment.academicYear || assignment.academicYear === period.academic_year);
  const alreadySubmitted = (assignment, period) => submissions.some((submission) =>
    submission.teacher === assignment.teacher &&
    submission.subject === assignment.subject &&
    (String(submission.periodId) === String(period.id) || submission.period === period.name)
  );
  const alreadyEvaluatedPair = submissions.some((submission) =>
    submission.teacher === form.teacher && submission.subject === form.subject &&
    (String(submission.periodId) === form.periodId || submission.period === selectedPeriod)
  );
  const selectedEvaluationPeriod = openPeriods.find((period) => String(period.id) === form.periodId);
  const periodAssignments = selectedEvaluationPeriod
    ? catalog.assignments.filter((assignment) => matchesPeriod(assignment, selectedEvaluationPeriod))
    : catalog.assignments;
  const availableAssignments = periodAssignments.filter((assignment) =>
    assignment.teacher === form.teacher && (!selectedEvaluationPeriod || !alreadySubmitted(assignment, selectedEvaluationPeriod))
  );
  const completedStatus = submissions.map((submission) => {
    const period = catalog.periods.find((item) => String(item.id) === String(submission.periodId)) || catalog.periods.find((item) => item.name === submission.period);
    return period ? { teacher: submission.teacher, subject: submission.subject, subjects: [submission.subject], period, completed: true } : null;
  }).filter(Boolean);
  const pendingStatus = openPeriods.flatMap((period) => {
    const assignments = catalog.assignments.filter((assignment) => matchesPeriod(assignment, period));
    return assignments.filter((assignment) => !alreadySubmitted(assignment, period)).map((assignment) => ({
      teacher: assignment.teacher,
      subject: assignment.subject,
      subjects: [assignment.subject],
      period,
      completed: false
    }));
  });
  const evaluationStatus = [...completedStatus, ...pendingStatus].sort((first, second) =>
    Date.parse(second.period.starts_at) - Date.parse(first.period.starts_at) || first.teacher.localeCompare(second.teacher)
  );
  const updateQuestion = (questionId, value) => {
    setForm({
      ...form,
      ratings: {
        ...form.ratings,
        [questionId]: value
      }
    });
  };
  const availableTeachers = [...new Set(periodAssignments
    .filter((assignment) => !selectedEvaluationPeriod || !alreadySubmitted(assignment, selectedEvaluationPeriod))
    .map((assignment) => assignment.teacher))];
  return (
    <main className="flow-content">
      <span className="flow-kicker">CLIENT / STUDENT PORTAL</span>
      <h1>Student Evaluation Dashboard</h1>
      <p>Review your assigned teachers, complete pending evaluations, and check your submission status.</p>
      <Steps current={step} labels={["Login", "Instructions", "Evaluate", "Submit"]} />
      {step === 1 && (
        <div className="student-dashboard">
          <section className="flow-card dashboard-panel">
            <div className="panel-heading">
              <div>
                <h2>My course and assigned classes</h2>
                <p>
                  Department: {catalog.studentDepartment || "Not assigned"}
                  {" · "}
                  Course: {catalog.studentCourse ? `${catalog.studentCourse.code} · ${catalog.studentCourse.name}` : "Not assigned"}
                </p>
              </div>
            </div>
            {catalog.assignments.length ? (
              <div className="table-wrap">
                <table>
                  <thead><tr><th>SUBJECT CODE</th><th>SUBJECT</th><th>TEACHER ID</th><th>TEACHER</th></tr></thead>
                  <tbody>{catalog.assignments.map((assignment) => (
                    <tr key={`${assignment.teacherId}-${assignment.subjectId}-${assignment.semester}-${assignment.academicYear}`}>
                      <td>{assignment.subjectCode}</td><td>{assignment.subject}</td><td>{assignment.teacherCode}</td><td>{assignment.teacher}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            ) : <div className="empty-state" role="status">No teacher and subject assignments are available for your course yet.</div>}
          </section>
          <section className="flow-card dashboard-panel">
            <div className="panel-heading">
              <div>
                <h2>My evaluation status</h2>
                <p>Your pending evaluations and submitted evaluations, including closed periods.</p>
              </div>
            </div>
            {evaluationStatus.length ? (
              <div className="table-wrap">
                <table className="student-status-table">
                  <thead><tr><th>TEACHER</th><th>ASSIGNED SUBJECTS</th><th>PERIOD</th><th>STATUS</th><th>ACTION</th></tr></thead>
                  <tbody>
                    {evaluationStatus.map((item) => (
                      <tr key={`${item.teacher}-${item.subject}-${item.period.id}`}>
                        <td>{item.teacher}</td>
                        <td>{item.subject}</td>
                        <td>{item.period.name}</td>
                        <td><span className={`status-pill ${item.completed ? "muted" : ""}`}>{item.completed ? "Completed" : "Pending"}</span></td>
                        <td>
                          {!item.completed && (
                            <button
                              className="row-action"
                              onClick={() => {
                                setForm({ ...form, teacher: item.teacher, subject: item.subject, periodId: String(item.period.id), ratings: buildInitialRatings() });
                                setStep(2);
                              }}
                            >
                              Evaluate
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="empty-state" role="status">There are no pending or completed evaluations to display.</div>
            )}
          </section>
          <div className="flow-card instruction-card">
            <h2>Instructions before you start</h2>
            <ol>
              <li>Choose an active evaluation period, teacher, and subject assigned to you.</li>
              <li>Rate each item using the scale provided for that question.</li>
              <li>For numbers 1 to 27, use the rating scale from Always to Never.</li>
              <li>For number 28, use the Strongly Agree to Strongly Disagree scale.</li>
              <li>For number 29, choose Yes or No.</li>
              <li>Submit only once for each assigned teacher and subject in an evaluation period.</li>
            </ol>
            <button className="primary" onClick={() => {
              setForm({ ...form, teacher: "", subject: "", periodId: "", ratings: buildInitialRatings() });
              setStep(2);
            }}>Start an evaluation <Check size={16} /></button>
          </div>
        </div>
      )}
      {step === 2 && <div className="flow-card response-form">
        <h2>Student / Teacher Evaluation Form</h2>
        <p>Ratings are anonymous. Once submitted, an evaluation cannot be edited or submitted again for the same teacher and period.</p>
        <form onSubmit={submit}>
          <div className="teacher-header">
            <label>
              Evaluation period
              <select required value={form.periodId} onChange={(event) => setForm({ ...form, periodId: event.target.value, teacher: "", subject: "" })}>
                <option value="">Select open evaluation period</option>
                {openPeriods.map((period) => <option value={period.id} key={period.id}>{period.name} · {period.semester} {period.academic_year}</option>)}
              </select>
            </label>
            <label>
              Teacher / Instructor
              <select required value={form.teacher} onChange={(event) => setForm({ ...form, teacher: event.target.value, subject: "" })}>
                <option value="">Select teacher</option>
                {availableTeachers.map((teacher) => <option value={teacher} key={teacher}>{teacher}</option>)}
              </select>
            </label>
            <label>
              Subject
              <select required value={form.subject} onChange={(event) => setForm({ ...form, subject: event.target.value })}>
                <option value="">Select subject</option>
                {availableAssignments.map((assignment) => <option value={assignment.subject} key={`${assignment.teacher}-${assignment.subject}`}>{assignment.subject}</option>)}
              </select>
            </label>
          </div>
          {openPeriods.length === 0 && <div className="empty-state" role="status">There is no open evaluation period right now. Please contact the Dean or Administrator.</div>}
          {form.periodId && alreadyEvaluatedPair && <div className="empty-state" role="status">You have already evaluated this teacher and subject for this period.</div>}
          {form.periodId && !alreadyEvaluatedPair && !availableAssignments.length && <div className="empty-state" role="status">There is no active subject assignment for this teacher.</div>}
          <div className="question-list">
            <section className="question-criterion">
              <h3>Evaluation questions</h3>
              {orderedQuestions.map((question) => {
                const scale = getScaleForQuestion(question.id);
                const selectedValue = form.ratings[String(question.id)];
                return (
                  <div className="question-card" key={question.id}>
                    <div className="question-head">
                      <span className="q-number">{question.id}.</span>
                      <p>{question.text}</p>
                    </div>
                    <div className="answer-grid">
                      {scale.map((option) => {
                        const isChecked = String(selectedValue) === String(option.value);
                        return (
                          <label className={`option-box ${isChecked ? "selected" : ""}`} key={`${question.id}-${option.value}`}>
                            <input
                              type="radio"
                              name={`q-${question.id}`}
                              value={String(option.value)}
                              checked={isChecked}
                              onChange={() => updateQuestion(String(question.id), option.value)}
                            />
                            <span className="option-score">{option.value}</span>
                            <span className="option-label">{option.label}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </section>
          </div>
          <div className="flow-act">
            <button type="button" className="secondary" onClick={() => setStep(1)}>Back</button>
            <button type="submit" className="primary" disabled={evaluationSubmitting || !form.teacher || !form.subject || !form.periodId}>
              {evaluationSubmitting ? "Submitting…" : "Submit Evaluation"}
            </button>
          </div>
        </form>
      </div>}
      {step === 3 && <div className="flow-card success-card">
        <h2><Check size={19} /> Evaluation submitted</h2>
        <p>Thank you for your honest feedback. Your response has been recorded successfully.</p>
        <button className="primary" onClick={() => setStep(1)}>Return to my evaluation status</button>
      </div>}
    </main>
  );
}
function filteredRows(responses, filters) {
  const term = filters.search.trim().toLowerCase();
  return responses.filter((item) => (!filters.teacher || item.teacher === filters.teacher) && (!filters.department || item.department === filters.department) && (!filters.subject || item.subject === filters.subject) && (!filters.semester || item.semester === filters.semester) && (!filters.academicYear || item.academicYear === filters.academicYear) && (!filters.period || item.period === filters.period) && (!term || `${item.teacher} ${item.subject} ${item.department} ${item.period} ${item.academicYear}`.toLowerCase().includes(term)));
}
function saveCsv(responses, criteria) {
  const headers = ["Teacher", "Department", "Subject", "Semester", "Academic year", "Evaluation period", "Anonymous responses", "Average rating", ...criteria.map((criterion) => criterion.name)];
  const quote = (value) => `"${String(value).replace(/"/g, '""')}"`;
  const lines = responses.map((row) => {
    const categoryValues = criteria.map((criterion) => {
      const scores = criterion.questionIds.map((id) => row.perQuestion[String(id)]).filter((score) => Number.isFinite(score));
      return scores.length ? (scores.reduce((total, score) => total + score, 0) / scores.length).toFixed(2) : "";
    });
    return [
      row.teacher,
      row.department,
      row.subject,
      row.semester,
      row.academicYear,
      row.period,
      row.responses,
      row.mean.toFixed(2),
      ...categoryValues
    ].map(quote).join(",");
  });
  const content = `\uFEFF${[headers.map(quote).join(","), ...lines].join("\r\n")}`;
  const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "olpcsmi-evaluation-report.csv";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function ReportTable({ rows, criteria, onView }) {
  if (!rows.length) return /* @__PURE__ */ jsx("div", { className: "empty-state", children: "No evaluation results match these filters." });
  return /* @__PURE__ */ jsx("div", { className: "table-wrap report-table", children: /* @__PURE__ */ jsxs("table", { children: [
    /* @__PURE__ */ jsx("thead", { children: /* @__PURE__ */ jsxs("tr", { children: [
      /* @__PURE__ */ jsx("th", { children: "TEACHER" }),
      /* @__PURE__ */ jsx("th", { children: "DEPARTMENT" }),
      /* @__PURE__ */ jsx("th", { children: "SUBJECT" }),
      /* @__PURE__ */ jsx("th", { children: "SEMESTER / PERIOD" }),
      /* @__PURE__ */ jsx("th", { children: "RESPONSES" }),
      /* @__PURE__ */ jsx("th", { children: "MEAN" }),
      onView && /* @__PURE__ */ jsx("th", { children: "DETAILS" })
    ] }) }),
    /* @__PURE__ */ jsx("tbody", { children: rows.map((row) => /* @__PURE__ */ jsxs("tr", { children: [
      /* @__PURE__ */ jsx("td", { children: /* @__PURE__ */ jsx("strong", { children: row.teacher }) }),
      /* @__PURE__ */ jsx("td", { children: row.department || "\u2014" }),
      /* @__PURE__ */ jsx("td", { children: row.subject }),
      /* @__PURE__ */ jsxs("td", { children: [
        row.semester || row.period,
        row.academicYear ? ` \xB7 ${row.academicYear}` : ""
      ] }),
      /* @__PURE__ */ jsx("td", { children: row.responses }),
      /* @__PURE__ */ jsx("td", { children: /* @__PURE__ */ jsx("span", { className: "report-score", children: row.mean.toFixed(2) }) }),
      onView && /* @__PURE__ */ jsx("td", { children: /* @__PURE__ */ jsx("button", { className: "row-action", onClick: () => onView(row), children: "View Details" }) })
    ] }, `${row.teacher}-${row.subject}-${row.period}`)) })
  ] }) });
}
function TeacherReportDetails({ row, criteria }) {
  return /* @__PURE__ */ jsxs("section", { className: "flow-card dashboard-panel individual-report", children: [
    /* @__PURE__ */ jsxs("div", { className: "panel-heading", children: [
      /* @__PURE__ */ jsxs("div", { children: [
        /* @__PURE__ */ jsx("h2", { children: `${row.teacher} Evaluation Details` }),
        /* @__PURE__ */ jsx("p", { children: `${row.subject} · ${row.period}${row.academicYear ? ` · ${row.academicYear}` : ""} · ${row.responses} anonymous response(s)` })
      ] }),
      /* @__PURE__ */ jsxs("div", { className: "export-actions", children: [
        /* @__PURE__ */ jsxs("button", { className: "primary", onClick: () => window.print(), children: [
          /* @__PURE__ */ jsx(Printer, { size: 16 }),
          " Print Report"
        ] })
      ] })
    ] }),
    /* @__PURE__ */ jsxs("div", { className: "summary-cards", children: [
      /* @__PURE__ */ jsxs("div", { children: [
        /* @__PURE__ */ jsx("span", { children: "Overall average" }),
        /* @__PURE__ */ jsx("strong", { children: row.mean.toFixed(2) }),
        /* @__PURE__ */ jsx("small", { children: "Out of 5" })
      ] }),
      /* @__PURE__ */ jsxs("div", { children: [
        /* @__PURE__ */ jsx("span", { children: "Anonymous responses" }),
        /* @__PURE__ */ jsx("strong", { children: row.responses }),
        /* @__PURE__ */ jsx("small", { children: "Student identities are not shown" })
      ] })
    ] }),
    /* @__PURE__ */ jsx("div", { className: "table-wrap", children: /* @__PURE__ */ jsxs("table", { children: [
      /* @__PURE__ */ jsx("thead", { children: /* @__PURE__ */ jsxs("tr", { children: [
        /* @__PURE__ */ jsx("th", { children: "CRITERION" }),
        /* @__PURE__ */ jsx("th", { children: "AVERAGE RATING" })
      ] }) }),
      /* @__PURE__ */ jsx("tbody", { children: criteria.map((criterion) => {
        const scores = criterion.questionIds.map((id) => row.perQuestion[String(id)]).filter((score) => Number.isFinite(score));
        const average = scores.length ? scores.reduce((total, score) => total + score, 0) / scores.length : 0;
        return /* @__PURE__ */ jsxs("tr", { children: [
          /* @__PURE__ */ jsx("td", { children: criterion.name }),
          /* @__PURE__ */ jsx("td", { children: /* @__PURE__ */ jsx("span", { className: "report-score", children: average.toFixed(2) }) })
        ] }, criterion.name);
      }) })
    ] }) })
  ] });
}
function ReportCharts({ rows, criteria }) {
  const teacherTotals = /* @__PURE__ */ new Map();
  rows.forEach((row) => {
    const current = teacherTotals.get(row.teacher) ?? { total: 0, count: 0 };
    current.total += row.mean * row.responses;
    current.count += row.responses;
    teacherTotals.set(row.teacher, current);
  });
  const teacherMetrics = [...teacherTotals.entries()].map(([teacher, score]) => ({
    label: teacher,
    value: score.count ? score.total / score.count : 0,
    detail: `${score.count} response(s)`
  })).sort((first, second) => second.value - first.value);
  const criterionMetrics = criteria.map((criterion) => {
    const scoredRows = rows.flatMap((row) => criterion.questionIds.map((id) => row.perQuestion[String(id)]).filter((score) => Number.isFinite(score)).map((score) => ({ score, responses: row.responses })));
    const count = scoredRows.reduce((total2, item) => total2 + item.responses, 0);
    const total = scoredRows.reduce((sum, item) => sum + item.score * item.responses, 0);
    return { label: criterion.name, value: count ? total / count : 0, detail: `${criterion.questionIds.length} questionnaire item(s)` };
  });
  return /* @__PURE__ */ jsxs("section", { className: "chart-grid", "aria-label": "Evaluation charts", children: [
    /* @__PURE__ */ jsxs("div", { className: "chart-card", children: [
      /* @__PURE__ */ jsxs("h3", { children: [
        /* @__PURE__ */ jsx(BarChart3, { size: 17 }),
        " Teacher averages"
      ] }),
      teacherMetrics.length ? teacherMetrics.slice(0, 8).map((metric) => /* @__PURE__ */ jsxs("div", { className: "bar-row", children: [
        /* @__PURE__ */ jsxs("div", { children: [
          /* @__PURE__ */ jsx("span", { children: metric.label }),
          /* @__PURE__ */ jsx("strong", { children: metric.value.toFixed(2) })
        ] }),
        /* @__PURE__ */ jsx("i", { children: /* @__PURE__ */ jsx("b", { style: { width: `${Math.max(0, Math.min(100, metric.value / 5 * 100))}%` } }) }),
        /* @__PURE__ */ jsx("small", { children: metric.detail })
      ] }, metric.label)) : /* @__PURE__ */ jsx("div", { className: "chart-empty", children: "Evaluation data will appear here when submitted." })
    ] }),
    /* @__PURE__ */ jsxs("div", { className: "chart-card", children: [
      /* @__PURE__ */ jsxs("h3", { children: [
        /* @__PURE__ */ jsx(ClipboardCheck, { size: 17 }),
        " Criteria averages"
      ] }),
      criterionMetrics.map((metric) => /* @__PURE__ */ jsxs("div", { className: "bar-row", children: [
        /* @__PURE__ */ jsxs("div", { children: [
          /* @__PURE__ */ jsx("span", { children: metric.label }),
          /* @__PURE__ */ jsx("strong", { children: metric.value.toFixed(2) })
        ] }),
        /* @__PURE__ */ jsx("i", { children: /* @__PURE__ */ jsx("b", { style: { width: `${Math.max(0, Math.min(100, metric.value / 5 * 100))}%` } }) }),
        /* @__PURE__ */ jsx("small", { children: metric.detail })
      ] }, metric.label))
    ] })
  ] });
}
function AdminFlow({ role, userId, department, responses, catalog, apiRequest, refreshCatalog, flash, questions, setQuestions, onAccountUpdated }) {
  const [activePanel, setActivePanel] = useState("dashboard");
  const [selectedReport, setSelectedReport] = useState(null);
  const [filters, setFilters] = useState({ teacher: "", department: "", subject: "", semester: "", academicYear: "", period: "", search: "" });
  const [accounts, setAccounts] = useState([]);
  const [accountSearch, setAccountSearch] = useState("");
  const [criteria, setCriteria] = useState(DEFAULT_CRITERIA);
  const [criteriaText, setCriteriaText] = useState(JSON.stringify(DEFAULT_CRITERIA, null, 2));
  const [questionTexts, setQuestionTexts] = useState(questions.map(({ id, text }) => ({ id, text })));
  const [loading, setLoading] = useState(false);
  const [accountForm, setAccountForm] = useState({ username: "", password: "", displayName: "", role: "student", department: "", studentNumber: "", course: "", yearLevel: "" });
  const [editingAccountId, setEditingAccountId] = useState(null);
  const [teacherForm, setTeacherForm] = useState({ name: "", department: "" });
  const [editingTeacherId, setEditingTeacherId] = useState(null);
  const [teacherSearch, setTeacherSearch] = useState("");
  const [subjectForm, setSubjectForm] = useState({ name: "", department: "", teacher: "" });
  const [editingSubjectId, setEditingSubjectId] = useState(null);
  const [periodForm, setPeriodForm] = useState({ name: "", semester: "1st Semester", academicYear: "", startsAt: "", endsAt: "" });
  const [editingPeriodId, setEditingPeriodId] = useState(null);
  const filtered = useMemo(() => filteredRows(responses, filters), [responses, filters]);
  const filteredAccounts = useMemo(() => {
    const query = accountSearch.trim().toLocaleLowerCase();
    if (!query) return accounts;
    return accounts.filter((account) => [
      account.display_name,
      account.username,
      account.department,
      account.student_number,
      account.course,
      account.year_level,
      roles[account.role].label
    ].some((value) => String(value || "").toLocaleLowerCase().includes(query)));
  }, [accounts, accountSearch]);
  const filteredTeachers = useMemo(() => {
    const query = teacherSearch.trim().toLocaleLowerCase();
    return catalog.teachers.filter((teacher) => {
      const subjects = catalog.assignments.filter((assignment) => assignment.teacher === teacher.name).map((assignment) => assignment.subject);
      return !query || [teacher.name, teacher.department, ...subjects].some((value) => value.toLocaleLowerCase().includes(query));
    });
  }, [catalog, teacherSearch]);
  const totalResponses = filtered.reduce((total, item) => total + item.responses, 0);
  const submittedEvaluations = responses.reduce((total, item) => total + item.responses, 0);
  const overallMean = totalResponses ? filtered.reduce((total, item) => total + item.mean * item.responses, 0) / totalResponses : 0;
  const reportDepartments = catalog.departments.map((item) => typeof item === "string" ? item : item.name);
  const refreshAccounts = async () => {
    setAccounts(await apiRequest("/admin/users"));
  };
  const refreshCriteria = async () => {
    const result = await apiRequest("/settings/criteria");
    const nextCriteria = result.criteria?.length ? result.criteria : DEFAULT_CRITERIA;
    setCriteria(nextCriteria);
    setCriteriaText(JSON.stringify(nextCriteria, null, 2));
  };
  useEffect(() => {
    const loadSettings = role === "admin" ? Promise.all([refreshAccounts(), refreshCriteria()]) : refreshCriteria();
    void loadSettings.catch((error) => {
      flash(error instanceof Error ? error.message : "Unable to load administrator settings.");
    });
  }, [role]);
  useEffect(() => {
    setQuestionTexts(questions.map(({ id, text }) => ({ id, text })));
  }, [questions]);
  const runAction = async (operation, successMessage) => {
    setLoading(true);
    try {
      await operation();
      flash(successMessage);
    } catch (error) {
      flash(error instanceof Error ? error.message : "The request could not be completed.");
    } finally {
      setLoading(false);
    }
  };
  const createAccount = (event) => {
    event.preventDefault();
    const username = accountForm.username.trim();
    const displayName = accountForm.displayName.trim();
    const password = accountForm.password.trim();
    const studentNumber = accountForm.studentNumber.trim();
    const course = accountForm.course.trim();
    const yearLevel = accountForm.yearLevel.trim();
    if (!username || username.length < 3) {
      flash("Use a valid username with at least 3 characters.");
      return;
    }
    if (!displayName || displayName.length < 2) {
      flash("Provide the account holder's full name.");
      return;
    }
    if (!editingAccountId && !password || password && password.length < 12) {
      flash("Temporary password must be at least 12 characters long.");
      return;
    }
    if (accountForm.role === "student" && !studentNumber) {
      flash("Student number is required for student accounts.");
      return;
    }
    void runAction(async () => {
      if (editingAccountId) {
        await apiRequest(`/admin/users/${editingAccountId}`, {
          method: "PUT",
          body: JSON.stringify({ displayName, department: accountForm.department, studentNumber, course, yearLevel, ...password ? { password } : {} })
        });
        if (editingAccountId === userId) onAccountUpdated(displayName, accountForm.department);
        setEditingAccountId(null);
      } else {
        await apiRequest("/admin/users", { method: "POST", body: JSON.stringify({ ...accountForm, username, displayName, password, studentNumber, course, yearLevel }) });
      }
      await refreshAccounts();
      setAccountForm({ username: "", password: "", displayName: "", role: "student", department: "", studentNumber: "", course: "", yearLevel: "" });
    }, editingAccountId ? "Account updated." : "Account created.");
  };
  const startAccountEdit = (account) => {
    setEditingAccountId(account.id);
    setAccountForm({
      username: account.username,
      password: "",
      displayName: account.display_name,
      role: account.role,
      department: account.department,
      studentNumber: account.student_number || "",
      course: account.course || "",
      yearLevel: account.year_level || ""
    });
  };
  const cancelAccountEdit = () => {
    setEditingAccountId(null);
    setAccountForm({ username: "", password: "", displayName: "", role: "student", department: "", studentNumber: "", course: "", yearLevel: "" });
  };
  const saveTeacher = (event) => {
    event.preventDefault();
    const teacherCode = teacherForm.teacherCode.trim();
    const name = teacherForm.name.trim();
    if (!/^[A-Za-z0-9._-]{1,64}$/.test(teacherCode) || name.length < 2 || name.length > 120) {
      flash("Enter a valid Teacher ID and full name.");
      return;
    }
    void runAction(async () => {
      await apiRequest(editingTeacherId ? `/admin/teachers/${editingTeacherId}` : "/admin/teachers", {
        method: editingTeacherId ? "PATCH" : "POST",
        body: JSON.stringify({ name, department: teacherForm.department })
      });
      setTeacherForm({ name: "", department: "" });
      setEditingTeacherId(null);
      await refreshCatalog();
    }, editingTeacherId ? "Teacher record updated." : "Teacher added.");
  };
  const editTeacher = (teacher) => {
    setEditingTeacherId(teacher.id);
    setTeacherForm({ name: teacher.name, department: teacher.department });
  };
  const deleteTeacher = (teacher) => {
    if (!window.confirm(`Delete ${teacher.name} from the teacher catalog? Historical evaluation reports will be retained.`)) return;
    void runAction(async () => {
      await apiRequest(`/admin/teachers/${teacher.id}`, { method: "DELETE" });
      if (editingTeacherId === teacher.id) {
        setEditingTeacherId(null);
        setTeacherForm({ name: "", department: "" });
      }
      await refreshCatalog();
    }, "Teacher removed from the catalog.");
  };
  const createSubject = (event) => {
    event.preventDefault();
    const name = subjectForm.name.trim();
    const teacher = subjectForm.teacher.trim();
    if (!name || name.length < 2) {
      flash("Subject name is required.");
      return;
    }
    if (!editingSubjectId && !teacher) {
      flash("Select the teacher assigned to this subject.");
      return;
    }
    void runAction(async () => {
      await apiRequest(editingSubjectId ? `/admin/subjects/${editingSubjectId}` : "/admin/subjects", {
        method: editingSubjectId ? "PUT" : "POST",
        body: JSON.stringify({ ...subjectForm, name, teacher })
      });
      setEditingSubjectId(null);
      setSubjectForm({ name: "", department: "", teacher: "" });
      await refreshCatalog();
    }, editingSubjectId ? "Subject updated." : "Subject assignment created.");
  };
  const editSubject = (subject) => {
    setEditingSubjectId(subject.id);
    setSubjectForm({ name: subject.name, department: subject.department, teacher: "" });
  };
  const deleteSubject = (subject) => {
    if (!window.confirm(`Delete ${subject.name} and remove its teacher assignments? Existing evaluation reports will be retained.`)) return;
    void runAction(async () => {
      await apiRequest(`/admin/subjects/${subject.id}`, { method: "DELETE" });
      if (editingSubjectId === subject.id) {
        setEditingSubjectId(null);
        setSubjectForm({ name: "", department: "", teacher: "" });
      }
      await refreshCatalog();
    }, "Subject deleted.");
  };
  const createPeriod = (event) => {
    event.preventDefault();
    const name = periodForm.name.trim();
    const academicYear = periodForm.academicYear.trim();
    const startsAt = new Date(periodForm.startsAt);
    const endsAt = new Date(periodForm.endsAt);
    if (!name || name.length < 3) {
      flash("Enter a valid evaluation period name.");
      return;
    }
    if (!academicYear) {
      flash("Academic year is required for the evaluation period.");
      return;
    }
    if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) {
      flash("Complete both start and end dates.");
      return;
    }
    if (startsAt >= endsAt) {
      flash("The period end date must be later than the start date.");
      return;
    }
    void runAction(async () => {
      await apiRequest(editingPeriodId ? `/admin/periods/${editingPeriodId}` : "/admin/periods", {
        method: editingPeriodId ? "PATCH" : "POST",
        body: JSON.stringify({ ...periodForm, name, academicYear, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() })
      });
      setEditingPeriodId(null);
      setPeriodForm({ name: "", semester: "1st Semester", academicYear: "", startsAt: "", endsAt: "" });
      await refreshCatalog();
    }, editingPeriodId ? "Evaluation period updated." : "Evaluation period created. Open it when it is ready for students.");
  };
  const editPeriod = (period) => {
    setEditingPeriodId(period.id);
    setPeriodForm({
      name: period.name,
      semester: period.semester,
      academicYear: period.academic_year,
      startsAt: asDateTimeLocal(period.starts_at),
      endsAt: asDateTimeLocal(period.ends_at)
    });
  };
  const cancelPeriodEdit = () => {
    setEditingPeriodId(null);
    setPeriodForm({ name: "", semester: "1st Semester", academicYear: "", startsAt: "", endsAt: "" });
  };
  const togglePeriod = (period) => {
    void runAction(async () => {
      await apiRequest(`/admin/periods/${period.id}`, { method: "PATCH", body: JSON.stringify({ status: period.status === "open" ? "closed" : "open" }) });
      await refreshCatalog();
    }, `Evaluation period ${period.status === "open" ? "closed" : "opened"}.`);
  };
  const toggleAccount = (account) => {
    void runAction(async () => {
      await apiRequest(`/admin/users/${account.id}`, { method: "PATCH", body: JSON.stringify({ active: !account.active }) });
      await refreshAccounts();
    }, `Account ${account.active ? "disabled" : "enabled"}.`);
  };
  const deleteAccount = (account) => {
    if (!["student", "dean"].includes(account.role)) return;
    if (!window.confirm(`Permanently delete the ${roles[account.role].label.toLowerCase()} account for ${account.display_name}? Accounts with submitted evaluations must be disabled instead.`)) return;
    void runAction(async () => {
      await apiRequest(`/admin/users/${account.id}`, { method: "DELETE" });
      if (editingAccountId === account.id) cancelAccountEdit();
      await refreshAccounts();
    }, "Account deleted.");
  };
  const saveCriteria = (event) => {
    event.preventDefault();
    void runAction(async () => {
      const parsed = JSON.parse(criteriaText);
      const result = await apiRequest("/admin/settings/criteria", { method: "PUT", body: JSON.stringify({ criteria: parsed }) });
      const nextCriteria = result.criteria?.length ? result.criteria : DEFAULT_CRITERIA;
      setCriteria(nextCriteria);
      setCriteriaText(JSON.stringify(nextCriteria, null, 2));
    }, "Evaluation criteria saved. The 29 question statements are unchanged.");
  };
  const saveQuestions = (event) => {
    event.preventDefault();
    void runAction(async () => {
      const result = await apiRequest("/admin/settings/questions", {
        method: "PUT",
        body: JSON.stringify({ questions: questionTexts })
      });
      setQuestions(result.questions);
    }, "Evaluation questions saved.");
  };
  const allNav = [
    { id: "dashboard", label: "Dashboard", icon: BarChart3 },
    { id: "accounts", label: "Accounts", icon: Users },
    { id: "catalog", label: "Teachers & subjects", icon: BookOpen },
    { id: "periods", label: "Evaluation periods", icon: CalendarDays },
    { id: "criteria", label: "Criteria & settings", icon: ClipboardCheck }
  ];
  const nav = role === "admin" ? allNav : allNav.filter(({ id }) => id === "dashboard");
  return /* @__PURE__ */ jsxs("div", { className: "workspace-layout", children: [
    /* @__PURE__ */ jsxs("aside", { className: "workspace-nav", children: [
      /* @__PURE__ */ jsx("p", { children: "WORKSPACE" }),
      nav.map(({ id, label, icon: Icon }) => /* @__PURE__ */ jsxs("button", { className: activePanel === id ? "active" : "", onClick: () => setActivePanel(id), children: [
        /* @__PURE__ */ jsx(Icon, { size: 17 }),
        " ",
        label
      ] }, id))
    ] }),
    /* @__PURE__ */ jsxs("main", { className: "flow-content dashboard-content", children: [
      /* @__PURE__ */ jsx("span", { className: "flow-kicker", children: role === "admin" ? "ADMINISTRATOR PORTAL" : "DEAN PORTAL" }),
      /* @__PURE__ */ jsxs("div", { className: "dashboard-title", children: [
        /* @__PURE__ */ jsxs("div", { children: [
          /* @__PURE__ */ jsx("h1", { children: nav.find((item) => item.id === activePanel)?.label }),
          /* @__PURE__ */ jsx("p", { children: role === "admin" ? "Manage school accounts and evaluation operations, and review anonymous results." : "Review anonymous evaluation results across all departments." })
        ] }),
        activePanel === "dashboard" && /* @__PURE__ */ jsxs("div", { className: "export-actions", children: [
          /* @__PURE__ */ jsxs("button", { className: "secondary", onClick: () => saveCsv(filtered, criteria), children: [
            /* @__PURE__ */ jsx(Download, { size: 16 }),
            " Export Excel / CSV"
          ] }),
          /* @__PURE__ */ jsxs("button", { className: "primary", onClick: () => window.print(), children: [
            /* @__PURE__ */ jsx(Printer, { size: 16 }),
            " Save as PDF"
          ] })
        ] })
      ] }),
      activePanel === "dashboard" && /* @__PURE__ */ jsxs(Fragment, { children: [
        /* @__PURE__ */ jsx("div", { className: "summary-cards", children: role === "admin" ? /* @__PURE__ */ jsxs(Fragment, { children: [
          /* @__PURE__ */ jsxs("div", { children: [
            /* @__PURE__ */ jsx("span", { children: "Students" }),
            /* @__PURE__ */ jsx("strong", { children: accounts.filter((account) => account.role === "student").length }),
            /* @__PURE__ */ jsx("small", { children: "Student accounts" })
          ] }),
          /* @__PURE__ */ jsxs("div", { children: [
            /* @__PURE__ */ jsx("span", { children: "Teachers" }),
            /* @__PURE__ */ jsx("strong", { children: catalog.teachers.length }),
            /* @__PURE__ */ jsx("small", { children: "Teacher records" })
          ] }),
          /* @__PURE__ */ jsxs("div", { children: [
            /* @__PURE__ */ jsx("span", { children: "Subjects" }),
            /* @__PURE__ */ jsx("strong", { children: catalog.subjects.length }),
            /* @__PURE__ */ jsx("small", { children: "Available subjects" })
          ] }),
          /* @__PURE__ */ jsxs("div", { children: [
            /* @__PURE__ */ jsx("span", { children: "Submitted evaluations" }),
            /* @__PURE__ */ jsx("strong", { children: submittedEvaluations }),
            /* @__PURE__ */ jsx("small", { children: "Submitted responses only" })
          ] })
        ] }) : /* @__PURE__ */ jsxs(Fragment, { children: [
          /* @__PURE__ */ jsxs("div", { children: [
            /* @__PURE__ */ jsx("span", { children: "Anonymous responses" }),
            /* @__PURE__ */ jsx("strong", { children: totalResponses }),
            /* @__PURE__ */ jsx("small", { children: "Across current filters" })
          ] }),
          /* @__PURE__ */ jsxs("div", { children: [
            /* @__PURE__ */ jsx("span", { children: "Teachers evaluated" }),
            /* @__PURE__ */ jsx("strong", { children: new Set(filtered.map((item) => item.teacher)).size }),
            /* @__PURE__ */ jsx("small", { children: "In selected report" })
          ] }),
          /* @__PURE__ */ jsxs("div", { children: [
            /* @__PURE__ */ jsx("span", { children: "Average rating" }),
            /* @__PURE__ */ jsxs("strong", { children: [
              overallMean.toFixed(2),
              /* @__PURE__ */ jsx("small", { children: " / 5" })
            ] }),
            /* @__PURE__ */ jsx("small", { children: "Weighted by responses" })
          ] }),
          /* @__PURE__ */ jsxs("div", { children: [
            /* @__PURE__ */ jsx("span", { children: "Open periods" }),
            /* @__PURE__ */ jsx("strong", { children: catalog.periods.filter((period) => period.status === "open").length }),
            /* @__PURE__ */ jsx("small", { children: "Managed by school staff" })
          ] })
        ] }) }),
        /* @__PURE__ */ jsxs("section", { className: "flow-card dashboard-panel", children: [
          /* @__PURE__ */ jsxs("div", { className: "panel-heading", children: [
            /* @__PURE__ */ jsxs("div", { children: [
              /* @__PURE__ */ jsxs("h2", { children: [
                /* @__PURE__ */ jsx(Search, { size: 18 }),
                " Filter reports"
              ] }),
              /* @__PURE__ */ jsx("p", { children: "Only aggregate evaluation results are displayed; student identities are never included." })
            ] }),
            /* @__PURE__ */ jsxs("span", { className: "secure-label", children: [
              /* @__PURE__ */ jsx(ShieldCheck, { size: 15 }),
              " Anonymous"
            ] })
          ] }),
          /* @__PURE__ */ jsxs("div", { className: "report-filters", children: [
            /* @__PURE__ */ jsxs("label", { children: [
              "Search",
              /* @__PURE__ */ jsx("input", { value: filters.search, placeholder: "Teacher, subject or department", onChange: (event) => setFilters({ ...filters, search: event.target.value }) })
            ] }),
            /* @__PURE__ */ jsxs("label", { children: [
              "Teacher",
              /* @__PURE__ */ jsxs("select", { value: filters.teacher, onChange: (event) => setFilters({ ...filters, teacher: event.target.value }), children: [
                /* @__PURE__ */ jsx("option", { value: "", children: "All teachers" }),
                catalog.teachers.map((teacher) => /* @__PURE__ */ jsx("option", { children: teacher.name }, teacher.id))
              ] })
            ] }),
            /* @__PURE__ */ jsxs("label", { children: [
              "Department",
              /* @__PURE__ */ jsxs("select", { value: filters.department, onChange: (event) => setFilters({ ...filters, department: event.target.value }), children: [
                /* @__PURE__ */ jsx("option", { value: "", children: "All departments" }),
                reportDepartments.map((item) => /* @__PURE__ */ jsx("option", { children: item }, item))
              ] })
            ] }),
            /* @__PURE__ */ jsxs("label", { children: [
              "Subject",
              /* @__PURE__ */ jsxs("select", { value: filters.subject, onChange: (event) => setFilters({ ...filters, subject: event.target.value }), children: [
                /* @__PURE__ */ jsx("option", { value: "", children: "All subjects" }),
                catalog.subjects.map((subject) => /* @__PURE__ */ jsx("option", { children: subject.name }, subject.id))
              ] })
            ] }),
            /* @__PURE__ */ jsxs("label", { children: [
              "Semester",
              /* @__PURE__ */ jsxs("select", { value: filters.semester, onChange: (event) => setFilters({ ...filters, semester: event.target.value }), children: [
                /* @__PURE__ */ jsx("option", { value: "", children: "All semesters" }),
                SEMESTERS.map((semester) => /* @__PURE__ */ jsx("option", { children: semester }, semester))
              ] })
            ] }),
            /* @__PURE__ */ jsxs("label", { children: [
              "Evaluation period",
              /* @__PURE__ */ jsxs("select", { value: filters.period, onChange: (event) => setFilters({ ...filters, period: event.target.value }), children: [
                /* @__PURE__ */ jsx("option", { value: "", children: "All periods" }),
                catalog.periods.map((period) => /* @__PURE__ */ jsx("option", { children: period.name }, period.id))
              ] })
            ] })
          ] }),
          /* @__PURE__ */ jsx(ReportCharts, { rows: filtered, criteria })
        ] }),
        /* @__PURE__ */ jsxs("section", { className: "flow-card dashboard-panel", children: [
          /* @__PURE__ */ jsx("div", { className: "panel-heading", children: /* @__PURE__ */ jsxs("div", { children: [
            /* @__PURE__ */ jsxs("h2", { children: [
              /* @__PURE__ */ jsx(FileText, { size: 18 }),
              " Evaluation summary"
            ] }),
            /* @__PURE__ */ jsxs("p", { children: [
              filtered.length,
              " teacher, subject, and period result(s)"
            ] })
          ] }) }),
          /* @__PURE__ */ jsx(ReportTable, { rows: filtered, criteria, onView: setSelectedReport })
        ] }),
        selectedReport && /* @__PURE__ */ jsx(TeacherReportDetails, {
          row: selectedReport,
          criteria,
          onClose: () => setSelectedReport(null)
        })
      ] }),
      role === "admin" && activePanel === "accounts" && /* @__PURE__ */ jsxs("div", { className: "management-grid", children: [
        /* @__PURE__ */ jsxs("section", { className: "flow-card dashboard-panel", children: [
          /* @__PURE__ */ jsxs("h2", { children: [
            /* @__PURE__ */ jsx(Users, { size: 18 }),
            " ",
            editingAccountId ? "Edit account" : "Create account"
          ] }),
          /* @__PURE__ */ jsx("p", { children: editingAccountId ? "Update account information. Leave the password blank to keep it unchanged." : "Use a unique school username and issue a strong temporary password to the account holder." }),
          /* @__PURE__ */ jsxs("form", { className: "management-form", onSubmit: createAccount, children: [
            /* @__PURE__ */ jsxs("label", { children: [
              "Username",
              /* @__PURE__ */ jsx("input", { required: true, minLength: 3, maxLength: 64, pattern: "[a-zA-Z0-9._\\-]+", disabled: Boolean(editingAccountId), value: accountForm.username, onChange: (event) => setAccountForm({ ...accountForm, username: event.target.value }) })
            ] }),
            /* @__PURE__ */ jsxs("label", { children: [
              editingAccountId ? "New password (optional)" : "Temporary password",
              /* @__PURE__ */ jsx("input", { required: !editingAccountId, minLength: 12, maxLength: 256, type: "password", autoComplete: "new-password", value: accountForm.password, onChange: (event) => setAccountForm({ ...accountForm, password: event.target.value }) })
            ] }),
            /* @__PURE__ */ jsxs("label", { children: [
              "Full name",
              /* @__PURE__ */ jsx("input", { required: true, minLength: 2, maxLength: 120, value: accountForm.displayName, onChange: (event) => setAccountForm({ ...accountForm, displayName: event.target.value }) })
            ] }),
            /* @__PURE__ */ jsxs("label", { children: [
              "Role",
              /* @__PURE__ */ jsx("select", { disabled: Boolean(editingAccountId), value: accountForm.role, onChange: (event) => setAccountForm({ ...accountForm, role: event.target.value }), children: roles && Object.entries(roles).map(([key, item]) => /* @__PURE__ */ jsx("option", { value: key, children: item.label }, key)) })
            ] }),
            /* @__PURE__ */ jsxs("label", { children: [
              "Department",
              /* @__PURE__ */ jsxs("select", { value: accountForm.department, onChange: (event) => setAccountForm({ ...accountForm, department: event.target.value }), children: [
                /* @__PURE__ */ jsxs("option", { value: "", children: [
                  "Select department",
                  accountForm.role === "dean" ? "" : " (optional)"
                ] }),
                catalog.departments.map((item) => { const name = typeof item === "string" ? item : item.name; return /* @__PURE__ */ jsx("option", { children: name }, name); })
              ] })
            ] }),
            accountForm.role === "student" && /* @__PURE__ */ jsxs(Fragment, { children: [
              /* @__PURE__ */ jsxs("label", { children: [
                "Student number",
                /* @__PURE__ */ jsx("input", { required: true, minLength: 1, maxLength: 64, value: accountForm.studentNumber, onChange: (event) => setAccountForm({ ...accountForm, studentNumber: event.target.value }) })
              ] }),
              /* @__PURE__ */ jsxs("label", { children: [
                "Course",
                /* @__PURE__ */ jsx("input", { maxLength: 120, value: accountForm.course, onChange: (event) => setAccountForm({ ...accountForm, course: event.target.value }) })
              ] }),
              /* @__PURE__ */ jsxs("label", { children: [
                "Year level",
                /* @__PURE__ */ jsx("input", { maxLength: 32, value: accountForm.yearLevel, onChange: (event) => setAccountForm({ ...accountForm, yearLevel: event.target.value }) })
              ] })
            ] }),
            /* @__PURE__ */ jsxs("button", { className: "primary", disabled: loading, children: [
              /* @__PURE__ */ jsx(Users, { size: 16 }),
              " ",
              editingAccountId ? "Save changes" : "Create account"
            ] }),
            editingAccountId && /* @__PURE__ */ jsx("button", { type: "button", className: "secondary", onClick: cancelAccountEdit, children: "Cancel" })
          ] })
        ] }),
        /* @__PURE__ */ jsxs("section", { className: "flow-card dashboard-panel", children: [
          /* @__PURE__ */ jsxs("div", { className: "management-table-heading", children: [
            /* @__PURE__ */ jsx("h2", { children: "School accounts" }),
            /* @__PURE__ */ jsxs("label", { className: "management-search", children: [
              /* @__PURE__ */ jsx(Search, { size: 15 }),
              /* @__PURE__ */ jsx("input", { value: accountSearch, onChange: (event) => setAccountSearch(event.target.value), placeholder: "Search name, username, role, department", "aria-label": "Search school accounts" })
            ] })
          ] }),
          /* @__PURE__ */ jsx("div", { className: "table-wrap", children: /* @__PURE__ */ jsxs("table", { children: [
            /* @__PURE__ */ jsx("thead", { children: /* @__PURE__ */ jsxs("tr", { children: [
              /* @__PURE__ */ jsx("th", { children: "NAME" }),
              /* @__PURE__ */ jsx("th", { children: "USERNAME" }),
              /* @__PURE__ */ jsx("th", { children: "ROLE" }),
              /* @__PURE__ */ jsx("th", { children: "STATUS" }),
              /* @__PURE__ */ jsx("th", { children: "DETAILS" })
            ] }) }),
            /* @__PURE__ */ jsxs("tbody", { children: [
              filteredAccounts.map((account) => /* @__PURE__ */ jsxs("tr", { children: [
                /* @__PURE__ */ jsxs("td", { children: [
                  /* @__PURE__ */ jsx("strong", { children: account.display_name }),
                  /* @__PURE__ */ jsx("small", { className: "cell-subtitle", children: account.role === "student" ? [account.student_number || account.username, account.course, account.year_level].filter(Boolean).join(" · ") : account.department || "No department" })
                ] }),
                /* @__PURE__ */ jsx("td", { children: account.username }),
                /* @__PURE__ */ jsx("td", { children: roles[account.role].label }),
                /* @__PURE__ */ jsx("td", { children: /* @__PURE__ */ jsx("span", { className: `account-status ${account.active ? "enabled" : "disabled"}`, children: account.active ? "Active" : "Disabled" }) }),
                /* @__PURE__ */ jsxs("td", { children: [
                  /* @__PURE__ */ jsx("button", { className: "row-action", onClick: () => startAccountEdit(account), children: "Edit" }),
                  /* @__PURE__ */ jsx("button", { className: "row-action", onClick: () => toggleAccount(account), children: account.active ? "Disable" : "Enable" }),
                  account.role !== "admin" && /* @__PURE__ */ jsx("button", { className: "row-action", onClick: () => deleteAccount(account), children: "Delete" })
                ] })
              ] }, account.id)),
              !filteredAccounts.length && /* @__PURE__ */ jsx("tr", { children: /* @__PURE__ */ jsx("td", { colSpan: 5, children: accounts.length ? "No accounts match your search." : "No accounts found." }) })
            ] })
          ] }) })
        ] })
      ] }),
      role === "admin" && activePanel === "catalog" && /* @__PURE__ */ jsxs("div", { className: "management-grid", children: [
        /* @__PURE__ */ jsxs("section", { className: "flow-card dashboard-panel", children: [
          /* @__PURE__ */ jsxs("h2", { children: [
            /* @__PURE__ */ jsx(Users, { size: 18 }),
            " ",
            editingTeacherId ? "Edit teacher record" : "Add teacher"
          ] }),
          /* @__PURE__ */ jsx("p", { children: "Keep teacher details in the catalog before assigning subjects." }),
          /* @__PURE__ */ jsxs("form", { className: "management-form", onSubmit: saveTeacher, children: [
            /* @__PURE__ */ jsxs("label", { children: [
              "Teacher name",
              /* @__PURE__ */ jsx("input", { required: true, minLength: 2, maxLength: 120, value: teacherForm.name, onChange: (event) => setTeacherForm({ ...teacherForm, name: event.target.value }) })
            ] }),
            /* @__PURE__ */ jsxs("label", { children: [
              "Department",
              /* @__PURE__ */ jsxs("select", { value: teacherForm.department, onChange: (event) => setTeacherForm({ ...teacherForm, department: event.target.value }), children: [
                /* @__PURE__ */ jsx("option", { value: "", children: "Select department" }),
                catalog.departments.map((item) => { const name = typeof item === "string" ? item : item.name; return /* @__PURE__ */ jsx("option", { children: name }, name); })
              ] })
            ] }),
            /* @__PURE__ */ jsxs("button", { className: "primary", disabled: loading, children: [
              /* @__PURE__ */ jsx(Users, { size: 16 }),
              " ",
              editingTeacherId ? "Save teacher" : "Add teacher"
            ] }),
            editingTeacherId && /* @__PURE__ */ jsx("button", { type: "button", className: "secondary", onClick: () => {
              setEditingTeacherId(null);
              setTeacherForm({ name: "", department: "" });
            }, children: "Cancel" })
          ] })
        ] }),
        /* @__PURE__ */ jsxs("section", { className: "flow-card dashboard-panel", children: [
          /* @__PURE__ */ jsxs("h2", { children: [
            /* @__PURE__ */ jsx(BookOpen, { size: 18 }),
            editingSubjectId ? " Edit subject" : " Assign subject to teacher"
          ] }),
          /* @__PURE__ */ jsxs("form", { className: "management-form", onSubmit: createSubject, children: [
            /* @__PURE__ */ jsxs("label", { children: [
              "Subject name",
              /* @__PURE__ */ jsx("input", { required: true, minLength: 2, maxLength: 160, value: subjectForm.name, onChange: (event) => setSubjectForm({ ...subjectForm, name: event.target.value }) })
            ] }),
            /* @__PURE__ */ jsxs("label", { children: [
              "Department",
              /* @__PURE__ */ jsxs("select", { value: subjectForm.department, onChange: (event) => setSubjectForm({ ...subjectForm, department: event.target.value }), children: [
                /* @__PURE__ */ jsx("option", { value: "", children: "Select department" }),
                catalog.departments.map((item) => { const name = typeof item === "string" ? item : item.name; return /* @__PURE__ */ jsx("option", { children: name }, name); })
              ] })
            ] }),
            editingSubjectId ? null : /* @__PURE__ */ jsxs("label", { children: [
              "Teacher",
              /* @__PURE__ */ jsxs("select", { required: true, value: subjectForm.teacher, onChange: (event) => setSubjectForm({ ...subjectForm, teacher: event.target.value }), children: [
                /* @__PURE__ */ jsx("option", { value: "", children: "Select teacher" }),
                catalog.teachers.map((teacher) => /* @__PURE__ */ jsx("option", { children: teacher.name }, teacher.id))
              ] })
            ] }),
            /* @__PURE__ */ jsxs("button", { className: "primary", disabled: loading, children: [
              /* @__PURE__ */ jsx(BookOpen, { size: 16 }),
              editingSubjectId ? " Save changes" : " Save subject"
            ] }),
            editingSubjectId && /* @__PURE__ */ jsx("button", { type: "button", className: "secondary", onClick: () => {
              setEditingSubjectId(null);
              setSubjectForm({ name: "", department: "", teacher: "" });
            }, children: "Cancel" })
          ] })
        ] }),
        /* @__PURE__ */ jsxs("section", { className: "flow-card dashboard-panel teacher-catalog-panel", children: [
          /* @__PURE__ */ jsxs("div", { className: "management-table-heading", children: [
            /* @__PURE__ */ jsx("h2", { children: "Teacher and subject catalog" }),
            /* @__PURE__ */ jsxs("label", { className: "management-search", children: [
              /* @__PURE__ */ jsx(Search, { size: 15 }),
              /* @__PURE__ */ jsx("input", { value: teacherSearch, onChange: (event) => setTeacherSearch(event.target.value), placeholder: "Search teacher or subject", "aria-label": "Search teachers and subjects" })
            ] })
          ] }),
          /* @__PURE__ */ jsx("div", { className: "table-wrap", children: /* @__PURE__ */ jsxs("table", { children: [
            /* @__PURE__ */ jsx("thead", { children: /* @__PURE__ */ jsxs("tr", { children: [
              /* @__PURE__ */ jsx("th", { children: "TEACHER" }),
              /* @__PURE__ */ jsx("th", { children: "DEPARTMENT" }),
              /* @__PURE__ */ jsx("th", { children: "ASSIGNED SUBJECTS" }),
              /* @__PURE__ */ jsx("th", { children: "ACTION" })
            ] }) }),
            /* @__PURE__ */ jsxs("tbody", { children: [
              filteredTeachers.map((teacher) => {
                const subjects = catalog.assignments.filter((assignment) => assignment.teacher === teacher.name).map((assignment) => assignment.subject);
                return /* @__PURE__ */ jsxs("tr", { children: [
                  /* @__PURE__ */ jsx("td", { children: /* @__PURE__ */ jsx("strong", { children: teacher.name }) }),
                  /* @__PURE__ */ jsx("td", { children: teacher.department || "\u2014" }),
                  /* @__PURE__ */ jsx("td", { children: subjects.length ? subjects.join(", ") : "No subject assignments" }),
                  /* @__PURE__ */ jsxs("td", { children: [
                    /* @__PURE__ */ jsx("button", { className: "row-action", onClick: () => editTeacher(teacher), children: "Edit" }),
                    /* @__PURE__ */ jsx("button", { className: "row-action", onClick: () => deleteTeacher(teacher), children: "Delete" })
                  ] })
                ] }, teacher.id);
              }),
              !filteredTeachers.length && /* @__PURE__ */ jsx("tr", { children: /* @__PURE__ */ jsx("td", { colSpan: 4, children: catalog.teachers.length ? "No teachers match your search." : "No teacher records yet." }) })
            ] })
          ] }) })
        ] })
      ] }),
      role === "admin" && activePanel === "periods" && /* @__PURE__ */ jsxs("div", { className: "management-grid period-management-grid", children: [
        /* @__PURE__ */ jsxs("section", { className: "flow-card dashboard-panel period-create-panel", children: [
          /* @__PURE__ */ jsxs("h2", { children: [
            /* @__PURE__ */ jsx(CalendarDays, { size: 18 }),
            editingPeriodId ? " Edit evaluation period" : " Create evaluation period"
          ] }),
          /* @__PURE__ */ jsx("p", { children: "New periods start closed. Open a period when student evaluations are ready." }),
          /* @__PURE__ */ jsxs("form", { className: "management-form period-create-form", onSubmit: createPeriod, children: [
            /* @__PURE__ */ jsxs("label", { children: [
              "Period name",
              /* @__PURE__ */ jsx("input", { required: true, minLength: 3, maxLength: 120, value: periodForm.name, onChange: (event) => setPeriodForm({ ...periodForm, name: event.target.value }), placeholder: "e.g. First Semester Evaluation" })
            ] }),
            /* @__PURE__ */ jsxs("label", { children: [
              "Semester",
              /* @__PURE__ */ jsx("select", { value: periodForm.semester, onChange: (event) => setPeriodForm({ ...periodForm, semester: event.target.value }), children: SEMESTERS.map((semester) => /* @__PURE__ */ jsx("option", { children: semester }, semester)) })
            ] }),
            /* @__PURE__ */ jsxs("label", { children: [
              "Academic year",
              /* @__PURE__ */ jsx("input", { required: true, value: periodForm.academicYear, onChange: (event) => setPeriodForm({ ...periodForm, academicYear: event.target.value }), placeholder: "2026-2027" })
            ] }),
            /* @__PURE__ */ jsxs("label", { children: [
              "Starts",
              /* @__PURE__ */ jsx("input", { required: true, type: "datetime-local", value: periodForm.startsAt, onChange: (event) => setPeriodForm({ ...periodForm, startsAt: event.target.value }) })
            ] }),
            /* @__PURE__ */ jsxs("label", { children: [
              "Ends",
              /* @__PURE__ */ jsx("input", { required: true, type: "datetime-local", value: periodForm.endsAt, onChange: (event) => setPeriodForm({ ...periodForm, endsAt: event.target.value }) })
            ] }),
            /* @__PURE__ */ jsxs("button", { className: "primary", disabled: loading, children: [
              /* @__PURE__ */ jsx(CalendarDays, { size: 16 }),
              editingPeriodId ? " Save period" : " Create period"
            ] }),
            editingPeriodId && /* @__PURE__ */ jsx("button", { type: "button", className: "secondary", onClick: cancelPeriodEdit, children: "Cancel" })
          ] })
        ] }),
        /* @__PURE__ */ jsxs("section", { className: "flow-card dashboard-panel period-list-panel", children: [
          /* @__PURE__ */ jsx("h2", { children: "Evaluation periods" }),
          /* @__PURE__ */ jsx("div", { className: "table-wrap period-table-wrap", children: /* @__PURE__ */ jsxs("table", { children: [
            /* @__PURE__ */ jsx("thead", { children: /* @__PURE__ */ jsxs("tr", { children: [
              /* @__PURE__ */ jsx("th", { children: "PERIOD" }),
              /* @__PURE__ */ jsx("th", { children: "ACADEMIC YEAR" }),
              /* @__PURE__ */ jsx("th", { children: "DATES" }),
              /* @__PURE__ */ jsx("th", { children: "STATUS" }),
              /* @__PURE__ */ jsx("th", { children: "ACTION" })
            ] }) }),
            /* @__PURE__ */ jsxs("tbody", { children: [
              catalog.periods.map((period) => /* @__PURE__ */ jsxs("tr", { children: [
                /* @__PURE__ */ jsxs("td", { children: [
                  /* @__PURE__ */ jsx("strong", { children: period.name }),
                  /* @__PURE__ */ jsx("small", { className: "cell-subtitle", children: period.semester || "Legacy" })
                ] }),
                /* @__PURE__ */ jsx("td", { children: period.academic_year || "\u2014" }),
                /* @__PURE__ */ jsx("td", { children: /* @__PURE__ */ jsxs("span", { className: "period-date-range", children: [
                  /* @__PURE__ */ jsxs("span", { children: [
                    /* @__PURE__ */ jsx("small", { children: "Start" }),
                    new Date(period.starts_at).toLocaleDateString()
                  ] }),
                  /* @__PURE__ */ jsxs("span", { children: [
                    /* @__PURE__ */ jsx("small", { children: "End" }),
                    new Date(period.ends_at).toLocaleDateString()
                  ] })
                ] }) }),
                /* @__PURE__ */ jsx("td", { children: /* @__PURE__ */ jsx("span", { className: `account-status ${period.status === "open" ? "enabled" : "disabled"}`, children: period.status }) }),
                /* @__PURE__ */ jsx("td", { children: period.name !== "Legacy data" && /* @__PURE__ */ jsxs(Fragment, { children: [
                  /* @__PURE__ */ jsx("button", { className: "row-action", onClick: () => editPeriod(period), children: "Edit" }),
                  /* @__PURE__ */ jsx("button", { className: "row-action", disabled: Date.parse(period.ends_at) < Date.now() && period.status === "closed", onClick: () => togglePeriod(period), children: period.status === "open" ? "Close" : "Open" })
                ] }) })
              ] }, period.id)),
              !catalog.periods.length && /* @__PURE__ */ jsx("tr", { children: /* @__PURE__ */ jsx("td", { colSpan: 5, children: "No evaluation periods yet." }) })
            ] })
          ] }) })
        ] })
      ] }),
      role === "admin" && activePanel === "criteria" && /* @__PURE__ */ jsxs("div", { className: "flow-card dashboard-panel criteria-settings", children: [
        /* @__PURE__ */ jsxs("h2", { children: [
          /* @__PURE__ */ jsx(ClipboardCheck, { size: 18 }),
          " Evaluation criteria and settings"
        ] }),
        /* @__PURE__ */ jsx("p", { children: "Update evaluation question wording and organize questions into criteria. Question numbers and rating types remain unchanged." }),
        /* @__PURE__ */ jsxs("form", { onSubmit: saveQuestions, children: [
          questionTexts.map((question) => /* @__PURE__ */ jsxs("label", { children: [
            `Question ${question.id}`,
            /* @__PURE__ */ jsx("textarea", {
              rows: 2,
              maxLength: 1000,
              required: true,
              value: question.text,
              onChange: (event) => setQuestionTexts(questionTexts.map((item) => item.id === question.id ? { ...item, text: event.target.value } : item))
            })
          ] }, question.id)),
          /* @__PURE__ */ jsx("small", { children: "Question numbers and rating scales stay the same. Each question needs wording between 5 and 1,000 characters." }),
          /* @__PURE__ */ jsxs("button", { className: "primary", disabled: loading, children: [
            /* @__PURE__ */ jsx(Check, { size: 16 }),
            " Save evaluation questions"
          ] })
        ] }),
        /* @__PURE__ */ jsxs("form", { onSubmit: saveCriteria, children: [
          /* @__PURE__ */ jsxs("label", { children: [
            "Criterion groups (JSON)",
            /* @__PURE__ */ jsx("textarea", { rows: 14, spellCheck: false, value: criteriaText, onChange: (event) => setCriteriaText(event.target.value) })
          ] }),
          /* @__PURE__ */ jsx("small", { children: "Every existing question number (1\u201329) must be included exactly once. Invalid or incomplete criteria are rejected by the server." }),
          /* @__PURE__ */ jsxs("button", { className: "primary", disabled: loading, children: [
            /* @__PURE__ */ jsx(Check, { size: 16 }),
            " Save criteria settings"
          ] })
        ] })
      ] })
    ] })
  ] });
}
function AdminDashboard({ role, userId, responses, catalog, apiRequest, refreshCatalog, flash, questions, setQuestions, onAccountUpdated }) {
  const [activePanel, setActivePanel] = useState(role === "admin" ? "dashboard" : "results");
  const [accounts, setAccounts] = useState([]);
  const [adminEvaluations, setAdminEvaluations] = useState([]);
  const [accountSearch, setAccountSearch] = useState("");
  const [teacherSearch, setTeacherSearch] = useState("");
  const [subjectSearch, setSubjectSearch] = useState("");
  const [evaluationSearch, setEvaluationSearch] = useState("");
  const [selectedReport, setSelectedReport] = useState(null);
  const [filters, setFilters] = useState({ teacher: "", department: "", subject: "", semester: "", academicYear: "", period: "", search: "" });
  const [loading, setLoading] = useState(false);
  const [editingAccountId, setEditingAccountId] = useState(null);
  const [accountForm, setAccountForm] = useState({ username: "", password: "", displayName: "", role: "student", department: "", studentNumber: "", courseId: "", yearLevel: "", subjectIds: [] });
  const [teacherForm, setTeacherForm] = useState({ teacherCode: "", name: "", department: "" });
  const [editingTeacherId, setEditingTeacherId] = useState(null);
  const [subjectForm, setSubjectForm] = useState({ subjectCode: "", name: "", department: "" });
  const [editingSubjectId, setEditingSubjectId] = useState(null);
  const [courseForm, setCourseForm] = useState({ courseCode: "", courseName: "", department: "", subjectIds: [] });
  const [editingCourseId, setEditingCourseId] = useState(null);
  const [courseSearch, setCourseSearch] = useState("");
  const [departmentForm, setDepartmentForm] = useState({ name: "" });
  const [editingDepartmentId, setEditingDepartmentId] = useState(null);
  const [departmentSearch, setDepartmentSearch] = useState("");
  const [assignmentForm, setAssignmentForm] = useState({ teacherId: "", subjectId: "", semester: "", academicYear: "" });
  const [editingAssignmentId, setEditingAssignmentId] = useState(null);
  const [periodForm, setPeriodForm] = useState({ name: "", semester: "", academicYear: "", startsAt: "", endsAt: "" });
  const [editingPeriodId, setEditingPeriodId] = useState(null);
  const [criteria, setCriteria] = useState(DEFAULT_CRITERIA);
  const [criteriaText, setCriteriaText] = useState(JSON.stringify(DEFAULT_CRITERIA, null, 2));
  const [questionTexts, setQuestionTexts] = useState(questions.map(({ id, text }) => ({ id, text })));
  const filtered = useMemo(() => filteredRows(responses, filters), [responses, filters]);
  const visibleAccounts = useMemo(() => {
    const accountRole = activePanel === "deans" ? "dean" : "student";
    const query = accountSearch.trim().toLocaleLowerCase();
    return accounts.filter((account) => account.role === accountRole && (!query || [
      account.display_name, account.username, account.department, account.student_number, account.course, account.year_level
    ].some((value) => String(value || "").toLocaleLowerCase().includes(query))));
  }, [accounts, activePanel, accountSearch]);
  const visibleTeachers = useMemo(() => {
    const query = teacherSearch.trim().toLocaleLowerCase();
    return catalog.teachers.filter((teacher) => !query || [
      teacher.name, teacher.department,
      ...catalog.assignments.filter((item) => item.teacherId === teacher.id).map((item) => item.subject)
    ].some((value) => String(value || "").toLocaleLowerCase().includes(query)));
  }, [catalog, teacherSearch]);
  const visibleSubjects = useMemo(() => {
    const query = subjectSearch.trim().toLocaleLowerCase();
    return catalog.subjects.filter((subject) => !query || `${subject.subjectCode} ${subject.name} ${subject.department}`.toLocaleLowerCase().includes(query));
  }, [catalog.subjects, subjectSearch]);
  const visibleCourses = useMemo(() => {
    const query = courseSearch.trim().toLocaleLowerCase();
    return (catalog.courses || []).filter((course) => !query || `${course.courseCode} ${course.courseName}`.toLocaleLowerCase().includes(query));
  }, [catalog.courses, courseSearch]);
  const visibleDepartments = useMemo(() => {
    const query = departmentSearch.trim().toLocaleLowerCase();
    return (catalog.departments || []).filter((departmentRecord) => {
      const name = typeof departmentRecord === "string" ? departmentRecord : departmentRecord.name;
      return !query || String(name || "").toLocaleLowerCase().includes(query);
    });
  }, [catalog.departments, departmentSearch]);
  const visibleEvaluations = useMemo(() => {
    const query = evaluationSearch.trim().toLocaleLowerCase();
    return adminEvaluations.filter((evaluation) => !query || [
      evaluation.teacher, evaluation.subject, evaluation.department, evaluation.period, evaluation.submittedAt
    ].some((value) => String(value || "").toLocaleLowerCase().includes(query)));
  }, [adminEvaluations, evaluationSearch]);
  const totalEvaluations = responses.reduce((total, row) => total + Number(row.responses || 0), 0);
  const totalResponses = filtered.reduce((total, row) => total + Number(row.responses || 0), 0);
  const reportDepartments = catalog.departments.map((item) => typeof item === "string" ? item : item.name);
  const reportAcademicYears = [...new Set(responses.map((item) => item.academicYear).filter(Boolean))].sort();
  const printSummary = () => {
    setSelectedReport(null);
    window.setTimeout(() => window.print(), 0);
  };
  const refreshAccounts = async () => setAccounts(await apiRequest("/admin/users"));
  const refreshAdminEvaluations = async () => setAdminEvaluations(await apiRequest("/admin/evaluations"));
  const refreshCriteria = async () => {
    const result = await apiRequest("/settings/criteria");
    const next = result.criteria?.length ? result.criteria : DEFAULT_CRITERIA;
    setCriteria(next);
    setCriteriaText(JSON.stringify(next, null, 2));
  };
  useEffect(() => {
    setQuestionTexts(questions.map(({ id, text }) => ({ id, text })));
  }, [questions]);
  useEffect(() => {
    const tasks = [refreshCriteria()];
    if (role === "admin") tasks.push(refreshAccounts(), refreshAdminEvaluations());
    Promise.all(tasks).catch((error) => flash(error instanceof Error ? error.message : "Unable to load management data."));
  }, [role]);
  const runAction = async (operation, successMessage) => {
    setLoading(true);
    try {
      await operation();
      flash(successMessage);
    } catch (error) {
      flash(error instanceof Error ? error.message : "The request could not be completed.");
    } finally {
      setLoading(false);
    }
  };
  const resetAccountForm = () => {
    setEditingAccountId(null);
    setAccountForm({ username: "", password: "", displayName: "", role: activePanel === "deans" ? "dean" : "student", department: "", studentNumber: "", courseId: "", yearLevel: "", subjectIds: [] });
  };
  const saveAccount = (event) => {
    event.preventDefault();
    const username = accountForm.username.trim();
    const displayName = accountForm.displayName.trim();
    const password = accountForm.password;
    const roleForPanel = activePanel === "deans" ? "dean" : "student";
    if (displayName.length < 2) {
      flash("Enter the account holder's full name.");
      return;
    }
    if (!editingAccountId && (!/^[a-zA-Z0-9._-]{3,64}$/.test(username) || password.length < 12)) {
      flash("Use a valid username and a temporary password with at least 12 characters.");
      return;
    }
    if (roleForPanel === "student" && !editingAccountId && !accountForm.studentNumber.trim()) {
      flash("Student number is required.");
      return;
    }
    void runAction(async () => {
      if (editingAccountId) {
        await apiRequest(`/admin/users/${editingAccountId}`, {
          method: "PUT",
          body: JSON.stringify({
            displayName,
            department: roleForPanel === "dean" ? "" : accountForm.department,
            studentNumber: accountForm.studentNumber.trim(),
            courseId: accountForm.courseId ? Number(accountForm.courseId) : null,
            yearLevel: accountForm.yearLevel.trim(),
            subjectIds: accountForm.subjectIds.map(Number),
            ...(password ? { password } : {})
          })
        });
        if (editingAccountId === userId) onAccountUpdated(displayName, roleForPanel === "dean" ? "" : accountForm.department);
      } else {
        await apiRequest("/admin/users", {
          method: "POST",
          body: JSON.stringify({ ...accountForm, username, displayName, role: roleForPanel, department: roleForPanel === "dean" ? "" : accountForm.department, password, courseId: accountForm.courseId ? Number(accountForm.courseId) : null, subjectIds: roleForPanel === "student" ? accountForm.subjectIds.map(Number) : [] })
        });
      }
      resetAccountForm();
      await refreshAccounts();
    }, editingAccountId ? "Account updated." : `${roles[roleForPanel].label} account created.`);
  };
  const editAccount = (account) => {
    setEditingAccountId(account.id);
    setAccountForm({
      username: account.username,
      password: "",
      displayName: account.display_name,
      role: account.role,
      department: account.department || "",
      studentNumber: account.student_number || "",
      courseId: account.course_id ? String(account.course_id) : "",
      yearLevel: account.year_level || "",
      subjectIds: (account.subject_ids || []).map(String)
    });
  };
  const deleteAccount = (account) => {
    if (!window.confirm(`Delete ${account.display_name}'s ${roles[account.role].label.toLowerCase()} account? Accounts with evaluation activity may need to be disabled instead.`)) return;
    void runAction(async () => {
      await apiRequest(`/admin/users/${account.id}`, { method: "DELETE" });
      if (editingAccountId === account.id) resetAccountForm();
      await refreshAccounts();
    }, `${roles[account.role].label} account deleted.`);
  };
  const toggleAccount = (account) => {
    void runAction(async () => {
      await apiRequest(`/admin/users/${account.id}`, { method: "PATCH", body: JSON.stringify({ active: !account.active }) });
      await refreshAccounts();
    }, `Account ${account.active ? "disabled" : "enabled"}.`);
  };
  const saveTeacher = (event) => {
    event.preventDefault();
    const teacherCode = teacherForm.teacherCode.trim();
    const name = teacherForm.name.trim();
    if (!/^[A-Za-z0-9._-]{1,64}$/.test(teacherCode) || name.length < 2 || name.length > 120) {
      flash("Enter a valid Teacher ID and a name between 2 and 120 characters.");
      return;
    }
    void runAction(async () => {
      await apiRequest(editingTeacherId ? `/admin/teachers/${editingTeacherId}` : "/admin/teachers", {
        method: editingTeacherId ? "PATCH" : "POST",
        body: JSON.stringify({ teacherCode, name, department: teacherForm.department })
      });
      setEditingTeacherId(null);
      setTeacherForm({ teacherCode: "", name: "", department: "" });
      await refreshCatalog();
    }, editingTeacherId ? "Teacher updated." : "Teacher added.");
  };
  const deleteTeacher = (teacher) => {
    if (!window.confirm(`Delete ${teacher.name} from the teacher catalog? Historical results will remain anonymous and available.`)) return;
    void runAction(async () => {
      await apiRequest(`/admin/teachers/${teacher.id}`, { method: "DELETE" });
      setEditingTeacherId(null);
      setTeacherForm({ teacherCode: "", name: "", department: "" });
      await refreshCatalog();
    }, "Teacher deleted.");
  };
  const saveSubject = (event) => {
    event.preventDefault();
    const subjectCode = subjectForm.subjectCode.trim();
    const name = subjectForm.name.trim();
    if (!/^[A-Za-z0-9._-]{1,32}$/.test(subjectCode) || name.length < 2) {
      flash("Enter a valid Subject Code and name.");
      return;
    }
    void runAction(async () => {
      await apiRequest(editingSubjectId ? `/admin/subjects/${editingSubjectId}` : "/admin/subjects", {
        method: editingSubjectId ? "PUT" : "POST",
        body: JSON.stringify({ ...subjectForm, subjectCode, name })
      });
      setEditingSubjectId(null);
      setSubjectForm({ subjectCode: "", name: "", department: "" });
      await refreshCatalog();
    }, editingSubjectId ? "Subject updated." : "Subject added.");
  };
  const deleteSubject = (subject) => {
    if (!window.confirm(`Delete ${subject.name} and its teacher assignments? Existing evaluation results will be retained.`)) return;
    void runAction(async () => {
      await apiRequest(`/admin/subjects/${subject.id}`, { method: "DELETE" });
      if (editingSubjectId === subject.id) {
        setEditingSubjectId(null);
        setSubjectForm({ subjectCode: "", name: "", department: "" });
      }
      await refreshCatalog();
    }, "Subject deleted.");
  };
  const saveCourse = (event) => {
    event.preventDefault();
    const courseCode = courseForm.courseCode.trim();
    const courseName = courseForm.courseName.trim();
    if (!/^[A-Za-z0-9._-]{1,32}$/.test(courseCode) || courseName.length < 2) {
      flash("Enter a valid Course Code and Course Name.");
      return;
    }
    void runAction(async () => {
      await apiRequest(editingCourseId ? `/admin/courses/${editingCourseId}` : "/admin/courses", {
        method: editingCourseId ? "PUT" : "POST",
        body: JSON.stringify({
          courseCode,
          courseName,
          department: courseForm.department,
          subjectIds: courseForm.subjectIds.map(Number)
        })
      });
      setEditingCourseId(null);
      setCourseForm({ courseCode: "", courseName: "", department: "", subjectIds: [] });
      await refreshCatalog();
    }, editingCourseId ? "Course updated." : "Course added.");
  };
  const editCourse = (course) => {
    setEditingCourseId(course.id);
    setCourseForm({
      courseCode: course.courseCode,
      courseName: course.courseName,
      department: course.department || "",
      subjectIds: catalog.courseSubjects.filter((item) => item.courseId === course.id).map((item) => String(item.subjectId))
    });
  };
  const deleteCourse = (course) => {
    if (!window.confirm(`Delete ${course.courseName}? Student records are kept, but the course enrollment and subject links will be removed.`)) return;
    void runAction(async () => {
      await apiRequest(`/admin/courses/${course.id}`, { method: "DELETE" });
      if (editingCourseId === course.id) {
        setEditingCourseId(null);
        setCourseForm({ courseCode: "", courseName: "", department: "", subjectIds: [] });
      }
      await refreshCatalog();
      await refreshAccounts();
    }, "Course deleted.");
  };
  const saveDepartment = (event) => {
    event.preventDefault();
    const name = departmentForm.name.trim();
    if (name.length < 2 || name.length > 120) {
      flash("Enter a department name between 2 and 120 characters.");
      return;
    }
    void runAction(async () => {
      await apiRequest(editingDepartmentId ? `/admin/departments/${editingDepartmentId}` : "/admin/departments", {
        method: editingDepartmentId ? "PUT" : "POST",
        body: JSON.stringify({ name })
      });
      setEditingDepartmentId(null);
      setDepartmentForm({ name: "" });
      await refreshCatalog();
    }, editingDepartmentId ? "Department updated." : "Department added.");
  };
  const editDepartment = (departmentRecord) => {
    setEditingDepartmentId(departmentRecord.id);
    setDepartmentForm({ name: departmentRecord.name });
  };
  const saveAssignment = (event) => {
    event.preventDefault();
    const payload = {
      teacherId: Number(assignmentForm.teacherId),
      subjectId: Number(assignmentForm.subjectId),
      semester: assignmentForm.semester,
      academicYear: assignmentForm.academicYear.trim()
    };
    if (!payload.teacherId || !payload.subjectId || !payload.semester || !payload.academicYear) {
      flash("Select a teacher and subject and enter the academic year.");
      return;
    }
    void runAction(async () => {
      await apiRequest(editingAssignmentId ? `/admin/assignments/${editingAssignmentId}` : "/admin/assignments", {
        method: editingAssignmentId ? "PUT" : "POST",
        body: JSON.stringify(payload)
      });
      setEditingAssignmentId(null);
      setAssignmentForm({ teacherId: "", subjectId: "", semester: "", academicYear: "" });
      await refreshCatalog();
    }, editingAssignmentId ? "Teacher assignment updated." : "Teacher assigned to subject.");
  };
  const editAssignment = (assignment) => {
    setEditingAssignmentId(assignment.id);
    setAssignmentForm({
      teacherId: String(assignment.teacherId),
      subjectId: String(assignment.subjectId),
      semester: assignment.semester || "",
      academicYear: assignment.academicYear || ""
    });
  };
  const deleteAssignment = (assignment) => {
    if (!window.confirm(`Remove ${assignment.teacher}'s assignment to ${assignment.subject}?`)) return;
    void runAction(async () => {
      await apiRequest(`/admin/assignments/${assignment.id}`, { method: "DELETE" });
      if (editingAssignmentId === assignment.id) {
        setEditingAssignmentId(null);
        setAssignmentForm({ teacherId: "", subjectId: "", semester: "", academicYear: "" });
      }
      await refreshCatalog();
    }, "Teacher assignment removed.");
  };
  const savePeriod = (event) => {
    event.preventDefault();
    const startsAt = new Date(periodForm.startsAt);
    const endsAt = new Date(periodForm.endsAt);
    if (!periodForm.name.trim() || !periodForm.semester || !periodForm.academicYear.trim() || Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime()) || startsAt >= endsAt) {
      flash("Enter a period name, academic year, and valid start/end dates.");
      return;
    }
    void runAction(async () => {
      await apiRequest(editingPeriodId ? `/admin/periods/${editingPeriodId}` : "/admin/periods", {
        method: editingPeriodId ? "PATCH" : "POST",
        body: JSON.stringify({ ...periodForm, name: periodForm.name.trim(), academicYear: periodForm.academicYear.trim(), startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() })
      });
      setEditingPeriodId(null);
      setPeriodForm({ name: "", semester: "", academicYear: "", startsAt: "", endsAt: "" });
      await refreshCatalog();
    }, editingPeriodId ? "Evaluation period updated." : "Evaluation period created.");
  };
  const editPeriod = (period) => {
    setEditingPeriodId(period.id);
    setPeriodForm({
      name: period.name,
      semester: period.semester,
      academicYear: period.academic_year,
      startsAt: asDateTimeLocal(period.starts_at),
      endsAt: asDateTimeLocal(period.ends_at)
    });
  };
  const togglePeriod = (period) => {
    void runAction(async () => {
      await apiRequest(`/admin/periods/${period.id}`, { method: "PATCH", body: JSON.stringify({ status: period.status === "open" ? "closed" : "open" }) });
      await refreshCatalog();
    }, `Evaluation period ${period.status === "open" ? "closed" : "opened"}.`);
  };
  const saveQuestions = (event) => {
    event.preventDefault();
    void runAction(async () => {
      const result = await apiRequest("/admin/settings/questions", { method: "PUT", body: JSON.stringify({ questions: questionTexts }) });
      setQuestions(result.questions);
    }, "Evaluation questions saved.");
  };
  const saveCriteria = (event) => {
    event.preventDefault();
    void runAction(async () => {
      const result = await apiRequest("/admin/settings/criteria", { method: "PUT", body: JSON.stringify({ criteria: JSON.parse(criteriaText) }) });
      const next = result.criteria?.length ? result.criteria : DEFAULT_CRITERIA;
      setCriteria(next);
      setCriteriaText(JSON.stringify(next, null, 2));
    }, "Evaluation criteria saved.");
  };
  const nav = role === "admin" ? [
    { id: "dashboard", label: "Dashboard", icon: BarChart3 },
    { id: "students", label: "Students", icon: Users },
    { id: "deans", label: "Deans", icon: ShieldCheck },
    { id: "teachers", label: "Teachers", icon: Users },
    { id: "subjects", label: "Subjects & assignments", icon: BookOpen },
    { id: "catalog-admin", label: "Departments & courses", icon: BookOpen },
    { id: "periods", label: "Evaluation periods", icon: CalendarDays },
    { id: "criteria", label: "Questions & criteria", icon: ClipboardCheck },
    { id: "evaluations", label: "Submitted evaluations", icon: FileText },
    { id: "results", label: "Evaluation results", icon: BarChart3 }
  ] : [{ id: "results", label: "Evaluation results", icon: BarChart3 }];
  const isAccountPanel = activePanel === "students" || activePanel === "deans";
  const selectedRole = activePanel === "deans" ? "dean" : "student";
  return (
    <div className="workspace-layout">
      <aside className="workspace-nav" aria-label="Admin dashboard navigation">
        <p>WORKSPACE</p>
        {nav.map(({ id, label, icon: Icon }) => (
          <button key={id} type="button" className={activePanel === id ? "active" : ""} onClick={() => {
            setActivePanel(id);
            if (id === "students" || id === "deans") resetAccountForm();
          }}>
            <Icon size={17} /> {label}
          </button>
        ))}
      </aside>
      <main className="flow-content dashboard-content">
        <span className="flow-kicker">{role === "admin" ? "ADMINISTRATOR PORTAL" : "DEAN PORTAL"}</span>
        <div className="dashboard-title">
          <div>
            <h1>{nav.find((item) => item.id === activePanel)?.label}</h1>
            <p>{role === "admin" ? "Manage school accounts, teaching resources, evaluation operations, and anonymous results." : "Review anonymous evaluation results across all departments."}</p>
          </div>
          {role === "admin" && activePanel === "results" && (
            <div className="export-actions">
              <button type="button" className="secondary" onClick={() => saveCsv(filtered, criteria)}><Download size={16} /> Export Excel / CSV</button>
              <button type="button" className="primary" onClick={() => window.print()}><Printer size={16} /> Print report</button>
            </div>
          )}
          {role === "dean" && activePanel === "results" && (
            <div className="export-actions">
              <button type="button" className="primary" onClick={printSummary}><Printer size={16} /> Print summary</button>
            </div>
          )}
        </div>

        {activePanel === "dashboard" && (
          <>
            <div className="summary-cards admin-summary-cards">
              {role === "admin" ? <>
                <div><span>Total Students</span><strong>{accounts.filter((item) => item.role === "student").length}</strong><small>Student accounts</small></div>
                <div><span>Total Teachers</span><strong>{catalog.teachers.length}</strong><small>Teacher records</small></div>
                <div><span>Total Subjects</span><strong>{catalog.subjects.length}</strong><small>Course catalog</small></div>
                <div><span>Total Deans</span><strong>{accounts.filter((item) => item.role === "dean").length}</strong><small>Dean accounts</small></div>
                <div><span>Total Evaluations</span><strong>{totalEvaluations}</strong><small>Anonymous submissions</small></div>
              </> : <>
                <div><span>Anonymous responses</span><strong>{totalResponses}</strong><small>Across current filters</small></div>
                <div><span>Teachers evaluated</span><strong>{new Set(filtered.map((item) => item.teacher)).size}</strong><small>In selected report</small></div>
                <div><span>Average rating</span><strong>{totalResponses ? (filtered.reduce((sum, item) => sum + item.mean * item.responses, 0) / totalResponses).toFixed(2) : "0.00"}</strong><small>Weighted by responses</small></div>
                <div><span>Open periods</span><strong>{catalog.periods.filter((item) => item.status === "open").length}</strong><small>Currently accepting evaluations</small></div>
              </>}
            </div>
            {role === "admin" && <section className="flow-card dashboard-panel">
              <h2>System management</h2>
              <p>Choose a module to manage school records. Student identities are not included in evaluation reports.</p>
              <div className="admin-quick-actions">
                {nav.filter((item) => item.id !== "dashboard").map(({ id, label, icon: Icon }) => (
                  <button type="button" className="secondary" key={id} onClick={() => setActivePanel(id)}><Icon size={16} /> {label}</button>
                ))}
              </div>
            </section>}
            {role === "dean" && <section className="flow-card dashboard-panel">
              <h2>School-wide overview</h2>
              <p>Review and print anonymous evaluation results across all departments.</p>
              <button type="button" className="primary" onClick={() => setActivePanel("results")}>View evaluation results</button>
            </section>}
          </>
        )}

        {role === "admin" && isAccountPanel && (
          <div className="management-grid">
            <section className="flow-card dashboard-panel">
              <h2>{editingAccountId ? `Edit ${roles[accountForm.role].label} record` : `Add ${roles[selectedRole].label}`}</h2>
              <p>{editingAccountId ? "Update account details. Leave the password blank to keep it unchanged." : "Create a school account and provide a secure temporary password."}</p>
              <form className="management-form" onSubmit={saveAccount}>
                {!editingAccountId && <label>Username<input required minLength={3} maxLength={64} pattern="[a-zA-Z0-9._\-]+" value={accountForm.username} onChange={(event) => setAccountForm({ ...accountForm, username: event.target.value })} /></label>}
                <label>{editingAccountId ? "New password (optional)" : "Temporary password"}<input type="password" autoComplete="new-password" required={!editingAccountId} minLength={12} maxLength={256} value={accountForm.password} onChange={(event) => setAccountForm({ ...accountForm, password: event.target.value })} /></label>
                <label>Full name<input required minLength={2} maxLength={120} value={accountForm.displayName} onChange={(event) => setAccountForm({ ...accountForm, displayName: event.target.value })} /></label>
                {selectedRole === "student" && <label>Department (optional)<select value={accountForm.department} onChange={(event) => setAccountForm({ ...accountForm, department: event.target.value })}><option value="">Select department (optional)</option>{catalog.departments.map((item) => { const name = typeof item === "string" ? item : item.name; return <option key={name}>{name}</option>; })}</select></label>}
                {selectedRole === "student" && <>
                  <label>Student number<input required maxLength={64} value={accountForm.studentNumber} onChange={(event) => setAccountForm({ ...accountForm, studentNumber: event.target.value })} /></label>
                  <label>Course (optional)<select value={accountForm.courseId} onChange={(event) => setAccountForm({ ...accountForm, courseId: event.target.value })}><option value="">No course assigned</option>{catalog.courses.map((course) => <option key={course.id} value={course.id}>{course.courseCode} · {course.courseName}</option>)}</select></label>
                  {!catalog.courses.length && <small className="cell-subtitle" role="status">No courses are available. You can still create the student account and assign subjects below.</small>}
                  <label>Year level<input maxLength={32} value={accountForm.yearLevel} onChange={(event) => setAccountForm({ ...accountForm, yearLevel: event.target.value })} /></label>
                  <fieldset className="management-checkbox-list">
                    <legend>Assigned subjects (optional)</legend>
                    {catalog.subjects.length ? catalog.subjects.map((subject) => (
                      <label key={subject.id}>
                        <input type="checkbox" checked={accountForm.subjectIds.includes(String(subject.id))} onChange={(event) => setAccountForm({
                          ...accountForm,
                          subjectIds: event.target.checked
                            ? [...accountForm.subjectIds, String(subject.id)]
                            : accountForm.subjectIds.filter((id) => id !== String(subject.id))
                        })} />
                        {subject.subjectCode} · {subject.name}
                      </label>
                    )) : <p>No subjects are available to assign.</p>}
                    <small>If no subjects are selected, the student's course subjects are used when available.</small>
                  </fieldset>
                </>}
                <button className="primary" disabled={loading}>{editingAccountId ? "Save changes" : `Add ${roles[selectedRole].label}`}</button>
                {editingAccountId && <button type="button" className="secondary" onClick={resetAccountForm}>Cancel edit</button>}
              </form>
            </section>
            <section className="flow-card dashboard-panel">
              <div className="management-table-heading">
                <h2>{selectedRole === "dean" ? "Dean directory" : "Student directory"}</h2>
                <label className="management-search"><Search size={15} /><input value={accountSearch} onChange={(event) => setAccountSearch(event.target.value)} placeholder={`Search ${selectedRole}s`} aria-label={`Search ${selectedRole}s`} /></label>
              </div>
              <div className="table-wrap"><table><thead><tr><th>NAME</th><th>USERNAME</th><th>{selectedRole === "dean" ? "SCOPE" : "STUDENT DETAILS"}</th><th>STATUS</th><th>ACTION</th></tr></thead>
                <tbody>{visibleAccounts.map((account) => <tr key={account.id}>
                  <td><strong>{account.display_name}</strong></td><td>{account.username}</td>
                  <td>{selectedRole === "dean" ? "All departments" : [account.student_number, account.department, account.course, account.year_level].filter(Boolean).join(" · ")}</td>
                  <td><span className={`account-status ${account.active ? "enabled" : "disabled"}`}>{account.active ? "Active" : "Disabled"}</span></td>
                  <td><button type="button" className="row-action" onClick={() => editAccount(account)}>Edit</button><button type="button" className="row-action" onClick={() => toggleAccount(account)}>{account.active ? "Disable" : "Enable"}</button><button type="button" className="row-action" onClick={() => deleteAccount(account)}>Delete</button></td>
                </tr>)}
                {!visibleAccounts.length && <tr><td colSpan="5">{accounts.some((item) => item.role === selectedRole) ? "No records match your search." : `No ${selectedRole} records yet.`}</td></tr>}</tbody>
              </table></div>
            </section>
          </div>
        )}

        {role === "admin" && activePanel === "teachers" && (
          <div className="management-grid">
            <section className="flow-card dashboard-panel">
              <h2>{editingTeacherId ? "Edit teacher" : "Add teacher"}</h2>
              <p>Manage teachers in the evaluation catalog. Teacher login accounts are not required.</p>
              <form className="management-form" onSubmit={saveTeacher}>
                <label>Teacher ID<input required maxLength={64} pattern="[A-Za-z0-9._\-]+" value={teacherForm.teacherCode} onChange={(event) => setTeacherForm({ ...teacherForm, teacherCode: event.target.value })} /></label>
                <label>Teacher name<input required minLength={2} maxLength={120} value={teacherForm.name} onChange={(event) => setTeacherForm({ ...teacherForm, name: event.target.value })} /></label>
                <label>Department<select value={teacherForm.department} onChange={(event) => setTeacherForm({ ...teacherForm, department: event.target.value })}><option value="">Select department</option>{catalog.departments.map((item) => { const name = typeof item === "string" ? item : item.name; return <option key={name}>{name}</option>; })}</select></label>
                <button className="primary" disabled={loading}>{editingTeacherId ? "Save teacher" : "Add teacher"}</button>
                {editingTeacherId && <button type="button" className="secondary" onClick={() => { setEditingTeacherId(null); setTeacherForm({ teacherCode: "", name: "", department: "" }); }}>Cancel</button>}
              </form>
            </section>
            <section className="flow-card dashboard-panel">
              <div className="management-table-heading"><h2>Teacher directory</h2><label className="management-search"><Search size={15} /><input value={teacherSearch} onChange={(event) => setTeacherSearch(event.target.value)} placeholder="Search teachers" aria-label="Search teachers" /></label></div>
              <div className="table-wrap"><table><thead><tr><th>TEACHER ID</th><th>FULL NAME</th><th>DEPARTMENT</th><th>SUBJECTS</th><th>ACTION</th></tr></thead>
                <tbody>{visibleTeachers.map((teacher) => <tr key={teacher.id}>
                  <td>{teacher.teacherCode}</td><td><strong>{teacher.name}</strong></td><td>{teacher.department || "—"}</td>
                  <td>{catalog.assignments.filter((item) => item.teacherId === teacher.id).map((item) => item.subject).join(", ") || "No assignments"}</td>
                  <td><button type="button" className="row-action" onClick={() => { setEditingTeacherId(teacher.id); setTeacherForm({ teacherCode: teacher.teacherCode, name: teacher.name, department: teacher.department }); }}>Edit</button><button type="button" className="row-action" onClick={() => deleteTeacher(teacher)}>Delete</button></td>
                </tr>)}
                {!visibleTeachers.length && <tr><td colSpan="5">No teacher records match this search.</td></tr>}</tbody>
              </table></div>
            </section>
          </div>
        )}

        {role === "admin" && activePanel === "subjects" && (
          <>
            <div className="management-grid">
              <section className="flow-card dashboard-panel">
                <h2>{editingSubjectId ? "Edit subject" : "Add subject"}</h2>
                <form className="management-form" onSubmit={saveSubject}>
                  <label>Subject Code<input required maxLength={32} pattern="[A-Za-z0-9._\-]+" value={subjectForm.subjectCode} onChange={(event) => setSubjectForm({ ...subjectForm, subjectCode: event.target.value })} /></label>
                  <label>Subject name<input required minLength={2} maxLength={160} value={subjectForm.name} onChange={(event) => setSubjectForm({ ...subjectForm, name: event.target.value })} /></label>
                  <label>Department<select value={subjectForm.department} onChange={(event) => setSubjectForm({ ...subjectForm, department: event.target.value })}><option value="">Select department</option>{catalog.departments.map((item) => { const name = typeof item === "string" ? item : item.name; return <option key={name}>{name}</option>; })}</select></label>
                  <button className="primary" disabled={loading}>{editingSubjectId ? "Save subject" : "Add subject"}</button>
                  {editingSubjectId && <button type="button" className="secondary" onClick={() => { setEditingSubjectId(null); setSubjectForm({ subjectCode: "", name: "", department: "" }); }}>Cancel</button>}
                </form>
              </section>
              <section className="flow-card dashboard-panel">
                <h2>{editingAssignmentId ? "Edit teacher assignment" : "Assign teacher to subject"}</h2>
                <form className="management-form" onSubmit={saveAssignment}>
                  <label>Teacher<select required value={assignmentForm.teacherId} onChange={(event) => setAssignmentForm({ ...assignmentForm, teacherId: event.target.value })}><option value="">Select teacher</option>{catalog.teachers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
                  <label>Subject<select required value={assignmentForm.subjectId} onChange={(event) => setAssignmentForm({ ...assignmentForm, subjectId: event.target.value })}><option value="">Select subject</option>{catalog.subjects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
                  <label>Semester<select required value={assignmentForm.semester} onChange={(event) => setAssignmentForm({ ...assignmentForm, semester: event.target.value })}><option value="">Select semester</option>{SEMESTERS.map((item) => <option key={item}>{item}</option>)}</select></label>
                  <label>Academic year<input required maxLength={32} placeholder="2026-2027" value={assignmentForm.academicYear} onChange={(event) => setAssignmentForm({ ...assignmentForm, academicYear: event.target.value })} /></label>
                  <button className="primary" disabled={loading}>{editingAssignmentId ? "Save assignment" : "Assign teacher"}</button>
                  {editingAssignmentId && <button type="button" className="secondary" onClick={() => { setEditingAssignmentId(null); setAssignmentForm({ teacherId: "", subjectId: "", semester: "", academicYear: "" }); }}>Cancel</button>}
                </form>
              </section>
            </div>
            <section className="flow-card dashboard-panel">
              <div className="management-table-heading"><h2>Subject catalog</h2><label className="management-search"><Search size={15} /><input value={subjectSearch} onChange={(event) => setSubjectSearch(event.target.value)} placeholder="Search subjects" aria-label="Search subjects" /></label></div>
              <div className="table-wrap"><table><thead><tr><th>SUBJECT CODE</th><th>SUBJECT</th><th>DEPARTMENT</th><th>ASSIGNED TEACHERS</th><th>ACTION</th></tr></thead>
                <tbody>{visibleSubjects.map((subject) => {
                  const assignments = catalog.assignments.filter((item) => item.subjectId === subject.id);
                  return <tr key={subject.id}><td>{subject.subjectCode}</td><td><strong>{subject.name}</strong></td><td>{subject.department || "—"}</td><td>{assignments.map((item) => `${item.teacher} (${item.semester || "No term"})`).join(", ") || "No assignments"}</td>
                    <td><button type="button" className="row-action" onClick={() => { setEditingSubjectId(subject.id); setSubjectForm({ subjectCode: subject.subjectCode, name: subject.name, department: subject.department }); }}>Edit</button><button type="button" className="row-action" onClick={() => deleteSubject(subject)}>Delete</button></td></tr>;
                })}
                {!visibleSubjects.length && <tr><td colSpan="5">No subjects match this search.</td></tr>}</tbody>
              </table></div>
            </section>
            <section className="flow-card dashboard-panel">
              <h2>Teacher-subject assignments</h2>
              <div className="table-wrap"><table><thead><tr><th>TEACHER</th><th>SUBJECT</th><th>DEPARTMENT</th><th>TERM</th><th>ACTION</th></tr></thead>
                <tbody>{catalog.assignments.map((item) => <tr key={item.id}>
                  <td>{item.teacher}</td><td>{item.subject}</td><td>{item.department || "—"}</td><td>{[item.semester, item.academicYear].filter(Boolean).join(" · ") || "All terms"}</td>
                  <td><button type="button" className="row-action" onClick={() => editAssignment(item)}>Edit</button><button type="button" className="row-action" onClick={() => deleteAssignment(item)}>Delete</button></td>
                </tr>)}
                {!catalog.assignments.length && <tr><td colSpan="5">No teacher-subject assignments yet.</td></tr>}</tbody>
              </table></div>
            </section>
          </>
        )}

        {role === "admin" && activePanel === "catalog-admin" && (
          <div className="management-grid">
            <section className="flow-card dashboard-panel">
              <h2>{editingDepartmentId ? "Edit department" : "Add department"}</h2>
              <form className="management-form" onSubmit={saveDepartment}>
                <label>Department name<input required minLength={2} maxLength={120} value={departmentForm.name} onChange={(event) => setDepartmentForm({ name: event.target.value })} /></label>
                <button className="primary" disabled={loading}>{editingDepartmentId ? "Save department" : "Add department"}</button>
                {editingDepartmentId && <button type="button" className="secondary" onClick={() => { setEditingDepartmentId(null); setDepartmentForm({ name: "" }); }}>Cancel</button>}
              </form>
            </section>
            <section className="flow-card dashboard-panel">
              <div className="management-table-heading"><h2>Department directory</h2><label className="management-search"><Search size={15} /><input value={departmentSearch} onChange={(event) => setDepartmentSearch(event.target.value)} placeholder="Search departments" aria-label="Search departments" /></label></div>
              <div className="table-wrap"><table><thead><tr><th>DEPARTMENT</th><th>ACTION</th></tr></thead>
                <tbody>{visibleDepartments.map((departmentRecord) => {
                  const department = typeof departmentRecord === "string" ? { id: departmentRecord, name: departmentRecord } : departmentRecord;
                  return <tr key={department.id}><td><strong>{department.name}</strong></td><td><button type="button" className="row-action" onClick={() => editDepartment(department)}>Edit</button></td></tr>;
                })}
                {!visibleDepartments.length && <tr><td colSpan="2">{catalog.departments.length ? "No departments match this search." : "No departments have been created yet."}</td></tr>}</tbody>
              </table></div>
            </section>
          </div>
        )}

        {role === "admin" && activePanel === "catalog-admin" && (
          <div className="management-grid">
            <section className="flow-card dashboard-panel">
              <h2>{editingCourseId ? "Edit course" : "Add course"}</h2>
              <p>Connect each course with the subjects taught in that program. Students assigned to this course can evaluate teachers for these subjects.</p>
              <form className="management-form" onSubmit={saveCourse}>
                <label>Course Code<input required maxLength={32} pattern="[A-Za-z0-9._\-]+" value={courseForm.courseCode} onChange={(event) => setCourseForm({ ...courseForm, courseCode: event.target.value })} /></label>
                <label>Course Name<input required minLength={2} maxLength={160} value={courseForm.courseName} onChange={(event) => setCourseForm({ ...courseForm, courseName: event.target.value })} /></label>
                <label>Department (optional)<select value={courseForm.department} onChange={(event) => setCourseForm({ ...courseForm, department: event.target.value })}><option value="">No department link</option>{catalog.departments.map((item) => { const name = typeof item === "string" ? item : item.name; return <option key={name}>{name}</option>; })}</select></label>
                <fieldset className="management-checkbox-list">
                  <legend>Subjects in this course</legend>
                  {!catalog.subjects.length && <p>Add subjects before connecting them to courses.</p>}
                  {catalog.subjects.map((subject) => (
                    <label key={subject.id}>
                      <input
                        type="checkbox"
                        checked={courseForm.subjectIds.includes(String(subject.id))}
                        onChange={(event) => setCourseForm({
                          ...courseForm,
                          subjectIds: event.target.checked
                            ? [...courseForm.subjectIds, String(subject.id)]
                            : courseForm.subjectIds.filter((id) => id !== String(subject.id))
                        })}
                      />
                      {subject.subjectCode} · {subject.name}
                    </label>
                  ))}
                </fieldset>
                <button className="primary" disabled={loading}>{editingCourseId ? "Save course" : "Add course"}</button>
                {editingCourseId && <button type="button" className="secondary" onClick={() => { setEditingCourseId(null); setCourseForm({ courseCode: "", courseName: "", department: "", subjectIds: [] }); }}>Cancel</button>}
              </form>
            </section>
            <section className="flow-card dashboard-panel">
              <div className="management-table-heading">
                <h2>Course directory</h2>
                <label className="management-search"><Search size={15} /><input value={courseSearch} onChange={(event) => setCourseSearch(event.target.value)} placeholder="Search courses" aria-label="Search courses" /></label>
              </div>
              <div className="table-wrap"><table><thead><tr><th>COURSE CODE</th><th>COURSE NAME</th><th>DEPARTMENT</th><th>STUDENTS</th><th>SUBJECTS</th><th>ACTION</th></tr></thead>
                <tbody>{visibleCourses.map((course) => {
                  const linkedSubjectIds = catalog.courseSubjects.filter((item) => item.courseId === course.id).map((item) => item.subjectId);
                  const enrolledStudents = accounts.filter((account) => account.role === "student" && Number(account.course_id) === course.id).length;
                  return <tr key={course.id}>
                    <td>{course.courseCode}</td><td><strong>{course.courseName}</strong></td><td>{course.department || "—"}</td><td>{enrolledStudents}</td>
                    <td>{catalog.subjects.filter((subject) => linkedSubjectIds.includes(subject.id)).map((subject) => subject.subjectCode).join(", ") || "No subjects linked"}</td>
                    <td><button type="button" className="row-action" onClick={() => editCourse(course)}>Edit</button><button type="button" className="row-action" onClick={() => deleteCourse(course)}>Delete</button></td>
                  </tr>;
                })}
                {!visibleCourses.length && <tr><td colSpan="6">{catalog.courses.length ? "No courses match this search." : "No courses have been created yet."}</td></tr>}</tbody>
              </table></div>
            </section>
          </div>
        )}

        {role === "admin" && activePanel === "periods" && (
          <div className="management-grid period-management-grid">
            <section className="flow-card dashboard-panel">
              <h2>{editingPeriodId ? "Edit evaluation period" : "Set evaluation period"}</h2>
              <p>New evaluation periods are closed until you choose to open them.</p>
              <form className="management-form period-create-form" onSubmit={savePeriod}>
                <label>Period name<input required minLength={3} maxLength={120} value={periodForm.name} onChange={(event) => setPeriodForm({ ...periodForm, name: event.target.value })} /></label>
                <label>Semester<select required value={periodForm.semester} onChange={(event) => setPeriodForm({ ...periodForm, semester: event.target.value })}><option value="">Select semester</option>{SEMESTERS.map((item) => <option key={item}>{item}</option>)}</select></label>
                <label>Academic year<input required maxLength={32} placeholder="2026-2027" value={periodForm.academicYear} onChange={(event) => setPeriodForm({ ...periodForm, academicYear: event.target.value })} /></label>
                <label>Starts<input required type="datetime-local" value={periodForm.startsAt} onChange={(event) => setPeriodForm({ ...periodForm, startsAt: event.target.value })} /></label>
                <label>Ends<input required type="datetime-local" value={periodForm.endsAt} onChange={(event) => setPeriodForm({ ...periodForm, endsAt: event.target.value })} /></label>
                <button className="primary" disabled={loading}>{editingPeriodId ? "Save period" : "Create period"}</button>
                {editingPeriodId && <button type="button" className="secondary" onClick={() => { setEditingPeriodId(null); setPeriodForm({ name: "", semester: "", academicYear: "", startsAt: "", endsAt: "" }); }}>Cancel</button>}
              </form>
            </section>
            <section className="flow-card dashboard-panel">
              <h2>Open and close evaluation periods</h2>
              <div className="table-wrap"><table><thead><tr><th>PERIOD</th><th>ACADEMIC YEAR</th><th>DATES</th><th>STATUS</th><th>ACTION</th></tr></thead>
                <tbody>{catalog.periods.map((period) => <tr key={period.id}>
                  <td><strong>{period.name}</strong><small className="cell-subtitle">{period.semester}</small></td>
                  <td>{period.academic_year || "—"}</td><td>{new Date(period.starts_at).toLocaleDateString()} – {new Date(period.ends_at).toLocaleDateString()}</td>
                  <td><span className={`account-status ${period.status === "open" ? "enabled" : "disabled"}`}>{period.status}</span></td>
                  <td>{period.name !== "Legacy data" && <><button type="button" className="row-action" onClick={() => editPeriod(period)}>Edit</button><button type="button" className="row-action" disabled={Date.parse(period.ends_at) < Date.now() && period.status === "closed"} onClick={() => togglePeriod(period)}>{period.status === "open" ? "Close" : "Open"}</button></>}</td>
                </tr>)}
                {!catalog.periods.length && <tr><td colSpan="5">No evaluation periods have been set.</td></tr>}</tbody>
              </table></div>
            </section>
          </div>
        )}

        {role === "admin" && activePanel === "criteria" && (
          <div className="flow-card dashboard-panel criteria-settings">
            <h2><ClipboardCheck size={18} /> Evaluation questions and criteria</h2>
            <p>Update question wording and organize questions into criteria. Question numbers and rating types remain unchanged.</p>
            <form onSubmit={saveQuestions}>
              {questionTexts.map((question) => <label key={question.id}>Question {question.id}<textarea rows={2} maxLength={1000} required value={question.text} onChange={(event) => setQuestionTexts((current) => current.map((item) => item.id === question.id ? { ...item, text: event.target.value } : item))} /></label>)}
              <small>Each question needs wording between 5 and 1,000 characters.</small>
              <button className="primary" disabled={loading}><Check size={16} /> Save evaluation questions</button>
            </form>
            <form onSubmit={saveCriteria}>
              <label>Criterion groups (JSON)<textarea rows={14} spellCheck={false} required value={criteriaText} onChange={(event) => setCriteriaText(event.target.value)} /></label>
              <small>Every question number (1–29) must be included exactly once. Invalid criteria are rejected by the server.</small>
              <button className="primary" disabled={loading}><Check size={16} /> Save evaluation criteria</button>
            </form>
          </div>
        )}

        {role === "admin" && activePanel === "evaluations" && (
          <section className="flow-card dashboard-panel">
            <div className="management-table-heading"><div><h2>Submitted evaluations</h2><p>Anonymous submission records only. Student account details and individual answers are not displayed.</p></div>
              <div className="admin-quick-actions">
                <label className="management-search"><Search size={15} /><input value={evaluationSearch} onChange={(event) => setEvaluationSearch(event.target.value)} placeholder="Search teacher, subject, period" aria-label="Search submitted evaluations" /></label>
                <button type="button" className="secondary" disabled={loading} onClick={() => void runAction(refreshAdminEvaluations, "Submitted evaluations refreshed.")}>Refresh</button>
              </div>
            </div>
            <div className="table-wrap"><table><thead><tr><th>TEACHER</th><th>SUBJECT</th><th>DEPARTMENT</th><th>EVALUATION PERIOD</th><th>SUBMITTED</th></tr></thead>
              <tbody>{visibleEvaluations.map((item) => <tr key={item.id}><td>{item.teacher}</td><td>{item.subject}</td><td>{item.department || "—"}</td><td>{item.period}</td><td>{item.submittedAt ? new Date(item.submittedAt).toLocaleString() : "—"}</td></tr>)}
              {!visibleEvaluations.length && <tr><td colSpan="5">{adminEvaluations.length ? "No evaluations match this search." : "No submitted evaluations yet."}</td></tr>}</tbody>
            </table></div>
          </section>
        )}

        {activePanel === "results" && (
          <>
            <div className="summary-cards">
              <div><span>Filtered evaluations</span><strong>{totalResponses}</strong><small>Anonymous submissions</small></div>
              <div><span>Teachers rated</span><strong>{new Set(filtered.map((item) => item.teacher)).size}</strong><small>In selected results</small></div>
              <div><span>Average score</span><strong>{totalResponses ? (filtered.reduce((sum, item) => sum + item.mean * item.responses, 0) / totalResponses).toFixed(2) : "0.00"}</strong><small>Out of 5</small></div>
              <div><span>Result groups</span><strong>{filtered.length}</strong><small>Teacher, subject, and period</small></div>
            </div>
            <section className="flow-card dashboard-panel">
              <div className="panel-heading"><div><h2><Search size={18} /> Search and filter results</h2><p>View teacher averages and results for each criterion. No student identities are included.</p></div><span className="secure-label"><ShieldCheck size={15} /> Anonymous</span></div>
              <div className="report-filters">
                <label>Search<input value={filters.search} placeholder="Teacher, subject or department" onChange={(event) => setFilters({ ...filters, search: event.target.value })} /></label>
                <label>Teacher<select value={filters.teacher} onChange={(event) => setFilters({ ...filters, teacher: event.target.value })}><option value="">All teachers</option>{catalog.teachers.map((item) => <option key={item.id}>{item.name}</option>)}</select></label>
                <label>Subject<select value={filters.subject} onChange={(event) => setFilters({ ...filters, subject: event.target.value })}><option value="">All subjects</option>{catalog.subjects.map((item) => <option key={item.id}>{item.name}</option>)}</select></label>
                <label>Evaluation period<select value={filters.period} onChange={(event) => setFilters({ ...filters, period: event.target.value })}><option value="">All periods</option>{catalog.periods.map((item) => <option key={item.id}>{item.name}</option>)}</select></label>
                <label>Department<select value={filters.department} onChange={(event) => setFilters({ ...filters, department: event.target.value })}><option value="">All departments</option>{reportDepartments.map((item) => <option key={item}>{item}</option>)}</select></label>
                <label>Semester<select value={filters.semester} onChange={(event) => setFilters({ ...filters, semester: event.target.value })}><option value="">All semesters</option>{SEMESTERS.map((item) => <option key={item}>{item}</option>)}</select></label>
                <label>Academic year<select value={filters.academicYear} onChange={(event) => setFilters({ ...filters, academicYear: event.target.value })}><option value="">All academic years</option>{reportAcademicYears.map((year) => <option key={year}>{year}</option>)}</select></label>
              </div>
              <ReportCharts rows={filtered} criteria={criteria} />
            </section>
            <section className="flow-card dashboard-panel">
              <div className="panel-heading"><div><h2><FileText size={18} /> Evaluation results</h2><p>{filtered.length} result group(s)</p></div></div>
              <ReportTable rows={filtered} criteria={criteria} onView={setSelectedReport} />
            </section>
            {selectedReport && <TeacherReportDetails row={selectedReport} criteria={criteria} />}
          </>
        )}
      </main>
    </div>
  );
}
var App_default = App;
export {
  App_default as default
};
