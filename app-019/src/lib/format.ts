// 数值格式化：内部统一 mm，1 位小数；图纸标注符合木工习惯（整数或 0.5 步进）
export function round01(x: number): number {
  return Math.round(x * 10) / 10
}

/** 0.5mm 步进取整（四舍五入），用于图纸标注 */
export function round05(x: number): number {
  return Math.round(x * 2) / 2
}

/** 图纸标注文本：0.5 步进，去掉多余的 .0 */
export function fmtDrawing(x: number): string {
  const v = round05(x)
  return Number.isInteger(v) ? String(v) : v.toFixed(1)
}

/** 计算表格文本：0.1mm 精度 */
export function fmt01(x: number): string {
  return round01(x).toFixed(1)
}

/** 齿宽核对表文本：保留到闭合格子（0.025/0.05mm），去掉无意义的末尾零 */
export function fmtClosure(x: number): string {
  return x.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')
}

/** 坐标取整到 0.1 网格，消除浮点误差 */
export function snap01(x: number): number {
  return Math.round(x * 10) / 10
}
