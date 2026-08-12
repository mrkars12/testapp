'use client'

import { useState, useRef, useEffect } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import SidebarDropdown from './SidebarDropdown'
import { API_URL } from '@/lib/config'

import { 
  HomeIcon, 
  CurrencyEuroIcon, 
  DevicePhoneMobileIcon,
  PaperAirplaneIcon,
  CubeIcon,
  GiftIcon
} from '@heroicons/react/24/outline'
import { useAuth } from '@/components/AuthProvider'

export default function Sidebar() {
  const [collapsed, setCollapsed] = useState(false)
  const [hovered, setHovered] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const pathname = usePathname()
  const router = useRouter()
  const { user, logout } = useAuth()
  const [openDropdowns, setOpenDropdowns] = useState<Set<string>>(new Set());

  // 🆕 slug المتجر الحالي بتاع المستخدم — بنجيبه مرة واحدة عشان نبني بيه
  // لينكات زي /settings/payments اللي محتاجة storeSlug في الـ URL.
  // نفس الطريقة المستخدمة في app/(protected)/stores-building/[storeSlug]/settings/page.tsx
  const [storeSlug, setStoreSlug] = useState<string | null>(null)

  const profileButtonRef = useRef<HTMLButtonElement>(null)
  const profileMenuRef = useRef<HTMLDivElement>(null)
  const isLoggingOutRef = useRef(false)

  const toggleDropdown = (id: string) => {
  setOpenDropdowns(prev => {
    const copy = new Set(prev);
    if (copy.has(id)) {
      copy.delete(id);
    } else {
      copy.add(id);
    }
    return copy;
  });
};

const isDropdownOpen = (id: string) => openDropdowns.has(id);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        profileMenuRef.current &&
        !profileMenuRef.current.contains(e.target as Node) &&
        profileButtonRef.current &&
        !profileButtonRef.current.contains(e.target as Node)
      ) {
        setProfileOpen(false)
      }
    }

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setProfileOpen(false)
    }

    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleEscape)

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [])

  // 🆕 جلب أول متجر بتاع المستخدم عشان نعرف الـ slug بتاعه.
  // بنفس فكرة fetchStoreData بتاعة صفحة settings، بس هنا بناخد أول متجر
  // بما إن كل يوزر حالياً عنده متجر واحد بس (getStore بيستخدم findFirst).
  useEffect(() => {
    const fetchStoreSlug = async () => {
      try {
        const res = await fetch(`${API_URL}/stores`, { credentials: 'include' })
        if (!res.ok) return
        const stores = await res.json()
        if (Array.isArray(stores) && stores[0]?.slug) {
          setStoreSlug(stores[0].slug)
        }
      } catch {
        // تجاهل بصمت — اللينك هيفضل معطل لحد ما البيانات توصل
      }
    }
    fetchStoreSlug()
  }, [])

  const isActive = (paths: string | string[]) => {
    if (!pathname) return false
    const arr = Array.isArray(paths) ? paths : [paths]

    return arr.some(p =>
      pathname === p ||
      pathname.startsWith(p + '/')
    )
  }

  // 🆕 مسار Payments الحقيقي — بيتبني بس لو عندنا storeSlug فعلي
  const paymentsHref = storeSlug ? `/stores-building/${storeSlug}/settings/payments` : null

  return (
    <aside
      className={`md:flex flex-col w-64 h-full fixed inset-y-0 left-0 z-10 bg-[#fafafa] border-r border-gray-200 transition-all duration-300 ${
        collapsed ? 'w-20' : ''
      }`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Logo */}
      <div className="flex items-center justify-center p-4">
        <img src="/assets/images/888.png" alt="DartCoin" className="h-10" />
      </div>

      {/* Menu */}
      <nav className="flex flex-1 flex-col overflow-auto gap-2 p-3">
  
        {/* Dashboard */}
        <Link
          href="/dashboard"
          className={`flex p-2 items-center h-6 p-2 gap-2 mb-1 text-sm text-left 
          rounded-md outline-none  
          transition-[width,height,padding] duration-150 ease-in-out
          text-[#0097c7] no-underline
          hover:bg-[hsl(240_4.8%_95.9%)] hover:text-[#0097c7] ${
            isActive('/dashboard')
              ? 'hover:text-[#0097c7] bg-[hsl(240_4.8%_95.9%)]'
              : 'hover:bg-[hsl(240_4.8%_95.9%)]'
          }`}
        >
          <i className="fas fa-house text-lg w-[1.2rem] h-[1.2rem]"></i>
          <span className="flex-1 truncate font-sans font-medium text-[#333]">Dashboard</span>
        </Link>

        <SidebarDropdown
          id="currency-exchange"
          label="Currency Exchange"
          icon="fas fa-euro-sign"
          isOpen={isDropdownOpen("currency-exchange")}
          toggle={() => toggleDropdown("currency-exchange")}
        >
          <a
            href="/exchange"
            className={`flex items-center w-full h-7 min-w-0 gap-2 px-2 text-sm rounded-md outline-none no-underline text-[hsl(240_5.3%_26.1%)] hover:text-[#0097c7] transition-colors ${
              isActive('/exchange')
                ? 'hover:text-[#0097c7] bg-[hsl(240_4.8%_95.9%)]'
                : 'hover:bg-[hsl(240_4.8%_95.9%)]'
            }`}
          >
            <span className="flex-1 truncate font-sans font-medium text-[#333]">Add</span>
          </a>

          <a
            href="/exchange/currency-exchange/withdraw"
            className={`flex items-center w-full h-7 min-w-0 gap-2 px-2 text-sm rounded-md outline-none no-underline text-[hsl(240_5.3%_26.1%)] hover:text-[#0097c7] transition-colors ${
              isActive('/exchange/currency-exchange/withdraw')
                ? 'hover:text-[#0097c7] bg-[hsl(240_4.8%_95.9%)]'
              : 'hover:bg-[hsl(240_4.8%_95.9%)]'
            }`}
          >
            <span className="flex-1 truncate font-sans font-medium text-[#333]">Withdrawal</span>
          </a>

          <a
            href="/exchange/currency-exchange/activity"
            className={`flex items-center w-full h-7 min-w-0 gap-2 px-2 text-sm rounded-md outline-none no-underline text-[hsl(240_5.3%_26.1%)] hover:text-[#0097c7] transition-colors ${
              isActive('/exchange/currency-exchange/activity')
                ? 'hover:text-[#0097c7] bg-[hsl(240_4.8%_95.9%)]'
              : 'hover:bg-[hsl(240_4.8%_95.9%)]'
            }`}
          >
            <span className="flex-1 truncate font-sans font-medium text-[#333]">Activity</span>
          </a>

          <a
            href="/exchange/currency-exchange/provider-requests/available"
            className={`flex items-center w-full h-7 min-w-0 gap-2 px-2 text-sm rounded-md outline-none no-underline text-[hsl(240_5.3%_26.1%)] hover:text-[#0097c7] transition-colors ${
              isActive('/exchange/currency-exchange/provider-requests')
                ? 'hover:text-[#0097c7] bg-[hsl(240_4.8%_95.9%)]'
              : 'hover:bg-[hsl(240_4.8%_95.9%)]'
            }`}
          >
            <span className="flex-1 truncate font-sans font-medium text-[#333]">
            I'm provider requests</span>
          </a>
        </SidebarDropdown>

        {/* Stores Management Section */}
        {/* Stores Management Section */}
        <div className="mt-4">
          <p className="text-xs font-medium text-gray-500 uppercase px-3 mb-2">
            Stores Management
          </p>

          <Link
            href="/stores-building"
            className={`flex p-2 items-center h-6 gap-2 mb-1 text-sm rounded-md outline-none transition-all duration-150 text-[#0097c7] no-underline hover:bg-[hsl(240_4.8%_95.9%)] ${
              isActive('/stores-building') && pathname === '/stores-building' ? 'bg-[hsl(240_4.8%_95.9%)]' : ''
            }`}
          >
            <i className="fas fa-store text-lg w-[1.2rem] h-[1.2rem]"></i>
            <span className="flex-1 truncate font-sans font-medium text-[#333]">Create Store</span>
          </Link>

          <Link
            href="/stores-building/pages"
            className={`flex p-2 items-center h-6 gap-2 mb-1 text-sm rounded-md outline-none transition-all duration-150 text-[#0097c7] no-underline hover:bg-[hsl(240_4.8%_95.9%)] ${
              isActive('/stores-building/pages') ? 'bg-[hsl(240_4.8%_95.9%)]' : ''
            }`}
          >
            <i className="fas fa-file-alt text-lg w-[1.2rem] h-[1.2rem]"></i>
            <span className="flex-1 truncate font-sans font-medium text-[#333]">Pages</span>
          </Link>

          <Link
            href="/stores-building/menus"
            className={`flex p-2 items-center h-6 gap-2 mb-1 text-sm rounded-md outline-none transition-all duration-150 text-[#0097c7] no-underline hover:bg-[hsl(240_4.8%_95.9%)] ${
              isActive('/stores-building/menus') ? 'bg-[hsl(240_4.8%_95.9%)]' : ''
            }`}
          >
            <i className="fas fa-bars text-lg w-[1.2rem] h-[1.2rem]"></i>
            <span className="flex-1 truncate font-sans font-medium text-[#333]">Menus</span>
          </Link>

          <Link
            href="/stores-building/products"
            className={`flex p-2 items-center h-6 gap-2 mb-1 text-sm rounded-md outline-none transition-all duration-150 text-[#0097c7] no-underline hover:bg-[hsl(240_4.8%_95.9%)] ${
              isActive('/stores-building/products') ? 'bg-[hsl(240_4.8%_95.9%)]' : ''
            }`}
          >
            <i className="fas fa-box text-lg w-[1.2rem] h-[1.2rem]"></i>
            <span className="flex-1 truncate font-sans font-medium text-[#333]">Products</span>
          </Link>

          <Link
            href="/stores-building/collections"
            className={`flex p-2 items-center h-6 gap-2 mb-1 text-sm rounded-md outline-none transition-all duration-150 text-[#0097c7] no-underline hover:bg-[hsl(240_4.8%_95.9%)] ${
              isActive('/stores-building/collections') ? 'bg-[hsl(240_4.8%_95.9%)]' : ''
            }`}
          >
            <i className="fas fa-layer-group text-lg w-[1.2rem] h-[1.2rem]"></i>
            <span className="flex-1 truncate font-sans font-medium text-[#333]">Collections</span>
          </Link>

          {/* 🔧 كان: href="/stores-building/[storeSlug]/settings/payments" (نص حرفي، مش هيشتغل)
              دلوقتي: بيتبني ديناميكياً من storeSlug الحقيقي بتاع متجر اليوزر */}
          <Link
            href={paymentsHref ?? '#'}
            onClick={(e) => { if (!paymentsHref) e.preventDefault() }}
            aria-disabled={!paymentsHref}
            className={`flex p-2 items-center h-6 gap-2 mb-1 text-sm rounded-md outline-none transition-all duration-150 text-[#0097c7] no-underline hover:bg-[hsl(240_4.8%_95.9%)] ${
              paymentsHref && isActive(paymentsHref) ? 'bg-[hsl(240_4.8%_95.9%)]' : ''
            } ${!paymentsHref ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            <i className="fas fa-credit-card text-lg w-[1.2rem] h-[1.2rem]"></i>
            <span className="flex-1 truncate font-sans font-medium text-[#333]">Payments</span>
          </Link>

          <Link
            href="/stores-building/themes"
            className={`flex p-2 items-center h-6 gap-2 mb-1 text-sm rounded-md outline-none transition-all duration-150 text-[#0097c7] no-underline hover:bg-[hsl(240_4.8%_95.9%)] ${
              isActive('/stores-building/themes')
                ? 'bg-[hsl(240_4.8%_95.9%)]'
                : ''
            }`}
          >
            <i className="fas fa-palette text-lg w-[1.2rem] h-[1.2rem]"></i>

            <span className="flex-1 truncate font-sans font-medium text-[#333]">
              Themes
            </span>
          </Link>
        </div>


        {/* Others Section */}
        <div className="mt-6">
          <p className="text-xs font-medium text-gray-500 uppercase px-3 mb-2">
            Others
          </p>

          <a
            href="/send-request/payments"
            className={`flex p-2 items-center h-6  gap-2 mb-1 text-sm text-left 
          rounded-md outline-none 
          transition-[width,height,padding] duration-150 ease-in-out
          text-[#0097c7] no-underline
          hover:bg-[hsl(240_4.8%_95.9%)] hover:text-[#0097c7] ${
            isActive('/send-request/payments')
              ? 'hover:text-[#0097c7] bg-[hsl(240_4.8%_95.9%)]'
              : 'hover:bg-[hsl(240_4.8%_95.9%)]'
          }`}
          >
            <i className="fas fa-paper-plane text-lg w-[1.2rem] h-[1.2rem]"></i>
            <span className="flex-1 truncate font-sans font-medium text-[#333]">send/request payments</span>
          </a>

          <a
            href="/on-ramp/subscribe"
            className={`flex p-2 items-center h-6  gap-2 mb-1 text-sm text-left 
          rounded-md outline-none 
          transition-[width,height,padding] duration-150 ease-in-out
          text-[#0097c7] no-underline
          hover:bg-[hsl(240_4.8%_95.9%)] hover:text-[#0097c7] ${
            isActive('/on-ramp/subscribe')
              ? 'hover:text-[#0097c7] bg-[hsl(240_4.8%_95.9%)]'
              : 'hover:bg-[hsl(240_4.8%_95.9%)]'
          }`}
          >
            <i className="fas fa-box-open text-lg w-[1.2rem] h-[1.2rem]"></i>
            <span className="flex-1 truncate font-sans font-medium text-[#333]">Development Fund</span>
          </a>

        </div>
      </nav>


      {/* User Profile - بالضبط زي الصورة */}
      <div className="min-w-0 relative flex flex-col !p-2">
        <div data-orientation="horizontal" role="none" className="!mr-[.2rem] shrink-0 !my-5 !mx-2 !w-auto" data-sidebar="separator"></div>
        <button
          ref={profileButtonRef}
          onClick={() => setProfileOpen(!profileOpen)}
          className="flex w-full items-center gap-3 cursor-pointer p-2 text-left border-0 transition-all duration-200 hover:bg-gray-100 bg-transparent"
        >
          {/* Avatar */}
          <span className="relative flex h-8 w-8 shrink-0 overflow-hidden rounded-lg">
            <span className="flex h-full w-full items-center justify-center rounded-lg bg-[#f4f4f5]">
              <span className="flex h-9 w-9 -m-0.5 items-center justify-center rounded-lg bg-[#f4f4f5] font-bold text-xs leading-none text-blue-500">
                ma
              </span>
            </span>
          </span>

          {/* Name and Email */}
          <div className="grid flex-1 text-left text-sm leading-tight">
            <span className="truncate font-semibold text-gray-900">
              {user?.fullname}
            </span>
            <span className="truncate text-xs text-gray-500">
              {user?.email}
            </span>
          </div>

          {/* Chevron */}
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className={`shrink-0 [&>svg]:w-[1.3rem] [&>svg]:h-[1.3rem] ml-auto ${
              profileOpen ? 'rotate-180' : '' 
            }`}
          >
            <path d="m7 15 5 5 5-5" />
            <path d="m7 9 5-5 5 5" />
          </svg>
        </button>

        {/* Dropdown Menu - يطلع من تحت */}
        {profileOpen && (
          <div
            ref={profileMenuRef}
            className="
              absolute left-[0] bg-white right-[0] bottom-[10px] [transform:translate(251px,0px)]  min-w-max z-50
              [--radix-popper-available-width:1053px]
              [--radix-popper-available-height:394px]
              [--radix-popper-anchor-width:239px]
              [--radix-popper-anchor-height:48px]
              [--radix-popper-transform-origin:0px_100%]
              "
            >
            <div className="min-w-[14rem] p-2 shadow-md text-popover-foreground bg-popover border rounded-lg overflow-hidden">
              {/* User Info */}
              <div className="flex items-center gap-4">
                <span className="relative flex h-8 w-8 shrink-0 overflow-hidden rounded-lg">
                  <span className="flex h-full w-full items-center justify-center rounded-lg bg-[#f4f4f5]">
                    <span className="flex h-9 w-9 -m-1 items-center justify-center rounded-lg bg-[#f4f4f5] text-black font-medium text-sm">
                      ma
                    </span>
                  </span>
                </span>
                <div className="grid leading-tight flex-1">
                  <span className="font-semibold text-gray-900 text-sm">
                    {user?.fullname}
                  </span>
                  <span className="text-sm text-gray-500">{user?.email}</span>
                  <div className="flex items-center gap-4 mt-1 text-xs">
                    <span className="text-green-600">
                      <i className="fas fa-thumbs-up mr-1"></i>(149)
                    </span>
                    <span className="text-red-600">
                      <i className="fas fa-thumbs-down mr-1"></i>(1)
                    </span>
                  </div>
                </div>
              </div>
              <div role="separator" aria-orientation="horizontal" className="bg-[hsl(220_14.3%_95.9%)] h-px my-1 -mx-7"></div>
              {/* Menu Items */}
              <div className="mt-1 space-y-1">
                <Link
                  href="/settings/security"
                  onClick={() => setProfileOpen(false)}
                  className="flex items-center relative gap-2 px-2 py-1.5 text-[13px] font-bold text-[#333] font-sans outline-none no-underline hover:bg-[hsl(220_14.3%_95.9%)]"
                >
                  Settings
                </Link>
                <a
                  href="#"
                  className="flex items-center relative gap-2 px-2 py-1.5 text-[13px] font-bold text-[#333] font-sans outline-none no-underline hover:bg-[hsl(220_14.3%_95.9%)]"
                >
                  Help
                </a>
                <div className="h-px bg-gray-200 my-2"></div>

                <button 
                  onClick={() => logout()} // استدعاء الخروج العادي
                  disabled={isLoggingOutRef.current}
                  className="flex items-center w-full relative gap-2 px-2 py-1.5 text-[13px] font-bold font-sans text-[#333] cursor-pointer outline-none no-underline transition-colors border-0 bg-white hover:bg-[hsl(220_14.3%_95.9%)]"
                >
                  <i className="fa-solid fa-right-from-bracket"></i>
                  {isLoggingOutRef.current ? 'جاري الخروج...' : 'تسجيل الخروج'}
                </button>
               
              </div>
            </div>
          </div>
        )}
      </div>
    </aside>
  )
}