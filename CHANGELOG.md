# Changelog

FlareMo 使用 SemVer。每个 release 都要写清楚升级影响、Cloudflare 资源变化和 Memos 兼容面变化。

## v0.22.2

可靠性补丁：修复移动端长 memo 编辑器打不开、标签解析误伤代码块（含标签改名/删除会写坏代码块的严重缺陷）、历史月份热力图颜色错误；对齐文档门禁描述并升级 Worker 运行时依赖。**无 migration、无新增 Cloudflare 资源、无 API 破坏性变化、无认证面配置变化。**

### 修复

- **移动端（触摸布局）长 memo 点「编辑」打不开**（issue #155）。根因是 `RichComposerEditor` 的 autoFocus effect 在挂载同一提交周期里同步 dispatch 焦点事务；移动布局 + 长内容时初始内容应用与焦点事务竞态，ProseMirror 抛 `RangeError: Applying a mismatched transaction`。现改为下一帧聚焦，并用 `editor.isDestroyed` + try/catch 兜住挂载期文档替换；抽成 `focusEditorOnNextFrame` helper 并补 5 个单测。
- **代码块里的 `#xxx` 不再被当成标签**（issue #152）。保存期 `extractTags` 与 web composer 端的两份实现都改为跳过围栏代码块与行内代码；顺带修了标签改名/删除的两个既有缺陷——此前围栏分段是反的，**会改写代码块内容、反而漏改围栏前的正文**；行内代码段被提前 push 也会打乱片段顺序。补充围栏（``` / ~~~、info string、未闭合、多 fence、fence 前正文）与改名/删除回归测试。
- **编辑器内标签高亮不再装饰代码**：代码块/行内代码里的 `#tag` 不再显示品牌色 chip（纯视觉，此前会误导用户以为被识别成标签）。
- **历史月份热力图颜色错误**（issue #144 的收尾）。月视图改用「当月范围」的小时统计聚合着色，不再依赖 today 锚定的尾部窗口；当前年份加载中回退已加载的统计，历史年份保持诚实的空态；新建/编辑 memo 后日/周/月/年统计缓存一并失效。（采纳 #149 的思路，作者 @0Pluto，并补空间过滤、当年兜底、缓存失效三处遗漏）
- **文档门禁描述对齐**：`llms.txt` 删除不存在的 `README.en.md` 链接、CI 时长改为约 14 分钟、全量门禁表述改为「只在维护者明确要求时本地执行」；修复 `docs/en` 两处死链。

### 工程卫生

- **worker 运行时依赖 hono 升级到 `^4.13.13`**，修 GHSA-5r4p-p66f-jhc7（`serveStatic` 二次解码；本项目未使用 `serveStatic`，但这是生产依赖里唯一的 moderate advisory）。
- `.gitignore` 增加 `/wrangler.*.jsonc`：`wrangler.kosx.jsonc` / `wrangler.personal.jsonc` 含真实 account_id 与 D1 id，此前只靠本机 `.git/info/exclude` 忽略，换机克隆后 `git add -A` 有误提交风险。
- 新增测试：标签代码块解析与改写回归（domain 23 例）、composer 标签一致性（web）、autoFocus helper（5 例）、月热力聚合纯函数（3 例）。

### Memos 兼容面变化

- 无 API 形状变化。`/api/v1` 的 memo `tags` 与 UI 同源；本版起代码块/行内代码内以 `#` 开头的词不再进入 `tags`（与「代码不是正文」的预期一致）。客户端在请求体显式传 `tags` 时仍以客户端值为准，解析规则不变。

### 数据库 migration

- 无。

### Cloudflare 资源变化

- 无新增或改名。部署前无需手动操作。

### Better Auth 应用认证变化

- 无破坏性变化。cookie session、bootstrap、注册开关、PAT 前缀与撤销行为、`FLAREMO_PUBLIC_URL` / `FLAREMO_TRUSTED_ORIGINS` 与各 secret 的配置要求均不变。

### 升级步骤

1. 直接部署即可（无 migration、无资源变化）。
2. 存量 memo 中历史上从代码块提取出的错误 tags **不会自动回填**；如需清理需单独评估一次性脚本（只影响旧数据，新写入与再次编辑已正确）。

### 已知问题

