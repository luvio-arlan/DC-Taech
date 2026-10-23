import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { hashPassword } from './auth.mjs';

export const DEFAULT_TEACHER_PASSWORD = 'bjtu888';

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  role TEXT NOT NULL DEFAULT 'student' CHECK (role IN ('student', 'teacher')),
  name TEXT NOT NULL,
  student_no TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  last_login_at TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS progress (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  state_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  day INTEGER NOT NULL,
  cash REAL NOT NULL,
  gpu INTEGER NOT NULL,
  capacity INTEGER NOT NULL,
  progress REAL NOT NULL,
  total_revenue REAL NOT NULL,
  daily_profit REAL NOT NULL,
  won INTEGER NOT NULL,
  lost INTEGER NOT NULL,
  score INTEGER NOT NULL,
  grade TEXT NOT NULL,
  best_score INTEGER,
  best_grade TEXT,
  best_day INTEGER,
  best_capacity INTEGER,
  best_installed_gpu INTEGER,
  best_progress REAL,
  best_total_revenue REAL,
  best_daily_profit REAL,
  best_won INTEGER,
  best_lost INTEGER,
  best_updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_progress_best ON progress(best_score DESC);
`;

const rowToUser = (row) =>
  row
    ? {
        id: Number(row.id),
        role: row.role,
        name: row.name,
        studentNo: row.student_no,
        mustChangePassword: Number(row.must_change_password) === 1,
        createdAt: row.created_at,
        lastLoginAt: row.last_login_at ?? null,
      }
    : null;

export async function openDatabase({ file, teacherPassword = process.env.TEACHER_PASSWORD || DEFAULT_TEACHER_PASSWORD }) {
  mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(SCHEMA);
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());

  const now = new Date().toISOString();
  const teacher = db.prepare('SELECT id, role FROM users WHERE student_no = ? COLLATE NOCASE').get('jiaowen');
  let seededTeacher = false;
  if (!teacher) {
    const hash = await hashPassword(teacherPassword);
    db.prepare(
      `INSERT INTO users (role, name, student_no, password_hash, must_change_password, created_at)
       VALUES ('teacher', '教务老师', 'jiaowen', ?, ?, ?)`,
    ).run(hash, teacherPassword === DEFAULT_TEACHER_PASSWORD ? 1 : 0, now);
    seededTeacher = true;
  }

  return {
    raw: db,
    file,
    seededTeacher,
    close() {
      db.close();
    },
    getUserByStudentNo(studentNo) {
      return rowToUser(db.prepare('SELECT * FROM users WHERE student_no = ? COLLATE NOCASE').get(studentNo));
    },
    getUserById(id) {
      return rowToUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id));
    },
    getPasswordHash(id) {
      const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(id);
      return row?.password_hash ?? null;
    },
    createStudent({ name, studentNo, passwordHash }) {
      const result = db
        .prepare(
          `INSERT INTO users (role, name, student_no, password_hash, created_at)
           VALUES ('student', ?, ?, ?, ?)`,
        )
        .run(name, studentNo, passwordHash, new Date().toISOString());
      return this.getUserById(Number(result.lastInsertRowid));
    },
    touchLogin(id) {
      db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(new Date().toISOString(), id);
    },
    updatePassword(id, passwordHash) {
      db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?').run(passwordHash, id);
    },
    createSession({ tokenHash, userId, expiresAt }) {
      const now = new Date().toISOString();
      db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(
        tokenHash,
        userId,
        now,
        expiresAt,
      );
    },
    getSessionUser(tokenHash) {
      const row = db
        .prepare(
          `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
           WHERE s.token_hash = ? AND s.expires_at > ?`,
        )
        .get(tokenHash, Date.now());
      return rowToUser(row);
    },
    deleteSession(tokenHash) {
      db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
    },
    deleteOtherSessions(userId, keepTokenHash) {
      db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?').run(userId, keepTokenHash);
    },
    upsertProgress({ userId, stateJson, evaluation }) {
      const s = evaluation.summary;
      const now = new Date().toISOString();
      const nextBest = `(progress.best_score IS NULL OR excluded.score > progress.best_score)`;
      db.prepare(
        `INSERT INTO progress (
           user_id, state_json, updated_at, day, cash, gpu, capacity, progress,
           total_revenue, daily_profit, won, lost, score, grade,
           best_score, best_grade, best_day, best_capacity, best_installed_gpu, best_progress,
           best_total_revenue, best_daily_profit, best_won, best_lost, best_updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET
           state_json = excluded.state_json,
           updated_at = excluded.updated_at,
           day = excluded.day,
           cash = excluded.cash,
           gpu = excluded.gpu,
           capacity = excluded.capacity,
           progress = excluded.progress,
           total_revenue = excluded.total_revenue,
           daily_profit = excluded.daily_profit,
           won = excluded.won,
           lost = excluded.lost,
           score = excluded.score,
           grade = excluded.grade,
           best_score = CASE WHEN ${nextBest} THEN excluded.score ELSE progress.best_score END,
           best_grade = CASE WHEN ${nextBest} THEN excluded.grade ELSE progress.best_grade END,
           best_day = CASE WHEN ${nextBest} THEN excluded.day ELSE progress.best_day END,
           best_capacity = CASE WHEN ${nextBest} THEN excluded.capacity ELSE progress.best_capacity END,
           best_installed_gpu = CASE WHEN ${nextBest} THEN excluded.gpu ELSE progress.best_installed_gpu END,
           best_progress = CASE WHEN ${nextBest} THEN excluded.progress ELSE progress.best_progress END,
           best_total_revenue = CASE WHEN ${nextBest} THEN excluded.total_revenue ELSE progress.best_total_revenue END,
           best_daily_profit = CASE WHEN ${nextBest} THEN excluded.daily_profit ELSE progress.best_daily_profit END,
           best_won = CASE WHEN ${nextBest} THEN excluded.won ELSE progress.best_won END,
           best_lost = CASE WHEN ${nextBest} THEN excluded.lost ELSE progress.best_lost END,
           best_updated_at = CASE WHEN ${nextBest} THEN excluded.updated_at ELSE progress.best_updated_at END`,
      ).run(
        userId,
        stateJson,
        now,
        s.day,
        s.cash,
        s.installedGpu,
        s.capacity,
        s.progress,
        s.totalRevenue,
        s.dailyProfit,
        s.won ? 1 : 0,
        s.lost ? 1 : 0,
        evaluation.score,
        evaluation.grade,
        evaluation.score,
        evaluation.grade,
        s.day,
        s.capacity,
        s.installedGpu,
        s.progress,
        s.totalRevenue,
        s.dailyProfit,
        s.won ? 1 : 0,
        s.lost ? 1 : 0,
        now,
      );
      return this.getProgress(userId);
    },
    getProgress(userId) {
      const row = db
        .prepare(
          `SELECT p.*, u.name, u.student_no FROM progress p JOIN users u ON u.id = p.user_id WHERE p.user_id = ?`,
        )
        .get(userId);
      if (!row) return null;
      return {
        stateJson: row.state_json,
        updatedAt: row.updated_at,
        latest: {
          score: Number(row.score),
          grade: row.grade,
          day: Number(row.day),
          cash: Number(row.cash),
          installedGpu: Number(row.gpu),
          capacity: Number(row.capacity),
          progress: Number(row.progress),
          totalRevenue: Number(row.total_revenue),
          dailyProfit: Number(row.daily_profit),
          won: Number(row.won) === 1,
          lost: Number(row.lost) === 1,
        },
        best: {
          score: row.best_score === null ? null : Number(row.best_score),
          grade: row.best_grade,
          day: row.best_day === null ? null : Number(row.best_day),
          capacity: row.best_capacity === null ? null : Number(row.best_capacity),
          installedGpu: row.best_installed_gpu === null ? null : Number(row.best_installed_gpu),
          progress: row.best_progress === null ? null : Number(row.best_progress),
          totalRevenue: row.best_total_revenue === null ? null : Number(row.best_total_revenue),
          dailyProfit: row.best_daily_profit === null ? null : Number(row.best_daily_profit),
          won: row.best_won === null ? null : Number(row.best_won) === 1,
          lost: row.best_lost === null ? null : Number(row.best_lost) === 1,
          updatedAt: row.best_updated_at,
        },
      };
    },
    deleteProgress(userId) {
      return db.prepare('DELETE FROM progress WHERE user_id = ?').run(userId).changes > 0;
    },
    /** 每个学生一行；没有进度的学生会返回 null 最佳成绩，教师后台也会显示。 */
    listStudents() {
      const rows = db
        .prepare(
          `SELECT u.id, u.name, u.student_no, u.created_at, u.last_login_at,
                  p.day, p.cash, p.capacity, p.gpu, p.progress, p.total_revenue, p.daily_profit,
                  p.won, p.lost, p.score, p.grade, p.updated_at,
                  p.best_score, p.best_grade, p.best_day, p.best_capacity, p.best_installed_gpu,
                  p.best_progress, p.best_total_revenue, p.best_daily_profit, p.best_won, p.best_lost,
                  p.best_updated_at
           FROM users u LEFT JOIN progress p ON p.user_id = u.id
           WHERE u.role = 'student'
           ORDER BY p.best_score DESC NULLS LAST, u.name COLLATE NOCASE ASC`,
        )
        .all();
      return rows.map((row) => ({
        id: Number(row.id),
        name: row.name,
        studentNo: row.student_no,
        createdAt: row.created_at,
        lastLoginAt: row.last_login_at ?? null,
        latest: row.updated_at
          ? {
              day: Number(row.day),
              cash: Number(row.cash),
              capacity: Number(row.capacity),
              installedGpu: Number(row.gpu),
              progress: Number(row.progress),
              totalRevenue: Number(row.total_revenue),
              dailyProfit: Number(row.daily_profit),
              won: Number(row.won) === 1,
              lost: Number(row.lost) === 1,
              score: Number(row.score),
              grade: row.grade,
              updatedAt: row.updated_at,
            }
          : null,
        best: row.best_score === null
          ? null
          : {
              score: Number(row.best_score),
              grade: row.best_grade,
              day: Number(row.best_day),
              capacity: Number(row.best_capacity),
              installedGpu: Number(row.best_installed_gpu),
              progress: Number(row.best_progress),
              totalRevenue: Number(row.best_total_revenue),
              dailyProfit: Number(row.best_daily_profit),
              won: Number(row.best_won) === 1,
              lost: Number(row.best_lost) === 1,
              updatedAt: row.best_updated_at,
            },
      }));
    },
  };
}
