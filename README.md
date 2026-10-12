# 企业 IT 运维平台

面向企业内网的 Web 运维工作台，统一资产、监控告警、常用诊断、受控操作与 AI 辅助。

## 文档导航

- [整体系统设计方案](docs/整体系统设计方案.md)：当前设计基线、模块、数据、接口、安全和分阶段交付。
- [初步想法](docs/想法.md)：需求背景与最初功能构想。
- [开发环境搭建记录](docs/开发环境搭建记录.md)：本机 WSL、数据库和 .NET 安装及已知限制。
- [更新日志](docs/更新日志.md)：每次实际变更与验证记录。
- [协作约定](AGENTS.md)：后续开发、日志同步、安全检查和本地提交规则。
- [迭代计划](docs/迭代计划.md)：原型优先与并行实施闭环。
- [持久化迁移契约草案](docs/持久化迁移契约草案.md)：Demo存储迁移前的事务、幂等与失败边界设计，尚未实现。
- [扩展兼容与AI配置设计](docs/扩展兼容与AI配置设计.md)：多数据库/设备、模型与提示词治理。
- [原型演示说明](docs/原型演示说明.md)：本机启动、部门交付与安全边界。
- [部门原型验收清单](docs/部门原型验收清单.md)：真实部门反馈与回归标准。
- [原型范围与验收清单映射](docs/原型范围与case映射.md)：本批次实际路由与 case 覆盖/排除对照，由脚本校验。
- [任务状态机实现边界](docs/任务状态机实现边界.md)：状态与事件词汇表核对、幂等键重放、结果未知对账。
- [AI协议适配验证](docs/AI协议适配验证.md)：离线请求/响应契约、端点批准名单、保留模型标识与验证层级。
- [授权策略实现边界](docs/授权策略实现边界.md)：角色/站点/审批绑定的纯规则范围与未实现部分。
- [原型验证记录](docs/原型验证记录.md)：实际技术测试及未覆盖范围，不代替部门签认。

## 技术方向

- 前端：React、TypeScript、Vite、Tailwind CSS、shadcn/ui、TanStack Query/Table。
- 后端：ASP.NET Core .NET 10 模块化单体，EF Core + Npgsql。
- 数据：PostgreSQL 16；Redis、向量检索等根据阶段需求引入。
- 任务：初期数据库持久任务 + BackgroundService；独立 Windows 执行节点仅运行白名单操作。
- AI：按用户权限检索与只读工具调用，变更操作后期经审批执行。

## 目前实现状态

持续迭代形成17页前端原型与 [后端 Demo API](src/backend/OpsPlatform.Api/Program.cs)。主业务页仍使用浏览器本地模拟数据；“后端联调”“设备接入”“系统数据库”“AI 配置”“提示词治理”等页通过开发代理实际访问本机 HTTP API，但服务器返回的也是内存演示数据，重启即丢失。不能用于生产。每页页头固定显示构建标识、数据模式与“本页限制说明”。

EF Core/Npgsql 依赖已声明，但尚无真实持久化 DbContext、迁移、企业认证或设备连接。已具备：平台数据库候选与离线部署预检（含文档保留地址主机策略）、外部模型离线协议与配置预检（含端点批准名单与保留模型标识）、10类设备候选目录/矩阵覆盖/单项与批量预检/接入前置清单/采集目标清单校验、提示词本地治理与服务器内存草稿·只追加版本·不可变发布修订·功能绑定、任务状态机模拟（词汇表核对、幂等键重放、结果未知对账）与进程内操作台账及其摘要·按操作ID对账。这些均为规则与演示数据，不代表真实适配或连通完成。

评审侧能力：所有联调面板只在显式点击后请求后端，响应结构不符即整批拒绝且不回退为本地清单；“本次会话评审证据”可把已核验结论导出为标记非生产的 JSON；反馈导出包与证据包都携带构建标识。静态评审包的 `prototype-manifest.json` 记录构建标识、页数与 case 范围，打包说明见演示说明。

## 验证入口

三类检查各自独立，任何一类通过都不代表部门验收或生产就绪：

```powershell
# 1) 前端与原型回归（构建 + 17页 + 各联调面板 + 静态服务检查）
powershell -ExecutionPolicy Bypass -File scripts/verify-prototype.ps1

# 2) 本机 Demo 后端契约（需先启动后端；仅本机、无外部网络）
node scripts/backend-contract.mjs
```

```bash
# 3) 后端 xUnit（WSL Ubuntu）
cd /mnt/e/codes/运维系统
dotnet test src/backend/OpsPlatform.slnx --no-restore
```

回归脚本会先执行本机 Demo 预检；如提示服务不可达、非 JSON 或旧版本，请先启动前后端并确认启动完成再重试。预检不自动启动服务，也不代表生产就绪；可单独运行 `node scripts/prototype-preflight.mjs`。清单条目与自动化检查的对应关系见《部门原型验收清单》第8节；实际通过数量与日期见更新日志，不在本文件硬编码，避免与实际漂移。