- 团队空间过滤（`space≠all`）时月热力回退 `notesCountMap`（该接口无空间参数，覆盖最近 366 天），历史月份在该过滤下仍为空态——属已知取舍。
- 编辑器内的标签自动补全（`tag-autocomplete`）尚未排除代码块上下文，纯输入期提示、不影响落库。
- 兼容面仍未覆盖完整 CEL、完整上游 webhook 事件/egress 语义、完整多用户 ACL、原生 JWT parity，第三方客户端 smoke test 仍未完成。

## v0.22.1

登录可靠性补丁版本：修复两处「登录/会话异常时界面静默卡死」的问题（由 2026-10-10 实例支持事件驱动），并滚动合入 v0.22.0 以来的站点、Worker 与工程卫生修复。**无 migration、无新增 Cloudflare 资源、无 API 破坏性变化、无认证面配置变化。**

### 修复

- **登录成功后不再可能静默卡在登录页**。症状：账号密码正确、服务端已成功建立会话并下发 cookie，但浏览器端「会话确认」请求一旦停滞，页面既不报错也不跳转，用户以为登录失败（当日实例上同一账号连续三次登录成功、浏览器始终未离开表单）。现在提交成功后启动 5 秒看门狗：确认未及时返回就降级为整页导航——会话 cookie 已就位，重载直接进入工作区；若重载后仍无会话（浏览器拒存 cookie），明确提示检查 Cookie 设置，不再无声循环。
- **工作台使用中的会话失效恢复**：资源请求返回 401 触发全局事件后，守卫除清空缓存并锁定外，现在会立即复核真实会话——已失效则跳转登录页；会话仍有效（个别资源被拒）则自动回到工作台，不再需要手动刷新或等待窗口聚焦。
- **触摸设备认证控件与热力图焦点**：移动端登录/注册输入框加大触达面积并防止聚焦缩放；热力图格子补齐键盘可访问性与悬停提示。
- **Worker：队列任务隔离与保留清理设界**：成员移除与数据导出队列的任务处理相互隔离，保留期清理有明确上限；管理端用户列表改为单次联表查询（过期读者座位的 fail-closed 语义保留）。
- **记忆插件（harness）MCP 传输加固**：请求超时覆盖响应体读取（此前只覆盖响应头，挂起的 body 会拖死调用方），失败重试边界收敛。
- **站点（文档站）**：文档内容延迟加载与导航改进；静态文档稳定化并补全 fork 部署文档。
- **测试**：日历 API 测试的日期定时炸弹修复（窗口改按「固定区间 ∪ 今天」动态推导，不再随日期推进失效）。

### 工程卫生

- **修复：`pnpm plugins:build` 与 `pnpm build:site` 自 e88faa2e 起完全无法运行**（P0）。该提交为「把 zip 编解码器移出启动图（#138）」把 `zipPluginFiles` 从同步改成 `async`（内部 `await loadZip()`），但 `scripts/plugins-build.ts` 的调用方漏了 `await`——`writeFile` 收到的是 Promise 而非 Uint8Array，抛 `ERR_INVALID_ARG_TYPE`。瘦 CI 不跑 build，所以门禁没能拦住。调用点只有一处（测试全写对了），补 `await` 即恢复。连带后果：`plugins/registry.json` 停留在 2026-09-20 的旧产物，与当前插件源码的 sha256/size 已不一致（重新生成后 3 个插件的哈希与体积均变化），站点商店展示的校验值一度对不上实际打包结果。
- **修复：部署文档在文档站上一直是死链**。`docs/github-action-deploy.md` 与 `docs/en/github-action-deploy.md` 中英文双份都存在，但从未登记进 `docs-source.generated.ts` 的 `ZH_DOCS`/`EN_DOCS`，也没进 `scripts/build.mjs` 的 `DOC_SLUGS`——README 的 Method 2 与文末链接都指向它，站点上却访问不到。现已登记上线（标题、group、中英文描述齐备），SSG 路径随 16→17 个 slug 展开。
- **新增 `docs-registry.test.ts` 守护文档清单**。发布一篇文档要手工改三处（markdown 文件、`ZH_DOCS`/`EN_DOCS`、`DOC_SLUGS`），此前只有 `build.mjs` 里一句 `Keep in sync` 注释兜着，而 `apps/site` 的测试是 `--passWithNoTests`。现在断言：`DOC_SLUGS` 与中文注册表逐条同序、slug 无重复、每个 slug 在 `docs/` 有文件、**`docs/en/` 下每个文件都已作为真翻译暴露**（漏删 `fallbackFromZh` 标记会让译文永远不进英文侧边栏与 sitemap，此前无任何报错）、英文 slug 必须是中文子集、中文文档描述非空。
- **新增 i18n 占位符一致性门禁**（`parity.test.ts`）。`interpolate` 用 `params[key] ?? match` 兜底，所以译文漏写或拼错 `{count}` 有两种静默失败：调用方传的值被丢弃（界面显示"共 条"），占位符本身漏进 UI 显示成 `{cunt}`。键集合一致性与非空检查都查不出这两类。现按 master 目录逐键比对占位符集合，8 种语言 54 个带占位符的键当前全部一致。
- **CI 超时余量**：`ci.yml` 的 `timeout-minutes` 由 20 提到 30。实测耗时约 14 分钟，余量只有 6 分钟，而 CI 机器波动会让耗时自然漂移；job 超时会把还在跑的步骤直接杀掉，拿不到"哪一步慢"的信号。门禁范围不变（仍是 format / lint / typecheck / 单元测试）。
- **README 8 语言同步 v0.22.0**：v0.22.0 的团队项目工作台（`/team-projects`）在 v0.22.0 发布（2026-09-29）后的 8 份 README 中全部缺席——README 自 2026-09-23 起未更新。现按「主 README 为基准、7 个译本逐节 1:1 镜像」的规则，在"团队协作"节同步补入各语言的条目。

