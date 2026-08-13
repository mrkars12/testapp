'use client'

export default function SaveBar({
  saving,
  onSave
}: any) {
  return (
    <div
      className="
      fixed
      bottom-0
      left-0
      right-0
      bg-white
      border-t
      p-4
      flex
      justify-end
      z-50
      shadow-lg
    "
    >
      <button
        onClick={onSave}
        disabled={saving}
        className="
        px-5
        py-2
        bg-black
        text-white
        rounded-xl
      "
      >
        {saving
          ? 'Saving...'
          : 'Save'}
      </button>
    </div>
  )
}