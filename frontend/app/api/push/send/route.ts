// app/api/push/send/route.ts
import webpush from 'web-push'

webpush.setVapidDetails(
  process.env.VAPID_SUBJECT!,
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
  process.env.VAPID_PRIVATE_KEY!
)

export async function POST(req: Request) {
  try {
    const { subscriptions, title, body, url } = await req.json()

    const notifications = subscriptions.map((sub: any) =>
      webpush.sendNotification(
        sub,
        JSON.stringify({ title, body, url })
      ).catch(err => console.error("Error sending to one sub:", err)) // حماية ضد الـ Crash
    )

    await Promise.all(notifications)

    return Response.json({ success: true })
  } catch (error) {
    return Response.json({ success: false, error: "Internal Server Error" }, { status: 500 })
  }
}