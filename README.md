# Renewal · 个人订阅管理

**当前默认是无邮件的个人订阅台账。** 本地可直接使用；设置页可连接 GitHub 私有数据仓库，在电脑和手机同步；可自愿勾选「在此设备记住令牌」，在当前浏览器明文保存并在下次打开时自动连接，默认关闭。网页可导出为静态文件并用 Pages 发布。使用方法见 [GITHUB-SYNC.md](GITHUB-SYNC.md)。GitHub 路线仍需实测大陆网络，不能替代下面的大陆服务器方案的网络条件。

`NEXT_PUBLIC_LEDGER_ONLY` 默认为 true；设为 false 可恢复旧版邮件界面。这个前端开关不会停止已经部署的邮件 worker / cron；旧部署转台账时，应停掉旧任务。下方邮件说明是可选的旧架构。

**中国大陆日常使用：优先阅读 [DEPLOY-CHINA.md](DEPLOY-CHINA.md)。** 推荐国内服务器 + 自托管 Supabase + 阿里云邮件推送，已提供 Docker 网页、私有提醒进程、HTTPS 与备份配置。下面的 Vercel / Supabase Cloud / Resend 步骤保留为境外部署选项，不能保证大陆访问稳定。

一个中文、手机优先的 Next.js PWA。用同一邮箱登录电脑和手机，Supabase 保存并同步订阅；Supabase 定时任务发送续费前一天的邮件。没有代取消、浏览器代操作或银行接入。

视觉采用 Artefact Archive 网站的档案风格：`#080808` 背景、`#E3000F` 红色强调、暖白文字、直角线框和编号，带轻微扫描线 / 噪点。鼠标有横纵十字跟随、悬停准星展开和点击反馈，支持原生弹窗；触屏及系统「减少动态效果」模式关闭该动效。小字号红色信息使用稍亮的红色以便阅读。JetBrains Mono 与 Space Grotesk 字体本地提供，开源许可证位于 `public/fonts/`，访客无需请求 Google Fonts。

## 已实现

- 添加、编辑、删除、停用订阅；服务、方案、金额、币种、计费周期、结算日期时间和时区、取消方式与链接、备注、自动续费和提醒开关。
- AI、视频、音乐、其他四种分类；表格分类列、手机卡片标签和分类筛选。添加 / 编辑可选分类，JSON / CSV 和 GitHub 同步保留分类；旧记录默认「其他」。
- 按结算日期排序；搜索、状态筛选、未来 7 / 30 天续费；活跃数量、按币种分别展示月度 / 年度折算支出。
- Supabase 邮箱密码登录、密码重置；无注册入口；数据库 RLS + 个人 UUID 白名单。
- Realtime 更新、切回网页刷新和每分钟前台刷新；冲突检测避免旧版本覆盖新版本。
- 云端每 15 分钟检查，结算前 24 小时开始邮件提醒；关闭应用也运行；重试、去重和发送记录。
- JSON / CSV 导入导出，导入预览确认、整个批次原子新增、格式校验和 CSV 公式转义。
- PWA 安装、图标、公共离线提示。离线时不能编辑云端台账，不缓存个人数据。
- 无需密钥即可体验示例模式（本浏览器保存，不跨设备、不发邮件）。示例价格和取消步骤不代表当前真实产品信息。

## 1. 先在电脑体验

需要 Node.js 22 LTS 或更新版本。进入此项目目录：

```powershell
npm install
npm run dev
```

打开 <http://127.0.0.1:3000>。环境变量未配置时会自动进入示例模式。

## 2. 配置 Supabase 云端数据库

