/**
 * Route-level loading boundary for the whole `/store` subtree.
 *
 * This used to be `fixed inset-0 z-[999999]` — an opaque white sheet over
 * the ENTIRE viewport, sidebar and store switcher included. Every
 * navigation within the dashboard that suspended even briefly blanked the
 * whole app, which is what made ordinary sidebar clicks feel like full page
 * loads: the chrome the user just clicked disappeared, then came back.
 *
 * The nav is not what is loading — the page content is. So the skeleton is
 * scoped to the content area and the surrounding layout stays put and
 * interactive, which is both faster to paint and what makes a transition
 * read as a transition rather than a reload.
 */
export default function Loading() {
  return (
    <div className="p-6" role="status" aria-live="polite" aria-busy="true">
      <div className="mb-6 h-8 w-48 animate-pulse rounded-lg bg-gray-100" />
      <div className="space-y-3">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="h-16 animate-pulse rounded-xl border border-gray-100 bg-gray-50" />
        ))}
      </div>
      <span className="sr-only">جارٍ التحميل...</span>
    </div>
  )
}
