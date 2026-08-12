import { createParamDecorator, ExecutionContext } from '@nestjs/common'

/**
 * @ActiveStore()
 * ================
 * يسحب المتجر الفعّال اللي حلّه ActiveStoreGuard من الـ request.
 * لازم يتستخدم فقط في Handlers متحطلها @UseGuards(..., ActiveStoreGuard)
 * قبل كده، وإلا هيرجع undefined.
 *
 * الاستخدام المتوقع في المراحل الجاية:
 *
 *   @Get()
 *   @UseGuards(SessionAuthGuard, ActiveStoreGuard)
 *   async getProducts(@ActiveStore() store: any) {
 *     return this.productService.getProducts(store.id, ...)
 *   }
 */
export const ActiveStore = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest()
    return request.activeStore
  },
)

/**
 * @ActiveStoreId()
 * اختصار سريع لو الـ handler محتاج الـ id بس (bigint) من غير باقي صف
 * المتجر — بيقلل التكرار في الـ services اللي مستنياها بس store.id.
 */
export const ActiveStoreId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest()
    return request.activeStoreId
  },
)
