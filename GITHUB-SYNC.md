# 用 GitHub 同步个人订阅台账

当前版本默认是订阅台账：记录、预算、查看续费日期和取消方式，操作由你到平台完成。不发送邮件。已有电脑与手机布局，以及桌面 Cursor 效果。

支持「AI / 视频 / 音乐 / 其他」分类，在添加 / 编辑窗口选择，列表上方可筛选。旧记录、旧 JSON / CSV 或 GitHub 台账没有分类时默认「其他」，不会按服务名称自动改动个人记录。更新分类功能时，请电脑和手机都使用新版网页；旧版客户端保存时可能丢弃分类字段。

## 两件事分开准备

- **网页入口**：电脑与手机都要能打开界面。可发布纯静态网页到 GitHub Pages，使用它提供的 `github.io` 地址；不用购买域名或云服务器。
- **私有数据**：订阅台账保存到独立的私有 GitHub 仓库。页面使用 GitHub Contents API 读写一个 JSON 文件，不需要 Supabase、邮件服务或定时任务。

这条路线以使用现有 GitHub 为优先，不满足“大陆访问有稳定保证”的要求。GitHub 页面与 API 都需要在你的手机流量 / 宽带上实测；如果经常失败，应该改用国内托管服务。仅取消邮件不会消除跨设备共享数据的存储需求。

## 1. 新建私有数据仓库

在 GitHub 建立 **Private** 仓库，例如 `renewal-data`，勾选创建 README，使其有默认分支。它只存个人数据，不存网页代码，也不开启 Pages 或自动部署。

不建议直接用网页源码仓库存台账：这样令牌可以只授权数据仓库，也不会因台账修改而触发网页构建。

页面连接时检查仓库必须私有。第一次没有 `ledger/subscriptions.json` 时显示空白台账，连接操作本身不上传、不覆盖已有本地记录。首次保存 / 导入后才创建数据文件。

## 2. 生成细粒度访问令牌

GitHub → 头像 → Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token。

- Resource owner 选你的账户。
- Repository access 选 **Only select repositories**，只选择 `renewal-data`。
- Repository permissions → **Contents: Read and write**；不要增加 Workflows 或账户管理权限。
- 设置有效期，过期后重新生成。

令牌只输入应用设置页。不要放入源码、构建环境、GitHub Actions secrets、导出文件或聊天。默认只在页面内存中保存令牌，刷新 / 关闭后需重新输入。可勾选「在此设备记住令牌」：连接成功后，令牌及对应仓库配置以明文 JSON 保存到当前网页 origin 的 localStorage，下一次打开自动连接。此存储不是加密，电脑与手机各自设置；浏览器清理数据、私密模式、网址 / 端口变化或令牌到期后需重新连接。各设备可以使用不同令牌，但授权同一个仓库。

客户端必须持有令牌才能写入私有仓库，任何能在该页面运行的恶意脚本 / 浏览器扩展都可能读取内存。记住令牌还会让令牌在关闭页面后留在设备上，拥有设备访问权限的人也可能读取它。因此只在个人设备及你自己可信的网页上连接，不要随意输入到别人的在线演示。发现泄露时到 GitHub 撤销并重建令牌。

## 3. 发布网页入口

GitHub Free 的 Pages 支持公开仓库；私有仓库的 Pages 需要相应付费计划。参见 [GitHub 官方说明](https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site)。**网页公开不等于台账公开**：台账与令牌都不放进网页仓库。

已有私有源码仓库可以保留。如果没有支持私有 Pages 的套餐，另建一个公开的网页源码仓库，例如 `renewal-web`，只上传本项目源码、字体和示例数据。先检查不包含 `.env.local`、`.env.worker`、个人 JSON / CSV 备份、`upstream` 或真实凭据。不要把 `renewal-data` 公开。

本项目包含 `.github/workflows/pages.yml`：

1. 仓库根目录直接包含 `package.json`、`app/`、`components/` 和 `.github/`。
2. Settings → Pages → Source 选择 **GitHub Actions**。
3. 推送 main 或在 Actions 手动运行 `Publish ledger interface to GitHub Pages`。
4. 等流程完成，复制 Pages 给出的 HTTPS 地址。

