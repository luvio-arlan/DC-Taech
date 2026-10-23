'use client';
import {type SyntheticEvent, type ReactNode, useEffect, useState} from 'react';
import {AlertCircle, ArrowRight, Eye, EyeOff, GraduationCap, LoaderCircle, LockKeyhole, ShieldCheck, Trophy, UserRound, Users} from 'lucide-react';
import {Dialog, DialogContent, DialogDescription, DialogTitle} from '@/components/ui/dialog';
import {ApiError, User, api} from '@/lib/api';

type AuthContext = {user: User; logout: () => Promise<void>; sessionExpired: () => void; passwordChanged: () => void};

export default function AuthGate({children}: {children: (context: AuthContext) => ReactNode}) {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .me()
      .then(({user: current}) => {
        if (!cancelled) setUser(current);
      })
      .catch(() => {
        if (!cancelled) setUser(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (user === undefined) {
    return (
      <div className="auth-shell auth-loading">
        <span className="brand-mark">N</span>
        <b>正在验证登录状态</b>
        <small>连接教学服务器 · 读取课堂档案</small>
      </div>
    );
  }

  if (!user) {
    return (
      <LoginScreen
        expired={expired}
        onAuthenticated={(next) => {
          setExpired(false);
          setUser(next);
        }}
      />
    );
  }

  return (
    <>
      {children({
        user,
        logout: async () => {
          try {
            await api.logout();
          } catch {
            /* 即使网络失败也退出本地界面 */
          }
          setUser(null);
        },
        sessionExpired: () => {
          setExpired(true);
          setUser(null);
        },
        passwordChanged: () => {
          setUser((current) => (current ? {...current, mustChangePassword: false} : current));
        },
      })}
    </>
  );
}

function LoginScreen({expired, onAuthenticated}: {expired: boolean; onAuthenticated: (user: User) => void}) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [name, setName] = useState('');
  const [studentNo, setStudentNo] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const switchMode = (next: 'login' | 'register') => {
    setMode(next);
    setError('');
    setPassword('');
    setConfirm('');
  };

  const submit = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    setError('');
    if (mode === 'register') {
      if (!name.trim()) return setError('请填写真实姓名，教师会据此核对成绩。');
      if (!/^\d{8}$/.test(studentNo)) return setError('学号必须是 8 位纯数字。');
      if (password.length < 6) return setError('密码至少 6 位。');
      if (password !== confirm) return setError('两次输入的密码不一致。');
    } else if (!studentNo.trim() || !password) {
      return setError('请输入账号和密码。');
    }
    setBusy(true);
    try {
      const result =
        mode === 'login'
          ? await api.login(studentNo.trim(), password)
          : await api.register(name.trim(), studentNo.trim(), password);
      onAuthenticated(result.user);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : '登录失败，请稍后重试。');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="auth-shell">
      <div className="auth-glow" aria-hidden="true" />
      <section className="auth-story">
        <div className="auth-brand">
          <span className="brand-mark">N</span>
          <div>
            <b>
              NEXUS<span>算力纪元</span>
            </b>
            <small>DATACENTER CEO SIMULATOR · TEACHING EDITION</small>
          </div>
        </div>
        <div className="auth-copy">
          <span className="eyebrow">
            <span className="live-dot" /> 数据中心经营教学实验
          </span>
          <h1>
            从 CEO 的办公桌
            <br />
            走进 <em>算力</em> 的世界
          </h1>
          <p>采购光电存芯冷，签下算力客户，扩建机房。每一次决策都会留下经营结果，也会进入课堂排行榜。</p>
          <div className="auth-features">
            <span>
              <ShieldCheck /> 姓名 + 学号注册，密码保护
            </span>
            <span>
              <Trophy /> 教师查看全班得分与排名
            </span>
            <span>
              <Users /> 进度自动保存，换设备可继续
            </span>
          </div>
        </div>
        <div className="auth-story-foot">
          <span>北京交通大学 · 教学使用</span>
          <span>虚构公司与经营参数 · 仅用于课堂模拟</span>
        </div>
      </section>

      <section className="auth-panel">
        <div className="auth-card glass">
          <div className="auth-card-head">
            <div>
              <span className="eyebrow">STUDENT ACCESS</span>
              <h2>{mode === 'login' ? '登录课堂档案' : '注册学生账号'}</h2>
            </div>
            <span className="auth-badge">
              <GraduationCap /> 教学版
            </span>
          </div>

          <div className="auth-tabs" role="tablist" aria-label="登录或注册">
            <button
              role="tab"
              aria-selected={mode === 'login'}
              className={mode === 'login' ? 'on' : ''}
              onClick={() => switchMode('login')}
            >
              登录
            </button>
            <button
              role="tab"
              aria-selected={mode === 'register'}
              className={mode === 'register' ? 'on' : ''}
              onClick={() => switchMode('register')}
            >
              注册
            </button>
          </div>

          {expired && (
            <div className="auth-error">
              <AlertCircle />
              登录状态已过期，请重新登录；本机进度仍保存在浏览器中。
            </div>
          )}

          <form className="auth-form" onSubmit={submit}>
            {mode === 'register' && (
              <label className="auth-field">
                <span>姓名</span>
                <div className="auth-input">
                  <UserRound />
                  <input
                    name="name"
                    autoComplete="name"
                    placeholder="请输入真实姓名"
                    value={name}
                    maxLength={24}
                    onChange={(event) => setName(event.target.value)}
                  />
                </div>
              </label>
            )}

            <label className="auth-field">
              <span>学号</span>
              <div className="auth-input">
                <GraduationCap />
                <input
                  name="username"
                  autoComplete="username"
                  inputMode={mode === 'register' ? 'numeric' : 'text'}
                  placeholder={mode === 'register' ? '8 位数字学号' : '学号，或教师账号'}
                  value={studentNo}
                  maxLength={mode === 'register' ? 8 : 32}
                  onChange={(event) =>
                    setStudentNo(
                      mode === 'register'
                        ? event.target.value.replace(/\D/g, '').slice(0, 8)
                        : event.target.value.replace(/\s/g, ''),
                    )
                  }
                />
                {mode === 'register' && <small>{studentNo.length}/8</small>}
              </div>
            </label>

            <label className="auth-field">
              <span>密码</span>
              <div className="auth-input">
                <LockKeyhole />
                <input
                  name="password"
                  type={visible ? 'text' : 'password'}
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  placeholder={mode === 'register' ? '至少 6 位，建议含字母和数字' : '请输入密码'}
                  value={password}
                  maxLength={72}
                  onChange={(event) => setPassword(event.target.value)}
                />
                <button
                  type="button"
                  className="auth-eye"
                  onClick={() => setVisible(!visible)}
                  aria-label={visible ? '隐藏密码' : '显示密码'}
                >
                  {visible ? <EyeOff /> : <Eye />}
                </button>
              </div>
            </label>

            {mode === 'register' && (
              <label className="auth-field">
                <span>确认密码</span>
                <div className="auth-input">
                  <LockKeyhole />
                  <input
                    name="confirm"
                    type={visible ? 'text' : 'password'}
                    autoComplete="new-password"
                    placeholder="再次输入密码"
                    value={confirm}
                    maxLength={72}
                    onChange={(event) => setConfirm(event.target.value)}
                  />
                </div>
              </label>
            )}

            {error && (
              <div className="auth-error" role="alert">
                <AlertCircle />
                {error}
              </div>
            )}

            <button className="auth-submit" type="submit" disabled={busy}>
              {busy ? <LoaderCircle className="spin" /> : mode === 'login' ? <ArrowRight /> : <GraduationCap />}
              {busy ? '正在连接教学服务器…' : mode === 'login' ? '登录并进入园区' : '注册并开始经营'}
            </button>
          </form>

          <div className="auth-hint">
            {mode === 'login' ? (
              <p>
                首次使用？切换到 <button onClick={() => switchMode('register')}>注册</button>，用姓名和 8 位学号创建账号。
                教师账号由教务统一提供。
              </p>
            ) : (
              <p>
                学号必须是 <b>8 位纯数字</b>，姓名用于教师核对成绩。密码至少 6 位，注册后自动登录。
              </p>
            )}
            <small>登录即表示你同意将经营成绩用于本课程的教学统计。</small>
          </div>
        </div>
        <p className="auth-footnote">NEXUS · 算力纪元 · 教学部署版</p>
      </section>
    </main>
  );
}

export function PasswordDialog({
  open,
  onOpenChange,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: (message: string) => void;
}) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) {
      setCurrent('');
      setNext('');
      setConfirm('');
      setError('');
      setBusy(false);
    }
  }, [open]);

  const submit = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    setError('');
    if (next.length < 6) return setError('新密码至少 6 位。');
    if (next !== confirm) return setError('两次输入的新密码不一致。');
    setBusy(true);
    try {
      await api.changePassword(current, next);
      onDone('密码已更新，其他设备上的登录已退出。');
      onOpenChange(false);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : '修改失败，请稍后重试。');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="account-dialog">
        <div className="account-dialog-head">
          <span className="eyebrow">ACCOUNT SECURITY</span>
          <DialogTitle>修改密码</DialogTitle>
          <DialogDescription>修改后，其他浏览器上的登录会话会自动退出。</DialogDescription>
        </div>
        <form className="account-form" onSubmit={submit}>
          <label>
            <span>当前密码</span>
            <input
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={(event) => setCurrent(event.target.value)}
            />
          </label>
          <label>
            <span>新密码</span>
            <input
              type="password"
              autoComplete="new-password"
              value={next}
              onChange={(event) => setNext(event.target.value)}
            />
          </label>
          <label>
            <span>确认新密码</span>
            <input
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
            />
          </label>
          {error && (
            <p className="account-error" role="alert">
              {error}
            </p>
          )}
          <div className="account-actions">
            <button type="button" className="secondary-button" onClick={() => onOpenChange(false)}>
              取消
            </button>
            <button type="submit" className="primary-button" disabled={busy}>
              {busy ? '正在保存…' : '保存新密码'}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
