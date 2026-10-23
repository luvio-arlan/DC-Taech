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

选择 **systemd + 宿主 Nginx**，不使用 Docker：这台机器没有安装 Docker，也无需为了一个 SQLite 服务引入容器运行时。

## 首次部署

### 1. 服务器准备

在阿里云控制台的 **安全组** 中放行：

- `22/tcp`（SSH，建议只允许自己的出口 IP）
- `80/tcp`（HTTP，用于访问和证书校验）
- `443/tcp`（HTTPS）

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
ssh root@120.26.147.100 'rsync -a --delete /tmp/nexus-build/ /opt/nexus/app/ && chown -R root:root /opt/nexus/app'
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
ExecStart=/usr/bin/node server/index.mjs
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
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;
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

### 5. HTTPS

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

浏览器打开 <https://bjtu.echoxai.net/>：

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
ssh root@120.26.147.100 'rsync -a --delete /tmp/nexus-build/ /opt/nexus/app/ && systemctl restart nexus && systemctl is-active nexus'
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

**教师后台看不到学生**
学生需要至少保存过一次进度（推进一天或打开任一经营面板后约 1 秒）才会出现在排行榜；已注册但未开始的学生会以“未开始”出现在教师列表。

**CSV 中文乱码**
文件带 UTF-8 BOM，可直接用 Excel 打开；若使用其他工具，请按 UTF-8 读取。
