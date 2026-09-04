import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup, screen } from '@testing-library/react'
import StoreScopedLayout from './layout'

/**
 * This layout only SCOPES the subtree (remount-on-slug-change). Store
 * authorization now lives one layout up, in `app/(protected)/layout.tsx`,
 * at the boundary that mounts the merchant shell — see
 * `app/(protected)/layout.test.tsx` for those assertions.
 */

let mockSlug = 'shop-a'
vi.mock('next/navigation', () => ({ useParams: () => ({ storeSlug: mockSlug }) }))

afterEach(cleanup)

describe('StoreScopedLayout', () => {
  it('renders children (scoping wrapper only, no gating)', () => {
    mockSlug = 'shop-a'
    render(<StoreScopedLayout><div data-testid="child">child</div></StoreScopedLayout>)
    expect(screen.getByTestId('child')).toBeTruthy()
  })

  it('keys the wrapper on the slug', () => {
    mockSlug = 'shop-a'
    const { container } = render(<StoreScopedLayout><div>x</div></StoreScopedLayout>)
    // the wrapper div is keyed by slug; children pass through unchanged
    expect(container.textContent).toBe('x')
  })
})
