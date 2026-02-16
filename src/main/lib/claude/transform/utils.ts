/**
 * 生成唯一 ID
 */
export function genId(): string {
  return `text-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}