1. 在 [Supabase](https://supabase.com/dashboard) 创建项目。
2. 在 SQL Editor 依次 **完整执行一次** `supabase/migrations/202609170001_initial.sql` 和 `supabase/migrations/202609170002_categories.sql`。已有数据库只执行尚未应用的迁移；也可以使用 Supabase CLI 的迁移流程。脚本不是可重复执行的脚本。本地 / GitHub 模式不需要数据库迁移。
3. 在 Authentication 中创建你的个人邮箱用户，设置强密码并确认邮箱。或者使用邀请用户，再通过重置密码邮件设置密码。这个工具不开放公众注册。
4. 从用户详情复制 UUID，在 SQL Editor 执行（替换值）：

```sql
insert into public.allowed_users(user_id)
values ('YOUR-AUTH-USER-UUID');
```

5. 在 Authentication 设置中关闭「允许新用户注册」，建议密码至少 12 位。保留邮箱登录。即使有人获得登录账户，没有在 `allowed_users` 中也不能访问订阅数据。
6. 复制 `.env.example` 为 `.env.local`，填入项目 URL 和 publishable / anon key：

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=YOUR_PUBLISHABLE_OR_ANON_KEY
```

这两个值本来就会出现在浏览器中，安全边界是数据库 RLS。**service_role、Resend key 和 CRON_SECRET 不可加 NEXT_PUBLIC_，也不要放入前端或提交到仓库。**

7. 重启开发服务，用个人邮箱密码登录。第一次为空台账；可以自行添加或从 `demo/subscriptions.json` 导入示例记录。

## 3. 部署到 Vercel，让手机也能打开

1. 将项目推送到自己的私有 GitHub 仓库。
2. 在 [Vercel](https://vercel.com/new) 导入仓库。Framework 选择 Next.js；如果仓库包含外层目录，Root Directory 选本项目目录。
3. 在 Vercel 配置上述两个 `NEXT_PUBLIC_` 环境变量，部署。
4. 在 Supabase Authentication 的 URL 配置中，把 Site URL 设为你的正式 `https://…vercel.app`，把同一个地址加入允许的 Redirect URLs。开发时另加 `http://127.0.0.1:3000`。避免生产使用宽泛的通配域名。
5. 电脑和手机打开同一 HTTPS 地址，用同一邮箱登录。iPhone 用 Safari → 分享 → 添加到主屏幕；Android / Edge / Chrome 用安装应用菜单。有支持的浏览器也会在设置页显示安装按钮。
6. Vercel 修改 `NEXT_PUBLIC_` 环境变量后需要重新部署，它们会在构建时注入。

本项目不依赖 Vercel 定时任务；提醒运行在 Supabase。实际上线需要你自己的云端账户；源码中没有代建账户、实际密钥或已经运行的云服务。

## 4. 配置关闭网页也运行的邮件提醒

邮件使用 [Resend](https://resend.com/)。先验证发信域名，创建 API key。测试域名通常限制收件人，正式使用应配置自己的验证域名。Authentication 的邀请 / 重置密码邮件走 Supabase Auth 的 SMTP，和下面的提醒发信是两条独立渠道；个人测试可先使用 Supabase 默认 Auth 邮件，正式使用可另配 SMTP。

安装 [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started)，登录并关联项目：

```powershell
supabase login
supabase link --project-ref YOUR_PROJECT_REF
```

生成一个随机、至少 32 字符的 CRON_SECRET。可以用密码管理器，或者在本机运行：

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

在本机建立不提交的 `.env.reminders` 文件：

```dotenv
RESEND_API_KEY=re_YOUR_KEY
REMINDER_FROM=Renewal <reminders@your-verified-domain.com>
APP_URL=https://your-app.vercel.app
CRON_SECRET=YOUR_RANDOM_SECRET
```

将它们写入 Supabase 后端并部署函数：

```powershell
supabase secrets set --env-file .env.reminders
supabase functions deploy send-reminders --no-verify-jwt
```

`SUPABASE_URL` 和 `SUPABASE_SERVICE_ROLE_KEY` 是 Supabase 托管 Edge Function 自动提供的后端环境变量，无需复制到 Vercel。函数禁用 JWT 校验，因为这是定时任务入口；函数在执行任何数据库操作前，要求 POST 且恒定时间比较自定义随机 `x-cron-secret`。浏览器从不调用这个函数。

然后：

1. 在 Supabase Database → Extensions 启用 **pg_cron** 和 **pg_net**。Vault 使用 Supabase 提供的 Vault。
2. 在 Supabase Vault 管理界面添加两个后端 secret：
   - `renewal_function_url`：`https://PROJECT.supabase.co/functions/v1/send-reminders`
   - `renewal_cron_secret`：与 Edge Function 的 `CRON_SECRET` **完全相同**
3. 在 SQL Editor 执行 `supabase/schedule.sql`。该脚本可重复执行；会替换同名任务，避免多个 cron 重复运行。
4. 确认任务 `renewal-reminders` 是启用状态，计划是 `*/15 * * * *`。

### 发信的真实验证

1. 登录台账，新增一个金额为 0、结算时间在 **23 小时 55 分钟后**的「提醒测试」订阅，开启提醒。使用未来 24 小时以内的时间，让它在下一次运行马上进入待发窗口。
2. 关闭网页。等待下一次 15 分钟任务；检查收件箱和垃圾邮件文件夹。
3. 重新登录设置页，确认有「已发送」记录。这表示邮件服务接受请求，不保证收件箱投递成功；还应查看 Resend 的投递记录。
4. 下一次 cron 应该不再发送同一期邮件。然后删除测试记录。
5. 若失败，在 Supabase 看 Edge Function 日志、`net._http_response` HTTP 结果，以及 `reminder_deliveries`。**cron SQL 成功只说明 HTTP 已排队，不能证明函数成功或邮件已发出。** 查询示例在 `supabase/schedule.sql` 中。

### 时间与重试规则

- 以用户填写的时区保存结算时刻，数据库统一存 UTC。提醒是「结算前 24 小时」，不是前一个自然日某个固定时刻；正常发送落在阈值后的下一次任务，通常最多约 15 分钟延迟。
- 任务中断、超时或供应商失败会在后续运行重试，每一期最多 20 次，且不会在结算时间过去后补发过期提醒。
- 在提醒窗口内新增订阅，会在下一次任务尽快提醒。
- 同一期由唯一 `(subscription_id, billing_at)` 去重；原子领取任务和 5 分钟租约处理并发 / 崩溃；固定 Resend idempotency key 和不可变邮件快照处理「已发出但记录失败」的重试。
- Resend 保留 idempotency key 24 小时；重试只发生在不到 24 小时的提醒窗口，避免跨越去重有效期。发送前会再次检查白名单、状态、提醒开关和结算时间。
- 用户在发信请求已经提交的一瞬间关闭提醒，无法撤回已提交的邮件。第一轮发送后同一期的失败重试使用首次邮件快照；编辑金额 / 方案后，若想更新提醒时间，应同步编辑下一次结算。
- 不发送推送通知；后台可靠性通过邮件实现，不需要手机授予通知权限。

## 5. 计费与维护

- 月付 / 季付 / 年付保留原始结算日，31 日在短月份使用月底，再恢复原始日；年付 2 月 29 日在平年使用 2 月 28 日。
- 每周 / 月 / 季 / 年均保持订阅时区的本地时间；夏令时会改变 UTC 偏移。不存在的夏令时输入会拒绝；重复的秋季时刻存在歧义，精确到分钟的账单可改用 UTC 输入确认。
- `auto_renew=true` 且仍活跃的订阅，在云端定时任务发现日期过去后推算下一期，**不表示确认付款**。所以即使不需要提醒，也要部署定时任务，以便云端自动更新续费日期。
- 非自动续费的日期不会自动推进；到期后会显示「日期已过，请核对」。续订后手动更新日期或停用记录。
- 支出只统计「正在使用」的订阅，按当前方案算预算；周付按 52 次 / 年，季度按 4 次 / 年。币种分开显示，不读取汇率、不合并币种。停用不等于已向服务商取消。
- JSON / CSV 只含订阅业务字段，不含账户 UUID / 数据库记录 ID。导入会重新创建 ID，整个文件校验通过才写入。重复导入会新增重复记录。2 MB / 500 条导入限制是前端便利限制；服务器仍有字段约束和账户隔离。
- 取消 URL 仅允许 http / https，永远不会由服务器抓取；外部页面在新窗口打开。取消步骤由你维护，平台不验证服务商条款。
- 建议每月导出 JSON 备份、检查提醒发送记录与云服务配额，并及时更新依赖。免费云项目可能因政策、暂停或配额影响提醒，长期使用时应检查自己的实际套餐和项目状态。
- 停止提醒任务：在 SQL Editor 执行 `select cron.unschedule('renewal-reminders');`。轮换 CRON_SECRET 时需同时更新 Edge Function 与 Vault。

## 6. 验证与文件

```powershell
npm run typecheck
npm run typecheck:edge
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

浏览器测试使用无密钥的示例模式；运行时不要设置 `NEXT_PUBLIC_SUPABASE_*`。桌面和手机均测试增删改、持久化、空结果、导出和宽度。单元测试覆盖月末、夏令时、币种、导入数据与危险链接。后端 SQL 集成测试使用内嵌 PostgreSQL，覆盖白名单隔离、任务去重、租约、快照和日期推进；真实托管发信还必须执行上面的云端验证。

```text
app/                         Next.js 页面、样式、PWA manifest
components/                  台账、编辑表单
lib/                         校验、计费、时区、导入导出
public/                      图标、Service Worker、离线提示
demo/                        可导入示例数据
supabase/migrations/         表、RLS、领取与发信状态函数
supabase/functions/          云端邮件任务
supabase/schedule.sql        Vault + 定时调用配置
tests/                       日期与后端逻辑测试
e2e/                         桌面 / 手机交互验证
.env.example                 前端及后端配置模板
```

官方配置依据：[Next.js PWA](https://nextjs.org/docs/app/guides/progressive-web-apps)、[Supabase 密码登录](https://supabase.com/docs/guides/auth/passwords)、[Supabase 定时 Edge Functions](https://supabase.com/docs/guides/functions/schedule-functions)、[Resend 发信 API](https://resend.com/docs/api-reference/emails/send-email)、[Resend 去重](https://resend.com/docs/dashboard/emails/idempotency-keys)。
