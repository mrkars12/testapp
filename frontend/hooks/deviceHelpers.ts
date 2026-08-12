// hooks/deviceHelpers.ts

/**
 * تحويل رمز الدولة (مثل EG أو US) إلى إيموجي العلم الخاص بها
 */
export function getFlagEmoji(countryCode: string): string {
  if (!countryCode) return '🏳️'

  const codePoints = countryCode
    .toUpperCase()
    .split('')
    .map(char => 127397 + char.charCodeAt(0)) // ✅ تم إضافة (0) لحل خطأ الـ Arguments

  return String.fromCodePoint(...codePoints)
}

/**
 * الحصول على إيموجي المتصفح بناءً على اسمه
 */
export function getBrowserIcon(browser: string): string {
  // ✅ تم تعريف الكائن بنوع Record لمنع خطأ الوصول للمفاتيح
  const icons: Record<string, string> = {
    chrome: '🔵',
    firefox: '🦊',
    safari: '🌍',
    edge: '📌',
    opera: '🔴',
    brave: '🦁'
  }

  const key = browser?.toLowerCase() || ''
  return icons[key] || '🌐'
}

/**
 * الحصول على إيموجي نوع الجهاز
 */
export function getDeviceIcon(type: string): string {
  const icons: Record<string, string> = {
    desktop: '💻',
    mobile: '📱',
    tablet: '📱'
  }

  const key = type?.toLowerCase() || ''
  return icons[key] || '🖥️'
}