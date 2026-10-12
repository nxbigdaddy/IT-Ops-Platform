import { Link } from 'react-router-dom'
import { reviewPath } from './review-path'
export default function ReviewPath() {
  return <section className="panel" aria-label="部门评审建议路径" style={{ padding: 16 }}>
    <div className="panel-head"><div><h2>部门评审建议路径</h2><p>按验收清单顺序排列的建议步骤，可直接点开对应页面；顺序只是建议，不代表已完成或已通过</p></div></div>
    <ol style={{ margin: '8px 0 0', paddingLeft: 20 }}>
      {reviewPath.map(step => <li key={step.label} style={{ marginBottom: 6 }}>
        <Link to={step.to}>{step.label}</Link>
        <p className="field-note" style={{ margin: 0 }}>{step.hint}</p>
      </li>)}
    </ol>
    <p className="field-note">每条步骤的结果仍需人工按 <code>case-records-template.csv</code> 记录并附证据；自动化检查通过不代填部门结论。</p>
  </section>
}