构建会自动生成 `out/` 静态文件，并针对仓库子路径配置资源、图标、manifest 和 Service Worker。GitHub `username.github.io` 仓库为根路径，普通项目仓库为 `/仓库名/`。不需要给 Actions 配台账令牌或 Supabase 凭据。页面源码与例子公开，私人台账继续存在另一个 Private 仓库。

也可以本机导出静态网页后上传到其他静态托管，Windows 示例：

```powershell
$env:RENEWAL_STATIC_EXPORT='true'
$env:NEXT_PUBLIC_BASE_PATH='/renewal-web'
$env:NEXT_PUBLIC_LEDGER_ONLY='true'
npm run build
```

根域名部署将 BASE_PATH 设为空；这些是构建时配置。`out` 是生成产物，不要把私人台账复制到其中。静态托管不能应用 Next.js 的服务器响应头，HTTPS / 防护策略由托管平台负责。

## 4. 电脑和手机连接同一台账

1. 两台设备打开同一个正式网页。
2. 设置与数据 → GitHub 同步，填写用户名、私有数据仓库名称、令牌 → 连接私有仓库。
3. 若已有本地记录，**先导出 JSON 留存**，连接后再导入。导入新增，不覆盖；重复导入会产生重复项。
4. 在电脑添加订阅，成功后自动写入 GitHub；手机切回网页或点击右上角刷新读取。

保存 / 删除 / 导入均以整个 JSON 文件的 SHA 版本检查并发。另一设备同时修改会拒绝旧版本上传、刷新最新记录并提示重新打开，不会静默覆盖。没有自动合并；遇到冲突先核对最新记录，再重新编辑。网络超时可能已经写入 GitHub，页面会尝试刷新核对，不要未经核对重复导入。

页面打开时每分钟前台刷新，也会在切回 / 恢复可见时同步。关闭页面不运行任务；网络失败时保留当前可见记录、阻止新增写入，不排队离线修改。已连接模式的云端记录不自动写入本地永久缓存；重要时导出 JSON。

未勾选记住令牌时，刷新后应用回到原有本地台账，**不代表云端数据丢失**；再连接私有仓库即可。已记住时自动连接，失败会显示提示并保留原有本地记录和已保存令牌；网络错误不会删除令牌。可输入新令牌重试，只有连接成功才替换保存的令牌。取消勾选或「清除已保存令牌」立即删除持久令牌，但当前连接仍能使用；「断开同步」会清除保存的令牌并返回之前的本地记录，避免下次自动重连。两个模式不会相互覆盖。本地台账初始有示例数据，可删除或在设置中恢复例子。

“自动续费”记录服务商设置，不会替你扣费或跳过日期。台账模式不会自动推进已过期日期；核对实际账单后编辑下一次结算，避免未经确认就掩盖到期记录。

手机可以添加到主屏幕；触屏不启用 Cursor 效果。iPhone 表单使用 16px 输入字号避免聚焦缩放，手机将订阅列表排成卡片和单列表单；电脑保留表格、侧栏和多列统计。

## 限制与验证

- 每份文件最多 1,000 条、900 KB；每次导入最多 500 条。保存一次会产生一个 Git 提交。
- 删除当前台账条目不会删除 Git 历史中的旧内容。不要用备注存密码、完整银行卡号或 API 密钥；GitHub 管理者仍可访问该仓库的数据。
- 仓库私有状态在读取和写入前检查，但无法防止你稍后将仓库主动公开。不要修改数据仓库为 Public。
- 各设备首次自行输入令牌，可自愿记住并自动连接，无公开注册 / 共享账户功能。令牌失效或速率受限时重新配置或等待重试。
- 完成配置后，用真实电脑和手机验证：新增 → 刷新 → 编辑 → 删除 → 导出。先测试网络，再决定它是否适合你日常使用。

当前本地测试使用模拟 API 和两套浏览器上下文验证同步与冲突，没有访问你的私有仓库，没有生成真实令牌，没有发布 Pages。

参考：[GitHub Contents API](https://docs.github.com/en/rest/repos/contents)、[细粒度令牌](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens)、[GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site)。