交付评审包：`powershell -ExecutionPolicy Bypass -File scripts/package-prototype.ps1`，产物在 `artifacts/packages/`（含静态文件、`prototype-manifest.json`、`serve-demo.mjs` 与 `DEMO-README.txt`）。

## 前端原型

具备 Node.js ≥22.6（建议受支持的24 LTS）与 pnpm 11.7.0 后：

```bash
cd src/frontend
pnpm install --frozen-lockfile
pnpm dev --host 127.0.0.1 --port 5173 --strictPort
```

本机也可运行 [原型启动脚本](scripts/start-prototype.ps1)。首次交付只监听本机；未开放内网/公网访问。部署到部门演示服务器的方法见原型演示说明。

浏览器自动检查需本机 Chrome/Edge（或以 `BROWSER_PATH` 指定 Chromium），统一入口是 `scripts/verify-prototype.ps1`；它按顺序运行构建、冒烟、可访问性、主流程、状态与反馈契约、范围映射、各联调面板（连接器/数据库/AI/提示词/任务/台账/证据包）与静态服务检查。单独运行某个脚本时，前后端需已按上文启动。

截图与检查输出保存在忽略目录 `artifacts/prototype`（含 `scope-summary.json`）。测试使用隔离浏览器上下文，不改变使用者浏览器中已有反馈。

## 本地构建（WSL Ubuntu）

```bash
cd /mnt/e/codes/运维系统
dotnet build src/backend/OpsPlatform.slnx
dotnet run --project src/backend/OpsPlatform.Api --launch-profile http
```

Demo API 固定监听 `http://localhost:5094`，仅 Development + Demo 模式对本机开放；生产模式拒绝业务访问。可用 [后端启动脚本](scripts/start-backend.ps1) 启动。`/health/live` 为进程存活检查；`/health/ready` **始终返回 503** 并给出**组件级报告**（`checks` 与 `blockers`）：持久化是否配置/可连接、鉴权与迁移是否缺失、外部网络是否关闭、演示 API 是否可用。就绪永远为否——演示存储可以落盘，但**没有迁移历史、保留策略与生产运维证据**，不能把 Demo 数据当就绪的生产系统。

演示存储有三种运行方式，都不改变“接口不声称持久化”的契约（`persistence: none/memory`，`/api/v1/storage-modes` 始终把 `durable` 与 `productionReady` 标为否）：

| 方式 | 启动 | 说明 |
| --- | --- | --- |
| 进程内存（默认） | `scripts/start-backend.ps1` | 重启即清空；反馈最多200条，台账最多500条 |
| 本机文件保留 | `scripts/start-backend-persistent.ps1` | 四类数据写 `artifacts/demo-data/*.json`；单进程、无事务、无并发写者 |
| 关系型（EF Core + SQLite） | `scripts/start-backend-sqlite.ps1` | 四个端口走真实数据库：唯一索引拒绝重复写入、事务保证插入与裁剪/状态与流水同生共死、条件更新实现 CAS |

```bash
dotnet test src/backend/OpsPlatform.slnx --no-restore
```

前端反馈暂存浏览器，与后端反馈不是同一存储，重启/清缓存边界需分别理解。默认（内存）模式下后端反馈与进程内操作台账重启即清空；文件与关系型模式会把它们落盘，但仍只是本机开发用途，不能当作生产持久化。

## 凭据与版本管理

- 不提交数据库密码、设备密码、令牌、证书私钥或真实日志样本。
- 写入路径有**服务端**凭据形态筛查作为纵深防御：反馈正文与提示词内容命中口令赋值、API Key、Bearer 令牌、私钥块等明显凭据形态时返回 400 且**不回显**命中内容。它只是形态筛查、不是 DLP，浏览器端的敏感提示同样只是辅助检查。
- 开发凭据使用本机 .NET User Secrets 或环境变量；生产使用专门凭据管理方案。User Secrets 并非加密保险库。
- 前端不得保存设备管理凭据；所有权限校验必须在后端执行。
- 修改代码或文档时同步记录更新日志，验证后本地提交；未经明确要求不推送远程仓库。
- [.gitignore](.gitignore) 排除常见生成目录、依赖目录与约定的本地配置；它不能自动识别所有秘密，提交前仍须审查暂存内容。

---

## 许可证

本项目采用 [MIT 许可证](LICENSE)。

## 第三方与上游声明

本项目包含或依赖第三方组件，其版权与许可证归各自作者所有，
详见仓库内的依赖清单与相关声明文件。若本项目基于其他开源项目二次开发，
已在正文中注明上游项目与所基于的版本，本项目为**非官方**衍生作品。

## 现状与限制

- 本项目为个人开发项目，按“现状”提供，不附带任何明示或暗示的担保。
- README 与代码注释中记录的验证结论仅针对当时的具体环境与版本，不代表在其他环境下同样成立。
- 涉及本地凭据的部分统一使用系统凭据库或环境变量，仓库内不含真实密钥；
  示例配置仅使用占位符。
