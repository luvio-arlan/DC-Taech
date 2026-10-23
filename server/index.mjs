import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createGzip } from 'node:zlib';
import { evaluate, isPlausibleState } from '../shared/scoring.js';
import {
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  clearSessionCookie,
  hashPassword,
  hashToken,
  newSessionToken,
  normalizeStudentNo,
  parseCookies,
  sessionCookie,
  validateName,
  validatePassword,
  validateStudentNo,
  verifyPassword,
} from './auth.mjs';
import { DEFAULT_TEACHER_PASSWORD, openDatabase } from './db.mjs';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT = resolve(__dirname, '..');
const MAX_BODY_BYTES = 512 * 1024;

const GAME_KEYS = [
  'version', 'day', 'cash', 'gpu', 'optical', 'power', 'storage', 'cooling', 'progress',
  'orders', 'contracts', 'ledger', 'events', 'visited', 'won', 'lost', 'lastRevenue', 'lastCost',
  'incident', 'mitigated', 'nextId', 'totalRevenue', 'totalCapex', 'forecast', 'spotLog',
  'totalLost', 'totalIdle',
];

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.srt': 'text/plain; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
};

const COMPRESSIBLE = new Set(['.html', '.js', '.mjs', '.css', '.json', '.svg', '.txt', '.srt']);

const securityHeaders = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
};

function sendJson(res, status, payload, extra = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    ...securityHeaders,
    ...extra,
  });
  res.end(body);
}

function sendText(res, status, text, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(status, {
    'Content-Type': contentType,
    'Content-Length': Buffer.byteLength(text),
    'Cache-Control': 'no-store',
    ...securityHeaders,
  });
  res.end(text);
}

function fail(res, status, message) {
  sendJson(res, status, { error: message });
}

async function readJson(req) {
  const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (type !== 'application/json') throw new HttpError(415, '请求格式必须是 application/json。');
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) throw new HttpError(413, '请求内容过大。');
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, '请求内容过大。');
    chunks.push(chunk);
  }
  if (!size) return {};
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
    return parsed;
  } catch {
    throw new HttpError(400, 'JSON 格式不正确。');
  }
}

function maskStudentNo(studentNo) {
  const value = String(studentNo ?? '');
  if (value.length <= 2) return '*'.repeat(value.length);
  if (value.length <= 3) return `${value[0]}**`;
  return `${value.slice(0, 2)}${'*'.repeat(value.length - 3)}${value.slice(-1)}`;
}

function sanitizeGameState(state) {
  const clean = {};
  for (const key of GAME_KEYS) clean[key] = state[key];
  clean.version = 1;
  clean.orders = clean.orders.slice(0, 200);
  clean.contracts = clean.contracts.slice(0, 20);
  clean.ledger = clean.ledger.slice(0, 200);
  clean.events = clean.events.slice(0, 30).map((event) => String(event).slice(0, 400));
  clean.visited = clean.visited.slice(0, 60);
  clean.spotLog = clean.spotLog.slice(-400);
  clean.forecast = clean.forecast && typeof clean.forecast === 'object' ? clean.forecast : null;
  return clean;
}

function statusOf(student) {
  if (!student.best) return '未开始';
  if (student.best.won) return '已达成';
  if (student.best.lost) return '现金耗尽';
  if (student.latest?.lost) return '现金耗尽';
  return '经营中';
}

