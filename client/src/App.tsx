import { useEffect, useMemo, useState } from 'react';
import { BarChart3, BookOpen, CalendarDays, Check, ClipboardCheck, Download, FileText, LogIn, Printer, Search, Send, ShieldCheck, Users } from 'lucide-react';
import './flow.css';
import './flow-extra.css';

type Role = 'server' | 'client' | 'dean';
type AppUser = { id: number; username: string; role: Role; displayName: string; department: string };
type SurveyResponse = {
  teacher: string;
  subject: string;
  department: string;
  period: string;
  semester: string;
  academicYear: string;
  responses: number;
  mean: number;
  perQuestion: Record<string, number>;
};
type Catalog = {
  teachers: { id: number; name: string; department: string }[];
  subjects: { id: number; name: string; department: string }[];
  assignments: { teacher: string; subject: string; department: string; semester: string; academicYear: string }[];
  periods: { id: number; name: string; semester: string; academic_year: string; starts_at: string; ends_at: string; status: 'open' | 'closed' }[];
  departments: string[];
};
type Criterion = { name: string; questionIds: number[] };
type Question = { id: number; text: string; type?: 'standard' | 'agree' | 'yesno' };

const API = '/api';
const localDemoLogin = import.meta.env.DEV;
const LOCAL_LOGIN_USERNAMES = new Map([
  ['admin', 'demo-admin'],
  ['student', 'demo-student'],
  ['dean', 'demo-dean'],
]);
const SEMESTERS = ['1st Semester', '2nd Semester', 'Summer'] as const;
const DEPARTMENTS = [
  'College of Accountancy',
  'College of Business Administration',
  'College of Criminology',
  'College of Hospitality Management',
  'College of Information Technology',
  'College of Teacher Education',
] as const;
const QUESTION_DATA: Question[] = [
  { id: 1, text: 'Starts the class and ends the class with prayer.' },
  { id: 2, text: 'Course objectives were explained clearly at the beginning of the course/subject.' },
  { id: 3, text: 'Gives relevant assignments and requirements to reinforce learning.' },
  { id: 4, text: 'Injects a sense of humor in his/her teaching without being vulgar.' },
  { id: 5, text: 'Has a democratic way in dealing with students\' behavior.' },
  { id: 6, text: 'Meet class regularly.' },
  { id: 7, text: 'Employs an acceptable way of handling different types of students.' },
  { id: 8, text: 'Relates subject matter to relevant topics of interest of students.' },
  { id: 9, text: 'Entertains and answers students\' questions.' },
  { id: 10, text: 'Relates subject matter to real life or practical situations.' },
  { id: 11, text: 'Explains clearly the policies pertaining to the grading system.' },
  { id: 12, text: 'Provides students opportunity to recheck their scores/ratings and verify grades.' },
  { id: 13, text: 'Gives students constructive feedbacks on their performance in class.' },
  { id: 14, text: 'Informs students of their scores/ratings and grades punctually.' },
  { id: 15, text: 'Gives quizzes, examinations, assessments and/or performance evaluation in a systematic manner.' },
  { id: 16, text: 'Engages students to get involved in interactive and independent learning.' },
  { id: 17, text: 'Shows vitality, enthusiasm and dynamism in teaching.' },
  { id: 18, text: 'Asks questions that promote critical and creative thinking.' },
  { id: 19, text: 'Manifests Pillarican spirituality through acts of humility, service and compassion.' },
  { id: 20, text: 'Makes favorable or encouraging response to students\' opinions, comments and suggestions.' },
  { id: 21, text: 'Practices a sense of propriety in speech, actions, grooming and attire.' },
  { id: 22, text: 'Acts as a witness to the Catholic faith by integrating Christian value in lessons.' },
  { id: 23, text: 'Models respect and courtesy in the online class.' },
  { id: 24, text: 'Shows concern for students.' },
  { id: 25, text: 'Uses variety of instructional strategies and resources to respond to students\' diverse needs.' },
  { id: 26, text: 'Incorporates multimedia and visual resources into online teaching.' },
  { id: 27, text: 'Understands and is responsive to students with special needs in the online classroom.' },
  { id: 28, text: 'Compared to course taught using classroom format, I found the distance education format to be equally effective.', type: 'agree' },
  { id: 29, text: 'Would you like to be in another class of this teacher/instructor again in later school year/semester?', type: 'yesno' },
];

const DEFAULT_CRITERIA: Criterion[] = [
  { name: 'Teaching effectiveness', questionIds: [2, 3, 8, 10, 15, 16, 17, 18, 25, 26] },
  { name: 'Communication', questionIds: [4, 9, 20] },
  { name: 'Classroom management', questionIds: [1, 5, 7, 21, 23] },
  { name: 'Punctuality and grading', questionIds: [6, 11, 12, 13, 14] },
  { name: 'Student engagement', questionIds: [19, 22, 24, 27, 28, 29] },
];

const roles: Record<Role, { label: string }> = {
  server: { label: 'Admin' },
  client: { label: 'Student' },
  dean: { label: 'Dean' },
};

const standardScale = [
  { value: 5, label: 'Always' },
  { value: 4, label: 'Frequently' },
  { value: 3, label: 'Sometimes' },
  { value: 2, label: 'Rarely' },
  { value: 1, label: 'Never' },
];

const agreeScale = [
  { value: 5, label: 'Strongly Agree' },
  { value: 4, label: 'Agree' },
  { value: 3, label: 'Neutral' },
  { value: 2, label: 'Disagree' },
  { value: 1, label: 'Strongly Disagree' },
];

const yesNoScale = [
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
];

function buildInitialRatings() {
  return QUESTION_DATA.reduce((accumulator, question) => {
    const key = String(question.id);
    accumulator[key] = question.type === 'yesno' ? '' : 0;
    return accumulator;
  }, {} as Record<string, number | string>);
}

