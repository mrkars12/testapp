// app/api/intended-path/route.ts

import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'

const COOKIE_NAME = '__intended_path'

// ✅ GET: استرجاع المسار
export async function GET() {
  const cookieStore = await cookies()

  const path = cookieStore.get(COOKIE_NAME)?.value

  return NextResponse.json({ path: path || null })
}

// ✅ POST: حفظ المسار
export async function POST(request: NextRequest) {
  const { path } = await request.json()

  const cookieStore = await cookies()

  cookieStore.set(COOKIE_NAME, path, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 5, // 5 دقائق
    path: '/',
  })

  return NextResponse.json({ success: true })
}

// ✅ DELETE: مسح المسار
export async function DELETE() {
  const cookieStore = await cookies()

  cookieStore.delete(COOKIE_NAME)

  return NextResponse.json({ success: true })
}