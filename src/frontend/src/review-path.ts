export type ReviewStep = { label: string; to: string; hint: string }
// Suggested order for a department review. It follows the acceptance checklist sections; it is guidance only,
// and every step's evidence must still be recorded by hand in the exported case-record file.
export const reviewPath: ReviewStep[] = [
  { label: '1. 设备接入：候选目录与矩阵覆盖', to: '/connectors', hint: '查看 10 类候选、接入前需确认事项、资产类别覆盖与未映射缺口' },
  { label: '2. 设备接入：目标清单与预检', to: '/integration', hint: '采集目标清单校验、单项预检、拟接入清单批量校验与取消等待' },
  { label: '3. 系统数据库：候选与部署预检', to: '/database', hint: '候选取值、部署预检前置条件、被监控目标与迁移计划清单' },
  { label: '4. AI 配置：协议、请求与响应契约', to: '/ai', hint: '离线协议目录、出站请求形状预览、合成响应拒止清单' },
  { label: '5. 提示词治理：版本、发布与绑定', to: '/prompt-governance', hint: '草稿版本、不可变发布修订、草稿比对、功能绑定与覆盖核对' },
  { label: '6. 后端联调：规则视图与台账', to: '/integration', hint: '审批/授权/执行三个只读规则视图、操作台账与本次会话评审证据' },
  { label: '7. 记录意见与结果', to: '/feedback', hint: '每页底部可记录本页意见；导出反馈 JSON 与证据包，并按模板填写用例结果' },
]
