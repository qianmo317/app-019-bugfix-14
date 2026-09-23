// 图纸编辑器：左参数 | 中三视图 | 右切割步骤与提示（蓝图 §6）
import { useMemo, useRef, useState } from 'react'
import type { Drawing, JointKind, Params, Wood, Fit } from '../types'
import { KIND_LABEL } from '../types'
import { computeJoint } from '../lib/calc'
import { buildViews } from '../geometry/views'
import { buildCutList } from '../lib/cutlist'
import { fmtClosure } from '../lib/format'
import { getPlan, upsertPlan, downloadJSON, deletePlan } from '../store/plans'
import { navigate } from '../router'
import { ViewSvg, CheckRuler } from '../components/ViewSvg'
import { ParamForm } from '../components/ParamForm'
import { DEFAULT_FIT_TABLE, WOOD_LABEL, loadFitTable, saveFitTable, type FitTable } from '../lib/fit'

export function EditorPage({ id }: { id: string }) {
  const [plan, setPlan] = useState<Drawing | undefined>(() => getPlan(id))
  const [dirty, setDirty] = useState(false)
  const [savedTick, setSavedTick] = useState(0)
  const recalcMs = useRef(0)

  // 参数改动即时重算（验收：<100ms）
  const computed = useMemo(() => {
    if (!plan) return null
    const t0 = performance.now()
    const r = computeJoint(plan.joints[0])
    const views = buildViews(plan.joints[0], r)
    recalcMs.current = performance.now() - t0
    return { result: r, views, cut: buildCutList(plan.joints[0], r.dovetail, r.tenon) }
  }, [plan, savedTick])

  if (!plan) {
    return (
      <div className="page">
        <p className="error">方案不存在或已删除</p>
        <button className="btn" onClick={() => navigate('/')}>回方案列表</button>
      </div>
    )
  }

  const joint = plan.joints[0]

  const updateParams = (p: Params) => {
    setPlan((prev) =>
      prev
        ? { ...prev, joints: [{ ...prev.joints[0], params: p }], updatedAt: Date.now() }
        : prev,
    )
    setDirty(true)
  }
  const updateKind = (k: JointKind) => {
    setPlan((prev) => (prev ? { ...prev, joints: [{ ...prev.joints[0], kind: k }], updatedAt: Date.now() } : prev))
    setDirty(true)
  }

  const save = () => {
    if (!plan) return
    upsertPlan(plan)
    setDirty(false)
    setSavedTick((t) => t + 1)
  }

  return (
    <div className="page editor-page" data-testid="editor-page">
      <div className="page-head">
        <h1>{plan.title}</h1>
        <div className="head-actions">
          <button className="btn btn-secondary" data-testid="export-json" onClick={() => downloadJSON(plan)}>
            导出 JSON
          </button>
          <button className="btn btn-secondary" data-testid="go-print" onClick={() => navigate(`/plan/${plan.id}/print`)}>
            打印视图
          </button>
          <button className="btn btn-primary" data-testid="save-plan" onClick={save}>
            保存
          </button>
        </div>
      </div>

      {dirty && (
        <div className="dirty-bar" role="status" data-testid="dirty-bar">
          参数已改，请重新核对尺寸
          <button className="btn btn-sm btn-primary" onClick={save}>保存</button>
        </div>
      )}

      <div className="editor-grid">
        <aside className="col-params">
          <h2>榫卯类型</h2>
          <select
            data-testid="editor-kind"
            value={joint.kind}
            onChange={(e) => updateKind(e.target.value as JointKind)}
          >
            {(Object.keys(KIND_LABEL) as JointKind[]).map((k) => (
              <option key={k} value={k}>{KIND_LABEL[k]}</option>
            ))}
          </select>
          <h2>参数</h2>
          <ParamForm kind={joint.kind} params={joint.params} onChange={updateParams} />
          <FitTableEditor />
        </aside>

        <main className="col-views">
          {computed && computed.result.warnings.length > 0 && (
            <div className="warnings" role="alert" data-testid="warnings">
              {computed.result.warnings.map((w, i) => (
                <p key={i}>⚠ {w}</p>
              ))}
            </div>
          )}
          <div className="views" data-testid="views">
            {computed?.views.map((vm) => <ViewSvg key={vm.id} vm={vm} />)}
          </div>
          <p className="note" data-testid="recalc-ms">重算耗时 {recalcMs.current.toFixed(1)}ms（要求 &lt;100ms）</p>
          {computed && joint.kind.startsWith('dovetail') && computed.result.dovetail && (
            <ToothTable dt={computed.result.dovetail} width={joint.params.boardA.width} />
          )}
        </main>

        <aside className="col-steps">
          <h2>切割步骤</h2>
          {computed && <CutSteps cut={computed.cut} />}
          <button
            className="btn btn-danger btn-sm"
            data-testid="delete-plan"
            onClick={() => {
              deletePlan(plan.id)
              navigate('/')
            }}
          >
            删除方案
          </button>
        </aside>
      </div>
    </div>
  )
}

