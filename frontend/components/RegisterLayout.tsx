'use client'

import { 
  ArrowLeftIcon,
  ShieldCheckIcon,
  LockClosedIcon,
  DevicePhoneMobileIcon 
} from '@heroicons/react/24/outline'
import { useRouter } from 'next/navigation'

interface RegisterLayoutProps {
  children: React.ReactNode
  step: number
}

export default function RegisterLayout({ children, step }: RegisterLayoutProps) {
  const router = useRouter()

  const features = [
    {
      icon: ShieldCheckIcon,
      title: 'آمن تماماً',
      description: 'تشفير من الدرجة الأولى'
    },
    {
      icon: LockClosedIcon,
      title: 'خصوصية كاملة',
      description: 'بياناتك محمية دائماً'
    },
    {
      icon: DevicePhoneMobileIcon,
      title: 'متاح دائماً',
      description: 'دعم على مدار الساعة'
    }
  ]

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-blue-50">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            {/* Logo */}
            <div className="flex items-center">
              <button
                onClick={() => router.push('/')}
                className="flex items-center gap-2 text-gray-900 hover:text-blue-600 transition-colors"
              >
                <div className="w-8 h-8 rounded-lg bg-gradient-to-r from-blue-600 to-cyan-600 flex items-center justify-center">
                  <span className="text-white font-bold text-sm">$</span>
                </div>
                <span className="font-bold text-xl">PayFlow</span>
              </button>
            </div>

            {/* Login Link */}
            <button
              onClick={() => router.push('/login')}
              className="text-gray-600 hover:text-blue-600 font-medium px-4 py-2 rounded-lg hover:bg-blue-50 transition-colors"
            >
              تسجيل الدخول
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="py-8 md:py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid lg:grid-cols-2 gap-12">
            {/* Left Column - Features */}
            <div className="hidden lg:block">
              <div className="sticky top-24">
                {/* Back Button */}
                <button
                  onClick={() => router.back()}
                  className="flex items-center gap-2 text-gray-600 hover:text-blue-600 mb-8 transition-colors group"
                >
                  <ArrowLeftIcon className="w-5 h-5 group-hover:-translate-x-1 transition-transform" />
                  <span>العودة</span>
                </button>

                {/* Features List */}
                <div className="space-y-6">
                  {features.map((feature, index) => {
                    const Icon = feature.icon
                    return (
                      <div
                        key={index}
                        className="flex items-center gap-4 p-4 rounded-2xl bg-white/50 backdrop-blur-sm border border-gray-200 hover:border-blue-200 hover:bg-white transition-all duration-300"
                      >
                        <div className="p-3 rounded-xl bg-blue-100 text-blue-600">
                          <Icon className="w-6 h-6" />
                        </div>
                        <div>
                          <h3 className="font-semibold text-gray-900">{feature.title}</h3>
                          <p className="text-sm text-gray-600">{feature.description}</p>
                        </div>
                      </div>
                    )
                  })}
                </div>

                {/* Testimonial */}
                <div className="mt-12 p-6 rounded-2xl bg-gradient-to-r from-blue-500 to-cyan-500 text-white">
                  <div className="text-4xl mb-4">"</div>
                  <p className="text-lg mb-4">
                    أفضل منصة دفع استخدمتها. آمنة، سريعة، ودعم فني ممتاز.
                  </p>
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center">
                      <span className="font-bold">A</span>
                    </div>
                    <div>
                      <p className="font-semibold">أحمد محمد</p>
                      <p className="text-sm text-blue-100">مدير شركة تقنية</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Right Column - Form */}
            <div>
              <div className="bg-white rounded-3xl shadow-xl border border-gray-200 p-6 md:p-8 lg:p-10">
                {children}
              </div>

              {/* Mobile Back Button */}
              <div className="lg:hidden mt-6">
                <button
                  onClick={() => router.back()}
                  className="flex items-center justify-center gap-2 text-gray-600 hover:text-blue-600 w-full py-3 rounded-xl border border-gray-200 hover:border-blue-200 transition-colors"
                >
                  <ArrowLeftIcon className="w-5 h-5" />
                  <span>العودة</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="mt-12 border-t border-gray-200 bg-white/50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="text-center text-sm text-gray-600">
            <p>© 2024 PayFlow. جميع الحقوق محفوظة.</p>
            <p className="mt-2">
              <button className="hover:text-blue-600 transition-colors mx-2">الشروط والأحكام</button>
              •
              <button className="hover:text-blue-600 transition-colors mx-2">الخصوصية</button>
              •
              <button className="hover:text-blue-600 transition-colors mx-2">المساعدة</button>
            </p>
          </div>
        </div>
      </footer>
    </div>
  )
}