function App() {
  const [step, setStep] = useState(1);
  const [loginName, setLoginName] = useState('');
  const [selectedDemoRole, setSelectedDemoRole] = useState<Role | ''>('');
  const [password, setPassword] = useState('');
  const [user, setUser] = useState<AppUser | null>(null);
  const [csrfToken, setCsrfToken] = useState('');
  const [authChecking, setAuthChecking] = useState(true);
  const [authError, setAuthError] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [responses, setResponses] = useState<SurveyResponse[]>([]);
  const [catalog, setCatalog] = useState<Catalog>({ teachers: [], subjects: [], assignments: [], periods: [], departments: [] });
  const [submissions, setSubmissions] = useState<{ teacher: string; subject: string; period: string; created_at: string }[]>([]);
  const [form, setForm] = useState({ teacher: '', subject: '', periodId: '', ratings: buildInitialRatings() });
  const [criteria, setCriteria] = useState<Criterion[]>(DEFAULT_CRITERIA);

  const flash = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(''), 2800);
  };

  const apiRequest = async (path: string, options: RequestInit = {}) => {
    const headers = new Headers(options.headers);
    if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    if (csrfToken && options.method && options.method !== 'GET') headers.set('X-CSRF-Token', csrfToken);
    const result = await fetch(`${API}${path}`, { ...options, headers, credentials: 'same-origin' });
    const data = await result.json().catch(() => ({})) as { error?: string };
    if (!result.ok) throw new Error(data.error || 'The request could not be completed.');
    return data;
  };

  useEffect(() => {
    let active = true;
    fetch(`${API}/auth/me`, { credentials: 'same-origin' })
      .then(async (response) => {
        if (response.status === 401) return null;
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Unable to verify your session.');
        return data as { user: AppUser; csrfToken: string };
      })
      .then((session) => {
        if (!active) return;
        if (session) {
          setUser(session.user);
          setLoginName(session.user.username);
          setCsrfToken(session.csrfToken);
        }
      })
      .catch((error: unknown) => {
        if (active) setAuthError(error instanceof Error ? error.message : 'Unable to connect to the evaluation server.');
      })
      .finally(() => {
        if (active) setAuthChecking(false);
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!user) return undefined;
    let active = true;
    const loadDashboardData = async () => {
      try {
        const [nextCatalog, reports] = await Promise.all([
          apiRequest('/catalog'),
          user.role === 'client' ? Promise.resolve([]) : apiRequest('/reports'),
        ]);
        if (!active) return;
        setCatalog(nextCatalog as Catalog);
        setResponses(reports as SurveyResponse[]);
        if (user.role === 'client') {
          const mine = await apiRequest('/my-submissions');
          if (active) setSubmissions(mine as typeof submissions);
        }
      } catch (error) {
        if (active) flash(error instanceof Error ? error.message : 'Unable to load dashboard data.');
      }
    };
    void loadDashboardData();
    const timer = user.role === 'dean' || user.role === 'server' ? window.setInterval(loadDashboardData, 15000) : undefined;
    return () => {
      active = false;
      if (timer) window.clearInterval(timer);
    };
  }, [user, csrfToken]);

  useEffect(() => {
    if (!user || user.role === 'client') return;
    void apiRequest('/settings/criteria')
      .then((data) => setCriteria((data as { criteria: Criterion[] }).criteria))
      .catch(() => setCriteria(DEFAULT_CRITERIA));
  }, [user]);

  const login = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmedUsername = loginName.trim();
    const submittedUsername = localDemoLogin
      ? LOCAL_LOGIN_USERNAMES.get(trimmedUsername.toLowerCase()) ?? trimmedUsername
      : trimmedUsername;

    if (!trimmedUsername || trimmedUsername.length > 120 || (!localDemoLogin && trimmedUsername.length < 3)) {
      setAuthError(localDemoLogin ? 'Choose Admin, Student, or Dean.' : 'Enter a valid username or school ID.');
      return;
    }

    if (!localDemoLogin && (!password || password.trim().length < 12)) {
      setAuthError('Password must be at least 12 characters long.');
      return;
    }

    setBusy(true);
    setAuthError('');
    try {
      const data = await apiRequest('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username: submittedUsername, password }),
      }) as { user: AppUser; csrfToken: string };
      setUser(data.user);
      setCsrfToken(data.csrfToken);
      setLoginName(data.user.username);
      setPassword('');
      setStep(1);
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : 'Sign-in failed. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();

    const teacher = form.teacher.trim();
    const subject = form.subject.trim();
    const missingQuestion = QUESTION_DATA.find((question) => {
      const value = form.ratings[String(question.id)];
      if (question.type === 'yesno') {
        return value !== 'yes' && value !== 'no';
      }
      return Number(value) < 1 || Number(value) > 5;
    });

    if (!teacher || !subject || !form.periodId) {
      flash('Please select the teacher, subject, and evaluation period.');
      return;
    }

    if (form.periodId && !catalog.periods.some((period) => String(period.id) === form.periodId && period.status === 'open')) {
      flash('The selected evaluation period is not currently open.');
      return;
    }

    if (missingQuestion) {
      flash(`Please answer question ${missingQuestion.id} before submitting.`);
      return;
    }

    try {
      await apiRequest('/responses', {
        method: 'POST',
        body: JSON.stringify({ teacher, subject, periodId: Number(form.periodId), ratings: form.ratings }),
      });
      setStep(3);
      setForm({ teacher: '', subject: '', periodId: '', ratings: buildInitialRatings() });
      flash('Evaluation submitted successfully.');
      const mine = await apiRequest('/my-submissions');
      setSubmissions(mine as typeof submissions);
    } catch (error) {
      flash(error instanceof Error ? error.message : 'Unable to submit evaluation.');
    }
  };

  const logout = async () => {
    try {
      await apiRequest('/auth/logout', { method: 'POST', body: '{}' });
    } catch (error) {
      flash(error instanceof Error ? error.message : 'Unable to sign out safely.');
      return;
    }
    setUser(null);
    setLoginName('');
    setSelectedDemoRole('');
    setPassword('');
    setResponses([]);
    setCatalog({ teachers: [], subjects: [], assignments: [], periods: [], departments: [] });
  };

  if (authChecking) {
    return <div className="auth-check"><SchoolMark size="small" /><span>Checking secure session…</span></div>;
  }

  if (!user) {
    return (
      <LoginScreen
        loginName={loginName}
        setLoginName={setLoginName}
        selectedDemoRole={selectedDemoRole}
        setSelectedDemoRole={(role) => {
          setSelectedDemoRole(role);
          setLoginName(role ? role === 'server' ? 'admin' : role === 'client' ? 'student' : 'dean' : '');
          setAuthError('');
        }}
        password={password}
        setPassword={setPassword}
        login={login}
        busy={busy}
        error={authError}
      />
    );
  }

  return (
    <div className="flow-shell">
      <header className="flow-topbar">
        <div className="flow-brand">
          <SchoolMark size="small" />
          <div><strong>OLPC-SMI</strong><small>Evaluation System</small></div>
        </div>
        <div className="live-pill"><i /> Live data</div>
        <div className="account-chip"><strong>{user.displayName}</strong><small>{roles[user.role].label}</small></div>
        <button className="logout" onClick={() => void logout()}>Sign out</button>
      </header>

      {user.role === 'client' && <ClientFlow step={step} setStep={setStep} form={form} setForm={setForm} submit={submit} catalog={catalog} submissions={submissions} />}
      {(user.role === 'server' || user.role === 'dean') && <AdminFlow role={user.role} department={user.department} responses={responses} catalog={catalog} apiRequest={apiRequest} refreshCatalog={async () => setCatalog(await apiRequest('/catalog') as Catalog)} flash={flash} />}

      {notice && <div className="toast"><Check size={16} /> {notice}</div>}
    </div>
  );
}function SchoolMark({ size }: { size: 'small' | 'large' }) {
  return <img className={`school-mark school-mark-${size}`} src="/olpc-logo.png" alt="OLPC-SMI official school logo" />;
}

