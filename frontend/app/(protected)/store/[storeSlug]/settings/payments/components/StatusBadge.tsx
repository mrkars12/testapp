/** Generic pill badge — status vocabulary and colors come entirely from the maps passed in, never hardcoded per gateway. */
export default function StatusBadge<T extends string>({
  status,
  labelMap,
  colorMap,
  className = '',
}: {
  status: T
  labelMap: Record<T, string>
  colorMap: Record<T, string>
  className?: string
}) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${colorMap[status]} ${className}`}>
      {labelMap[status]}
    </span>
  )
}
