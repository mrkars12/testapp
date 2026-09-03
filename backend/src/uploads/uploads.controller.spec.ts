import { UploadsController } from './uploads.controller'
import type { UploadsService } from './uploads.service'

/**
 * Regression: uploads must follow the active store.
 *
 * The controller used to hand the service a *user* id, and the service
 * turned that into "whichever store Postgres returns first for this
 * owner". For a merchant with two stores that silently wrote the upload
 * row — and the R2 object key, which is prefixed with the store id —
 * under the wrong store, no matter which store the merchant was working
 * in. These assertions pin the store id to the one ActiveStoreGuard
 * resolved, which is the only value that answers "which store is this
 * request for".
 */
describe('UploadsController', () => {
  const STORE_B = 42n

  let service: jest.Mocked<Pick<UploadsService, 'presign' | 'confirm' | 'remove'>>
  let controller: UploadsController

  beforeEach(() => {
    service = {
      presign: jest.fn().mockResolvedValue({ uploadUrl: 'u', key: 'k', publicUrl: 'p' }),
      confirm: jest.fn().mockResolvedValue({ success: true }),
      remove: jest.fn().mockResolvedValue({ success: true }),
    } as never

    controller = new UploadsController(service as never)
  })

  it('presigns against the active store', async () => {
    const body = {
      fileName: 'a.png',
      mimeType: 'image/png',
      size: 10,
      folder: 'products' as const,
    }

    await controller.presign(STORE_B, body)

    expect(service.presign).toHaveBeenCalledWith(STORE_B, body)
  })

  it('confirms against the active store', async () => {
    await controller.confirm(STORE_B, {
      key: 'k',
      attachedType: 'product',
      attachedId: '7',
    })

    expect(service.confirm).toHaveBeenCalledWith(STORE_B, 'k', 'product', '7')
  })

  it('removes against the active store', async () => {
    await controller.remove(STORE_B, 'k')

    expect(service.remove).toHaveBeenCalledWith(STORE_B, 'k')
  })

  it('exposes no path that resolves a store from the user alone', () => {
    // The old *ForUser entry points are gone deliberately. Keeping them
    // would leave a second, unguarded way to pick a store, and the next
    // caller would have no reason to prefer the guarded one.
    expect((service as Record<string, unknown>).presignForUser).toBeUndefined()
    expect(Object.getOwnPropertyNames(UploadsController.prototype).sort()).toEqual(
      ['confirm', 'constructor', 'presign', 'remove'],
    )
  })
})
