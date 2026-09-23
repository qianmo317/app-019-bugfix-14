// 燕尾榫齿宽分配算法（带约束的分配问题，纯函数）
// 设计约定（蓝图 §8）：
//  - 在齿板正面（展示面）划线：边距(半齿) + 齿顶1 + 槽(=齿根1) + 齿顶2 + ... + 齿顶n + 边距
//  - 均衡布局：齿间槽宽 = 对应齿根宽、两边距之和 = 末齿齿根宽 → Σ齿顶 + Σ齿根 = 板宽（严格闭合）
//  - 第 i 齿齿距 pitch[i] = 齿顶宽[i] + 齿根宽[i]（严格相等，逐齿可核）
//  - 齿顶宽（展示面）= 齿根宽 + 2 × 斜移量；斜移量 = 齿深 / 角度比 r（1:r）
import type { Wood } from '../types'
import { round01 } from './format'

const U = 0.1 // 0.1mm 网格

/** 齿根最小安全宽度（mm，经验值） */
export const MIN_ROOT: Record<Wood, number> = { softwood: 6, hardwood: 4 }

export interface DovetailInput {
  width: number     // 齿板宽度 W (mm)
  thickness: number // 齿板厚度 t (mm)
  ratio: 6 | 7 | 8  // 角度比 1:r
  teeth?: number    // 齿数（缺省自动建议）
  kerf: number      // 锯路宽度 (mm)
  wood: Wood
  blind?: boolean          // 半隐燕尾
  blindDepthRatio?: number // 半隐深度比例，默认 0.75
}

export interface ToothCell {
  index: number  // 齿号 1..n
  topW: number   // 齿顶宽（展示面）
  rootW: number  // 齿根宽（背面）
  faceX: number  // 展示面左边缘 x 坐标
  backX: number  // 背面左边缘 x 坐标
}

export interface PinCell {
  index: number
  faceX: number
  faceW: number
  backX: number
  backW: number
  half: boolean // 边缘半齿
}

export interface DovetailResult {
  teeth: ToothCell[]
  pins: PinCell[]
  margin: number      // 首尾半齿边距（左右对称，= 末齿齿根宽 / 2；末齿齿根为奇数格时含 0.05）
  slopeOffset: number // 单边斜移量 = 齿深 / r
  depth: number       // 齿深（穿透=板厚，半隐=0.75×板厚）
  pitch: number       // 名义齿距 W/n（警告判定用；每齿实际齿距见 teeth[i].topW + rootW）
  warnings: string[]
  closureError: number // 实测闭合误差 |Σ齿距 − 板宽|（即 |Σ齿顶 + Σ齿根 − 板宽|）
  gridWidth: number    // 分配所用板宽（0.1mm 网格值，与输入宽相差 ≤0.05）
  minRootW: number
  minTopW: number
}

/** 齿数自动建议：目标齿距约 28mm，并保证齿根宽不低于最小安全值 */
export function suggestTeeth(
  width: number,
  thickness: number,
  ratio: 6 | 7 | 8,
  wood: Wood,
  blind = false,
): number {
  const depth = blind ? thickness * 0.75 : thickness
  const off = depth / ratio
  let n = Math.max(2, Math.min(12, Math.round(width / 28)))
  while (n > 2 && width / (2 * n) - off < MIN_ROOT[wood]) n--
  return n
}