### Memos 兼容面变化

- 无。

### 数据库 migration

- 无。

### Cloudflare 资源变化

- 无新增或改名。部署前无需手动操作。

### Better Auth 应用认证变化

- 无破坏性变化。cookie session、bootstrap、注册开关、PAT 前缀与撤销行为、`FLAREMO_PUBLIC_URL` / `FLAREMO_TRUSTED_ORIGINS` 与各 secret 的配置要求均不变；本版仅增强前端在「会话确认停滞」与「使用中收到 401」两种异常下的恢复行为。

### 升级步骤

1. 直接部署即可（无 migration、无资源变化）。
2. 升级后无需手动操作。

### 已知问题

- 团队项目工作台目前只有中英文文案，其余语言回落到英文。
- 「降级为读者后仍可编辑自己既有团队笔记」的权限边界待决策（v0.22.0 起记录在案，本版未变更）。
- 兼容面仍未覆盖完整 CEL、完整上游 webhook 事件/egress 语义、完整多用户 ACL、原生 JWT parity，第三方客户端 smoke test 仍未完成。

## Unreleased（harness 插件，未发版）

### 修复

- **L1 开工锦囊不再把网络请求放在会话启动关键路径上**（2026-10-03 实测事故驱动：一次 2.5s 窗口内的网络抖动导致整个会话降级使用无年龄标注的旧快照，且快照越不稳越旧）。改为读副本模型（spec v0.3 §5.5）：
  - session-start / pre-invocation 读本地快照**即注**（统一头注 + 快照年龄，如"2 小时前的版本"），0ms 网络；≤10 分钟的新副本不再触发刷新。
  - 后台新增 `flaremo maintain`（hook detached spawn，`FLAREMO_NO_MAINTAIN=1` 可关）：outbox 补写 + lens 副本刷新（8s ×2，重试统一收进 transport 层 `requestWithRetry`；CLI 交互读命令同样受益）。投影与已注入内容不同时落 delta 文件。
  - **降级不再粘连**：served-from-replica 的会话在下一条 UserPromptSubmit / PreInvocation **一次性**补注 delta（`fetchedAt > 会话 startedAt` 守卫，刷新后新开的会话自然跳过），"一次抖动毒化全场"变成"最多落后一轮"。投影仍由服务端 `memory_compile` 编译，客户端只比对不重渲染。
  - 冷启动（完全无副本）是唯一的例外路径：单次 1.5s 尝试，失败注入显式不可达声明（原契约不变）。
  - 快照离线注改为如实陈述（"后台刷新已在进行"），不再断言本次会话从未观察过的"服务不可达"。
- **可观测性**：新增 `~/.flaremo/events.jsonl`（1MB 轮转、永不上传）记录每次 hook 的服务层（replica/live/unreachable）、delta 注入与 maintain 结果——静默降级路径从此可以事后 grep，而不是靠代理日志考古；`doctor` 新增"读副本"一行（快照数 + 最旧年龄）。

### 兼容性

- 无 migration、无服务端改动、无 API 破坏性变化。会话状态文件新增 `lensFromSnapshot` / `awaitingLens` 字段（旧文件缺省按 false 处理，天然兼容）；delta 文件 24h TTL 自动清理。