function TeacherIllustration() {
  return (
    <svg className="teacher-illustration" viewBox="0 0 360 230" role="img" aria-label="Teacher presenting a lesson at a chalkboard">
      <rect x="12" y="42" width="205" height="137" rx="4" fill="#d7a52d" />
      <rect x="20" y="50" width="189" height="120" fill="#163c35" />
      <path d="M34 151h158" stroke="#e8dfc2" strokeWidth="3" strokeLinecap="round" opacity=".8" />
      <path d="M57 80h66m-66 16h94m-94 16h75" stroke="#dce6d7" strokeWidth="3" strokeLinecap="round" opacity=".7" />
      <path d="M8 181h214l-12 10H20z" fill="#b78121" />
      <circle cx="272" cy="55" r="31" fill="#f2bd8d" />
      <path d="M241 56c-4-29 13-48 35-48 20 0 34 16 33 40-8-8-14-18-17-27-11 15-27 23-51 25z" fill="#392321" />
      <path d="M246 49c4-20 18-32 34-32 14 0 23 9 27 22-12-4-21-11-27-20-8 15-20 24-34 30z" fill="#513027" />
      <path d="M263 59h2m18 0h2" stroke="#36211c" strokeWidth="3" strokeLinecap="round" />
      <path d="M267 72c5 4 11 4 16 0" stroke="#a7564c" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M251 91c11-10 32-10 43 0l12 60h-67z" fill="#d45c53" />
      <path d="m261 99 24 27 12-9-22-24z" fill="#fff2d4" />
      <path d="m248 103-29 27-5-7 23-37m60 18 28 24-5 7-31-17" fill="#f2bd8d" stroke="#e7ab79" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M244 149h60l-5 40h-21l-6-28-8 28h-21z" fill="#345a8b" />
      <path d="m247 186-6 25h18l7-24m23 0 8 24h18l-10-25" fill="#f2bd8d" />
      <path d="M238 212h23m31 0h24" stroke="#f1d49a" strokeWidth="5" strokeLinecap="round" />
      <path d="m217 127 7-7 7 8-8 5z" fill="#f4e7c6" />
      <path d="M226 119 243 100" stroke="#f2bd8d" strokeWidth="5" strokeLinecap="round" />
    </svg>
  );
}

function LoginScreen({ loginName, setLoginName, selectedDemoRole, setSelectedDemoRole, password, setPassword, login, busy, error }: {
  loginName: string;
  setLoginName: (name: string) => void;
  selectedDemoRole: Role | '';
  setSelectedDemoRole: (role: Role | '') => void;
  password: string;
  setPassword: (value: string) => void;
  login: (event: React.FormEvent) => void;
  busy: boolean;
  error: string;
}) {
  return (
    <div className="auth-screen">
      <a className="auth-school-logo" href="#" aria-label="OLPC-SMI">
        <SchoolMark size="large" />
      </a>
      <div className="auth-card">
        <div className="auth-intro">
          <span className="auth-kicker">OLPC-SMI · SAN MANUEL, ISABELA</span>
          <h1>Online Teachers<br />Evaluation System</h1>
          <TeacherIllustration />
        </div>

        <form className="auth-form" onSubmit={login}>
          <h2>Login</h2>
          <p>{localDemoLogin ? 'Choose a role to continue.' : 'Sign in with your school account.'}</p>
          <div className="auth-status-row">
            <span className="status-pill"><ShieldCheck size={13} /> Secure portal</span>
          </div>

          {localDemoLogin && (
            <div className="role-grid" aria-label="Choose your role">
              {(Object.entries(roles) as [Role, { label: string }][]).map(([role, details]) => {
                const Icon = role === 'server' ? ShieldCheck : role === 'client' ? BookOpen : BarChart3;
                return (
                  <button
                    className={`role-button ${selectedDemoRole === role ? 'selected' : ''}`}
                    type="button"
                    key={role}
                    aria-pressed={selectedDemoRole === role}
                    onClick={() => setSelectedDemoRole(role)}
                  >
                    <Icon size={16} /> {details.label}
                  </button>
                );
              })}
            </div>
          )}
          <label>{localDemoLogin ? 'Username' : 'Username or school ID'}
            <input
              autoComplete="username"
              required
              maxLength={120}
              value={loginName}
              onChange={(event) => {
                setLoginName(event.target.value);
                if (localDemoLogin) setSelectedDemoRole('');
              }}
              placeholder={localDemoLogin ? 'Enter username' : 'Account username'}
            />
          </label>
          <label>Password
            <input autoComplete="current-password" required type="password" minLength={localDemoLogin ? undefined : 12} value={password} onChange={(event) => setPassword(event.target.value)} placeholder={localDemoLogin ? 'Enter any password' : 'Enter your password'} />
          </label>
          {error && <div className="auth-error" role="alert">{error}</div>}
          <button className="primary full" disabled={busy}>
            <LogIn size={16} /> {busy ? 'Signing in…' : 'Sign in'}
          </button>
          <small className="auth-help">{localDemoLogin ? 'Choose Admin, Student, or Dean and enter any password. Password is not checked or saved.' : 'Your role and dashboard are determined automatically from your account.'}</small>
        </form>
      </div>
    </div>
  );
}

