# 在中国大陆部署 Renewal

本项目的大陆部署路线：**同一台中国内地 Linux 云服务器运行 Next.js、自托管 Supabase 和提醒进程；阿里云邮件推送负责发邮件。** 浏览器的网页、登录、数据库和实时同步均连接你自己的域名，不访问 Vercel 或 supabase.co。保留现有个人账户权限、CRUD、导入导出、PWA 和鼠标效果。

这是一套可部署的源码与配置，尚未在你的云服务器运行。大陆机房能避免主要使用链路跨境，但服务器故障、网络故障和邮件过滤仍可能影响使用，不能承诺百分之百可用。镜像 / npm 包的首次下载与软件更新仍需可访问的软件源；运行期间不下载字体或 JS 依赖。

## 1. 先准备这三样

1. **中国内地云服务器**：例如阿里云中国内地地域，Ubuntu 24.04 LTS，至少 2 核 / 4 GB / 40 GB SSD；为同机运行和构建留余量，建议 4 核 / 8 GB / 80 GB SSD。这不是单纯静态网页，自托管 Supabase 的运行要求见[官方文档](https://supabase.com/docs/guides/self-hosting/docker)。购买前确认对应服务器规格满足个人备案的资源要求。本文不列促销价，实际费用以购买页面为准。
2. **实名认证的域名和备案**：通过服务器接入商办理个人 ICP 备案。备案通过后再把应用域名、API 子域名解析到服务器。中国内地服务器对外提供网站需要备案，见[阿里云官方说明](https://help.aliyun.com/zh/icp-filing/basic-icp-service/support/for-the-record-process-faq)。备案要求和申请材料以接入商当前页面为准。
3. **阿里云邮件推送**：使用华东 1（杭州）区域，验证发信域名和发信地址，配置该服务要求的 DNS 记录。创建只有发信权限的 RAM 用户 / AccessKey；不要使用主账户 AccessKey。提醒通过 HTTPS API 发信，账户密码恢复走 SMTP，两套凭据不同。

准备两个域名，例如 `renewal.example.cn` 和 `api.example.cn`。浏览器只访问这两个地址。不使用境外 CDN。公网只放行 80 / 443；SSH 22 仅向你的管理 IP 开放。不要公网开放数据库 5432 / 6543、后台 8000 或网页内部 3000。

自托管的取舍：无需重写现有数据库权限与日期逻辑，但需要自己负责服务器、升级、备份。不能继续使用 Supabase Cloud 免费项目充当实际数据库，否则登录 / 数据请求仍跨境。你已经建好的私有 GitHub 仓库可以继续存源码。

## 2. 上传源码和准备官方 Supabase

以下命令在 **Linux 服务器**运行，示例项目目录为 `/opt/renewal`。先安装 Docker Engine、Compose 插件（至少 2.24.4）、Git、Python 3，依据发行版与 [Docker 官方安装指南](https://docs.docker.com/engine/install/ubuntu/) 安装。不要把本文命令直接放到 Windows PowerShell 运行。

从私有仓库 clone，或把源码压缩包通过 SFTP 上传后解压到 `/opt/renewal`。目录最上层应有 `package.json` 和 `Dockerfile`。私有仓库认证使用 SSH deploy key，避免把令牌写入命令或仓库。

```sh
cd /opt/renewal/deploy/china
git clone --depth 1 https://github.com/supabase/supabase.git upstream
python3 prepare-supabase.py
```

准备脚本检查当前官方 Compose 的 `api-gw` / `supavisor` 服务，并安装只绑定回环地址的端口覆盖。上游接口变化时它会停止，避免直接部署错误配置。当前上游使用 Envoy 网关；本文不是旧版 Kong 模板。`upstream-revision.txt` 记录下载时的完整 Git 提交号，应将它连同本项目版本记录下来。后续更新先在测试环境验证这个提交及镜像标签，不能直接对生产执行 `git pull`。

如果服务器下载 GitHub 或容器镜像失败，可在可访问这些源的电脑下载同一提交的完整仓库与镜像，通过 SFTP / `docker save`、`docker load` 上传。不要使用来源不明的数据库或鉴权镜像；构建机和服务器需要相同 CPU 架构。`NODE_IMAGE` / `CADDY_IMAGE` 可改为你自己可信的国内镜像仓库地址。首次下载失败与网页上线后的大陆访问是不同问题。

## 3. 配置本机 Supabase 的秘密和域名

进入 `upstream/docker`，按[官方自托管安装流程](https://supabase.com/docs/guides/self-hosting/docker)复制 `.env.example` 到 `.env`，使用该提交配套的密钥生成脚本和配置指南生成 **全部**凭据，包括数据库密码、JWT、ANON / SERVICE_ROLE、后台登录、各服务加密密钥。不要保留官方示例凭据，不要仅修改数据库密码。生成的 ANON / SERVICE_ROLE 必须与 JWT 配套。

下面这些设置填写为你的实际域名：

```dotenv
SITE_URL=https://renewal.example.cn
ADDITIONAL_REDIRECT_URLS=https://renewal.example.cn
API_EXTERNAL_URL=https://api.example.cn
SUPABASE_PUBLIC_URL=https://api.example.cn
DISABLE_SIGNUP=true
ENABLE_EMAIL_SIGNUP=true
ENABLE_ANONYMOUS_USERS=false
ENABLE_PHONE_SIGNUP=false
ENABLE_EMAIL_AUTOCONFIRM=false
SMTP_HOST=smtpdm.aliyun.com
SMTP_PORT=465
SMTP_ADMIN_EMAIL=reminders@your-verified-mail-domain.cn
SMTP_USER=reminders@your-verified-mail-domain.cn
SMTP_PASS=YOUR_MAIL_SMTP_PASSWORD
SMTP_SENDER_NAME=Renewal
```

SMTP 密码是邮件推送发信地址的 SMTP 密码，**不是** AccessKeySecret。确认 SMTP 域名、端口以及发信地址的区域匹配杭州。按服务商 SMTP 文档配置，密码重置失败时单独检查 Auth 邮件设置。

启动前验证合并配置（其中含密码，**不要**将输出贴到聊天或截图）：

```sh
cd /opt/renewal/deploy/china/upstream/docker
chmod 600 .env
docker compose config --quiet
docker compose up -d
docker compose ps
```

确认网关只发布 `127.0.0.1:8000`，数据库连接池没有发布端口。还需在云安全组仅开放前述公网端口；Docker 发布端口可能绕过部分主机防火墙规则，不能只依赖 UFW。官方所有服务默认启动，暂不做删减以保留匹配的依赖。

## 4. 建表和创建个人登录账户

**新安装只执行一次迁移**：

```sh
cd /opt/renewal
docker compose --project-directory deploy/china/upstream/docker exec -T db psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/migrations/202609170001_initial.sql
docker compose --project-directory deploy/china/upstream/docker exec -T db psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/migrations/202609170002_categories.sql
```

管理后台不开放到公网。用 SSH 将服务器网关转发到你电脑，例如在本机终端运行（替换管理用户名和 IP）：

```sh
ssh -N -L 8000:127.0.0.1:8000 YOUR_SERVER_USER@YOUR_SERVER_IP
```

浏览器打开 `http://127.0.0.1:8000`，用自托管 `.env` 中的 DASHBOARD 用户名 / 密码访问 Studio。在 Authentication → Users 创建你的邮箱密码用户，确认邮箱；管理员手工创建时使用确认选项，不需要开放注册。数据库密码、Studio 密码和应用登录密码是不同的密码。

复制用户 UUID，用 Studio SQL Editor 执行：

```sql
insert into public.allowed_users(user_id)
values ('替换为本机Auth用户UUID')
on conflict (user_id) do nothing;
```

若此前已有 Supabase Cloud 数据：先在旧应用导出 JSON，创建新的本机用户后在新应用导入。用户 UUID 不同，不能简单复制旧 `user_id`。旧邮件发送日志不会随订阅导入；切换完成后停止旧项目的 cron，避免两边发信。只有空项目则无需迁移。

## 5. 配置网页和国内邮件提醒

```sh
cd /opt/renewal/deploy/china
cp .env.example .env
cp worker.env.example .env.worker
chmod 600 .env .env.worker
```

编辑 `.env`：正式应用域名、API 域名、TLS 证书邮箱、审核通过的 `ICP_NUMBER`，以及 **本机 Supabase 的 ANON_KEY**。这个公开 key 会编译到浏览器里；所有 service-role / 邮件秘密只放在服务器。

编辑 `.env.worker`：本机 `SUPABASE_SERVICE_ROLE_KEY`、至少 32 字符随机 `CRON_SECRET`、正式 `APP_URL`、`EMAIL_PROVIDER=aliyun`、RAM AccessKey 和验证过的 `ALIYUN_DM_ACCOUNT`。`SUPABASE_URL=http://api-gw:8000` 是容器内地址，不填 supabase.co。

准备随机秘密可在服务器运行：

```sh
openssl rand -hex 32
```

本方案直接在 Node 容器中运行同一份提醒处理代码，不需要 Supabase Cloud CLI、Edge Functions 云部署、Resend、Vault 或 `supabase/schedule.sql`。**不要同时启动另一套 cron。** 当前 worker 在启动时立即检查，以后每轮完成后约 15 分钟检查一次，不重叠执行；单轮最多处理 10 条、数据库租约防止多 worker 同时领取。个人几十个以内的订阅通常足够。服务器休眠、关机或进程停止会影响提醒。

```sh
docker compose config --quiet
docker compose build
docker compose up -d
docker compose ps
docker compose logs --tail 30 worker
```

Caddy 为两个域名申请和续期 HTTPS 证书，反向代理网页、Auth、REST、Realtime；Studio、Auth admin 和 Edge 路由均不对公网提供。首次证书签发需 DNS 生效、80 / 443 可访问和服务器可连接证书机构；如果签发失败，先看 `proxy` 日志再检查 DNS。TLS 证书申请和续期属于运维依赖，不能永久断开所有外部连接。

域名或 ANON_KEY 改动后重新 build 网页；worker 秘密改动后使用 `docker compose up -d --force-recreate worker`。只运行 `restart` 不会读取新环境变量。

阿里云 SingleSendMail 没有本项目可用的幂等键：数据库防止已确认成功的提醒重复发送，但“服务商已经收信、网络超时 / 状态写入失败”后重试可能重复。本项目优先重试，不能承诺邮件严格只发送一次。返回成功表示服务商接受请求，不证明到达收件箱；测试需要核对真实收件邮箱。[API 文档](https://help.aliyun.com/zh/direct-mail/singlesendmail)

## 6. 上线验收

- 手机关闭代理，用大陆移动数据打开网页、登录并新增订阅；电脑用宽带登录同一账户，确认数据出现。
- 电脑编辑金额，手机切回应用确认同步；另一账户和未登录请求不能读台账。
- 页面页脚展示真实 ICP 备案号；检查 API 根路径和 `/auth/v1/admin/users` 公网不提供后台访问。**不**把 service-role 放入前端做测试。
- 创建下一次结算为约 **23 小时 55 分钟后**的测试订阅，打开提醒开关并关闭网页。下一轮查看 worker 日志、应用设置里的发送记录和真实邮箱（含垃圾邮件）。验证停用、关闭提醒后不发送。
- 在 Safari / Chrome 添加到主屏幕，确认通过 HTTPS 打开；PWA 不改变网络链路，离线时仍只显示公共提示。
- 重启服务器，确认 `docker compose ps` 正常、worker 随容器恢复且日志有新检查。

日志的 `200` 和 `sent` 仅代表任务 / 服务商接受；`207` 表示某些发信失败，`500` 常见于缺密钥或迁移未完成。worker health 只在完整成功的一轮后刷新，超时未成功会变成 unhealthy；Docker 的 unhealthy **不会自动重启或通知你**，应通过云平台监控配置网页可用性、磁盘 / 内存、进程异常和 worker 健康告警到个人邮箱。

## 7. 日常备份、更新与恢复

每天运行一次：

```sh
cd /opt/renewal
sh deploy/china/backup.sh
```

输出保存到 `deploy/china/backups/`，包含账户与私人台账。该脚本没有自动安装定时任务，也不自动删旧备份；用服务器的计划任务每日运行，配置轮转，定期加密复制到另一台机器 / 私有国内对象存储。服务器快照也可作为额外保护。只保存在同一块磁盘不能应对服务器丢失。

备份还必须安全保存本机 Supabase `.env`、应用 `.env` / `.env.worker`、`upstream-revision.txt` 和本项目版本，数据库加密数据可能依赖其中的原密钥。秘密不能提交 GitHub。不要运行官方 `reset.sh` 或 `docker compose down -v`。

恢复流程：先在隔离测试服务器还原相同版本的 Supabase 和配置，保持 worker 停止；用 `psql -v ON_ERROR_STOP=1` 导入备份。脚本使用 `--clean --if-exists`，**恢复会替换目标数据库对象和数据**，不要对当前生产数据库盲目导入。备份包括 Supabase 内部表，新装初始化后恢复可能需要根据同版本的内部依赖处理，必须先完成一次测试恢复。确认用户登录、台账和提醒状态后才启动 worker，防止恢复时误发旧提醒。

更新前先备份，保留旧镜像标签，测试升级后再切换生产。应用更新：上传新源码、`docker compose build`、`docker compose up -d`；新迁移按编号执行。上游 Supabase 更新须遵循该版本的迁移指南，不能简单改 PostgreSQL 主版本镜像。这里交付的是部署模板，尚未实测真实 Linux Docker 栈、TLS、Auth SMTP、备份恢复或国内网络。

## 官方参考

- [Supabase 自托管 Docker](https://supabase.com/docs/guides/self-hosting/docker)
- [Next.js 自托管](https://nextjs.org/docs/app/guides/self-hosting)
- [阿里云个人网站备案](https://help.aliyun.com/zh/icp-filing/basic-icp-service/support/for-the-record-process-faq)
- [阿里云邮件签名规则](https://help.aliyun.com/zh/direct-mail/signature)
- [阿里云 SingleSendMail](https://help.aliyun.com/zh/direct-mail/singlesendmail)