function ToothTable({
  dt,
  width,
}: {
  dt: NonNullable<ReturnType<typeof computeJoint>['dovetail']>
  width: number
}) {
  const sumTop = dt.teeth.reduce((s, t) => s + t.topW, 0)
  const sumRoot = dt.teeth.reduce((s, t) => s + t.rootW, 0)
  const sumPitch = dt.teeth.reduce((s, t) => s + t.pitchW, 0)
  const slotRoot = sumRoot - dt.teeth[dt.teeth.length - 1].rootW // 前 n−1 个齿根槽；末齿齿根拆成左右两个半齿边距
  const ledger: { name: string; w: number }[] = [
    { name: '左边距（半齿）', w: dt.leftMargin },
    ...dt.teeth.flatMap((t) => {
      const rows = [{ name: `齿 ${t.index} 齿顶`, w: t.topW }]
      if (t.index < dt.teeth.length) rows.push({ name: `齿 ${t.index} 齿根槽`, w: t.rootW })
      return rows
    }),
    { name: '右边距（半齿）', w: dt.rightMargin },
  ]

  let cursor = 0
  const ledgerRows = ledger.map((row) => {
    const start = cursor
    const end = cursor + row.w
    cursor = end
    return { ...row, start, end }
  })

  return (
    <div className="tooth-table-wrap">
      <h2>齿宽分配表</h2>
      <table className="tooth-table" data-testid="tooth-table">
        <thead>
          <tr>
            <th>齿号</th>
            <th>齿顶起点</th>
            <th>齿顶宽</th>
            <th>齿根宽</th>
            <th>齿距＝齿顶＋齿根</th>
            <th>齿顶终点</th>
          </tr>
        </thead>
        <tbody>
          {dt.teeth.map((t) => (
            <tr key={t.index} data-testid={`tooth-row-${t.index}`}>
              <td>{t.index}</td>
              <td>{fmtClosure(t.faceX)}</td>
              <td>{fmtClosure(t.topW)}</td>
              <td>{fmtClosure(t.rootW)}</td>
              <td>{fmtClosure(t.pitchW)}</td>
              <td>{fmtClosure(t.faceXEnd)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td>合计</td>
            <td>—</td>
            <td data-testid="sum-top">{fmtClosure(sumTop)}</td>
            <td data-testid="sum-root">{fmtClosure(sumRoot)}</td>
            <td data-testid="sum-pitch">{fmtClosure(sumPitch)}</td>
            <td>—</td>
          </tr>
        </tfoot>
      </table>

      <h3>从左端逐段累加</h3>
      <table className="tooth-table closure-ledger" data-testid="closure-ledger">
        <thead>
          <tr>
            <th>段名</th>
            <th>段宽</th>
            <th>本段起点</th>
            <th>本段终点</th>
          </tr>
        </thead>
        <tbody>
          {ledgerRows.map((row, i) => (
            <tr key={i}>
              <td>{row.name}</td>
              <td>{fmtClosure(row.w)}</td>
              <td>{fmtClosure(row.start)}</td>
              <td>{fmtClosure(row.end)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="note" data-testid="closure-check">
        左边距 {fmtClosure(dt.leftMargin)}mm ＝ 右边距 {fmtClosure(dt.rightMargin)}mm
        （各为端齿齿根 {fmtClosure(dt.teeth[0].rootW)}mm 的一半）
      </p>
      <p className="note">
        逐齿核对：每一行「齿顶宽 ＋ 齿根宽 ＝ 齿距」；Σ齿距 = {fmtClosure(sumPitch)}mm ＝ 板宽 {fmtClosure(width)}mm。
      </p>
      <p className="note">
        注意：末齿行的齿根宽不是末齿右侧再另加的一段，它等于左右两个半齿边距之和；所以顺序累加表的最后一段只加右边距。
      </p>
      <p className="note">
        顺序核对：左边距 {fmtClosure(dt.leftMargin)} ＋ Σ齿顶 {fmtClosure(sumTop)} ＋ 前 n−1 个齿根槽 {fmtClosure(slotRoot)}
        ＋ 右边距 {fmtClosure(dt.rightMargin)} ＝ {fmtClosure(dt.leftMargin + sumTop + slotRoot + dt.rightMargin)}mm；
        板宽 {fmtClosure(width)}mm，闭合误差 {dt.closureError.toFixed(3)}mm。
      </p>
    </div>
  )
}

function CutSteps({ cut }: { cut: ReturnType<typeof buildCutList> }) {
  return (
    <div data-testid="cut-steps">
      <h3>件 A</h3>
      <ol className="steps">
        {cut.boardA.map((s) => (
          <li key={s.no}>
            <strong>{s.action}</strong>
            <span>{s.detail}</span>
          </li>
        ))}
      </ol>
      <h3>件 B</h3>
      <ol className="steps">
        {cut.boardB.map((s) => (
          <li key={s.no}>
            <strong>{s.action}</strong>
            <span>{s.detail}</span>
          </li>
        ))}
      </ol>
      <h3>注意事项</h3>
      <ul className="cautions">
        {cut.cautions.map((c, i) => (
          <li key={i}>{c}</li>
        ))}
      </ul>
    </div>
  )
}

export function FitTableEditor() {
  const [table, setTable] = useState<FitTable>(() => loadFitTable())
  const [saved, setSaved] = useState(false)
  const set = (wood: Wood, fit: Fit, v: number) => {
    setSaved(false)
    setTable((prev) => ({ ...prev, [wood]: { ...prev[wood], [fit]: v } }))
  }
  return (
    <details className="fit-table-editor">
      <summary>配合余量表（经验值，可编辑）</summary>
      <table className="fit-table">
        <thead>
          <tr>
            <th></th>
            <th>紧</th>
            <th>标准</th>
            <th>松</th>
          </tr>
        </thead>
        <tbody>
          {(['hardwood', 'softwood'] as Wood[]).map((w) => (
            <tr key={w}>
              <th>{WOOD_LABEL[w]}</th>
              {(['tight', 'standard', 'loose'] as Fit[]).map((f) => (
                <td key={f}>
                  <input
                    type="number"
                    step={0.1}
                    aria-label={`${w}-${f}`}
                    value={table[w][f]}
                    onChange={(e) => set(w, f, parseFloat(e.target.value) || 0)}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="actions">
        <button
          className="btn btn-sm btn-primary"
          data-testid="save-fit-table"
          onClick={() => {
            saveFitTable(table)
            setSaved(true)
          }}
        >
          保存余量表
        </button>
        <button className="btn btn-sm" onClick={() => setTable(DEFAULT_FIT_TABLE)}>恢复默认</button>
        {saved && <span className="ok">已保存</span>}
      </div>
      <p className="note">来源：木工经验值（非标准规范）。榫厚 = 料厚×比例 + 表值。</p>
    </details>
  )
}

export function PrintPage({ id }: { id: string }) {
  const plan = getPlan(id)
  if (!plan) return <div className="page"><p className="error">方案不存在</p></div>
  const joint = plan.joints[0]
  const r = computeJoint(joint)
  const views = buildViews(joint, r)
  return (
    <div className="page print-page" data-testid="print-page">
      <div className="print-toolbar no-print">
        <button className="btn btn-primary" data-testid="do-print" onClick={() => window.print()}>
          打印（1:1）
        </button>
        <button className="btn" onClick={() => navigate(`/plan/${plan.id}`)}>返回编辑</button>
        <span className="note">打印前关闭「适应页面/缩放」，选择 A4、100% 缩放</span>
      </div>
      <h1 className="print-title">{plan.title}</h1>
      <section className="print-section">
        <h2>校验尺</h2>
        {views.map((vm) => (
          <div key={vm.id} className="print-view-block">
            <ViewSvg vm={vm} widthMm={vm.contentW + 48} />
          </div>
        ))}
        <div className="print-view-block">
          <CheckRuler />
        </div>
      </section>
      <section className="print-section">
        <h2>1:1 模板页（剪下贴在木料上描线）</h2>
        <div className="print-view-block">
          {views[0] && <ViewSvg vm={views[0]} widthMm={views[0].contentW + 48} />}
        </div>
      </section>
      <section className="print-section">
        <h2>切割步骤</h2>
        <CutSteps cut={buildCutList(joint, r.dovetail, r.tenon)} />
      </section>
    </div>
  )
}
