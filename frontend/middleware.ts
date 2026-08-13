import { NextRequest, NextResponse } from 'next/server'

const PROTECTED_ROUTES = [
  '/dashboard',
  '/settings',
  '/profile',
]

const AUTH_PAGES = [
  '/login',
  '/register',
]

export function middleware(request: NextRequest) {
  const { pathname, searchParams } = request.nextUrl

  const token = request.cookies.get('access_token')?.value

  const isProtected = PROTECTED_ROUTES.some(route =>
    pathname.startsWith(route)
  )

  const isAuthPage = AUTH_PAGES.some(route =>
    pathname.startsWith(route)
  )

  const reason = searchParams.get('reason')
  const intended = searchParams.get('intended')

  const skipRedirect =
    reason === 'timeout' ||
    reason === 'force_logout'

  /**
   * =========================
   * Protected Routes
   * =========================
   */
  if (isProtected) {
  return NextResponse.next()
}

  /**
   * =========================
   * Login / Register Pages
   * =========================
   */
  if (isAuthPage) {
    // السماح بالدخول لصفحة اللوجين بعد الطرد
    if (skipRedirect) {
      const response = NextResponse.next()
      response.cookies.delete('access_token')
      return response
    }

    // إذا كان هناك توكن، ادخل مباشرة
    if (token) {
      const target =
        intended &&
        !intended.startsWith('/login') &&
        !intended.startsWith('/register')
          ? intended
          : '/dashboard'

      return NextResponse.redirect(
        new URL(target, request.url)
      )
    }
  }

  const response = NextResponse.next()

  response.headers.set(
    'x-user-auth',
    token ? '1' : '0'
  )

  return response
}

export const config = {
  matcher: [
    '/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}