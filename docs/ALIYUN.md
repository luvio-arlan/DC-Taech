# 阿里云部署记录（bjtu.echoxai.net）

本文记录本仓库对应的教学部署方式，也可以作为同类型 ECS 的复用清单。

## 当前环境

| 项目 | 值 |
| --- | --- |
| 公网 IP | `120.26.147.100` |
| 域名 | `bjtu.echoxai.net`（已解析到上述 IP） |
| 系统 | Ubuntu 22.04 LTS |
| Node.js | v22.20（内置 `node:sqlite`） |
| Nginx | 1.18（已有其他站点，勿覆盖默认站点） |
| 应用目录 | `/opt/nexus/app` |
| 数据目录 | `/var/lib/nexus` |
| 服务名 | `nexus.service` |
| 进程端口 | `127.0.0.1:8787`（只给 Nginx 访问） |
| 当前课堂入口 | <http://120.26.147.100:8080/> |
| 域名状态 | 阿里云 ICP 备案拦截中，备案完成后启用 80/443 |

选择 **systemd + 宿主 Nginx**，不使用 Docker：这台机器没有安装 Docker，也无需为了一个 SQLite 服务引入容器运行时。

## 当前状态（重要）

`bjtu.echoxai.net` 已经解析到这台 ECS，但访问 80/443 时被阿里云的 **Non-compliance ICP Filing** 页面拦截（443 直接 reset）。这是大陆 ECS 对未备案域名的限制，不是 Nginx 配置问题。同一 IP 上的 `hc.echoxai.net` 目前也受同样限制。

因此在域名完成 ICP 备案前，课堂入口使用 **IP + 8080 端口**：

> <http://120.26.147.100:8080/>

8080 已通过安全组验证可公网访问。备案完成后，删除 8080 入口、恢复 80/443 并申请证书即可。HTTP 下密码为明文传输，建议只在本课程/校内范围使用，不要长期公开。

## 首次部署

### 1. 服务器准备

在阿里云控制台的 **安全组** 中放行：

- `22/tcp`（SSH，建议只允许自己的出口 IP）
- `80/tcp`（HTTP，备案完成后使用）
- `443/tcp`（HTTPS，备案完成后使用）
- `8080/tcp`（备案完成前的课堂入口）

系统防火墙（ufw）当前未启用，无需额外放行。

```bash
sudo mkdir -p /opt/nexus/app /var/lib/nexus
sudo useradd --system --home /var/lib/nexus --shell /usr/sbin/nologin nexus 2>/dev/null || true
sudo chown -R nexus:nexus /var/lib/nexus
```

### 2. 本地构建并上传

在仓库根目录执行：

```bash
npm ci
npm test
npm run build

rsync -a --delete dist server shared package.json root@120.26.147.100:/tmp/nexus-build/
ssh root@120.26.147.100 'rsync -a --delete /tmp/nexus-build/ /opt/nexus/app/ && chown -R root:root /opt/nexus/app && chmod -R u+rwX,go+rX /opt/nexus/app'
```

运行时不需要 `node_modules`：教学服务只依赖 Node 内置模块。`dist/` 由 Node 直接托管。

### 3. systemd 服务

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
Environment=ALLOW_REGISTRATION=1
ExecStart=/opt/node-v22.20.0-linux-x64/bin/node server/index.mjs
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
# 用 `command -v node` 确认实际路径；本机为 /opt/node-v22.20.0-linux-x64/bin/node
sudo systemctl daemon-reload
sudo systemctl enable --now nexus
sudo systemctl status nexus --no-pager
curl -s http://127.0.0.1:8787/api/health
```

首次启动会在 `/var/lib/nexus/nexus.db` 建库，并创建教师账号 `jiaowen` / `bjtu888`。

### 4. Nginx 站点

`/etc/nginx/sites-available/bjtu.echoxai.net`：

```nginx
upstream nexus_app {
    server 127.0.0.1:8787;
    keepalive 16;
}

server {
    listen 80;
    listen [::]:80;
    server_name bjtu.echoxai.net;

    client_max_body_size 2m;

    location / {
        proxy_pass http://nexus_app;
        proxy_http_version 1.1;
        proxy_set_header Host $http_host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $http_host;
        proxy_set_header Connection "";
        proxy_read_timeout 60s;
    }
}
```

```bash
sudo ln -sfn /etc/nginx/sites-available/bjtu.echoxai.net /etc/nginx/sites-enabled/bjtu.echoxai.net
sudo nginx -t
sudo systemctl reload nginx
```

注意：**不要**给这个站点加 `default_server`。服务器上已有 `coffee-ip.conf` 和 `hc.echoxai.net`，直接访问 IP 或 `hc.echoxai.net` 的流量应保持原样。

在同一个站点文件中追加 8080 入口（备案完成前使用，不影响其他站点）：

```nginx
server {
    listen 8080;
    listen [::]:8080;
    server_name _;

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
        proxy_read_timeout 60s;
    }
}
```

`Host` 与 `X-Forwarded-Host` 必须使用 `$http_host`（含端口），否则浏览器在 `:8080` 下的 `Origin` 校验会失败，登录时报“请求来源不受信任”。

### 5. HTTPS（ICP 备案完成后）

> 当前未执行：未备案域名的 443 会被阿里云重置，Let's Encrypt 的 HTTP-01 校验也无法通过 80 端口完成。请先完成备案，再执行本节。

```bash
sudo apt-get update
sudo apt-get install -y certbot python3-certbot-nginx

