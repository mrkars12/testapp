import { cookies } from 'next/headers'

export async function getAuthFromCookie() {
  const cookieStore = await cookies()

  return {
    authenticated: !!cookieStore.get('laravel_session')
  }
}