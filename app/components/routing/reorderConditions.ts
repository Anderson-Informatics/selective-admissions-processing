export function moveSibling<T>(items: T[], index: number, direction: -1 | 1): T[] {
  const next = index + direction
  if (index < 0 || index >= items.length || next < 0 || next >= items.length) return items
  const reordered = [...items]
  const [item] = reordered.splice(index, 1)
  reordered.splice(next, 0, item!)
  return reordered
}
