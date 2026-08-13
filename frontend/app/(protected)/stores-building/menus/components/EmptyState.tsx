'use client'

export default function EmptyState({
  onCreate
}: any) {
  return (
    <div className="max-w-3xl mx-auto p-10">

      <div className="bg-white border rounded-2xl p-8 text-center">

        <h2 className="text-xl font-semibold mb-3">
          No menu found
        </h2>

        <p className="text-gray-500 mb-6">
          Create your first menu.
        </p>

        <button
          onClick={onCreate}
          className="
          px-5
          py-2
          bg-black
          text-white
          rounded-xl
        "
        >
          Create Main Menu
        </button>

      </div>

    </div>
  )
}