function csvCell(value) {
  const text = String(value ?? '');
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function csv(rows) {
  return '\ufeff' + rows.map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

export async function createApp(options = {}) {
  const dataDir = resolve(options.dataDir || process.env.DATA_DIR || join(ROOT, 'data'));
  const distDir = resolve(options.distDir || process.env.DIST_DIR || join(ROOT, 'dist'));
  const trustProxy = options.trustProxy ?? process.env.TRUST_PROXY === '1';
  const allowRegistration = options.allowRegistration ?? process.env.ALLOW_REGISTRATION !== '0';
  const log = options.log ?? true;
  const db = await openDatabase({
    file: join(dataDir, 'nexus.db'),
    teacherPassword: options.teacherPassword || process.env.TEACHER_PASSWORD || DEFAULT_TEACHER_PASSWORD,
  });

  const rateBuckets = new Map();
  function rateLimit(key, limit, windowMs) {
    const now = Date.now();
    let bucket = rateBuckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      rateBuckets.set(key, bucket);
    }
    bucket.count += 1;
    if (rateBuckets.size > 5000) {
      for (const [name, value] of rateBuckets) if (value.resetAt <= now) rateBuckets.delete(name);
    }
    return bucket.count <= limit;
  }
  // 登录失败后的退避：同一 IP + 账号连续失败会短暂锁定，降低暴力猜解风险。
  const loginFailures = new Map();
  function tooManyFailures(key) {
    const entry = loginFailures.get(key);
    return entry && entry.until > Date.now();
  }
  function noteFailure(key) {
    const entry = loginFailures.get(key) || { count: 0, until: 0 };
    entry.count += 1;
    if (entry.count >= 5) {
      entry.until = Date.now() + Math.min(60_000, 2 ** (entry.count - 5) * 1000);
      entry.count = 0;
    }
    loginFailures.set(key, entry);
  }
  function clearFailures(key) {
    loginFailures.delete(key);
  }

  function clientIp(req) {
    if (trustProxy) {
      const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
      if (forwarded) return forwarded;
    }
    return req.socket?.remoteAddress || 'unknown';
  }

  function sameOrigin(req) {
    const origin = req.headers.origin;
    if (!origin) return true; // curl / 非浏览器请求；浏览器跨站请求一定带 Origin
    const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
    try {
      return new URL(origin).host === host;
    } catch {
      return false;
    }
  }

  function currentSession(req) {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    if (!token) return null;
    const tokenHash = hashToken(token);
    const user = db.getSessionUser(tokenHash);
    return user ? { user, tokenHash } : null;
  }

  function setSession(req, res, userId) {
    const token = newSessionToken();
    const tokenHash = hashToken(token);
    db.createSession({ tokenHash, userId, expiresAt: Date.now() + SESSION_TTL_SECONDS * 1000 });
    res.setHeader('Set-Cookie', sessionCookie(req, token));
    return tokenHash;
  }

  async function handleRegister(req, res) {
    if (!allowRegistration) throw new HttpError(403, '教师已关闭自助注册，请联系任课老师。');
    const ip = clientIp(req);
    if (!rateLimit(`register:${ip}`, 10, 60 * 60 * 1000)) throw new HttpError(429, '注册过于频繁，请稍后再试。');
    const body = await readJson(req);
    const name = String(body.name ?? '').trim();
    const studentNo = normalizeStudentNo(body.studentNo);
    const password = String(body.password ?? '');
    const nameError = validateName(name);
    if (nameError) throw new HttpError(400, nameError);
    const noError = validateStudentNo(studentNo);
    if (noError) throw new HttpError(400, noError);
    const passwordError = validatePassword(password);
    if (passwordError) throw new HttpError(400, passwordError);
    if (studentNo.toLowerCase() === 'jiaowen') throw new HttpError(400, '该账号为教师保留账号。');
    if (db.getUserByStudentNo(studentNo)) throw new HttpError(409, '这个学号已经注册，请直接登录。');
    const passwordHash = await hashPassword(password);
    let user;
    try {
      user = db.createStudent({ name, studentNo, passwordHash });
    } catch (error) {
      if (String(error?.message || '').includes('UNIQUE')) throw new HttpError(409, '这个学号已经注册，请直接登录。');
      throw error;
    }
    setSession(req, res, user.id);
    sendJson(res, 201, { user });
  }

  async function handleLogin(req, res) {
    const ip = clientIp(req);
    if (!rateLimit(`login:${ip}`, 30, 5 * 60 * 1000)) throw new HttpError(429, '登录尝试过于频繁，请稍后再试。');
    const body = await readJson(req);
    const studentNo = normalizeStudentNo(body.studentNo);
    const password = String(body.password ?? '');
    if (!studentNo || !password) throw new HttpError(400, '请输入账号和密码。');
    const failKey = `${ip}:${studentNo.toLowerCase()}`;
    if (tooManyFailures(failKey)) throw new HttpError(429, '密码错误次数过多，请一分钟后再试。');
    const user = db.getUserByStudentNo(studentNo);
    const valid = user ? await verifyPassword(password, db.getPasswordHash(user.id)) : false;
    if (!valid) {
      noteFailure(failKey);
      await sleep(120); // 统一失败耗时，降低账号枚举与暴力破解速度
      throw new HttpError(401, '账号或密码不正确。');
    }
    clearFailures(failKey);
    db.touchLogin(user.id);
    setSession(req, res, user.id);
    sendJson(res, 200, { user });
  }

  function handleLogout(req, res) {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    if (token) db.deleteSession(hashToken(token));
    res.setHeader('Set-Cookie', clearSessionCookie(req));
    sendJson(res, 200, { ok: true });
  }

  async function handleChangePassword(req, res, session) {
    const body = await readJson(req);
    const current = String(body.currentPassword ?? '');
    const next = String(body.newPassword ?? '');
    const passwordError = validatePassword(next);
    if (passwordError) throw new HttpError(400, passwordError);
    if (!(await verifyPassword(current, db.getPasswordHash(session.user.id)))) {
      throw new HttpError(400, '当前密码不正确。');
    }
    if (current === next) throw new HttpError(400, '新密码不能与当前密码相同。');
    db.updatePassword(session.user.id, await hashPassword(next));
    db.deleteOtherSessions(session.user.id, session.tokenHash);
    sendJson(res, 200, { ok: true });
  }

  function handleGetProgress(res, session) {
    const progress = db.getProgress(session.user.id);
    if (!progress) return sendJson(res, 200, { progress: null });
    let state = null;
    try {
      state = JSON.parse(progress.stateJson);
    } catch {
      state = null;
    }
    sendJson(res, 200, {
      progress: {
        state,
        latest: progress.latest,
        best: progress.best,
        updatedAt: progress.updatedAt,
      },
    });
  }

  async function handlePutProgress(req, res, session) {
    if (session.user.role !== 'student') throw new HttpError(403, '教师账号不参与学生排名。');
    if (!rateLimit(`progress:${session.user.id}`, 120, 60 * 1000)) {
      throw new HttpError(429, '保存过于频繁，请稍后再试。');
    }
    const body = await readJson(req);
    const state = body.state;
    if (!isPlausibleState(state)) throw new HttpError(400, '游戏进度格式不正确。');
    const clean = sanitizeGameState(state);
    const stateJson = JSON.stringify(clean);
    if (Buffer.byteLength(stateJson) > 300_000) throw new HttpError(413, '游戏进度过大。');
    const evaluation = evaluate(clean);
    const progress = db.upsertProgress({ userId: session.user.id, stateJson, evaluation });
    sendJson(res, 200, {
      latest: progress.latest,
      best: progress.best,
      updatedAt: progress.updatedAt,
      components: evaluation.components,
    });
  }

  function handleLeaderboard(req, res, session, url) {
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit')) || 50));
    const students = db.listStudents().filter((student) => student.best);
    students.sort(
      (a, b) =>
        b.best.score - a.best.score ||
        Number(b.best.won) - Number(a.best.won) ||
        a.best.day - b.best.day ||
        a.name.localeCompare(b.name, 'zh-CN'),
    );
    const ranked = students.map((student, index) => ({
      rank: index + 1,
      name: student.name,
      studentNo: maskStudentNo(student.studentNo),
      score: student.best.score,
      grade: student.best.grade,
      day: student.best.day,
      capacity: student.best.capacity,
      installedGpu: student.best.installedGpu,
      totalRevenue: student.best.totalRevenue,
      won: student.best.won,
      lost: student.best.lost,
      updatedAt: student.best.updatedAt,
      isMe: student.studentNo === session.user.studentNo,
    }));
    const me = ranked.find((row) => row.isMe) ?? null;
    sendJson(res, 200, {
      rows: ranked.slice(0, limit),
      me,
      total: ranked.length,
      updatedAt: new Date().toISOString(),
    });
  }

  function teacherStudents(res) {
    const students = db.listStudents();
    const withStatus = students.map((student) => ({ ...student, status: statusOf(student) }));
    const submitted = withStatus.filter((student) => student.best);
    const averageScore = submitted.length
      ? Math.round(submitted.reduce((sum, student) => sum + student.best.score, 0) / submitted.length)
      : 0;
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    sendJson(res, 200, {
      students: withStatus,
      stats: {
        total: withStatus.length,
        submitted: submitted.length,
        completed: submitted.filter((student) => student.best.won).length,
        averageScore,
        topScore: submitted.length ? Math.max(...submitted.map((student) => student.best.score)) : 0,
        activeThisWeek: submitted.filter((student) => Date.parse(student.latest.updatedAt) >= weekAgo).length,
      },
      updatedAt: new Date().toISOString(),
    });
  }

  function teacherCsv(res) {
    const students = db.listStudents().map((student) => ({ ...student, status: statusOf(student) }));
    const rows = [
      ['排名', '姓名', '学号', '最佳得分', '等级', '状态', '最佳运营日', '最高就绪GPU', '安装GPU', '建设进度', '累计营收USD', '日经营现金流USD', '最近运营日', '最近现金USD', '最近活动'],
    ];
    let rank = 0;
    for (const student of students) {
      if (student.best) rank += 1;
      rows.push([
        student.best ? rank : '',
        student.name,
        student.studentNo,
        student.best?.score ?? '',
        student.best?.grade ?? '',
        student.status,
        student.best?.day ?? '',
        student.best?.capacity ?? '',
        student.best?.installedGpu ?? '',
        student.best ? `${Math.round(student.best.progress)}%` : '',
        student.best ? Math.round(student.best.totalRevenue) : '',
        student.best ? Math.round(student.best.dailyProfit) : '',
        student.latest?.day ?? '',
        student.latest ? Math.round(student.latest.cash) : '',
        student.best?.updatedAt ?? '',
      ]);
    }
    const body = csv(rows);
    res.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="nexus-scores-${new Date().toISOString().slice(0, 10)}.csv"; filename*=UTF-8''${encodeURIComponent('学生成绩排名.csv')}`,
      'Content-Length': Buffer.byteLength(body),
      'Cache-Control': 'no-store',
      ...securityHeaders,
    });
    res.end(body);
  }

  function handleResetStudent(res, id) {
    if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, '学生编号不正确。');
    const student = db.getUserById(id);
    if (!student || student.role !== 'student') throw new HttpError(404, '未找到该学生。');
    const removed = db.deleteProgress(id);
    sendJson(res, 200, { ok: true, removed });
  }

  async function routeApi(req, res, url) {
    const method = req.method || 'GET';
    const path = url.pathname;
    const stateChanging = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);
    if (stateChanging && !sameOrigin(req)) throw new HttpError(403, '请求来源不受信任。');

    if (method === 'GET' && path === '/api/health') {
      return sendJson(res, 200, { ok: true, time: new Date().toISOString() });
    }
    if (method === 'POST' && path === '/api/auth/register') return handleRegister(req, res);
    if (method === 'POST' && path === '/api/auth/login') return handleLogin(req, res);
    if (method === 'POST' && path === '/api/auth/logout') return handleLogout(req, res);

    const session = currentSession(req);
    if (method === 'GET' && path === '/api/auth/me') {
      if (!session) throw new HttpError(401, '请先登录。');
      return sendJson(res, 200, { user: session.user });
    }
    if (!session) throw new HttpError(401, '请先登录。');

    if (method === 'POST' && path === '/api/auth/password') return handleChangePassword(req, res, session);
    if (method === 'GET' && path === '/api/progress') return handleGetProgress(res, session);
    if (method === 'PUT' && path === '/api/progress') return handlePutProgress(req, res, session);
    if (method === 'GET' && path === '/api/leaderboard') return handleLeaderboard(req, res, session, url);

    const resetMatch = path.match(/^\/api\/teacher\/students\/(\d+)\/progress$/);
    if (path.startsWith('/api/teacher/')) {
      if (session.user.role !== 'teacher') throw new HttpError(403, '仅教师账号可以访问。');
      if (method === 'GET' && path === '/api/teacher/students') return teacherStudents(res);
      if (method === 'GET' && path === '/api/teacher/export.csv') return teacherCsv(res);
      if (method === 'DELETE' && resetMatch) return handleResetStudent(res, Number(resetMatch[1]));
    }
    throw new HttpError(404, '接口不存在。');
  }

  async function serveStatic(req, res, url) {
    const method = req.method || 'GET';
    if (method !== 'GET' && method !== 'HEAD') return fail(res, 405, '不支持的请求方法。');
    if (!existsSync(join(distDir, 'index.html'))) {
      return sendText(
        res,
        503,
        '前端尚未构建。开发模式请运行 npm run dev；生产模式请先运行 npm run build。',
      );
    }
    let pathname;
    try {
      pathname = decodeURIComponent(url.pathname);
    } catch {
      return fail(res, 400, '路径格式不正确。');
    }
    let filePath = resolve(distDir, `.${pathname}`);
    if (filePath !== distDir && !filePath.startsWith(distDir + sep)) return fail(res, 403, '禁止访问。');
    try {
      const stats = statSync(filePath);
      if (stats.isDirectory()) filePath = join(filePath, 'index.html');
    } catch {
      // 构建产物（带扩展名的资源）缺失时返回 404，其余路径回退到单页应用入口。
      if (pathname.startsWith('/assets/') || /\.[a-z0-9]+$/i.test(pathname)) return sendText(res, 404, 'Not found');
      filePath = join(distDir, 'index.html');
    }
    let stats;
    try {
      stats = statSync(filePath);
      if (!stats.isFile()) throw new Error('not a file');
    } catch {
      return sendText(res, 404, 'Not found');
    }

    const ext = extname(filePath).toLowerCase();
    const isAsset = pathname.startsWith('/assets/');
    const headers = {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': stats.size,
      'Cache-Control': isAsset ? 'public, max-age=31536000, immutable' : 'no-cache',
      'Last-Modified': stats.mtime.toUTCString(),
      ...securityHeaders,
    };
    if (ext === '.html') headers['Content-Type'] = 'text/html; charset=utf-8';
    if (pathname === '/' || filePath === join(distDir, 'index.html')) headers['Cache-Control'] = 'no-cache';

    const acceptsGzip = /\bgzip\b/.test(String(req.headers['accept-encoding'] || ''));
    const canGzip = acceptsGzip && COMPRESSIBLE.has(ext) && stats.size > 1024;
    if (canGzip) {
      headers['Content-Encoding'] = 'gzip';
      headers['Vary'] = 'Accept-Encoding';
      delete headers['Content-Length'];
    }
    res.writeHead(200, headers);
    if (method === 'HEAD') return res.end();
    const stream = createReadStream(filePath);
    stream.on('error', () => res.destroy());
    if (canGzip) stream.pipe(createGzip()).pipe(res);
    else stream.pipe(res);
  }

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
      if (url.pathname.startsWith('/api/')) await routeApi(req, res, url);
      else await serveStatic(req, res, url);
    } catch (error) {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      if (error instanceof HttpError) return fail(res, error.status, error.message);
      if (log) console.error('[nexus] request failed:', error);
      return fail(res, 500, '服务器内部错误，请稍后再试。');
    }
  });

  server.on('clientError', (error, socket) => {
    if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
  });

  return {
    server,
    db,
    dataDir,
    distDir,
    async listen({ port = 0, host = '0.0.0.0' } = {}) {
      await new Promise((resolveListen, rejectListen) => {
        const onError = (error) => {
          server.off('listening', onListening);
          rejectListen(error);
        };
        const onListening = () => {
          server.off('error', onError);
          resolveListen();
        };
        server.once('error', onError);
        server.once('listening', onListening);
        server.listen(port, host);
      });
      return server.address();
    },
    async close() {
      await new Promise((resolveClose) => {
        server.close(resolveClose);
        server.closeAllConnections?.();
      });
      db.close();
    },
  };
}

export async function startServer(options = {}) {
  const app = await createApp(options);
  const port = Number(options.port ?? process.env.PORT ?? 8787);
  const host = options.host ?? process.env.HOST ?? '0.0.0.0';
  await app.listen({ port, host });
  return app;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const app = await startServer();
  const address = app.server.address();
  const port = typeof address === 'object' && address ? address.port : process.env.PORT;
  console.log(`NEXUS teaching server listening on http://${address?.address || '0.0.0.0'}:${port}`);
  console.log(`Database: ${join(app.dataDir, 'nexus.db')}`);
  if (app.db.seededTeacher) console.log('Seeded teacher account: jiaowen (change the default password after first login).');
  let closing = false;
  const shutdown = async (signal) => {
    if (closing) return;
    closing = true;
    console.log(`\n${signal} received, shutting down...`);
    try {
      await app.close();
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}
