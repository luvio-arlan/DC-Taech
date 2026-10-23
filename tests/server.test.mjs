import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp} from '../server/index.mjs';

async function withApp(run) {
  const dir = await mkdtemp(join(tmpdir(), 'nexus-test-'));
  const app = await createApp({
    dataDir: dir,
    distDir: join(dir, 'dist'),
    log: false,
    teacherPassword: 'bjtu888',
  });
  await app.listen({port: 0, host: '127.0.0.1'});
  const {port} = app.server.address();
  const base = `http://127.0.0.1:${port}`;
  try {
    await run({app, base});
  } finally {
    await app.close();
    await rm(dir, {recursive: true, force: true});
  }
}

async function call(base, path, {method = 'GET', body, cookie, headers = {}} = {}) {
  const response = await fetch(base + path, {
    method,
    headers: {
      ...(body ? {'Content-Type': 'application/json'} : {}),
      ...(cookie ? {Cookie: cookie} : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* CSV 等非 JSON 响应 */
  }
  const setCookie = response.headers.getSetCookie?.()[0] ?? response.headers.get('set-cookie');
  return {response, status: response.status, json, text, cookie: setCookie?.split(';')[0]};
}

async function login(base, studentNo, password) {
  return call(base, '/api/auth/login', {method: 'POST', body: {studentNo, password}});
}

async function register(base, {name = '张三', studentNo = '20231001', password = 'secret1'} = {}) {
  return call(base, '/api/auth/register', {method: 'POST', body: {name, studentNo, password}});
}

const gameState = (overrides = {}) => ({
  version: 1,
  day: 1,
  cash: 32_000_000,
  gpu: 256,
  optical: 512,
  power: 2,
  storage: 512,
  cooling: 512,
  progress: 42,
  orders: [],
  contracts: [],
  ledger: [],
  events: [],
  visited: [],
  won: false,
  lost: false,
  lastRevenue: 0,
  lastCost: 0,
  incident: 0,
  mitigated: false,
  nextId: 1,
  totalRevenue: 0,
  totalCapex: 0,
  forecast: {},
  spotLog: [],
  totalLost: 0,
  totalIdle: 0,
  ...overrides,
});

test('教师账号 jiaowen / bjtu888 初始化后可登录，学生账号不显示在教师列表之外', async () => {
  await withApp(async ({base}) => {
    const teacher = await login(base, 'jiaowen', 'bjtu888');
    assert.equal(teacher.status, 200);
    assert.equal(teacher.json.user.role, 'teacher');
    assert.equal(teacher.json.user.studentNo, 'jiaowen');
    assert.ok(teacher.cookie);

    const me = await call(base, '/api/auth/me', {cookie: teacher.cookie});
    assert.equal(me.status, 200);
    assert.equal(me.json.user.mustChangePassword, true);

    const student = await register(base, {name: '李四', studentNo: '20231002'});
    assert.equal(student.status, 201);
    assert.equal(student.json.user.role, 'student');

    const forbidden = await call(base, '/api/teacher/students', {cookie: student.cookie});
    assert.equal(forbidden.status, 403);

    const list = await call(base, '/api/teacher/students', {cookie: teacher.cookie});
    assert.equal(list.status, 200);
    assert.equal(list.json.students.length, 1);
    assert.equal(list.json.students[0].studentNo, '20231002');
    assert.equal(list.json.students[0].status, '未开始');
  });
});

test('学生学号必须是 8 位纯数字，重复学号被拒绝', async () => {
  await withApp(async ({base}) => {
    for (const studentNo of ['1234567', '123456', '123456789', '12a456', 'abcdef', '']) {
      const result = await register(base, {studentNo});
      assert.equal(result.status, 400, `应拒绝学号 ${studentNo || '(空)'}`);
    }
    const ok = await register(base, {name: '王五', studentNo: '00000001'});
    assert.equal(ok.status, 201);
    assert.equal(ok.json.user.studentNo, '00000001');

    const duplicate = await register(base, {name: '王五', studentNo: '00000001'});
    assert.equal(duplicate.status, 409);

    const wrong = await login(base, '00000001', 'wrong-password');
    assert.equal(wrong.status, 401);

    const anonymous = await call(base, '/api/auth/me');
    assert.equal(anonymous.status, 401);
  });
});

test('学生进度保存后计算得分，排行榜隐藏学号中间位，教师可看完整数据并导出 CSV', async () => {
  await withApp(async ({base, app}) => {
    const teacher = await login(base, 'jiaowen', 'bjtu888');
    const first = await register(base, {name: '张三', studentNo: '20231001'});
    const second = await register(base, {name: '李四', studentNo: '20231002'});

    const strong = await call(base, '/api/progress', {
      method: 'PUT',
      cookie: first.cookie,
      body: {
        state: gameState({
          day: 20,
          progress: 100,
          gpu: 2_048,
          optical: 2_048,
          storage: 2_048,
          cooling: 2_048,
          power: 8,
          totalRevenue: 6_000_000,
          lastRevenue: 150_000,
          lastCost: 50_000,
          won: true,
        }),
      },
    });
    assert.equal(strong.status, 200);
    assert.ok(strong.json.latest.score > 0);
    assert.equal(strong.json.best.score, strong.json.latest.score);

    const weak = await call(base, '/api/progress', {
      method: 'PUT',
      cookie: second.cookie,
      body: {state: gameState({day: 3, totalRevenue: 100_000, lastRevenue: 10_000, lastCost: 9_000})},
    });
    assert.equal(weak.status, 200);

    const board = await call(base, '/api/leaderboard', {cookie: second.cookie});
    assert.equal(board.status, 200);
    assert.equal(board.json.rows.length, 2);
    assert.equal(board.json.rows[0].name, '张三');
    assert.equal(board.json.rows[0].studentNo, '20*****1');
    assert.equal(board.json.rows[0].isMe, false);
    assert.equal(board.json.rows[1].isMe, true);
    assert.equal(board.json.me.rank, 2);
    assert.ok(board.json.rows[0].score > board.json.rows[1].score);

    const detail = await call(base, '/api/progress', {cookie: first.cookie});
    assert.equal(detail.status, 200);
    assert.equal(detail.json.progress.state.day, 20);

    const list = await call(base, '/api/teacher/students', {cookie: teacher.cookie});
    assert.equal(list.status, 200);
    assert.equal(list.json.students[0].studentNo, '20231001');
    assert.equal(list.json.students[0].status, '已达成');
    assert.equal(list.json.stats.completed, 1);
    assert.equal(list.json.stats.submitted, 2);

    const csv = await fetch(base + '/api/teacher/export.csv', {headers: {Cookie: teacher.cookie}});
    const csvBytes = new Uint8Array(await csv.arrayBuffer());
    const text = new TextDecoder().decode(csvBytes);
    assert.equal(csv.status, 200);
    assert.deepEqual([...csvBytes.slice(0, 3)], [0xef, 0xbb, 0xbf]);
    assert.match(text, /张三/);
    assert.match(text, /20231001/);
    assert.match(text, /已达成/);

    const dbFile = join(app.dataDir, 'nexus.db');
    assert.ok(dbFile.endsWith('nexus.db'));
  });
});

test('较差的新成绩不会覆盖历史最佳，云端存档仍保留最新进度', async () => {
  await withApp(async ({base}) => {
    const student = await register(base, {name: '赵六', studentNo: '20231003'});
    const good = await call(base, '/api/progress', {
      method: 'PUT',
      cookie: student.cookie,
      body: {state: gameState({day: 30, progress: 100, gpu: 2_048, optical: 2_048, storage: 2_048, cooling: 2_048, power: 8, totalRevenue: 8_000_000, lastRevenue: 200_000, lastCost: 40_000, won: true})},
    });
    assert.equal(good.status, 200);
    const bestScore = good.json.best.score;

    const bad = await call(base, '/api/progress', {
      method: 'PUT',
      cookie: student.cookie,
      body: {state: gameState({day: 2})},
    });
    assert.equal(bad.status, 200);
    assert.ok(bad.json.latest.score < bestScore);
    assert.equal(bad.json.best.score, bestScore);
    assert.equal(bad.json.best.day, 30);

    const saved = await call(base, '/api/progress', {cookie: student.cookie});
    assert.equal(saved.json.progress.state.day, 2);
  });
});

test('密码修改后旧密码失效，当前会话保留，退出登录后会话失效', async () => {
  await withApp(async ({base}) => {
    const student = await register(base, {name: '钱七', studentNo: '20231004', password: 'oldpass'});
    const wrong = await call(base, '/api/auth/password', {
      method: 'POST',
      cookie: student.cookie,
      body: {currentPassword: 'nope', newPassword: 'newpass1'},
    });
    assert.equal(wrong.status, 400);

    const changed = await call(base, '/api/auth/password', {
      method: 'POST',
      cookie: student.cookie,
      body: {currentPassword: 'oldpass', newPassword: 'newpass1'},
    });
    assert.equal(changed.status, 200);

    const stillMe = await call(base, '/api/auth/me', {cookie: student.cookie});
    assert.equal(stillMe.status, 200);

    const oldLogin = await login(base, '20231004', 'oldpass');
    assert.equal(oldLogin.status, 401);
    const newLogin = await login(base, '20231004', 'newpass1');
    assert.equal(newLogin.status, 200);

    const logout = await call(base, '/api/auth/logout', {method: 'POST', cookie: student.cookie});
    assert.equal(logout.status, 200);
    const after = await call(base, '/api/auth/me', {cookie: student.cookie});
    assert.equal(after.status, 401);
  });
});

test('教师可以重置单个学生进度，学生无权调用教师接口', async () => {
  await withApp(async ({base}) => {
    const teacher = await login(base, 'jiaowen', 'bjtu888');
    const student = await register(base, {name: '孙八', studentNo: '20231005'});
    await call(base, '/api/progress', {
      method: 'PUT',
      cookie: student.cookie,
      body: {state: gameState({day: 10, totalRevenue: 1_000_000})},
    });

    const list = await call(base, '/api/teacher/students', {cookie: teacher.cookie});
    const id = list.json.students[0].id;
    assert.ok(id);

    const forbidden = await call(base, `/api/teacher/students/${id}/progress`, {
      method: 'DELETE',
      cookie: student.cookie,
    });
    assert.equal(forbidden.status, 403);

    const reset = await call(base, `/api/teacher/students/${id}/progress`, {
      method: 'DELETE',
      cookie: teacher.cookie,
    });
    assert.equal(reset.status, 200);
    assert.equal(reset.json.removed, true);

    const board = await call(base, '/api/leaderboard', {cookie: student.cookie});
    assert.equal(board.json.rows.length, 0);
    const progress = await call(base, '/api/progress', {cookie: student.cookie});
    assert.equal(progress.json.progress, null);
  });
});

test('跨站写请求被拒绝，非法进度被拒绝', async () => {
  await withApp(async ({base}) => {
    const student = await register(base, {name: '周九', studentNo: '20231006'});
    const crossSite = await call(base, '/api/auth/logout', {
      method: 'POST',
      cookie: student.cookie,
      headers: {Origin: 'https://evil.example'},
    });
    assert.equal(crossSite.status, 403);

    const invalid = await call(base, '/api/progress', {
      method: 'PUT',
      cookie: student.cookie,
      body: {state: {version: 1, day: 'many'}},
    });
    assert.equal(invalid.status, 400);
  });
});
