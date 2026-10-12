export type NavRoute = { to: string; label: string; group?: string; limits: string }
// Build id is injected by vite.config.ts from the current commit so reviewers can quote an exact build.
declare const __PROTOTYPE_BUILD__: string
export const prototypeBuildId = typeof __PROTOTYPE_BUILD__ === 'string' ? __PROTOTYPE_BUILD__ : 'unknown'
// Single source for navigation; the smoke test and the scope-mapping check both read this.
// Per-page limitations, rendered once in the page heading so the disclosure cannot drift per page.
export const navRoutes: NavRoute[] = [
  { to: '/', label: '工作台', group: '工作空间', limits: '本页指标与待办均为固定模拟样本，不代表真实设备或工单现状。' },
  { to: '/assets', label: '资产', limits: '资产、位置与负责人均为合成数据；筛选与详情不查询任何真实资产系统。' },
  { to: '/alerts', label: '告警', limits: '告警为固定样本；确认、忽略与转工单只改变本机模拟状态。' },
  { to: '/tickets', label: '工单', limits: '工单为合成记录；状态流转不触发真实审批、通知或执行。' },
  { to: '/directory', label: 'AD 目录', group: '部门业务域', limits: '账号、组与登录信息均为合成数据；未连接任何域控或目录服务。' },
  { to: '/permissions', label: '共享权限', limits: '共享路径与权限清单为合成数据；不会读取或修改真实文件权限。' },
  { to: '/printing', label: '打印管理', limits: '打印机与耗材为合成数据；未连接打印服务器或设备。' },
  { to: '/virtualization', label: '虚拟化', limits: '主机与虚机清单为合成数据；未连接虚拟化平台。' },
  { to: '/backup', label: '备份巡检', limits: '备份任务与巡检结果为合成数据；不代表真实备份可用性。' },
  { to: '/knowledge', label: '知识库 / AI 助手', limits: '知识条目与助手回答均为本地模拟文本；未调用任何模型或外部服务。' },
  { to: '/connectors', label: '设备接入', group: '平台配置', limits: '候选目录、矩阵与目标清单校验均为规划内容；不连接设备、不采集、不执行。' },
  { to: '/database', label: '系统数据库', limits: '候选、部署预检与示例配置均为离线规则；未创建数据库、未执行迁移。' },
  { to: '/ai', label: 'AI 配置', limits: '仅离线契约与预检；无密钥输入、无网络传输、无真实模型验证。' },
  { to: '/prompts', label: '提示词管理', limits: '提示词与渲染结果保存在当前浏览器；模拟渲染不是 AI 生成，刷新或重置会丢失。' },
  { to: '/prompt-governance', label: '提示词治理', limits: '草稿、版本与发布修订存于本机浏览器或本机 Demo 内存，重启即丢失；不代表已审批或已上线。' },
  { to: '/feedback', label: '验收反馈', group: '协作与验证', limits: '反馈记录仅存当前浏览器，跨设备不共享；状态字段是模拟流转，不等于部门签认。' },
  { to: '/integration', label: '后端联调', limits: '仅显式点击才请求本机 Demo API；响应为内存数据，重启即丢失，且非生产就绪。' },
]
