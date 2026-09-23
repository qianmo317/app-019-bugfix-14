// 燕尾榫齿宽分配算法（0.05mm 闭合格子，纯函数）
// 设计约定（蓝图 §8）：
//  - 在齿板正面（展示面）从左到右为：
//    左边距(半齿) + 齿1顶 + 齿1根槽 + 齿2顶 + ... + 齿n顶 + 右边距(半齿)
//  - 左右边距相等，且等于端齿齿根宽的一半
//  - 每个齿：齿顶宽 + 齿根宽 = 该齿齿距
//  - 顺序展开时前 n−1 个齿根作为齿间槽；末齿齿根由左右两个半齿边距合计承担
//  - 因此：Σ(齿顶宽) + Σ(齿根宽) = 板宽，坐标逐段相加严格闭合
//  - 齿顶宽（展示面）= 齿根宽 + 2 × 斜移量；斜移量 = 齿深 / 角度比 r（1:r）
import type { Wood } from '../types'
import { round01 } from './format'

const U = 0.05 // 闭合格子：齿宽/槽宽 0.05mm；端齿齿根取偶数格，故边距也落在 0.05mm

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
  pitchW: number // 齿距 = 齿顶宽 + 齿根宽
  faceX: number  // 展示面齿顶左边缘 x 坐标
  faceXEnd: number // 展示面齿顶右边缘 x 坐标
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
  margin: number        // 首尾半齿边距（leftMargin/rightMargin 的兼容别名）
  leftMargin: number    // 左半齿边距
  rightMargin: number   // 右半齿边距
  slopeOffset: number   // 单边斜移量 = 齿深 / r（为闭合在格子上取整）
  depth: number         // 齿深（穿透=板厚，半隐=0.75×板厚）
  pitch: number         // 平均齿距 W/n
  warnings: string[]
  closureError: number  // |Σ齿顶 + Σ齿根 − 板宽|
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

/** 选择最接近期望值、且满足奇偶约束的齿顶/齿根差（整数格） */
function nearestD(d0: number, required: 'even' | 'odd' | undefined): number {
  if (required === undefined) return Math.max(0, d0)
  const wantedParity = required === 'even' ? 0 : 1
  const current = ((d0 % 2) + 2) % 2
  if (current === wantedParity) return d0
  if (d0 <= 0) return d0 + 1
  // 两侧距离相同（只差 1 格）时取较宽齿顶，减少齿根过窄警告
  return d0 + 1
}

/** d 取最接近值并满足 d ≡ target (mod 4)，用于端齿齿根也要平分的 n=1 场景 */
function nearestDMod4(d0: number, target: number): number {
  const wanted = (((target % 4) + 4) % 4)
  for (let delta = 0; delta <= 3; delta++) {
    const candidates = delta === 0 ? [d0] : [d0 - delta, d0 + delta]
    for (const candidate of candidates) {
      const normalized = candidate - 4 * Math.floor(candidate / 4)
      if (candidate >= 0 && normalized === wanted) return candidate
    }
  }
  return d0
}

function requiredDParity(totalUnits: number, n: number): 'even' | 'odd' | undefined {
  if (n === 2) return Math.floor(totalUnits / 2) % 2 === 0 ? 'even' : 'odd'
  if (n % 2 === 1) return totalUnits % 2 === 0 ? 'even' : 'odd'
  return undefined
}

function nearestEven(x: number): number {
  const base = Math.round(x)
  if (base % 2 === 0) return base
  // 两侧同为偶数时优先取较大端齿，减少内齿吸收量
  return x >= base ? base + 1 : base - 1
}

/** 将 total 拆成 count 个尽量接近的整数，余数放在前 |remainder| 个齿 */
function balancedUnits(total: number, count: number): number[] {
  const base = Math.floor(total / count)
  const remainder = total - base * count
  return Array.from({ length: count }, (_, i) => base + (i < remainder ? 1 : 0))
}

/** 整数格分配齿根：两端齿根等宽且为偶数格（半齿边距仍在同一闭合格上），总和严格等于输入 */
function allocateRootUnits(totalRootUnits: number, n: number): number[] {
  if (n === 1) return [totalRootUnits]
  if (n === 2) return [totalRootUnits / 2, totalRootUnits / 2]

  const innerCount = n - 2
  const edgeUnits = nearestEven(totalRootUnits / n)
  const innerTotal = totalRootUnits - 2 * edgeUnits
  const inner = balancedUnits(innerTotal, innerCount)
  return [edgeUnits, ...inner, edgeUnits]
}

