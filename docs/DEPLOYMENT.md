# 部署指南

NEXUS 教学版由两部分组成：

- **前端**：React 19 + Three.js + Vite，构建到 `dist/`。
- **教学服务**：Node.js 单进程，提供账号、会话、进度存档、排行榜和教师后台，数据写入 SQLite。

`server/index.mjs` 同时托管 `dist/` 和 `/api/*`，所以生产环境只需要 **Node.js + 反向代理**，不需要单独的数据库服务。SQLite 由 Node 内置的 `node:sqlite` 驱动，运行时没有 npm 依赖。

## 本地开发

需要 **Node.js 22.13+**（推荐 24 LTS）。

```bash
npm ci
npm run dev
```

- 前端：<http://127.0.0.1:5173>
- API：<http://127.0.0.1:8787>
- Vite 会把 `/api` 代理到 8787，前端和接口同源，Cookie 可直接使用。

首次启动会自动创建 `data/nexus.db`，并写入教师账号：

| 账号 | 密码 | 角色 |
| --- | --- | --- |
| `jiaowen` | `bjtu888` | 教师 |

学生使用 **姓名 + 6 位纯数字学号 + 密码** 自助注册。教师首次登录后应立即在右上角账号菜单中修改密码。

```bash
npm test       # 经营规则、需求预测、账号与排名接口测试
npm run build  # TypeScript 检查 + 生产构建
npm start      # 生产模式：Node 托管 dist + API，默认 8787
npm run backup # 备份 SQLite（默认 data/nexus.db）
```

## 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `8787` | 监听端口 |
| `HOST` | `0.0.0.0` | 监听地址；放在 Nginx 后面时建议 `127.0.0.1` |
| `DATA_DIR` | `./data` | SQLite 所在目录 |
| `DIST_DIR` | `./dist` | 前端构建产物目录 |
| `TEACHER_PASSWORD` | `bjtu888` | **仅首次建库**时使用；不会覆盖已修改的教师密码 |
| `ALLOW_REGISTRATION` | `1` | 设为 `0` 关闭学生自助注册 |
| `TRUST_PROXY` | `0` | 位于反向代理后设为 `1`，用 `X-Forwarded-For` 识别 IP |

## Docker Compose（推荐）

```bash
cp .env.example .env
# 修改 .env 中的 TEACHER_PASSWORD
docker compose up -d --build
```

`docker-compose.yml` 启动两个容器：

- `app`：Node 教学服务，数据保存在命名卷 `nexus-data`。
- `web`：Nginx，对外监听 80，反向代理到 `app:8787`。

打开 `http://服务器IP/` 即可。教师账号 `jiaowen`，密码为 `.env` 中的 `TEACHER_PASSWORD`（默认 `bjtu888`）。

### 启用 HTTPS

1. 把已签发的证书放到 `deploy/certs/nexus.pem` 和 `deploy/certs/nexus.key`。
2. 复制 HTTPS 配置：

   ```bash
   cp deploy/nginx.https.conf.example deploy/nginx.https.conf
   ```

3. 用覆盖文件启动：

   ```bash
   docker compose -f docker-compose.yml -f docker-compose.https.yml up -d
   ```

4. 在安全组/防火墙放行 443。

## 不使用 Docker（systemd + Nginx）

适用于已有 Node.js 和 Nginx 的服务器（阿里云 ECS 的完整步骤见 [阿里云部署](ALIYUN.md)）。

```bash
sudo mkdir -p /opt/nexus/app /var/lib/nexus
sudo useradd --system --home /var/lib/nexus --shell /usr/sbin/nologin nexus || true
sudo chown -R nexus:nexus /var/lib/nexus

# 本地构建后同步（在仓库根目录执行）
rsync -a --delete dist server shared package.json user@server:/tmp/nexus-build/
ssh user@server 'sudo rsync -a --delete /tmp/nexus-build/ /opt/nexus/app/'

```

`/etc/systemd/system/nexus.service`：

```ini
[Unit]
Description=NEXUS teaching server
After=network.target

[Service]
Type=simple
User=nexus
Group=nexus
WorkingDirectory=/opt/nexus/app
Environment=NODE_ENV=production
Environment=PORT=8787
Environment=HOST=127.0.0.1
Environment=DATA_DIR=/var/lib/nexus
Environment=TRUST_PROXY=1
Environment=TEACHER_PASSWORD=bjtu888
ExecStart=/usr/bin/node server/index.mjs  # 以 `command -v node` 的实际路径为准
Restart=always
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/nexus

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now nexus
curl http://127.0.0.1:8787/api/health
```

Nginx 站点（`/etc/nginx/sites-available/nexus`）：

```nginx
server {
    listen 80;
    server_name nexus.example.com;

    client_max_body_size 2m;

    location / {
        proxy_pass http://127.0.0.1:8787;
        proxy_http_version 1.1;
        proxy_set_header Host $http_host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $http_host;
        proxy_set_header Connection "";
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/nexus /etc/nginx/sites-enabled/nexus
sudo nginx -t && sudo systemctl reload nginx
```

如果服务器上已有默认站点，保留它，把 `server_name` 改成实际域名即可，NEXUS 不会抢占 IP 默认站点。

## 数据与备份

数据库默认位于 `DATA_DIR/nexus.db`，同目录会有 SQLite 的 `-wal` 和 `-shm` 文件。**不要只复制 `nexus.db`**，请使用在线备份：

```bash
# Docker
docker compose exec app node server/backup.mjs
docker compose cp app:/app/data ./backup

# systemd
sudo -u nexus env DATA_DIR=/var/lib/nexus /usr/bin/node /opt/nexus/app/server/backup.mjs
```

`backup.mjs` 使用 `VACUUM INTO` 生成一致性快照。建议把快照同步到对象存储或另一台机器。

## 更新与回滚

1. 本地 `npm test && npm run build`。
2. 把 `dist/`、`server/`、`shared/` 同步到服务器（或 `git pull` 后重新构建）。
3. `sudo systemctl restart nexus`（Docker：`docker compose up -d --build`）。
4. 数据库在 `DATA_DIR` 中，更新代码不会清空成绩。

回滚时切回上一份代码目录并重启即可；数据库结构只做向后兼容的增量变更。

## 安全清单

- 首次登录后立刻修改教师密码；不要把默认密码写进公开文档或群公告。
- 公开部署务必使用 HTTPS。密码和会话 Cookie 在 HTTP 下是明文传输。
- 学生名单导入完成后，可设 `ALLOW_REGISTRATION=0` 关闭自助注册。
- 只开放 80/443；Node 端口 8787 不要直接暴露到公网。
- 定期备份 `DATA_DIR`；教师后台的“重置进度”不可撤销。
- 服务器密码、SSH 私钥、`.env` 和数据库文件都不应提交到 Git。