export function computeDovetail(input: DovetailInput): DovetailResult {
  const { width, thickness, ratio, kerf, wood, blind } = input
  const warnings: string[] = []
  const depth = round01(thickness * (blind ? (input.blindDepthRatio ?? 0.75) : 1))
  const slopeOffset = depth / ratio
  const n = input.teeth ?? suggestTeeth(width, thickness, ratio, wood, blind)
  const minRootW = MIN_ROOT[wood]
  const minTopW = round01(2 * kerf)

  // —— 0.1mm 网格上的严格闭合分配 ——
  // 1) 板宽量化到 0.1mm 网格（输入任意小数 → 网格宽，相差 ≤0.05）
  // 2) 累积取整差分把总网格分给 n 个齿距：
  //      pitch[i] = round(W(i+1)/n) − round(Wi/n)  →  Σpitch 严格 = 总网格，逐齿偏差 ≤1 格
  // 3) 齿顶/齿根在同一齿距内互补分配：top = round((pitch + d)/2)，root = pitch − top
  //      → 每齿 top + root = pitch（严格相等），top − root 与 2×斜移量相差 ≤1 格
  // 4) 边距 = 末齿齿根宽 / 2（左右同值）；末齿齿根拆成两边距，故 Σ齿顶 + Σ齿根 = 网格宽
  const totalUnits = Math.round(width / U)
  const pairUnits = Array.from({ length: n }, (_unused, i) =>
    Math.round((totalUnits * (i + 1)) / n) - Math.round((totalUnits * i) / n),
  )
  const d = Math.round((2 * slopeOffset) / U)
  const topUnits = pairUnits.map((p) => Math.round((p + d) / 2))
  const rootUnits = pairUnits.map((p, i) => p - topUnits[i])
  const margin = (rootUnits[n - 1] * U) / 2
  const gridWidth = totalUnits * U
  const teeth: ToothCell[] = []
  let x = margin
  for (let i = 0; i < n; i++) {
    const topW = topUnits[i] * U
    const rootW = rootUnits[i] * U
    // 坐标保留 0.05mm 精度（边距可为半格），全部由网格整数累加，不逐点取整以免累积漂移
    teeth.push({ index: i + 1, topW, rootW, faceX: x, backX: x + slopeOffset })
    x += topW + rootW
  }
  // 实测闭合误差：|Σ齿距 − 板宽|。
  // 布局为 左边距｜齿顶1｜齿根1(=槽1)｜…｜齿顶n｜右边距，且 2×边距 = 末齿齿根，
  // 故 Σ齿距 = Σ齿顶 + Σ齿根 = Σ齿顶 + Σ齿间槽 + 2×边距 = 网格宽（网格宽上恒为 0）。
  const closureError = Math.abs(
    round01(teeth.reduce((s, th) => s + round01(th.topW + th.rootW), 0) - width),
  )

  // —— 销板（B 板）互补齿形 ——
  const pins: PinCell[] = []
  pins.push({
    index: 0,
    faceX: 0,
    faceW: margin,
    backX: 0,
    backW: margin + slopeOffset,
    half: true,
  })
  for (let i = 0; i < n - 1; i++) {
    const left = teeth[i].faceX + teeth[i].topW
    pins.push({
      index: i + 1,
      faceX: left,
      faceW: teeth[i + 1].faceX - left,
      backX: left - slopeOffset,
      backW: teeth[i + 1].faceX - left + 2 * slopeOffset,
      half: false,
    })
  }
  const last = teeth[n - 1]
  pins.push({
    index: n,
    faceX: last.faceX + last.topW,
    faceW: margin,
    backX: last.faceX + last.topW - slopeOffset,
    backW: margin + slopeOffset,
    half: true,
  })

  // —— 约束校验与警告（不允许静默输出）——
  const minRoot = Math.min(...rootUnits) * U
  const minTop = Math.min(...topUnits) * U
  if (minRoot < 0) {
    warnings.push(
      `齿数 ${n} 过多：齿根宽为负值，无法排布。请减少齿数或减小角度比（当前 1:${ratio}）`,
    )
  } else if (minRoot < minRootW) {
    warnings.push(
      `齿根宽最低 ${minRoot.toFixed(1)}mm，低于${wood === 'softwood' ? '软木' : '硬木'}最小安全值 ${minRootW}mm，齿根易劈裂；建议减少齿数`,
    )
  }
  if (minTop < minTopW && minTop >= 0) {
    warnings.push(
      `齿顶宽最低 ${minTop.toFixed(1)}mm，小于锯路宽 2 倍（${minTopW.toFixed(1)}mm），锯片切不出来；建议减少齿数或换细锯路`,
    )
  }
  if (n < 3 && width >= 150) {
    warnings.push(`齿数过少（${n} 齿），板宽 ${width}mm 建议至少 3 齿以保证结合强度`)
  }
  const pitch = width / n
  if (pitch < 15 && pitch > 0) {
    warnings.push(`齿距仅 ${pitch.toFixed(1)}mm，过小易劈裂，建议减少齿数`)
  }
  if (n < 2 || n > 12) {
    warnings.push(`齿数 ${n} 超出合理范围（2~12）`)
  }

  return {
    teeth,
    pins,
    margin,
    slopeOffset,
    depth,
    pitch,
    warnings,
    closureError,
    gridWidth,
    minRootW,
    minTopW,
  }
}