export function computeDovetail(input: DovetailInput): DovetailResult {
  const { width, thickness, ratio, kerf, wood, blind } = input
  const warnings: string[] = []
  const depth = blind ? round01(thickness * (input.blindDepthRatio ?? 0.75)) : thickness
  const n = Math.max(1, input.teeth ?? suggestTeeth(width, thickness, ratio, wood, blind))
  const minRootW = MIN_ROOT[wood]
  const minTopW = round01(2 * kerf)

  // —— 0.05mm 闭合格上分配 ——
  // T = W 的总格数；d = (齿顶宽−齿根宽) 的格数；2q + nd = T。
  // q 为全部齿根宽合计；齿根取整数格，齿顶=齿根+d，故 Σ齿顶+Σ齿根=T*U。
  const T = Math.round(width / U)

  // 端齿齿根必须是偶数格，才能平分成两个同宽半齿边距。
  // q=(T-nd)/2 必须是整数；n=2 时还要让 q/2（单个端齿齿根）为整数。
  const useFallbackGrid = n % 2 === 0 && T % 2 !== 0
  const grid = useFallbackGrid ? U / 2 : U
  const totalUnits = Math.round(width / grid)
  const desiredD = Math.round((2 * depth) / (ratio * grid))
  const d = n === 1
    ? nearestDMod4(desiredD, totalUnits)
    : nearestD(desiredD, requiredDParity(totalUnits, n))
  const q = (totalUnits - n * d) / 2
  const rootUnits = allocateRootUnits(q, n)
  const topUnits = rootUnits.map((r) => r + d)

  const edgeRootUnits = rootUnits[0]
  const leftMargin = (edgeRootUnits * grid) / 2
  const rightMargin = (rootUnits[n - 1] * grid) / 2
  const slopeOffset = (d * grid) / 2

  const teeth: ToothCell[] = []
  let x = leftMargin
  for (let i = 0; i < n; i++) {
    const topW = topUnits[i] * grid
    const rootW = rootUnits[i] * grid
    const faceXEnd = x + topW
    teeth.push({
      index: i + 1,
      topW,
      rootW,
      pitchW: topW + rootW,
      faceX: x,
      faceXEnd,
      backX: x + slopeOffset,
    })
    // 末齿之后是右边距，不是完整齿根槽；其余齿根宽就是到下一齿顶起点的槽宽
    if (i < n - 1) x += topW + rootW
  }

  const totalTopUnits = topUnits.reduce((s, v) => s + v, 0)
  const totalRootUnits = rootUnits.reduce((s, v) => s + v, 0)
  const closureError = Math.abs((totalTopUnits + totalRootUnits - totalUnits) * grid)
  const physicalClosureError = Math.abs(totalUnits * grid - width)
  const effectiveClosureError = Math.max(closureError, physicalClosureError)

  // —— 销板（B 板）互补齿形 ——
  const pins: PinCell[] = []
  pins.push({
    index: 0,
    faceX: 0,
    faceW: leftMargin,
    backX: 0,
    backW: leftMargin + slopeOffset,
    half: true,
  })
  for (let i = 0; i < n - 1; i++) {
    const left = teeth[i].faceXEnd
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
    faceX: last.faceXEnd,
    faceW: rightMargin,
    backX: last.faceXEnd - slopeOffset,
    backW: rightMargin + slopeOffset,
    half: true,
  })

  // —— 约束校验与警告（不允许静默输出）——
  const minRoot = Math.min(...rootUnits) * grid
  const minTop = Math.min(...topUnits) * grid
  if (minRoot < 0) {
    warnings.push(
      `齿数 ${n} 过多：齿根宽为负值，无法排布。请减少齿数或减小角度比（当前 1:${ratio}）`,
    )
  } else if (minRoot < minRootW) {
    warnings.push(
      `齿根宽最低 ${minRoot.toFixed(2)}mm，低于${wood === 'softwood' ? '软木' : '硬木'}最小安全值 ${minRootW}mm，齿根易劈裂；建议减少齿数`,
    )
  }
  if (minTop < minTopW && minTop >= 0) {
    warnings.push(
      `齿顶宽最低 ${minTop.toFixed(2)}mm，小于锯路宽 2 倍（${minTopW.toFixed(1)}mm），锯片切不出来；建议减少齿数或换细锯路`,
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
    margin: leftMargin,
    leftMargin,
    rightMargin,
    slopeOffset,
    depth,
    pitch,
    warnings,
    closureError: effectiveClosureError,
    minRootW,
    minTopW,
  }
}
