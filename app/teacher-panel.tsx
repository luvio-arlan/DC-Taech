'use client';
import {useCallback, useEffect, useMemo, useState} from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Download,
  KeyRound,
  LoaderCircle,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldAlert,
  Trophy,
  Users,
} from 'lucide-react';
import {ApiError, StudentRow, TeacherPayload, User, api} from '@/lib/api';

const GRADE_TONE: Record<string, string> = {S: 'gold', A: 'green', B: 'blue', C: 'muted', D: 'dim'};
type SortKey = 'score' | 'recent' | 'name' | 'day';

export default function TeacherPanel({
  user,
  notify,
  onChangePassword,
}: {
  user: User;
  notify: (message: string) => void;
  onChangePassword: () => void;
}) {
  const [data, setData] = useState<TeacherPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortKey>('score');
  const [confirmId, setConfirmId] = useState<number | null>(null);
  const [resetting, setResetting] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setData(await api.teacherStudents());
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : '教师后台加载失败。');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (confirmId === null) return;
    const timer = setTimeout(() => setConfirmId(null), 4000);
    return () => clearTimeout(timer);
  }, [confirmId]);

  const rows = useMemo(() => {
    const list = (data?.students ?? []).filter((student) => {
      const keyword = query.trim().toLowerCase();
      if (!keyword) return true;
      return student.name.toLowerCase().includes(keyword) || student.studentNo.includes(keyword);
    });
    return [...list].sort((a, b) => {
      if (sort === 'name') return a.name.localeCompare(b.name, 'zh-CN');
      if (sort === 'recent') {
        const at = a.latest ? Date.parse(a.latest.updatedAt) : 0;
        const bt = b.latest ? Date.parse(b.latest.updatedAt) : 0;
        return bt - at;
      }
      if (sort === 'day') return (b.best?.day ?? -1) - (a.best?.day ?? -1);
      return (b.best?.score ?? -1) - (a.best?.score ?? -1);
    });
  }, [data, query, sort]);

  const rankMap = useMemo(() => {
    const sorted = (data?.students ?? [])
      .filter((student) => student.best)
      .sort(
        (a, b) =>
          (b.best?.score ?? 0) - (a.best?.score ?? 0) ||
          Number(b.best?.won ?? false) - Number(a.best?.won ?? false) ||
          (a.best?.day ?? 0) - (b.best?.day ?? 0),
      );
    return new Map(sorted.map((student, index) => [student.id, index + 1]));
  }, [data]);

  const reset = async (student: StudentRow) => {
    if (confirmId !== student.id) {
      setConfirmId(student.id);
      return;
    }
    setResetting(student.id);
    try {
      await api.resetStudent(student.id);
      notify(`已重置 ${student.name}（${student.studentNo}）的云端进度。`);
      setConfirmId(null);
      await load();
    } catch (cause) {
      notify(cause instanceof ApiError ? cause.message : '重置失败，请稍后重试。');
    } finally {
      setResetting(null);
    }
  };

  const stats = data?.stats;

  return (
    <div className="teacher">
      {user.mustChangePassword && (
        <div className="teacher-banner">
          <ShieldAlert />
          <div>
            <b>教师账号仍在使用初始密码</b>
            <p>为避免学生登录教师后台，请在正式上课前修改密码。学生可以在排行榜看到班级成绩，但不能进入本页。</p>
          </div>
          <button className="secondary-button" onClick={onChangePassword}>
            <KeyRound /> 修改密码
          </button>
        </div>
      )}

      <div className="teacher-stats">
        <div className="teacher-stat">
          <Users />
          <div>
            <small>已注册学生</small>
            <b>{stats?.total ?? '—'}</b>
            <span>{stats ? `${stats.submitted} 人已上传成绩` : '正在统计'}</span>
          </div>
        </div>
        <div className="teacher-stat">
          <Trophy />
          <div>
            <small>平均分 / 最高分</small>
            <b>{stats ? `${stats.averageScore.toLocaleString('en-US')}` : '—'}</b>
            <span>{stats ? `最高 ${stats.topScore.toLocaleString('en-US')} 分` : '正在统计'}</span>
          </div>
        </div>
        <div className="teacher-stat">
          <CheckCircle2 />
          <div>
            <small>达成董事会目标</small>
            <b>{stats?.completed ?? '—'}</b>
            <span>{stats ? `本周活跃 ${stats.activeThisWeek} 人` : '正在统计'}</span>
          </div>
        </div>
      </div>

      <div className="teacher-toolbar">
        <div className="teacher-search">
          <Search />
          <input
            placeholder="搜索姓名或 6 位学号"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="搜索学生"
          />
        </div>
        <select value={sort} onChange={(event) => setSort(event.target.value as SortKey)} aria-label="排序方式">
          <option value="score">按最佳得分</option>
          <option value="day">按完成日</option>
          <option value="recent">按最近活动</option>
          <option value="name">按姓名</option>
        </select>
        <button className="secondary-button" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={loading ? 'spin' : ''} /> 刷新
        </button>
        <a className="secondary-button teacher-export" href={api.exportUrl} download>
          <Download /> 导出 CSV
        </a>
      </div>

      {error && (
        <div className="teacher-error" role="alert">
          <AlertCircle /> {error}
        </div>
      )}

      {loading && !data ? (
        <div className="teacher-loading">
          <LoaderCircle className="spin" /> 正在读取全班成绩
        </div>
      ) : rows.length ? (
        <div className="teacher-table-wrap">
          <div className="teacher-row teacher-table-head">
            <span>排名</span>
            <span>学生</span>
            <span>最佳得分</span>
            <span>等级</span>
            <span>状态</span>
            <span>最佳日 / 最近日</span>
            <span>就绪算力</span>
            <span>累计营收</span>
            <span>最近活动</span>
            <span>操作</span>
          </div>
          {rows.map((student) => {
            return (
              <div className={`teacher-row ${student.status === '已达成' ? 'done' : ''}`} key={student.id}>
                <span className="teacher-rank">{student.best ? `#${rankMap.get(student.id)}` : '—'}</span>
                <span className="teacher-who">
                  <b>{student.name}</b>
                  <small>{student.studentNo}</small>
                </span>
                <span className="teacher-score">{student.best ? student.best.score.toLocaleString('en-US') : '—'}</span>
                <span>
                  {student.best ? (
                    <em className={`grade grade-${GRADE_TONE[student.best.grade] ?? 'dim'}`}>{student.best.grade}</em>
                  ) : (
                    <span className="teacher-muted">—</span>
                  )}
                </span>
                <span>
                  <em
                    className={`ranking-status ${student.status === '已达成' ? 'won' : student.status === '现金耗尽' ? 'lost' : ''}`}
                  >
                    {student.status}
                  </em>
                </span>
                <span className="teacher-days">
                  {student.best ? `第 ${student.best.day} 天` : '—'}
                  <small>{student.latest ? `DAY ${student.latest.day}` : '尚未开始'}</small>
                </span>
                <span className="teacher-gpu">{student.best ? `${student.best.capacity.toLocaleString('en-US')} GPU` : '—'}</span>
                <span className="teacher-revenue">{student.best ? `$${Math.round(student.best.totalRevenue).toLocaleString('en-US')}` : '—'}</span>
                <span className="teacher-when">{formatWhen(student.latest?.updatedAt ?? student.createdAt)}</span>
                <span>
                  {student.latest ? (
                    <button
                      className={`teacher-reset ${confirmId === student.id ? 'confirm' : ''}`}
                      onClick={() => void reset(student)}
                      disabled={resetting === student.id}
                      title="清空该学生的云端存档与排名，方便重新开始"
                    >
                      {resetting === student.id ? <LoaderCircle className="spin" /> : <RotateCcw />}
                      {confirmId === student.id ? '再次点击确认' : '重置进度'}
                    </button>
                  ) : (
                    <span className="teacher-muted">—</span>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="teacher-empty">
          <Users />
          <h3>{query ? '没有匹配的学生' : '还没有学生注册'}</h3>
          <p>{query ? '换一个姓名或学号试试。' : '把部署地址发给学生，用姓名和 6 位学号注册后即可开始经营。'}</p>
        </div>
      )}

      <div className="note-box teacher-note">
        排名按每位学生的历史最佳成绩计算；重置进度会同时删除云端存档和排名，操作不可撤销。CSV 含完整成绩字段，可用 Excel
        打开。教师账号不参与学生排名。
      </div>
    </div>
  );
}

function formatWhen(iso?: string | null) {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}