function Steps({ current, labels }: { current: number; labels: string[] }) {
  return (
    <div className="stepper">
      {labels.map((label, index) => (
        <span className="step-wrap" key={label}>
          <span className={`step ${current > index + 1 ? 'done' : ''} ${current === index + 1 ? 'current' : ''}`}>
            <span>{current > index + 1 ? <Check size={14} /> : index + 1}</span>
            {label}
          </span>
          {index < labels.length - 1 && <i className="step-bar" />}
        </span>
      ))}
    </div>
  );
}

function getScaleForQuestion(questionId: number) {
  if (questionId === 28) return agreeScale;
  if (questionId === 29) return yesNoScale;
  return standardScale;
}

function ClientFlow({ step, setStep, form, setForm, submit, catalog, submissions }: {
  step: number;
  setStep: (step: number) => void;
  form: { teacher: string; subject: string; periodId: string; ratings: Record<string, number | string> };
  setForm: (form: any) => void;
  submit: (event: React.FormEvent) => void;
  catalog: Catalog;
  submissions: { teacher: string; subject: string; period: string; created_at: string }[];
}) {
  const openPeriods = catalog.periods.filter((period) => (
    period.status === 'open' && Date.parse(period.starts_at) <= Date.now() && Date.parse(period.ends_at) >= Date.now()
  ));
  const availableAssignments = catalog.assignments.filter((assignment) => (
    assignment.teacher === form.teacher
    && !submissions.some((submission) => (
      submission.teacher === assignment.teacher
      && submission.subject === assignment.subject
      && submission.period === openPeriods.find((period => String(period.id) === form.periodId))?.name
    ))
  ));
  const updateQuestion = (questionId: string, value: number | string) => {
    setForm({
      ...form,
      ratings: {
        ...form.ratings,
        [questionId]: value,
      },
    });
  };

  return (
    <main className="flow-content">
      <span className="flow-kicker">CLIENT / STUDENT PORTAL</span>
      <h1>Student/Teacher Evaluation Questionnaires</h1>
      <p>Answer each item honestly. Each teacher receives one evaluation per student.</p>
      <Steps current={step} labels={['Login', 'Instructions', 'Evaluate', 'Submit']} />

      {step === 1 && (
        <div className="flow-card instruction-card">
          <h2>Instructions before you start</h2>
          <ol>
            <li>Choose an active evaluation period, teacher, and subject assigned to you.</li>
            <li>Rate each item using the scale provided for that question.</li>
            <li>For numbers 1 to 27, use the rating scale from Always to Never.</li>
            <li>For number 28, use the Strongly Agree to Strongly Disagree scale.</li>
            <li>For number 29, choose Yes or No.</li>
            <li>Submit only once for each teacher.</li>
          </ol>
          <button className="primary" onClick={() => setStep(2)}>I understand <Check size={16} /></button>
        </div>
      )}

      {step === 2 && (
        <div className="flow-card response-form">
          <h2>Student / Teacher Evaluation Form</h2>
          <form onSubmit={submit}>
            <div className="teacher-header">
              <label>Evaluation period
                <select required value={form.periodId} onChange={(event) => setForm({ ...form, periodId: event.target.value, subject: '' })}>
                  <option value="">Select open evaluation period</option>
                  {openPeriods.map((period) => (
                    <option key={period.id} value={period.id}>{period.name} · {period.semester} {period.academic_year}</option>
                  ))}
                </select>
              </label>
              <label>Teacher / Instructor
                <select required value={form.teacher} onChange={(event) => setForm({ ...form, teacher: event.target.value })}>
                  <option value="">Select teacher</option>
                  {catalog.teachers.map((teacher) => (
                    <option key={teacher.id} value={teacher.name}>{teacher.name}</option>
                  ))}
                </select>
              </label>
              <label>Subject
                <select required value={form.subject} onChange={(event) => setForm({ ...form, subject: event.target.value })}>
                  <option value="">Select subject</option>
                  {availableAssignments.map((assignment) => (
                    <option key={`${assignment.teacher}-${assignment.subject}`} value={assignment.subject}>{assignment.subject}</option>
                  ))}
                </select>
              </label>
            </div>
            {openPeriods.length === 0 && <div className="empty-state" role="status">There is no open evaluation period right now. Please contact the Dean or Administrator.</div>}
            {form.periodId && availableAssignments.length === 0 && <div className="empty-state" role="status">You have already submitted for this teacher, subject, and period, or there is no active assignment.</div>}

            <div className="question-list">
              {QUESTION_DATA.map((question) => {
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
                          <label key={`${question.id}-${option.value}`} className={`option-box ${isChecked ? 'selected' : ''}`}>
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
            </div>

            <div className="flow-act">
              <button type="button" className="secondary" onClick={() => setStep(1)}>Back</button>
              <button type="submit" className="primary" disabled={!form.teacher || !form.subject || !form.periodId}>Submit Evaluation</button>
            </div>
          </form>
        </div>
      )}

      {step === 3 && (
        <div className="flow-card success-card">
          <h2><Check size={19} /> Evaluation submitted</h2>
          <p>Thank you for your honest feedback. Your response has been recorded successfully.</p>
          <button className="primary" onClick={() => setStep(2)}>Submit another evaluation</button>
        </div>
      )}
    </main>
  );
}

function filteredRows(responses: SurveyResponse[], filters: { teacher: string; department: string; subject: string; semester: string; period: string; search: string }) {
  const term = filters.search.trim().toLowerCase();
  return responses.filter((item) => (
    (!filters.teacher || item.teacher === filters.teacher)
    && (!filters.department || item.department === filters.department)
    && (!filters.subject || item.subject === filters.subject)
    && (!filters.semester || item.semester === filters.semester)
    && (!filters.period || item.period === filters.period)
    && (!term || `${item.teacher} ${item.subject} ${item.department} ${item.period}`.toLowerCase().includes(term))
  ));
}

function saveCsv(responses: SurveyResponse[], criteria: Criterion[]) {
  const headers = ['Teacher', 'Department', 'Subject', 'Semester', 'Academic year', 'Evaluation period', 'Anonymous responses', 'Average rating', ...criteria.map((criterion) => criterion.name)];
  const quote = (value: string | number) => `"${String(value).replace(/"/g, '""')}"`;
  const lines = responses.map((row) => {
    const categoryValues = criteria.map((criterion) => {
      const scores = criterion.questionIds.map((id) => row.perQuestion[String(id)]).filter((score) => Number.isFinite(score));
      return scores.length ? (scores.reduce((total, score) => total + score, 0) / scores.length).toFixed(2) : '';
    });
    return [
      row.teacher, row.department, row.subject, row.semester, row.academicYear, row.period, row.responses, row.mean.toFixed(2), ...categoryValues,
    ].map(quote).join(',');
  });
  const content = `\uFEFF${[headers.map(quote).join(','), ...lines].join('\r\n')}`;
  const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'olpcsmi-evaluation-report.csv';
  anchor.click();
  URL.revokeObjectURL(url);
}

function ReportTable({ rows, criteria }: { rows: SurveyResponse[]; criteria: Criterion[] }) {
  if (!rows.length) return <div className="empty-state">No evaluation results match these filters.</div>;
  return (
    <div className="table-wrap report-table">
      <table>
        <thead><tr><th>TEACHER</th><th>DEPARTMENT</th><th>SUBJECT</th><th>SEMESTER / PERIOD</th><th>RESPONSES</th><th>MEAN</th></tr></thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.teacher}-${row.subject}-${row.period}`}>
              <td><strong>{row.teacher}</strong></td>
              <td>{row.department || '—'}</td>
              <td>{row.subject}</td>
              <td>{row.semester || row.period}{row.academicYear ? ` · ${row.academicYear}` : ''}</td>
              <td>{row.responses}</td>
              <td><span className="report-score">{row.mean.toFixed(2)}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ReportCharts({ rows, criteria }: { rows: SurveyResponse[]; criteria: Criterion[] }) {
  const teacherTotals = new Map<string, { total: number; count: number }>();
  rows.forEach((row) => {
    const current = teacherTotals.get(row.teacher) ?? { total: 0, count: 0 };
    current.total += row.mean * row.responses;
    current.count += row.responses;
    teacherTotals.set(row.teacher, current);
  });
  const teacherMetrics = [...teacherTotals.entries()].map(([teacher, score]) => ({
    label: teacher,
    value: score.count ? score.total / score.count : 0,
    detail: `${score.count} response(s)`,
  })).sort((first, second) => second.value - first.value);
  const criterionMetrics = criteria.map((criterion) => {
    const scoredRows = rows.flatMap((row) => criterion.questionIds
      .map((id) => row.perQuestion[String(id)])
      .filter((score) => Number.isFinite(score))
      .map((score) => ({ score, responses: row.responses })));
    const count = scoredRows.reduce((total, item) => total + item.responses, 0);
    const total = scoredRows.reduce((sum, item) => sum + item.score * item.responses, 0);
    return { label: criterion.name, value: count ? total / count : 0, detail: `${criterion.questionIds.length} questionnaire item(s)` };
  });
  return (
    <section className="chart-grid" aria-label="Evaluation charts">
      <div className="chart-card">
        <h3><BarChart3 size={17} /> Teacher averages</h3>
        {teacherMetrics.length ? teacherMetrics.slice(0, 8).map((metric) => (
          <div className="bar-row" key={metric.label}>
            <div><span>{metric.label}</span><strong>{metric.value.toFixed(2)}</strong></div>
            <i><b style={{ width: `${Math.max(0, Math.min(100, metric.value / 5 * 100))}%` }} /></i>
            <small>{metric.detail}</small>
          </div>
        )) : <div className="chart-empty">Evaluation data will appear here when submitted.</div>}
      </div>
      <div className="chart-card">
        <h3><ClipboardCheck size={17} /> Criteria averages</h3>
        {criterionMetrics.map((metric) => (
          <div className="bar-row" key={metric.label}>
            <div><span>{metric.label}</span><strong>{metric.value.toFixed(2)}</strong></div>
            <i><b style={{ width: `${Math.max(0, Math.min(100, metric.value / 5 * 100))}%` }} /></i>
            <small>{metric.detail}</small>
          </div>
        ))}
      </div>
    </section>
  );
}

type ApiRequest = (path: string, options?: RequestInit) => Promise<any>;

function AdminFlow({ role, department, responses, catalog, apiRequest, refreshCatalog, flash }: { role: 'server' | 'dean'; department: string; responses: SurveyResponse[]; catalog: Catalog; apiRequest: ApiRequest; refreshCatalog: () => Promise<void>; flash: (message: string) => void }) {
  const [activePanel, setActivePanel] = useState<'dashboard' | 'accounts' | 'catalog' | 'periods' | 'criteria'>('dashboard');
  const [filters, setFilters] = useState({ teacher: '', department: '', subject: '', semester: '', period: '', search: '' });
  const [accounts, setAccounts] = useState<{ id: number; username: string; role: Role; display_name: string; department: string; active: number }[]>([]);
  const [accountSearch, setAccountSearch] = useState('');
  const [criteria, setCriteria] = useState<Criterion[]>(DEFAULT_CRITERIA);
  const [criteriaText, setCriteriaText] = useState(JSON.stringify(DEFAULT_CRITERIA, null, 2));
  const [loading, setLoading] = useState(false);
  const [accountForm, setAccountForm] = useState({ username: '', password: '', displayName: '', role: 'client' as Role, department: '' });
  const [subjectForm, setSubjectForm] = useState({ name: '', department: '', teacher: '' });
  const [periodForm, setPeriodForm] = useState({ name: '', semester: '1st Semester', academicYear: '', startsAt: '', endsAt: '' });
  const filtered = useMemo(() => filteredRows(responses, filters), [responses, filters]);
  const filteredAccounts = useMemo(() => {
    const query = accountSearch.trim().toLocaleLowerCase();
    if (!query) return accounts;
    return accounts.filter((account) => (
      [account.display_name, account.username, account.department, roles[account.role].label]
        .some((value) => value.toLocaleLowerCase().includes(query))
    ));
  }, [accounts, accountSearch]);
  const totalResponses = filtered.reduce((total, item) => total + item.responses, 0);
  const overallMean = totalResponses
    ? filtered.reduce((total, item) => total + item.mean * item.responses, 0) / totalResponses
    : 0;
  const reportDepartments = role === 'server' ? DEPARTMENTS : department ? [department] : [];

  const refreshAccounts = async () => {
    setAccounts(await apiRequest('/admin/users'));
  };
  const refreshCriteria = async () => {
    const result = await apiRequest('/settings/criteria') as { criteria: Criterion[] };
    const nextCriteria = result.criteria?.length ? result.criteria : DEFAULT_CRITERIA;
    setCriteria(nextCriteria);
    setCriteriaText(JSON.stringify(nextCriteria, null, 2));
  };

  useEffect(() => {
    const loadSettings = role === 'server'
      ? Promise.all([refreshAccounts(), refreshCriteria()])
      : refreshCriteria();
    void loadSettings.catch((error: unknown) => {
      flash(error instanceof Error ? error.message : 'Unable to load administrator settings.');
    });
  }, [role]);

  const runAction = async (operation: () => Promise<void>, successMessage: string) => {
    setLoading(true);
    try {
      await operation();
      flash(successMessage);
    } catch (error) {
      flash(error instanceof Error ? error.message : 'The request could not be completed.');
    } finally {
      setLoading(false);
    }
  };

  const createAccount = (event: React.FormEvent) => {
    event.preventDefault();
    const username = accountForm.username.trim();
    const displayName = accountForm.displayName.trim();
    const password = accountForm.password.trim();

    if (!username || username.length < 3) {
      flash('Use a valid username with at least 3 characters.');
      return;
    }

    if (!displayName || displayName.length < 2) {
      flash('Provide the account holder\'s full name.');
      return;
    }

    if (!password || password.length < 12) {
      flash('Temporary password must be at least 12 characters long.');
      return;
    }

    void runAction(async () => {
      await apiRequest('/admin/users', { method: 'POST', body: JSON.stringify({ ...accountForm, username, displayName, password }) });
      await refreshAccounts();
      setAccountForm({ username: '', password: '', displayName: '', role: 'client', department: '' });
    }, 'Account created.');
  };

  const createSubject = (event: React.FormEvent) => {
    event.preventDefault();
    const name = subjectForm.name.trim();
    const teacher = subjectForm.teacher.trim();

    if (!name || name.length < 2) {
      flash('Subject name is required.');
      return;
    }

    if (!teacher) {
      flash('Select the teacher assigned to this subject.');
      return;
    }

    void runAction(async () => {
      await apiRequest('/admin/subjects', { method: 'POST', body: JSON.stringify({ ...subjectForm, name, teacher }) });
      setSubjectForm({ name: '', department: '', teacher: '' });
      await refreshCatalog();
    }, 'Subject assignment created.');
  };

  const createPeriod = (event: React.FormEvent) => {
    event.preventDefault();
    const name = periodForm.name.trim();
    const academicYear = periodForm.academicYear.trim();
    const startsAt = new Date(periodForm.startsAt);
    const endsAt = new Date(periodForm.endsAt);

    if (!name || name.length < 3) {
      flash('Enter a valid evaluation period name.');
      return;
    }

    if (!academicYear) {
      flash('Academic year is required for the evaluation period.');
      return;
    }

    if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) {
      flash('Complete both start and end dates.');
      return;
    }

    if (startsAt >= endsAt) {
      flash('The period end date must be later than the start date.');
      return;
    }

    void runAction(async () => {
      await apiRequest('/admin/periods', {
        method: 'POST',
        body: JSON.stringify({ ...periodForm, name, academicYear, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() }),
      });
      setPeriodForm({ name: '', semester: '1st Semester', academicYear: '', startsAt: '', endsAt: '' });
      await refreshCatalog();
    }, 'Evaluation period created. Open it when it is ready for students.');
  };

  const togglePeriod = (period: Catalog['periods'][number]) => {
    void runAction(async () => {
      await apiRequest(`/admin/periods/${period.id}`, { method: 'PATCH', body: JSON.stringify({ status: period.status === 'open' ? 'closed' : 'open' }) });
      await refreshCatalog();
    }, `Evaluation period ${period.status === 'open' ? 'closed' : 'opened'}.`);
  };

  const toggleAccount = (account: typeof accounts[number]) => {
    void runAction(async () => {
      await apiRequest(`/admin/users/${account.id}`, { method: 'PATCH', body: JSON.stringify({ active: !account.active }) });
      await refreshAccounts();
    }, `Account ${account.active ? 'disabled' : 'enabled'}.`);
  };

  const saveCriteria = (event: React.FormEvent) => {
    event.preventDefault();
    void runAction(async () => {
      const parsed = JSON.parse(criteriaText) as Criterion[];
      const result = await apiRequest('/admin/settings/criteria', { method: 'PUT', body: JSON.stringify({ criteria: parsed }) }) as { criteria: Criterion[] };
      const nextCriteria = result.criteria?.length ? result.criteria : DEFAULT_CRITERIA;
      setCriteria(nextCriteria);
      setCriteriaText(JSON.stringify(nextCriteria, null, 2));
    }, 'Evaluation criteria saved. The 29 question statements are unchanged.');
  };

  const allNav = [
    { id: 'dashboard', label: 'Dashboard', icon: BarChart3 },
    { id: 'accounts', label: 'Accounts', icon: Users },
    { id: 'catalog', label: 'Teachers & subjects', icon: BookOpen },
    { id: 'periods', label: 'Evaluation periods', icon: CalendarDays },
    { id: 'criteria', label: 'Criteria & settings', icon: ClipboardCheck },
  ] as const;
  const nav = role === 'server' ? allNav : allNav.filter(({ id }) => id === 'dashboard');

  return (
    <div className="workspace-layout">
      <aside className="workspace-nav">
        <p>WORKSPACE</p>
        {nav.map(({ id, label, icon: Icon }) => (
          <button key={id} className={activePanel === id ? 'active' : ''} onClick={() => setActivePanel(id)}>
            <Icon size={17} /> {label}
          </button>
        ))}
      </aside>
      <main className="flow-content dashboard-content">
        <span className="flow-kicker">{role === 'server' ? 'ADMINISTRATOR PORTAL' : 'DEAN PORTAL'}</span>
        <div className="dashboard-title">
          <div><h1>{nav.find((item) => item.id === activePanel)?.label}</h1><p>{role === 'server' ? 'Manage school accounts and evaluation operations, and review anonymous results.' : 'Review anonymous evaluation results for your department.'}</p></div>
          {activePanel === 'dashboard' && <div className="export-actions"><button className="secondary" onClick={() => saveCsv(filtered, criteria)}><Download size={16} /> Export Excel / CSV</button><button className="primary" onClick={() => window.print()}><Printer size={16} /> Save as PDF</button></div>}
        </div>

        {activePanel === 'dashboard' && (
          <>
            {role === 'dean' && !department && <div className="empty-state" role="status">Your Dean account has no department assigned. Ask an Admin to assign your department before viewing reports.</div>}
            <div className="summary-cards">
              <div><span>Anonymous responses</span><strong>{totalResponses}</strong><small>Across current filters</small></div>
              <div><span>Teachers evaluated</span><strong>{new Set(filtered.map((item) => item.teacher)).size}</strong><small>In selected report</small></div>
              <div><span>Average rating</span><strong>{overallMean.toFixed(2)}<small> / 5</small></strong><small>Weighted by responses</small></div>
              <div><span>Open periods</span><strong>{catalog.periods.filter((period) => period.status === 'open').length}</strong><small>Managed by school staff</small></div>
            </div>
            <section className="flow-card dashboard-panel">
              <div className="panel-heading"><div><h2><Search size={18} /> Filter reports</h2><p>Only aggregate evaluation results are displayed; student identities are never included.</p></div><span className="secure-label"><ShieldCheck size={15} /> Anonymous</span></div>
              <div className="report-filters">
                <label>Search<input value={filters.search} placeholder="Teacher, subject or department" onChange={(event) => setFilters({ ...filters, search: event.target.value })} /></label>
                <label>Teacher<select value={filters.teacher} onChange={(event) => setFilters({ ...filters, teacher: event.target.value })}><option value="">All teachers</option>{catalog.teachers.map((teacher) => <option key={teacher.id}>{teacher.name}</option>)}</select></label>
                <label>Department<select value={filters.department} onChange={(event) => setFilters({ ...filters, department: event.target.value })}><option value="">All departments</option>{reportDepartments.map((item) => <option key={item}>{item}</option>)}</select></label>
                <label>Subject<select value={filters.subject} onChange={(event) => setFilters({ ...filters, subject: event.target.value })}><option value="">All subjects</option>{catalog.subjects.map((subject) => <option key={subject.id}>{subject.name}</option>)}</select></label>
                <label>Semester<select value={filters.semester} onChange={(event) => setFilters({ ...filters, semester: event.target.value })}><option value="">All semesters</option>{SEMESTERS.map((semester) => <option key={semester}>{semester}</option>)}</select></label>
                <label>Evaluation period<select value={filters.period} onChange={(event) => setFilters({ ...filters, period: event.target.value })}><option value="">All periods</option>{catalog.periods.map((period) => <option key={period.id}>{period.name}</option>)}</select></label>
              </div>
              <ReportCharts rows={filtered} criteria={criteria} />
            </section>
            <section className="flow-card dashboard-panel"><div className="panel-heading"><div><h2><FileText size={18} /> Evaluation summary</h2><p>{filtered.length} teacher, subject, and period result(s)</p></div></div><ReportTable rows={filtered} criteria={criteria} /></section>
          </>
        )}

        {role === 'server' && activePanel === 'accounts' && (
          <div className="management-grid">
            <section className="flow-card dashboard-panel">
              <h2><Users size={18} /> Create account</h2>
              <p>Use a unique school username and issue a strong temporary password to the account holder.</p>
              <form className="management-form" onSubmit={createAccount}>
                <label>Username<input required minLength={3} maxLength={64} pattern="[a-zA-Z0-9._-]+" value={accountForm.username} onChange={(event) => setAccountForm({ ...accountForm, username: event.target.value })} /></label>
                <label>Temporary password<input required minLength={12} maxLength={256} type="password" autoComplete="new-password" value={accountForm.password} onChange={(event) => setAccountForm({ ...accountForm, password: event.target.value })} /></label>
                <label>Full name<input required minLength={2} maxLength={120} value={accountForm.displayName} onChange={(event) => setAccountForm({ ...accountForm, displayName: event.target.value })} /></label>
                <label>Role<select value={accountForm.role} onChange={(event) => setAccountForm({ ...accountForm, role: event.target.value as Role })}>{roles && Object.entries(roles).map(([key, item]) => <option key={key} value={key}>{item.label}</option>)}</select></label>
                <label>Department<select required={accountForm.role === 'dean'} value={accountForm.department} onChange={(event) => setAccountForm({ ...accountForm, department: event.target.value })}><option value="">Select department{accountForm.role === 'dean' ? '' : ' (optional)'}</option>{DEPARTMENTS.map((department) => <option key={department}>{department}</option>)}</select></label>
                <button className="primary" disabled={loading}><Users size={16} /> Create account</button>
              </form>
            </section>
            <section className="flow-card dashboard-panel">
              <div className="management-table-heading">
                <h2>School accounts</h2>
                <label className="management-search"><Search size={15} /><input value={accountSearch} onChange={(event) => setAccountSearch(event.target.value)} placeholder="Search name, username, role, department" aria-label="Search school accounts" /></label>
              </div>
              <div className="table-wrap"><table><thead><tr><th>NAME</th><th>USERNAME</th><th>ROLE</th><th>STATUS</th><th>ACTION</th></tr></thead><tbody>
                {filteredAccounts.map((account) => <tr key={account.id}><td><strong>{account.display_name}</strong><small className="cell-subtitle">{account.department || 'No department'}</small></td><td>{account.username}</td><td>{roles[account.role].label}</td><td><span className={`account-status ${account.active ? 'enabled' : 'disabled'}`}>{account.active ? 'Active' : 'Disabled'}</span></td><td><button className="row-action" onClick={() => toggleAccount(account)}>{account.active ? 'Disable' : 'Enable'}</button></td></tr>)}
                {!filteredAccounts.length && <tr><td colSpan={5}>{accounts.length ? 'No accounts match your search.' : 'No accounts found.'}</td></tr>}
              </tbody></table></div>
            </section>
          </div>
        )}

        {role === 'server' && activePanel === 'catalog' && (
          <div className="management-grid">
            <section className="flow-card dashboard-panel">
              <h2><BookOpen size={18} /> Assign subject to teacher</h2>
              <form className="management-form" onSubmit={createSubject}>
                <label>Subject name<input required minLength={2} maxLength={160} value={subjectForm.name} onChange={(event) => setSubjectForm({ ...subjectForm, name: event.target.value })} /></label>
                <label>Department<select value={subjectForm.department} onChange={(event) => setSubjectForm({ ...subjectForm, department: event.target.value })}><option value="">Select department</option>{DEPARTMENTS.map((department) => <option key={department}>{department}</option>)}</select></label>
                <label>Teacher<select required value={subjectForm.teacher} onChange={(event) => setSubjectForm({ ...subjectForm, teacher: event.target.value })}><option value="">Select teacher</option>{catalog.teachers.map((teacher) => <option key={teacher.id}>{teacher.name}</option>)}</select></label>
                <button className="primary" disabled={loading}><BookOpen size={16} /> Save subject</button>
              </form>
            </section>
            <section className="flow-card dashboard-panel">
              <h2>Teacher and subject catalog</h2>
              <div className="table-wrap"><table><thead><tr><th>TEACHER</th><th>DEPARTMENT</th><th>ASSIGNED SUBJECTS</th></tr></thead><tbody>
                {catalog.teachers.map((teacher) => {
                  const subjects = catalog.assignments.filter((assignment) => assignment.teacher === teacher.name).map((assignment) => assignment.subject);
                  return <tr key={teacher.id}><td><strong>{teacher.name}</strong></td><td>{teacher.department || '—'}</td><td>{subjects.length ? subjects.join(', ') : 'No subject assignments'}</td></tr>;
                })}
              </tbody></table></div>
            </section>
          </div>
        )}

        {role === 'server' && activePanel === 'periods' && (
          <div className="management-grid period-management-grid">
            <section className="flow-card dashboard-panel period-create-panel">
              <h2><CalendarDays size={18} /> Create evaluation period</h2>
              <p>New periods start closed. Open a period when student evaluations are ready.</p>
              <form className="management-form period-create-form" onSubmit={createPeriod}>
                <label>Period name<input required minLength={3} maxLength={120} value={periodForm.name} onChange={(event) => setPeriodForm({ ...periodForm, name: event.target.value })} placeholder="e.g. First Semester Evaluation" /></label>
                <label>Semester<select value={periodForm.semester} onChange={(event) => setPeriodForm({ ...periodForm, semester: event.target.value })}>{SEMESTERS.map((semester) => <option key={semester}>{semester}</option>)}</select></label>
                <label>Academic year<input required value={periodForm.academicYear} onChange={(event) => setPeriodForm({ ...periodForm, academicYear: event.target.value })} placeholder="2026-2027" /></label>
                <label>Starts<input required type="datetime-local" value={periodForm.startsAt} onChange={(event) => setPeriodForm({ ...periodForm, startsAt: event.target.value })} /></label>
                <label>Ends<input required type="datetime-local" value={periodForm.endsAt} onChange={(event) => setPeriodForm({ ...periodForm, endsAt: event.target.value })} /></label>
                <button className="primary" disabled={loading}><CalendarDays size={16} /> Create period</button>
              </form>
            </section>
            <section className="flow-card dashboard-panel period-list-panel">
              <h2>Evaluation periods</h2>
              <div className="table-wrap period-table-wrap"><table><thead><tr><th>PERIOD</th><th>ACADEMIC YEAR</th><th>DATES</th><th>STATUS</th><th>ACTION</th></tr></thead><tbody>
                {catalog.periods.map((period) => <tr key={period.id}><td><strong>{period.name}</strong><small className="cell-subtitle">{period.semester || 'Legacy'}</small></td><td>{period.academic_year || '—'}</td><td><span className="period-date-range"><span><small>Start</small>{new Date(period.starts_at).toLocaleDateString()}</span><span><small>End</small>{new Date(period.ends_at).toLocaleDateString()}</span></span></td><td><span className={`account-status ${period.status === 'open' ? 'enabled' : 'disabled'}`}>{period.status}</span></td><td>{period.name !== 'Legacy data' && <button className="row-action" disabled={Date.parse(period.ends_at) < Date.now() && period.status === 'closed'} onClick={() => togglePeriod(period)}>{period.status === 'open' ? 'Close' : 'Open'}</button>}</td></tr>)}
                {!catalog.periods.length && <tr><td colSpan={5}>No evaluation periods yet.</td></tr>}
              </tbody></table></div>
            </section>
          </div>
        )}

        {role === 'server' && activePanel === 'criteria' && (
          <div className="flow-card dashboard-panel criteria-settings">
            <h2><ClipboardCheck size={18} /> Evaluation criteria and settings</h2>
            <p>Change criterion names or regroup existing question numbers. The wording and order of the 29 student questions remain locked.</p>
            <form onSubmit={saveCriteria}>
              <label>Criterion groups (JSON)<textarea rows={14} spellCheck={false} value={criteriaText} onChange={(event) => setCriteriaText(event.target.value)} /></label>
              <small>Every existing question number (1–29) must be included exactly once. Invalid or incomplete criteria are rejected by the server.</small>
              <button className="primary" disabled={loading}><Check size={16} /> Save criteria settings</button>
            </form>
          </div>
        )}
      </main>
    </div>
  );
}

function TeacherFlow({ responses, teacherName }: { responses: SurveyResponse[]; teacherName: string }) {
  const totalResponses = responses.reduce((total, item) => total + item.responses, 0);
  const mean = totalResponses ? responses.reduce((total, item) => total + item.mean * item.responses, 0) / totalResponses : 0;
  return (
    <main className="flow-content dashboard-content">
      <span className="flow-kicker">TEACHER PORTAL</span>
      <div className="dashboard-title"><div><h1>My performance summary</h1><p>Anonymous aggregated student feedback. No student identifiers or individual submissions are shown.</p></div><button className="primary" onClick={() => window.print()}><Printer size={16} /> Save as PDF</button></div>
      <div className="summary-cards">
        <div><span>Overall average</span><strong>{mean.toFixed(2)}<small> / 5</small></strong><small>{teacherName}</small></div>
        <div><span>Anonymous responses</span><strong>{totalResponses}</strong><small>Across assigned subjects</small></div>
        <div><span>Subjects with feedback</span><strong>{new Set(responses.map((item) => item.subject)).size}</strong><small>Available to your account only</small></div>
      </div>
      <section className="flow-card dashboard-panel"><div className="panel-heading"><div><h2><BarChart3 size={18} /> Feedback by subject</h2><p>Results with fewer than one response show only the anonymous group average.</p></div></div><ReportCharts rows={responses} criteria={DEFAULT_CRITERIA} /><ReportTable rows={responses} criteria={DEFAULT_CRITERIA} /></section>
    </main>
  );
}

export default App;
