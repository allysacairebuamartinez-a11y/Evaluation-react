-- OLPC-SMI Online Teachers Evaluation System
-- Import this file in phpMyAdmin to create a fresh database.
-- Do not run DROP DATABASE: importing must not delete existing school data.

CREATE DATABASE IF NOT EXISTS olpcsmi_evaluation_v2
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE olpcsmi_evaluation_v2;
SET NAMES utf8mb4;

-- Every account has a PHP password_hash() value, never a plain-text password.
CREATE TABLE IF NOT EXISTS users (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  username VARCHAR(64) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('admin', 'student', 'dean') NOT NULL,
  display_name VARCHAR(120) NOT NULL,
  department VARCHAR(120) NOT NULL DEFAULT '',
  active TINYINT(1) NOT NULL DEFAULT 1,
  failed_attempts INT UNSIGNED NOT NULL DEFAULT 0,
  locked_until DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_username (username)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS courses (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  course_code VARCHAR(32) NOT NULL,
  course_name VARCHAR(160) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_courses_code (course_code),
  UNIQUE KEY uq_courses_name (course_name)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS students (
  user_id INT UNSIGNED NOT NULL,
  student_number VARCHAR(64) NOT NULL,
  course VARCHAR(120) NOT NULL DEFAULT '',
  course_id INT UNSIGNED NULL,
  year_level VARCHAR(32) NOT NULL DEFAULT '',
  PRIMARY KEY (user_id),
  UNIQUE KEY uq_students_number (student_number),
  KEY idx_students_course (course_id),
  CONSTRAINT fk_students_user
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_students_course
    FOREIGN KEY (course_id) REFERENCES courses (id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS deans (
  user_id INT UNSIGNED NOT NULL,
  department VARCHAR(120) NOT NULL,
  PRIMARY KEY (user_id),
  CONSTRAINT fk_deans_user
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS teachers (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  teacher_code VARCHAR(64) NOT NULL,
  name VARCHAR(120) NOT NULL,
  department VARCHAR(120) NOT NULL DEFAULT '',
  user_id INT UNSIGNED NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_teachers_code (teacher_code),
  UNIQUE KEY uq_teachers_name (name),
  UNIQUE KEY uq_teachers_user (user_id),
  CONSTRAINT fk_teachers_user
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS subjects (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  subject_code VARCHAR(32) NOT NULL,
  name VARCHAR(160) NOT NULL,
  department VARCHAR(120) NOT NULL DEFAULT '',
  PRIMARY KEY (id),
  UNIQUE KEY uq_subjects_code (subject_code),
  UNIQUE KEY uq_subjects_name (name)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS teacher_subjects (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  teacher_id INT UNSIGNED NOT NULL,
  subject_id INT UNSIGNED NOT NULL,
  semester VARCHAR(32) NOT NULL DEFAULT '',
  academic_year VARCHAR(32) NOT NULL DEFAULT '',
  PRIMARY KEY (id),
  UNIQUE KEY uq_teacher_subject_term (teacher_id, subject_id, semester, academic_year),
  CONSTRAINT fk_teacher_subjects_teacher
    FOREIGN KEY (teacher_id) REFERENCES teachers (id) ON DELETE CASCADE,
  CONSTRAINT fk_teacher_subjects_subject
    FOREIGN KEY (subject_id) REFERENCES subjects (id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS course_subjects (
  course_id INT UNSIGNED NOT NULL,
  subject_id INT UNSIGNED NOT NULL,
  PRIMARY KEY (course_id, subject_id),
  CONSTRAINT fk_course_subjects_course
    FOREIGN KEY (course_id) REFERENCES courses (id) ON DELETE CASCADE,
  CONSTRAINT fk_course_subjects_subject
    FOREIGN KEY (subject_id) REFERENCES subjects (id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS evaluation_criteria (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(80) NOT NULL,
  sort_order TINYINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uq_evaluation_criteria_name (name)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS evaluation_periods (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(120) NOT NULL,
  semester ENUM('1st Semester', '2nd Semester', 'Summer') NOT NULL,
  academic_year VARCHAR(32) NOT NULL,
  starts_at DATETIME NOT NULL,
  ends_at DATETIME NOT NULL,
  status ENUM('open', 'closed') NOT NULL DEFAULT 'closed',
  PRIMARY KEY (id),
  UNIQUE KEY uq_evaluation_periods_name (name),
  KEY idx_evaluation_periods_dates (starts_at, ends_at)
) ENGINE=InnoDB;

-- Supporting question table used by the questionnaire and admin settings.
CREATE TABLE IF NOT EXISTS evaluation_questions (
  id TINYINT UNSIGNED NOT NULL,
  question_text TEXT NOT NULL,
  answer_type ENUM('rating', 'yesno') NOT NULL DEFAULT 'rating',
  PRIMARY KEY (id)
) ENGINE=InnoDB;

-- Each question belongs to one reporting criterion.
CREATE TABLE IF NOT EXISTS criterion_questions (
  criterion_id INT UNSIGNED NOT NULL,
  question_id TINYINT UNSIGNED NOT NULL,
  PRIMARY KEY (criterion_id, question_id),
  UNIQUE KEY uq_criterion_questions_question (question_id),
  CONSTRAINT fk_criterion_questions_criterion
    FOREIGN KEY (criterion_id) REFERENCES evaluation_criteria (id) ON DELETE CASCADE,
  CONSTRAINT fk_criterion_questions_question
    FOREIGN KEY (question_id) REFERENCES evaluation_questions (id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Evaluation records contain no student user ID. Answers link only to this
-- anonymous evaluation record; student identity is kept separately below.
CREATE TABLE IF NOT EXISTS evaluations (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  teacher_id INT UNSIGNED NULL,
  teacher_name VARCHAR(120) NOT NULL,
  subject_id INT UNSIGNED NULL,
  subject_name VARCHAR(160) NOT NULL,
  department VARCHAR(120) NOT NULL DEFAULT '',
  period_id INT UNSIGNED NULL,
  period_name VARCHAR(120) NOT NULL,
  comment VARCHAR(2000) NOT NULL DEFAULT '',
  submitted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_evaluations_teacher (teacher_name),
  KEY idx_evaluations_department (department),
  KEY idx_evaluations_period (period_name),
  CONSTRAINT fk_evaluations_teacher
    FOREIGN KEY (teacher_id) REFERENCES teachers (id) ON DELETE SET NULL,
  CONSTRAINT fk_evaluations_subject
    FOREIGN KEY (subject_id) REFERENCES subjects (id) ON DELETE SET NULL,
  CONSTRAINT fk_evaluations_period
    FOREIGN KEY (period_id) REFERENCES evaluation_periods (id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- This private eligibility record prevents a student from evaluating the same
-- teacher twice in one period. It deliberately has no evaluation_id, so it
-- cannot be joined back to an individual anonymous answer or report.
CREATE TABLE IF NOT EXISTS evaluation_duplicate_guards (
  student_user_id INT UNSIGNED NOT NULL,
  teacher_id INT UNSIGNED NOT NULL,
  subject_id INT UNSIGNED NOT NULL,
  period_id INT UNSIGNED NOT NULL,
  PRIMARY KEY (student_user_id, teacher_id, period_id),
  CONSTRAINT fk_duplicate_guards_student
    FOREIGN KEY (student_user_id) REFERENCES users (id) ON DELETE RESTRICT,
  CONSTRAINT fk_duplicate_guards_teacher
    FOREIGN KEY (teacher_id) REFERENCES teachers (id) ON DELETE CASCADE,
  CONSTRAINT fk_duplicate_guards_subject
    FOREIGN KEY (subject_id) REFERENCES subjects (id) ON DELETE CASCADE,
  CONSTRAINT fk_duplicate_guards_period
    FOREIGN KEY (period_id) REFERENCES evaluation_periods (id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS evaluation_answers (
  evaluation_id BIGINT UNSIGNED NOT NULL,
  question_id TINYINT UNSIGNED NOT NULL,
  answer_value VARCHAR(8) NOT NULL,
  PRIMARY KEY (evaluation_id, question_id),
  CONSTRAINT fk_evaluation_answers_evaluation
    FOREIGN KEY (evaluation_id) REFERENCES evaluations (id) ON DELETE CASCADE,
  CONSTRAINT fk_evaluation_answers_question
    FOREIGN KEY (question_id) REFERENCES evaluation_questions (id)
) ENGINE=InnoDB;

-- Application setting used by the PHP API.
CREATE TABLE IF NOT EXISTS system_settings (
  setting_key VARCHAR(80) NOT NULL,
  setting_value TEXT NOT NULL,
  PRIMARY KEY (setting_key)
) ENGINE=InnoDB;

-- Restored catalog records from the project's legacy school catalog.
INSERT IGNORE INTO teachers (id, teacher_code, name, department) VALUES
  (1, 'T-0001', 'Mr. Jimmy Velasco', 'College of Teacher Education'),
  (5, 'T-0005', 'Ms. Marielle Ulant', 'College of Teacher Education'),
  (6, 'T-0006', 'Mr. Kevin Lester Taguba', 'College of Teacher Education'),
  (7, 'T-0007', 'Ms. Luzviminda Ll...vore', 'College of Teacher Education'),
  (8, 'T-0008', 'Mr. Ton Ads...uara', 'College of Teacher Education'),
  (9, 'T-0009', 'Mr. Jayzert Martinez', 'College of Teacher Education'),
  (12, 'T-0012', 'Mr. Maciohn', 'College of Teacher Education'),
  (13, 'T-0013', 'Ms. Dhariebelle', 'College of Teacher Education'),
  (16, 'T-0016', 'Mr. Romeo Balingao', 'College of Teacher Education'),
  (19, 'T-0019', 'Ms. Janessa Mansibang', 'College of Teacher Education'),
  (20, 'T-0020', 'Ms. Lorraine Manuel', 'College of Teacher Education'),
  (21, 'T-0021', 'Mr. Ydia Romeo', 'College of Teacher Education'),
  (23, 'T-0023', 'Mr. Armon', 'College of Teacher Education');

INSERT IGNORE INTO subjects (id, subject_code, name, department) VALUES
  (1, 'ITCC-111-LEC', 'ITCC 111 Lec - Introduction to Computing (Lec.)', 'College of Teacher Education'),
  (2, 'STEQ', 'Student/Teacher Evaluation Questionnaires', ''),
  (4, 'ITCC-112-LEC', 'ITCC 112 Lec - Computer Programming 1 (Lec.)', 'College of Teacher Education'),
  (5, 'PCOM', 'PCOM - Purposive Communication', 'College of Teacher Education'),
  (6, 'STS', 'STS - Science Technology and Society', 'College of Teacher Education'),
  (7, 'MATH-0', 'MATH 0 - Mathematics in the Modern World', 'College of Teacher Education'),
  (8, 'THEO-1', 'THEO 1 - CHRIST: The fullness of Revelation', 'College of Teacher Education'),
  (9, 'PE-1', 'PE 1 - Physical Activities Towards Health and Fitness 1', 'College of Teacher Education'),
  (10, 'NSTP-11', 'NSTP 11 - National Service Training Program 1', 'College of Teacher Education'),
  (11, 'ITPE-213', 'ITPE 213 - Elective 2', 'College of Teacher Education'),
  (12, 'ITPC-214', 'ITPC 214 - Multimedia', 'College of Teacher Education'),
  (13, 'FIL-1', 'FIL 1 - Filipino 1', 'College of Teacher Education'),
  (14, 'ITCC-211', 'ITCC 211 - Data Structure', 'College of Teacher Education'),
  (15, 'ITPE-221', 'ITPE 221 - IT Elective 3', 'College of Teacher Education'),
  (16, 'ITPE-223', 'ITPE 223 - IT Elective 4', 'College of Teacher Education'),
  (17, 'ITPC-223', 'ITPC 223 - Networking 1', 'College of Teacher Education'),
  (18, 'ITPC-224', 'ITPC 224 - Information Management', 'College of Teacher Education'),
  (19, 'SOC-SCI-5', 'SOC SCI 5 - Life and Works of Rizal', 'College of Teacher Education'),
  (20, 'HIST-1', 'HIST 1 - Readings in Philippine History', 'College of Teacher Education'),
  (21, 'THEO-4', 'THEO 4 - Catechetics', 'College of Teacher Education'),
  (22, 'FIL-2', 'FIL 2 - Masining na Pagpapahayag', 'College of Teacher Education'),
  (23, 'PE-4', 'PE 4 - Sport', 'College of Teacher Education');

-- Teacher/subject links must be assigned in Admin with the correct semester
-- and academic year; the legacy archive stored year-level labels instead.

INSERT IGNORE INTO evaluation_periods
  (id, name, semester, academic_year, starts_at, ends_at, status) VALUES
  (1, 'Sample First Semester Evaluation', '1st Semester', '2026-2027',
   DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 DAY),
   DATE_ADD(UTC_TIMESTAMP(), INTERVAL 30 DAY), 'closed');

INSERT IGNORE INTO evaluation_criteria (id, name, sort_order) VALUES
  (1, 'Teaching effectiveness', 1),
  (2, 'Communication', 2),
  (3, 'Classroom management', 3),
  (4, 'Punctuality and grading', 4),
  (5, 'Student engagement', 5);

INSERT IGNORE INTO evaluation_questions (id, question_text, answer_type) VALUES
  (1, 'Starts the class and ends the class with prayer.', 'rating'),
  (2, 'Course objectives were explained clearly at the beginning of the course/subject.', 'rating'),
  (3, 'Gives relevant assignments and requirements to reinforce learning.', 'rating'),
  (4, 'Injects a sense of humor in his/her teaching without being vulgar.', 'rating'),
  (5, 'Has a democratic way in dealing with students'' behavior.', 'rating'),
  (6, 'Meet class regularly.', 'rating'),
  (7, 'Employs an acceptable way of handling different types of students.', 'rating'),
  (8, 'Relates subject matter to relevant topics of interest of students.', 'rating'),
  (9, 'Entertains and answers students'' questions.', 'rating'),
  (10, 'Relates subject matter to real life or practical situations.', 'rating'),
  (11, 'Explains clearly the policies pertaining to the grading system.', 'rating'),
  (12, 'Provides students opportunity to recheck their scores/ratings and verify grades.', 'rating'),
  (13, 'Gives students constructive feedbacks on their performance in class.', 'rating'),
  (14, 'Informs students of their scores/ratings and grades punctually.', 'rating'),
  (15, 'Gives quizzes, examinations, assessments and/or performance evaluation in a systematic manner.', 'rating'),
  (16, 'Engages students to get involved in interactive and independent learning.', 'rating'),
  (17, 'Shows vitality, enthusiasm and dynamism in teaching.', 'rating'),
  (18, 'Asks questions that promote critical and creative thinking.', 'rating'),
  (19, 'Manifests Pillarican spirituality through acts of humility, service and compassion.', 'rating'),
  (20, 'Makes favorable or encouraging response to students'' opinions, comments and suggestions.', 'rating'),
  (21, 'Practices a sense of propriety in speech, actions, grooming and attire.', 'rating'),
  (22, 'Acts as a witness to the Catholic faith by integrating Christian value in lessons.', 'rating'),
  (23, 'Models respect and courtesy in the online class.', 'rating'),
  (24, 'Shows concern for students.', 'rating'),
  (25, 'Uses variety of instructional strategies and resources to respond to students'' diverse needs.', 'rating'),
  (26, 'Incorporates multimedia and visual resources into online teaching.', 'rating'),
  (27, 'Understands and is responsive to students with special needs in the online classroom.', 'rating'),
  (28, 'Compared to course taught using classroom format, I found the distance education format to be equally effective.', 'rating'),
  (29, 'Would you like to be in another class of this teacher/instructor again in later school year/semester?', 'yesno');

INSERT IGNORE INTO criterion_questions (criterion_id, question_id) VALUES
  (1, 2), (1, 3), (1, 8), (1, 10), (1, 15), (1, 16), (1, 17), (1, 18), (1, 25), (1, 26),
  (2, 4), (2, 9), (2, 20),
  (3, 1), (3, 5), (3, 7), (3, 21), (3, 23),
  (4, 6), (4, 11), (4, 12), (4, 13), (4, 14),
  (5, 19), (5, 22), (5, 24), (5, 27), (5, 28), (5, 29);

INSERT IGNORE INTO system_settings (setting_key, setting_value)
VALUES ('school_name', 'OLPC-SMI Online Teachers Evaluation System');
