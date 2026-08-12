import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'

export async function GET() {
  try {
    // ✅ لازم await في الإصدارات الحديثة
    const cookieStore = await cookies()

    // ✅ جمع الكوكيز وإرسالها للـ backend (Laravel مثلاً)
    const cookieHeader = cookieStore
      .getAll()
      .map((c) => `${c.name}=${c.value}`)
      .join('; ')

    // ✅ طلب بيانات المستخدم من الـ API
    const res = await fetch(`${process.env.API_URL}/api/me`, {
      method: 'GET',
      headers: {
        Cookie: cookieHeader,
        Accept: 'application/json',
      },
      cache: 'no-store', // مهم عشان auth يكون دايمًا fresh
    })

    // ❌ لو مش authenticated
    if (!res.ok) {
      return NextResponse.json(
        {
          authenticated: false,
          two_factor_enabled: false,
        },
        { status: 200 }
      )
    }

    const data = await res.json()

    // ✅ الرد النهائي
    return NextResponse.json({
      authenticated: data?.authenticated ?? false,
      two_factor_enabled: data?.user?.two_factor_enabled ?? false,
    })
  } catch (error) {
    console.error('Auth state error:', error)

    return NextResponse.json(
      {
        authenticated: false,
        two_factor_enabled: false,
      },
      { status: 500 }
    )
  }
}