# 外部 AI 协议适配与验证边界

> 本文描述第五轮离线适配阶段，不表示已获准使用外部模型。仅处理合成测试数据，不读取密钥、不发送HTTP请求。

## 分层

1. **协议适配**：把类型化的model/system/user/maxTokens/temperature转换成供应商请求JSON；把供应商非流式响应转换为文本、token用量、停止原因。
2. **受控传输（尚未实现）**：批准端点、DNS/IP检查、禁止重定向、TLS、超时、限流、凭据引用和响应大小限制。
3. **调用治理（尚未实现）**：用户/资源权限、数据脱敏、提示词版本与功能绑定、预算、审计、审批及故障降级。
4. **真实模型验证（尚未进行）**：使用经批准端点和测试数据，分别验证厂商版本、模型能力、错误、流式、成本与质量。

当前仅推进第1层。API目录中的整体供应商能力保持未验证/未外发，不因为纯函数测试通过就改成“生产已支持”。

## 预检接受的协议取值

`GET /api/v1/ai-protocols` 返回预检实际接受的协议标识（当前为 `OpenAiCompatible` 与 `Anthropic`），并逐项声明请求/合成响应契约名、`adapterImplemented=true` 与 `transportImplemented/liveVerified/credentialRead=false`。该目录与 `AiConnectionPolicy` 共用同一份接受集合，避免文档、界面与校验规则漂移。

注意两个命名空间不同：`/api/v1/ai-providers` 的目录标识（如 `openai-compatible`）仅用于展示，配置预检只接受本节的协议取值。AI 配置页与联调页的协议选项均由该接口显式载入后填充，未载入时不可提交，载入失败不回退本地清单。

## 出站请求形状预览

`POST /api/v1/ai-contract-preflight` 用固定的合成模型标识与演示文本调用既有适配器的 `BuildRequest`，返回**将要发送的载荷形状**，用于核对数据最小化。请求字段为严格必填且拒绝未知字段；合成文本上限 8192 字符，超出即拒绝且不回显内容；响应的 `networkVerified`、`transportImplemented`、`credentialRead` 恒为 false，`syntheticInput` 恒为 true。

该接口**不发送请求**、不解析凭据、不验证模型行为，也不返回任何模型输出；它只证明载荷构造与本地协议规则一致，不能替代第 3、4 层。

## 保留的模型标识

## 响应契约的可评审入口（第190轮）

离线适配器的**响应解析**规则同样开放为只读预检：`GET /api/v1/ai-response-scenarios` 与 `POST /api/v1/ai-response-preflight`。十五个服务端合成响应覆盖：合法响应（两种协议各一）、object/type 字段不符、角色不符、用量不自洽、结束原因不支持、输出为空、工具调用字段、提供方错误对象、重复属性、非法 JSON。每个结论都由对应适配器的真实解析器产生，返回 `accepted` 与结论代码；被拒场景不回显原始合成载荷。

这些接口**不发起网络请求**、不读取凭据、不调用模型：`liveCallPerformed`、`transportImplemented`、`productionEnabled` 恒为假。解析通过只表示离线契约自洽，不代表厂商兼容、真实调用成功或输出质量。



配置预检与请求形状预览都只接受保留的合成模型名（`demo-` 前缀加小写字母、数字或连字符，最多48字符）；真实厂商模型标识（如 `gpt-4o`、`claude-3-5-sonnet`）返回 400 `not_reserved_demo_model` 且**不回显提交值**。该规则与端点批准名单同属“Demo 只处理合成输入”的策略，不限制未来真实试点（真实试点需另行批准并改用独立契约）。

## 回环传输适配器（第210轮）

为验证“请求构造器与响应解析器在真实套接字上可用”，新增 `LoopbackModelTransport`：

- **端点白名单**：只接受 `http` 且主机为 `127.0.0.1`、`::1` 或 `localhost`，且 URL 不得带用户信息、查询串或片段；其它端点在任何连接尝试之前直接判为 `endpoint_not_loopback`。
- **不读凭据**：不发送 `Authorization` 头，也不读取任何密钥存储；请求体只包含调用方传入的合成文本。
- **有界读取**：响应超过 256 KiB 直接判 `response_too_large`；不把响应正文回显到结论中。
- **结论分类**：`parsed`、`refused`（`endpoint_not_loopback`/`unsupported_protocol`）、`timeout`（`loopback_timeout`，默认5秒）、`unreachable`（`loopback_unreachable`）、`rejected`（`http_status_not_ok`/`response_too_large`/解析器给出的具体代码，如 `invalid_json`、`exactly_one_choice_required`）。
- **与产品能力无关**：结论恒为 `LoopbackOnly=true`、`CredentialRead=false`、`ProductionTransportImplemented=false`；`transportImplemented` 与 `productionEnabled` 仍为假。

已用**本机进程内桩服务**（真实套接字）验证：合法响应经真实适配器解析出文本/用量/结束原因；桩返回 500、非法 JSON、choices 为空、超大正文与长时间不响应分别得到对应分类；连接被拒端口得到 `unreachable`；调用方取消会向上传播为取消。

演示 API 上有两个受 Demo 门控的只读/合成端点（生产 503、外域 403）：