sudo certbot --nginx \
  -d bjtu.echoxai.net \
  --redirect \
  --agree-tos \
  --register-unsafely-without-email \
  --non-interactive
```

certbot 会自动写入 443 证书、把 80 重定向到 HTTPS，并安装续期定时器。

```bash
sudo certbot renew --dry-run
systemctl list-timers | grep certbot
```

中国大陆服务器绑定域名访问 80/443 通常要求域名已完成 ICP 备案；若备案未完成，可先用 `http://120.26.147.100:8787` 做内网/临时验证，不要把该端口长期暴露在公网。

### 6. 验收

```bash
curl -s https://bjtu.echoxai.net/api/health
curl -sI https://bjtu.echoxai.net/ | head
```

浏览器打开 <http://120.26.147.100:8080/>（备案完成后改为 `https://bjtu.echoxai.net/`）：

1. 用教师账号 `jiaowen` / `bjtu888` 登录。
2. 右上角账号菜单 → **修改密码**，立即改掉默认密码。
3. 退出，用姓名 + 6 位学号 + 密码注册一个测试学生。
4. 推进几天经营，打开「排行榜」与「教师后台」，确认成绩已上传并能导出 CSV。
5. 验收后可在教师后台重置测试学生进度。

## 日常运维

```bash
# 查看服务与日志
sudo systemctl status nexus --no-pager
sudo journalctl -u nexus -n 100 --no-pager

# 重启（更新代码后）
sudo systemctl restart nexus

# 备份数据库（一致性快照）
sudo -u nexus env DATA_DIR=/var/lib/nexus /usr/bin/node /opt/nexus/app/server/backup.mjs
sudo ls -lh /var/lib/nexus/backup-*.db

# 关闭学生自助注册（开课名单固定后）
sudo systemctl edit nexus
# 添加：
# [Service]
# Environment=ALLOW_REGISTRATION=0
sudo systemctl daemon-reload && sudo systemctl restart nexus
```

更新代码：

```bash
# 本地
npm test && npm run build
rsync -a --delete dist server shared package.json root@120.26.147.100:/tmp/nexus-build/
ssh root@120.26.147.100 'rsync -a --delete /tmp/nexus-build/ /opt/nexus/app/ && chmod -R u+rwX,go+rX /opt/nexus/app && systemctl restart nexus && systemctl is-active nexus'
```

数据库在 `/var/lib/nexus`，代码更新不会清空学生成绩。回滚时把上一版 `dist/server/shared` 覆盖回去并重启即可。

## 账号与数据说明

- 学生账号：姓名 + **6 位纯数字学号** + 自设密码。
- 教师账号：`jiaowen`，初始密码 `bjtu888`，登录后请在账号菜单中修改。
- 密码使用 scrypt 加盐哈希；会话 Cookie 为 HttpOnly + SameSite=Lax，HTTPS 下自动加 Secure。
- 每位学生只有一条云端存档和一条历史最佳成绩；排行榜按最佳成绩排序。
- 教师后台可以查看全班成绩、排序、搜索、导出 CSV，并重置单个学生的云端进度。
- 删除 `/var/lib/nexus/nexus.db` 会清空所有账号和成绩，操作前务必先备份。

## 常见问题

**页面能打开但登录报“无法连接服务器”**
检查 `systemctl status nexus` 和 Nginx 站点是否启用；`curl 127.0.0.1:8787/api/health` 应返回 `{"ok":true}`。

**登录后立刻回到登录页**
HTTPS 反向代理没有传 `X-Forwarded-Proto`，导致 Secure Cookie 行为异常。确认 Nginx 配置包含该请求头。

**域名打不开，返回 403 / Non-compliance ICP Filing**
域名尚未完成 ICP 备案，被阿里云在 80 端口拦截；443 会直接 reset。备案完成前请使用 `http://120.26.147.100:8080/`。

**教师后台看不到学生**
学生需要至少保存过一次进度（推进一天或打开任一经营面板后约 1 秒）才会出现在排行榜；已注册但未开始的学生会以“未开始”出现在教师列表。

**CSV 中文乱码**
文件带 UTF-8 BOM，可直接用 Excel 打开；若使用其他工具，请按 UTF-8 读取。
