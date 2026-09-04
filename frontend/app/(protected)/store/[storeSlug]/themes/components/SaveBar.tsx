'use client'

export default function SaveBar({ saving, onSave }: { saving: boolean; onSave: () => void }) {
  return (
    <div className="fixed bottom-0 left-0 right-0 bg-white border-t px-4 py-3 flex justify-end gap-3 z-50 shadow-lg">
      <button
        onClick={onSave}
        disabled={saving}
        className="px-6 py-2.5 bg-black text-white rounded-lg text-sm font-medium hover:bg-gray-800 disabled:opacity-50 transition-colors"
      >
        {saving ? 'جاري الحفظ...' : 'حفظ التغييرات'}
      </button>
    </div>
  )
}