- `POST /api/v1/ai-loopback-stub`（及 `/{behaviour}`）：合成桩，只接受**保留的演示模型标识**（`demo-` 前缀），按请求形状推断协议并回一个符合契约的响应，响应带 `demo_stub: true`，正文以 `[合成桩响应]` 开头。它**不是**模型：不推理、不联网，只按输入长度生成确定性的用量。
- `GET /api/v1/ai-loopback-stub-scenarios`：**服务端自有**的桩行为目录（8项），每项给出标识、名称、说明与**两种协议各自的预期结论代码**；界面据此选择，不能自造行为或结论。

桩行为（`behaviour`）与真实回环上的实测结论：

| 行为 | 说明 | 实测结论 |
| --- | --- | --- |
| `valid` | 合法响应 | `parsed`（HTTP 200，396字节） |
| `provider_error` | 响应含 error 字段 | `provider_error_not_supported` |
| `tool_calls` | 响应含工具调用字段 | `tools_not_supported` |
| `inconsistent_usage` | 用量不自洽（Messages 侧为输出令牌超限） | `inconsistent_usage` / `invalid_output_tokens` |
| `invalid_json` | 截断的非法 JSON | `invalid_json` |
| `http_500` | 桩以 500 回应 | `http_status_not_ok`（HTTP 500） |
| `oversized` | 响应超过 256 KiB | `response_too_large`（263564字节） |
| `slow` | 延迟 6 秒 | `loopback_timeout`（实测 5037 毫秒触发5秒超时） |

这使得拒止清单不再只靠合成 fixture：**每一个结论都在真实套接字上被复现**（`slow` 因耗时在常规检查中跳过，已单独实测一次）。
- `POST /api/v1/ai-loopback-exchange`：真实 HTTP 往返——默认打向本机自身的桩端点（取自当前连接的本地端口），因此演示无需外部依赖。端点为调用方覆盖时仍强制回环，非回环直接 400（连接前拒绝）。

已实测：两种协议均得到 `parsed`、HTTP 200，正文含合成标记、用量自洽、耗时数十毫秒，且 `loopbackOnly=true`、`credentialRead=false`、`productionTransportImplemented=false`、`syntheticStubOnly=true`。这仍然**不是外部 AI 接入**：`transportImplemented` 与 `productionEnabled` 恒为假，没有凭据读取、没有真实提供方、没有模型推理。

## 首批协议范围


| 协议 | 范围 | 明确不支持 |
| --- | --- | --- |
| OpenAI-compatible Chat Completions | 单个非流式文本结果、标准usage与finish_reason | 任意厂商扩展、Responses API、多模态、工具执行、流式 |
| Anthropic Messages | 非流式text内容块、input/output usage、stop_reason | tool_use执行、图片/附件、流式及未经验证的扩展块 |

不支持的工具或内容类型必须拒绝，不从中抽取貌似文本后标成功。输入、模型名、最大token、温度、响应长度和字段类型均有限制。测试结果必须标synthetic/testOnly，liveVerified保持false。

## 必测场景

- 两种协议正常请求构造与非流式文本解析。
- system消息位置及max_tokens等字段与各协议匹配。
- 空模型、空用户输入、非法温度、token上下限。
- 非JSON、错误对象、空内容、字段错型、输出过大。
- tool_calls/function_call/tool_use不得触发执行；未知内容块不得默默放行。
- token用量不得负数、溢出或被错型内容伪造。
- 文本仅作为字符串，不执行HTML、脚本或嵌套提示内容。

## 代码入口与限制

- `BuildRequest(AiDraftRequest)` 返回调用方负责Dispose的JsonDocument，不发送请求。
- `ParseSyntheticResponse(string)` 返回AiDraftResult，失败仅返回AiProtocolException安全Code，不拼接输入正文。
- model最多128字符；system/user各32768、合计49152字符；maxTokens为1至32768。
- OpenAI温度范围0至2，Anthropic为0至1；拒绝NaN及Infinity。
- 响应UTF-8最大262144字节、JSON深度16、文本65536字符、token用量上限10000000。
- OpenAI只接受一个choice且usage总和一致；Anthropic只连接text块。拒绝重复JSON字段、错误对象、工具字段/块、未知停止原因。
- fixture结果固定synthetic/testOnly；未来真实传输必须采用另一个明确的结果类型，不复用此类型冒充真实调用。

## 配置预检与真实连通分离

第六轮增加离线配置策略模块，输入批准主机清单与待校验配置，输出字段/错误代码，不回显原始秘密或端点内容。规则包括HTTPS、443端口、精确批准域名、无userinfo/query/fragment、非IP地址、限定secret引用、超时与token预算。批准清单由调用方受控配置提供，不能由待测试连接自行声称批准。

即使全部预检通过，仍只表示configurationValid；networkVerified和liveCallEnabled保持false。不解析DNS、不连接目标、不读取secret。

正式传输仍需：连接前解析全部A/AAAA并阻断未批准地址、连接时锁定已校验地址以避免DNS重绑定、禁用重定向、验证TLS主机、限定出口代理与响应大小、超时/取消、预算并发扣减及审计脱敏。内网模型若需要私有地址应单独定义并批准策略，不能通过本模块偷偷放宽公共外部API规则。

## 与现有原型关系

现有AI配置页仍仅模拟配置，知识助手仍固定示例回答。提示词服务器版本仍只是内存草稿，不自动调用此适配层。正式接通前必须补齐受控传输、鉴权、数据外发审批、secretRef解析与审计，不能直接在浏览器输入真实API Key。

验证实际计数与命令以 [更新日志](更新日志.md) 和 [原型验证记录](原型验证记录.md) 为准。
