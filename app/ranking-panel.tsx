'use client';
import {useCallback, useEffect, useState} from 'react';
import {AlertCircle, Award, Crown, LoaderCircle, Medal, RefreshCw, Trophy} from 'lucide-react';
import {ApiError, LeaderboardPayload, User, api} from '@/lib/api';
import {evaluate} from '@/shared/scoring.js';
import {Game, money} from '@/lib/game';

const GRADE_TONE: Record<string, string> = {S: 'gold', A: 'green', B: 'blue', C: 'muted', D: 'dim'};

export default function RankingPanel({user, game}: {user: User; game: Game}) {
  const [data, setData] = useState<LeaderboardPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const live = evaluate(game);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setData(await api.leaderboard(50));
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : '排行榜加载失败。');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="ranking">
      <div className="ranking-hero">
        <div className="ranking-score-card">
          <span className="eyebrow">
            <span className="live-dot" /> {user.role === 'teacher' ? '教师演示成绩' : '我的当前成绩'}
          </span>
          <div className="ranking-score-main">
            <b>{live.score.toLocaleString('en-US')}</b>
            <span className={`grade grade-${GRADE_TONE[live.grade]}`}>{live.grade}</span>
          </div>
          <p>
            {user.name} · {user.role === 'teacher' ? '教师账号' : `学号 ${user.studentNo}`} · DAY{' '}
            {String(live.summary.day).padStart(2, '0')} · 就绪 {live.summary.capacity.toLocaleString('en-US')} GPU · 现金{' '}
            {money(live.summary.cash, true)}
          </p>
          <small>成绩随经营实时计算，并在约 1 秒后同步到教学服务器。排行榜取历史最佳成绩。</small>
        </div>
        <div className="ranking-breakdown">
          {live.components.map((component) => (
            <div className="ranking-part" key={component.key}>
              <div>
                <span>{component.label}</span>
                <b>
                  {component.points}
                  <em> / {component.max}</em>
                </b>
              </div>
              <div className="ranking-bar">
                <i style={{width: `${(component.points / component.max) * 100}%`}} />
              </div>
              <small>{component.detail}</small>
            </div>
          ))}
        </div>
      </div>

      <div className="ranking-head">
        <div>
          <h3>全班排行榜</h3>
          <p>{data ? `共 ${data.total} 位同学上榜 · 更新于 ${formatWhen(data.updatedAt)}` : '正在读取班级成绩…'}</p>
        </div>
        <button className="secondary-button ranking-refresh" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={loading ? 'spin' : ''} /> 刷新
        </button>
      </div>

      {error && (
        <div className="ranking-error" role="alert">
          <AlertCircle /> {error}
        </div>
      )}

      {loading && !data ? (
        <div className="ranking-loading">
          <LoaderCircle className="spin" /> 正在加载排行榜
        </div>
      ) : data && data.rows.length ? (
        <div className="ranking-table">
          <div className="ranking-row ranking-table-head">
            <span>排名</span>
            <span>同学</span>
            <span>最佳得分</span>
            <span>等级</span>
            <span>完成日</span>
            <span>就绪算力</span>
            <span>状态</span>
          </div>
          {data.rows.map((row) => (
            <div className={`ranking-row ${row.isMe ? 'me' : ''}`} key={`${row.rank}-${row.studentNo}`}>
              <span className={`ranking-no ${row.rank <= 3 ? `top-${row.rank}` : ''}`}>
                {row.rank === 1 ? <Crown /> : row.rank === 2 ? <Medal /> : row.rank === 3 ? <Award /> : row.rank}
              </span>
              <span className="ranking-who">
                <b>
                  {row.name}
                  {row.isMe && <i>我</i>}
                </b>
                <small>{row.studentNo}</small>
              </span>
              <span className="ranking-points">{row.score.toLocaleString('en-US')}</span>
              <span>
                <em className={`grade grade-${GRADE_TONE[row.grade] ?? 'dim'}`}>{row.grade}</em>
              </span>
              <span className="ranking-day">{row.won ? `第 ${row.day} 天` : `DAY ${row.day}`}</span>
              <span className="ranking-gpu">{row.capacity.toLocaleString('en-US')} GPU</span>
              <span>
                <em className={`ranking-status ${row.won ? 'won' : row.lost ? 'lost' : ''}`}>
                  {row.won ? '已达成' : row.lost ? '现金耗尽' : '经营中'}
                </em>
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div className="ranking-empty">
          <Trophy />
          <h3>排行榜还是空的</h3>
          <p>推进游戏天数后，成绩会自动上传。第一位上榜的同学就是本班的起点。</p>
        </div>
      )}

      {data?.me && data.me.rank > 50 && (
        <div className="ranking-mine">
          <span>我的排名</span>
          <b>#{data.me.rank}</b>
          <span>{data.me.score.toLocaleString('en-US')} 分</span>
        </div>
      )}

      <div className="note-box">
        评分规则：累计营收 30%、日经营现金流 20%、就绪算力 20%、建设进度 10%、现金安全 10%、董事会目标 7%、达成速度 3%，满分 10,000。
        教师可在后台查看完整明细并导出 CSV。
      </div>
    </div>
  );
}

function formatWhen(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '刚刚';
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}
