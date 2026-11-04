const departments = [
  "College of Accountancy",
  "College of Business Administration",
  "College of Criminology",
  "College of Hospitality Management",
  "College of Information Technology",
  "College of Teacher Education"
];

const clone = (value) => JSON.parse(JSON.stringify(value));

export function createDemoApi(questions, criteria) {
  const now = Date.now();
  const department = "College of Teacher Education";
  const courses = [
    { id: 1, courseCode: "BEED", courseName: "Bachelor of Elementary Education" },
    { id: 2, courseCode: "BSIT", courseName: "Bachelor of Science in Information Technology" }
  ];
  const teachers = [
    { id: 1, teacherCode: "T-001", name: "Ana Reyes", department },
    { id: 2, teacherCode: "T-002", name: "Marco Santos", department },
    { id: 3, teacherCode: "T-003", name: "Liza Cruz", department },
    { id: 4, teacherCode: "T-004", name: "Paolo Garcia", department: "College of Information Technology" }
  ];
  const subjects = [
    { id: 1, subjectCode: "EDU101", name: "Foundations of Education", department },
    { id: 2, subjectCode: "EDU205", name: "Assessment of Learning", department },
    { id: 3, subjectCode: "EDU210", name: "Child and Adolescent Development", department },
    { id: 4, subjectCode: "IT101", name: "Introduction to Computing", department: "College of Information Technology" }
  ];
  const assignments = [
    { id: 1, teacherId: 1, subjectId: 1, semester: "1st Semester", academicYear: "2026-2027" },
    { id: 2, teacherId: 2, subjectId: 2, semester: "1st Semester", academicYear: "2026-2027" },
    { id: 3, teacherId: 3, subjectId: 3, semester: "1st Semester", academicYear: "2026-2027" },
    { id: 4, teacherId: 4, subjectId: 4, semester: "1st Semester", academicYear: "2026-2027" }
  ];
  const evaluationPeriod = {
    id: 1,
    name: "First Semester Evaluation",
    semester: "1st Semester",
    academic_year: "2026-2027",
    starts_at: new Date(now - 7 * 86400000).toISOString(),
    ends_at: new Date(now + 30 * 86400000).toISOString(),
    status: "open"
  };
  const store = {
    teachers,
    subjects,
    assignments,
    courses,
    courseSubjects: [
      { courseId: 1, subjectId: 1 },
      { courseId: 1, subjectId: 2 },
      { courseId: 1, subjectId: 3 },
      { courseId: 2, subjectId: 4 }
    ],
    periods: [evaluationPeriod],
    accounts: [
      { id: 101, username: "dean.demo", role: "dean", display_name: "Demo Dean", department: "", active: 1, created_at: new Date(now).toISOString() },
      { id: 102, username: "student.demo", role: "student", display_name: "Demo Student", department: "", active: 1, created_at: new Date(now).toISOString(), student_number: "DEMO-1001", course_id: 1, course: courses[0].courseName, year_level: "2nd Year" }
    ],
    submissions: [
      { teacher: "Marco Santos", subject: "Assessment of Learning", periodId: 1, period: evaluationPeriod.name }
    ],
    questions: clone(questions),
    criteria: clone(criteria),
    nextIds: { teacher: 5, subject: 5, assignment: 5, course: 3, period: 2, account: 103, evaluation: 2 }
  };
  const questionScores = Object.fromEntries(Array.from({ length: 28 }, (_, index) => [String(index + 1), 4.2 + (index % 5) * 0.15]));
  const reports = [
    { teacher: "Ana Reyes", subject: "Foundations of Education", department, period: evaluationPeriod.name, semester: evaluationPeriod.semester, academicYear: evaluationPeriod.academic_year, responses: 18, mean: 4.72, perQuestion: questionScores },
    { teacher: "Marco Santos", subject: "Assessment of Learning", department, period: evaluationPeriod.name, semester: evaluationPeriod.semester, academicYear: evaluationPeriod.academic_year, responses: 16, mean: 4.58, perQuestion: questionScores },
    { teacher: "Liza Cruz", subject: "Child and Adolescent Development", department, period: evaluationPeriod.name, semester: evaluationPeriod.semester, academicYear: evaluationPeriod.academic_year, responses: 14, mean: 4.41, perQuestion: questionScores },
    { teacher: "Paolo Garcia", subject: "Introduction to Computing", department: "College of Information Technology", period: evaluationPeriod.name, semester: evaluationPeriod.semester, academicYear: evaluationPeriod.academic_year, responses: 12, mean: 4.63, perQuestion: questionScores }
  ];
  const catalogFor = (role) => {
    const assigned = store.assignments.map((item) => {
      const teacher = store.teachers.find((entry) => entry.id === item.teacherId);
      const subject = store.subjects.find((entry) => entry.id === item.subjectId);
      if (!teacher || !subject) return null;
      return {
        ...item,
        teacherCode: teacher.teacherCode,
        teacher: teacher.name,
        subjectCode: subject.subjectCode,
        subject: subject.name,
        department: teacher.department || subject.department
      };
    }).filter(Boolean);
    const student = role === "student";
    const studentSubjects = student
      ? new Set(store.courseSubjects.filter((link) => link.courseId === 1).map((link) => link.subjectId))
      : null;
    const allowedAssignments = assigned.filter((item) => !student || studentSubjects.has(item.subjectId));
    const allowedTeacherIds = new Set(allowedAssignments.map((item) => item.teacherId));
    const allowedSubjectIds = new Set(allowedAssignments.map((item) => item.subjectId));
    return {
      teachers: store.teachers.filter((item) => !student || allowedTeacherIds.has(item.id)),
      subjects: store.subjects.filter((item) => !student || allowedSubjectIds.has(item.id)),
      assignments: allowedAssignments,
      courses: role === "admin" ? store.courses : [],
      courseSubjects: role === "admin" ? store.courseSubjects : [],
      studentCourse: student ? { id: 1, code: store.courses[0]?.courseCode || "BEED", name: store.courses[0]?.courseName || "Bachelor of Elementary Education" } : null,
      periods: store.periods,
      departments
    };
  };
  const routeError = (route) => {
    throw new Error(`Demo mode does not support this request: ${route}`);
  };

  return async function demoApiRequest(path, options = {}, role) {
    const requestUrl = new URL(path, "http://demo.local");
    const route = requestUrl.pathname;
    const method = options.method || "GET";
    const body = options.body ? JSON.parse(options.body) : {};
    let match;

    if (method === "GET" && route === "/catalog") return clone(catalogFor(role));
    if (method === "GET" && route === "/settings/questions") return { questions: clone(store.questions) };
    if (method === "GET" && route === "/settings/criteria") return { criteria: clone(store.criteria) };
    if (method === "PUT" && route === "/admin/settings/questions") {
      store.questions = clone(body.questions);
      return { status: "updated", questions: clone(store.questions) };
    }
    if (method === "PUT" && route === "/admin/settings/criteria") {
      store.criteria = clone(body.criteria);
      return { status: "updated", criteria: clone(store.criteria) };
    }
    if (method === "GET" && route === "/reports") {
      const filters = requestUrl.searchParams;
      return clone(reports.filter((row) =>
        (!filters.get("teacher") || row.teacher === filters.get("teacher")) &&
        (!filters.get("department") || row.department === filters.get("department")) &&
        (!filters.get("subject") || row.subject === filters.get("subject")) &&
        (!filters.get("period") || row.period === filters.get("period")) &&
        (!filters.get("semester") || row.semester === filters.get("semester")) &&
        (!filters.get("academicYear") || row.academicYear === filters.get("academicYear"))
      ));
    }
    if (method === "GET" && route === "/reports/filters") {
      const rows = reports;
      return Object.fromEntries(["teacher", "subject", "department", "period", "semester", "academicYear"].map((key) => [
        key,
        [...new Set(rows.map((row) => row[key]).filter(Boolean))].sort()
      ]));
    }
    if (method === "POST" && route === "/reports/submit") {
      return { status: "submitted", submitted_at: new Date().toISOString(), reports: clone(reports), submitted_by: "Demo user" };
    }
    if (method === "GET" && route === "/my-submissions") return clone(store.submissions);
    if (method === "POST" && route === "/responses") {
      const period = store.periods.find((item) => item.id === Number(body.periodId));
      if (!period) throw new Error("Choose a sample evaluation period.");
      if (store.submissions.some((item) => item.teacher === body.teacher && item.periodId === period.id)) {
        throw new Error("You have already evaluated this teacher for this period.");
      }
      store.submissions.push({ teacher: body.teacher, subject: body.subject, period: period.name, periodId: period.id });
      const teacher = store.teachers.find((item) => item.name === body.teacher);
      const report = reports.find((item) =>
        item.teacher === body.teacher && item.subject === body.subject &&
        item.period === period.name && item.department === teacher?.department
      );
      const submittedScores = Object.fromEntries(Object.entries(body.ratings || {})
        .filter(([id, value]) => Number(id) <= 28 && Number.isFinite(Number(value)))
        .map(([id, value]) => [id, Number(value)]));
      const scores = Object.values(submittedScores);
      const submittedMean = scores.length ? scores.reduce((sum, score) => sum + score, 0) / scores.length : 0;
      if (report) {
        report.mean = Number(((report.mean * report.responses + submittedMean) / (report.responses + 1)).toFixed(2));
        report.responses += 1;
      } else {
        reports.push({
          teacher: body.teacher,
          subject: body.subject,
          department: teacher?.department || department,
          period: period.name,
          semester: period.semester,
          academicYear: period.academic_year,
          responses: 1,
          mean: Number(submittedMean.toFixed(2)),
          perQuestion: submittedScores
        });
      }
      return { status: "submitted", created_at: new Date().toISOString() };
    }
    if (method === "GET" && route === "/admin/users") return clone(store.accounts);
    if (route === "/admin/users" && method === "POST") {
      store.accounts.push({
        id: store.nextIds.account++,
        username: body.username,
        role: body.role,
        display_name: body.displayName,
        department: body.department || "",
        active: 1,
        created_at: new Date().toISOString(),
        student_number: body.studentNumber || "",
        course_id: Number(body.courseId) || null,
        course: store.courses.find((item) => item.id === Number(body.courseId))?.courseName || body.course || "",
        year_level: body.yearLevel || ""
      });
      return { status: "created" };
    }
    if ((match = route.match(/^\/admin\/users\/(\d+)$/))) {
      const account = store.accounts.find((item) => item.id === Number(match[1]));
      if (!account) throw new Error("Demo account not found.");
      if (method === "PATCH") account.active = body.active ? 1 : 0;
      else if (method === "PUT") {
        account.display_name = body.displayName;
        account.department = body.department || "";
        account.student_number = body.studentNumber || account.student_number;
        account.course_id = Number(body.courseId) || account.course_id;
        account.course = store.courses.find((item) => item.id === account.course_id)?.courseName || account.course;
        account.year_level = body.yearLevel || account.year_level;
      } else if (method === "DELETE") store.accounts = store.accounts.filter((item) => item.id !== account.id);
      else return routeError(route);
      return { status: "updated" };
    }
    if (method === "GET" && route === "/admin/evaluations") {
      return clone(reports.map((row, index) => ({
        id: index + 1,
        teacher: row.teacher,
        subject: row.subject,
        department: row.department,
        period: row.period,
        submittedAt: new Date(now - index * 3600000).toISOString()
      })));
    }
    if (route === "/admin/teachers" && method === "POST") {
      store.teachers.push({ id: store.nextIds.teacher++, ...body });
      return { status: "created" };
    }
    if ((match = route.match(/^\/admin\/teachers\/(\d+)$/))) {
      const teacher = store.teachers.find((item) => item.id === Number(match[1]));
      if (!teacher) throw new Error("Demo teacher not found.");
      if (method === "PATCH") Object.assign(teacher, body);
      else if (method === "DELETE") {
        store.teachers = store.teachers.filter((item) => item.id !== teacher.id);
        store.assignments = store.assignments.filter((item) => item.teacherId !== teacher.id);
      } else return routeError(route);
      return { status: "updated" };
    }
    if (route === "/admin/subjects" && method === "POST") {
      store.subjects.push({ id: store.nextIds.subject++, ...body });
      return { status: "created" };
    }
    if ((match = route.match(/^\/admin\/subjects\/(\d+)$/))) {
      const subject = store.subjects.find((item) => item.id === Number(match[1]));
      if (!subject) throw new Error("Demo subject not found.");
      if (method === "PUT") Object.assign(subject, body);
      else if (method === "DELETE") {
        store.subjects = store.subjects.filter((item) => item.id !== subject.id);
        store.assignments = store.assignments.filter((item) => item.subjectId !== subject.id);
        store.courseSubjects = store.courseSubjects.filter((item) => item.subjectId !== subject.id);
      } else return routeError(route);
      return { status: "updated" };
    }
    if ((match = route.match(/^\/admin\/courses(?:\/(\d+))?$/))) {
      const courseId = Number(match[1]);
      if (!courseId && method === "POST" || courseId && method === "PUT") {
        const course = courseId
          ? store.courses.find((item) => item.id === courseId)
          : { id: store.nextIds.course++ };
        if (!course) throw new Error("Demo course not found.");
        Object.assign(course, { courseCode: body.courseCode, courseName: body.courseName });
        if (!courseId) store.courses.push(course);
        store.accounts.filter((account) => account.course_id === course.id).forEach((account) => {
          account.course = course.courseName;
        });
        store.courseSubjects = store.courseSubjects.filter((item) => item.courseId !== course.id);
        body.subjectIds.forEach((subjectId) => store.courseSubjects.push({ courseId: course.id, subjectId: Number(subjectId) }));
        return { status: courseId ? "updated" : "created", id: course.id };
      }
      if (courseId && method === "DELETE") {
        store.courses = store.courses.filter((item) => item.id !== courseId);
        store.courseSubjects = store.courseSubjects.filter((item) => item.courseId !== courseId);
        store.accounts.filter((account) => account.course_id === courseId).forEach((account) => {
          account.course_id = null;
          account.course = "";
        });
        return { status: "deleted" };
      }
    }
    if (route === "/admin/assignments" && method === "POST") {
      store.assignments.push({ id: store.nextIds.assignment++, ...body });
      return { status: "created" };
    }
    if ((match = route.match(/^\/admin\/assignments\/(\d+)$/))) {
      const assignment = store.assignments.find((item) => item.id === Number(match[1]));
      if (!assignment) throw new Error("Demo assignment not found.");
      if (method === "PUT") Object.assign(assignment, body);
      else if (method === "DELETE") store.assignments = store.assignments.filter((item) => item.id !== assignment.id);
      else return routeError(route);
      return { status: method === "PUT" ? "updated" : "deleted" };
    }
    if (route === "/admin/periods" && method === "POST") {
      store.periods.push({
        id: store.nextIds.period++,
        name: body.name,
        semester: body.semester,
        academic_year: body.academicYear,
        starts_at: body.startsAt,
        ends_at: body.endsAt,
        status: "closed"
      });
      return { status: "created" };
    }
    if ((match = route.match(/^\/admin\/periods\/(\d+)$/))) {
      const period = store.periods.find((item) => item.id === Number(match[1]));
      if (!period) throw new Error("Demo evaluation period not found.");
      if (method === "PATCH") {
        if (body.name) Object.assign(period, {
          name: body.name,
          semester: body.semester,
          academic_year: body.academicYear,
          starts_at: body.startsAt,
          ends_at: body.endsAt
        });
        if (body.status) period.status = body.status;
      } else return routeError(route);
      return { status: "updated" };
    }
    return routeError(`${method} ${route}`);
  };
}
