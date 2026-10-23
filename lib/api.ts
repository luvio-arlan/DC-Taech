export type Role = 'student' | 'teacher';

export interface User {
  id: number;
  role: Role;
  name: string;
  studentNo: string;
  mustChangePassword: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}

export interface ScoreSummary {
  day: number;
  cash: number;
  installedGpu: number;
  capacity: number;
  progress: number;
  totalRevenue: number;
  dailyProfit: number;
  won: boolean;
  lost: boolean;
}

export interface LatestSummary extends ScoreSummary {
  score: number;
  grade: string;
  updatedAt: string;
}

export interface BestSummary {
  score: number;
  grade: string;
  day: number;
  capacity: number;
  installedGpu: number;
  progress: number;
  totalRevenue: number;
  dailyProfit: number;
  won: boolean;
  lost: boolean;
  updatedAt: string;
}

export interface ProgressPayload {
  state: Record<string, unknown> | null;
  latest: LatestSummary;
  best: BestSummary;
  updatedAt: string;
}

export interface LeaderboardRow {
  rank: number;
  name: string;
  studentNo: string;
  score: number;
  grade: string;
  day: number;
  capacity: number;
  installedGpu: number;
  totalRevenue: number;
  won: boolean;
  lost: boolean;
  updatedAt: string;
  isMe: boolean;
}

export interface LeaderboardPayload {
  rows: LeaderboardRow[];
  me: LeaderboardRow | null;
  total: number;
  updatedAt: string;
}

export interface StudentRow {
  id: number;
  name: string;
  studentNo: string;
  createdAt: string;
  lastLoginAt: string | null;
  latest: LatestSummary | null;
  best: BestSummary | null;
  status: string;
}

export interface TeacherPayload {
  students: StudentRow[];
  stats: {
    total: number;
    submitted: number;
    completed: number;
    averageScore: number;
    topScore: number;
    activeThisWeek: number;
  };
  updatedAt: string;
}

export interface ScoreComponent {
  key: string;
  label: string;
  max: number;
  points: number;
  detail: string;
}

export interface SavePayload {
  latest: LatestSummary;
  best: BestSummary;
  updatedAt: string;
  components: ScoreComponent[];
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  let response: Response;
  try {
    response = await fetch(path, {...init, headers, credentials: 'same-origin'});
  } catch {
    throw new ApiError(0, '无法连接服务器，请检查网络后重试。');
  }
  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok) {
    const message =
      payload && typeof payload === 'object' && 'error' in payload && typeof payload.error === 'string'
        ? payload.error
        : `请求失败（${response.status}）`;
    throw new ApiError(response.status, message);
  }
  return payload as T;
}

export const api = {
  me: () => request<{user: User}>('/api/auth/me'),
  login: (studentNo: string, password: string) =>
    request<{user: User}>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({studentNo, password}),
    }),
  register: (name: string, studentNo: string, password: string) =>
    request<{user: User}>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({name, studentNo, password}),
    }),
  logout: () => request<{ok: true}>('/api/auth/logout', {method: 'POST'}),
  changePassword: (currentPassword: string, newPassword: string) =>
    request<{ok: true}>('/api/auth/password', {
      method: 'POST',
      body: JSON.stringify({currentPassword, newPassword}),
    }),
  getProgress: () => request<{progress: ProgressPayload | null}>('/api/progress'),
  saveProgress: (state: Record<string, unknown>) =>
    request<SavePayload>('/api/progress', {
      method: 'PUT',
      body: JSON.stringify({state}),
    }),
  leaderboard: (limit = 50) => request<LeaderboardPayload>(`/api/leaderboard?limit=${limit}`),
  teacherStudents: () => request<TeacherPayload>('/api/teacher/students'),
  resetStudent: (id: number) =>
    request<{ok: true; removed: boolean}>(`/api/teacher/students/${id}/progress`, {method: 'DELETE'}),
  exportUrl: '/api/teacher/export.csv',
};
