/* ══════════════════════════════════════════════════════════════════════
   Handing THIS tab to the provider.

   The storefront checkout never opens a window. A gateway that requires
   a hosted page gets the tab the customer is already in, and gives it
   back to the same checkout URL when it is done — which is why the
   checkout token is written into this tab's history before the
   navigation (see returnContext.ts) and why nothing here has any notion
   of an opener, a named target, or a window to close afterwards.

   Two shapes, because that is what providers actually specify: a plain
   GET redirect, and a POST of signed fields to a hosted form. Both stay
   top-level.
   ══════════════════════════════════════════════════════════════════════ */

/** Schemes a provider redirect may use. Anything else is not a redirect. */
function isNavigableUrl(url: string): boolean {
  try {
    const parsed = new URL(url, window.location.href)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:'
  } catch {
    return false
  }
}

/**
 * Sends this tab to the provider.
 *
 * Returns false when the URL is not something a browser should be sent
 * to — a `javascript:` or `data:` URL reaching here would mean the
 * backend's normalized next action carried an attacker-supplied value,
 * and executing it in our own origin is the one outcome worse than a
 * failed payment. The caller surfaces that as a payment error.
 */
export function navigateSameTab(
  url: string,
  method: 'GET' | 'POST',
  formFields?: Record<string, string>,
): boolean {
  if (!isNavigableUrl(url)) return false

  if (method === 'POST' && formFields) {
    submitTopLevelForm(url, formFields)
    return true
  }

  window.location.assign(url)
  return true
}

/**
 * POSTs to the provider in this tab.
 *
 * No `target`: the form navigates the document it lives in. That single
 * omission is the whole difference from the old second-tab flow.
 */
function submitTopLevelForm(url: string, formFields: Record<string, string>): void {
  const form = document.createElement('form')
  form.method = 'POST'
  form.action = url
  form.style.display = 'none'

  for (const [key, value] of Object.entries(formFields)) {
    const input = document.createElement('input')
    input.type = 'hidden'
    input.name = key
    input.value = String(value)
    form.appendChild(input)
  }

  document.body.appendChild(form)
  form.submit()
  // The document is on its way out; removing the node keeps the DOM
  // honest for the moment before it goes, and matters if the navigation
  // is cancelled (a beforeunload handler, a blocked scheme).
  document.body.removeChild(form)
}
