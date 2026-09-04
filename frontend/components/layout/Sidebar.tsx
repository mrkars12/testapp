'use client'

import { useState, useRef, useEffect } from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useParams } from 'next/navigation'
import { useStoreBootstrap, resolveOriginalStoreSlug } from '@/lib/storeBootstrap'
import SidebarDropdown from './SidebarDropdown'
import StoreSwitcher from './StoreSwitcher'
import { useAuth } from '@/components/AuthProvider'

export default function Sidebar() {
  const [collapsed, setCollapsed] = useState(false)
  const [hovered, setHovered] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const pathname = usePathname()
  const router = useRouter()
  const params = useParams()
  // The ACTIVE store is the URL segment and nothing else. This previously
  // fell back to an in-memory mirror, which could name a store the user was
  // no longer in.
  const activeStoreSlug = typeof params?.storeSlug === 'string' ? params.storeSlug : null

  // On store-agnostic routes (/dashboard, /exchange, /settings/...) the URL
  // names no store and the mirror may be empty, so nav links used to fall
  // back to slug-free paths like `/store/orders`. Those are
  // redirect stubs: clicking one rendered a full-screen "جارٍ فتح
  // المتجر..." spinner, fetched the store list, and only THEN navigated to
  // the real page — a visible double navigation on every such click.
  //
  // The store list is already bootstrapped by the protected layout, so the
  // landing store is known here without any extra request. Resolving it up
  // front lets every link point straight at its final URL.
  const bootstrapStores = useStoreBootstrap((st) => st.stores)
  const navStoreSlug = activeStoreSlug ?? resolveOriginalStoreSlug(bootstrapStores)
  const { user, logout } = useAuth()
  const [openDropdowns, setOpenDropdowns] = useState<Set<string>>(new Set());

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

  const isActive = (paths: string | string[]) => {
    if (!pathname) return false
    const arr = Array.isArray(paths) ? paths : [paths]

    // Nav targets are written slug-free (`/store/products`) but
    // the live path carries the store segment
    // (`/store/acme/products`). Compare against the path with
    // that segment stripped, so highlighting doesn't silently stop working
    // for every store-scoped route.
    const slugFreePath = pathname.replace(
      /^\/store\/[^/]+(?=\/)/,
      '/store',
    )

    return arr.some(p =>
      pathname === p ||
      pathname.startsWith(p + '/') ||
      slugFreePath === p ||
      slugFreePath.startsWith(p + '/')
    )
  }

  // Store-scoped admin routes live under `/store/[storeSlug]/…`
  // — the slug in the URL is what makes a store active, so every nav link
  // has to carry it. `navStoreSlug` covers the store-agnostic case too, so
  // the slug-free stub (and its redirect hop) is only reached in the one
  // situation where nothing can be resolved: the store list has not loaded
  // yet, or the user owns no store at all.
  const s = (subPath: string) =>
    navStoreSlug ? `/store/${navStoreSlug}/${subPath}` : `/store/${subPath}`
  const paymentsHref = s('settings/payments')
  // The store ROOT is Dashboard — a distinct destination from every
  // section beneath it. This must never share `isActive`'s prefix-matching
  // with a section link (Dashboard would then also light up on
  // `/store/<slug>/products`, since that path starts with the root path),
  // so its active check is a plain exact match, done separately below.
  const dashboardHref = navStoreSlug ? `/store/${navStoreSlug}` : '/store'
  const isDashboardActive = pathname === dashboardHref || pathname === '/store'

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

      {/* ── Store Switcher ── */}
      <div className="px-3 pb-2">
        <StoreSwitcher />
      </div>

      {/* Menu */}
      <nav className="flex flex-1 flex-col overflow-auto gap-2 p-3">
  
        {/* Dashboard — the store ROOT (/store/<slug>), not the account /dashboard. */}
        <Link
          href={dashboardHref}
          className={`flex p-2 items-center h-6 p-2 gap-2 mb-1 text-sm text-left
          rounded-md outline-none
          transition-[width,height,padding] duration-150 ease-in-out
          text-[#0097c7] no-underline
          hover:bg-[hsl(240_4.8%_95.9%)] hover:text-[#0097c7] ${
            isDashboardActive
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

          {/*
            "المتاجر" (store list) and "إضافة متجر" (create store) used to
            live here. Both are store-agnostic actions, not store-scoped
            navigation, and this section is exclusively the latter now —
            creating a store lives in the Store Switcher instead
            ("إنشاء متجر جديد"), which is where a merchant already is when
            they need to add one, rather than a second, redundant entry
            point in the main nav. Seeing every store is the post-login
            chooser's job (`/select-store`), not a permanent Sidebar link.
          */}
          <Link
            href={s('pages')}
            className={`flex p-2 items-center h-6 gap-2 mb-1 text-sm rounded-md outline-none transition-all duration-150 text-[#0097c7] no-underline hover:bg-[hsl(240_4.8%_95.9%)] ${
              isActive('/store/pages') ? 'bg-[hsl(240_4.8%_95.9%)]' : ''
            }`}
          >
            <i className="fas fa-file-alt text-lg w-[1.2rem] h-[1.2rem]"></i>
            <span className="flex-1 truncate font-sans font-medium text-[#333]">Pages</span>
          </Link>

          <Link
            href={s('menus')}
            className={`flex p-2 items-center h-6 gap-2 mb-1 text-sm rounded-md outline-none transition-all duration-150 text-[#0097c7] no-underline hover:bg-[hsl(240_4.8%_95.9%)] ${
              isActive('/store/menus') ? 'bg-[hsl(240_4.8%_95.9%)]' : ''
            }`}
          >
            <i className="fas fa-bars text-lg w-[1.2rem] h-[1.2rem]"></i>
            <span className="flex-1 truncate font-sans font-medium text-[#333]">Menus</span>
          </Link>

          <Link
            href={s('products')}
            className={`flex p-2 items-center h-6 gap-2 mb-1 text-sm rounded-md outline-none transition-all duration-150 text-[#0097c7] no-underline hover:bg-[hsl(240_4.8%_95.9%)] ${
              isActive('/store/products') ? 'bg-[hsl(240_4.8%_95.9%)]' : ''
            }`}
          >
            <i className="fas fa-box text-lg w-[1.2rem] h-[1.2rem]"></i>
            <span className="flex-1 truncate font-sans font-medium text-[#333]">Products</span>
          </Link>

          <Link
            href={s('orders')}
            className={`flex p-2 items-center h-6 gap-2 mb-1 text-sm rounded-md outline-none transition-all duration-150 text-[#0097c7] no-underline hover:bg-[hsl(240_4.8%_95.9%)] ${
              isActive('/store/orders') ? 'bg-[hsl(240_4.8%_95.9%)]' : ''
            }`}
          >
            <i className="fas fa-receipt text-lg w-[1.2rem] h-[1.2rem]"></i>
            <span className="flex-1 truncate font-sans font-medium text-[#333]">Orders</span>
          </Link>

          <Link
            href={s('collections')}
            className={`flex p-2 items-center h-6 gap-2 mb-1 text-sm rounded-md outline-none transition-all duration-150 text-[#0097c7] no-underline hover:bg-[hsl(240_4.8%_95.9%)] ${
              isActive('/store/collections') ? 'bg-[hsl(240_4.8%_95.9%)]' : ''
            }`}
          >
            <i className="fas fa-layer-group text-lg w-[1.2rem] h-[1.2rem]"></i>
            <span className="flex-1 truncate font-sans font-medium text-[#333]">Collections</span>
          </Link>

          {/*
            Store settings. `isActive` is given the payments path as an
            exclusion so this row does not also light up while the user is
            on Payment Settings, which is nested beneath it.
          */}
          <Link
            href={s('settings')}
            className={`flex p-2 items-center h-6 gap-2 mb-1 text-sm rounded-md outline-none transition-all duration-150 text-[#0097c7] no-underline hover:bg-[hsl(240_4.8%_95.9%)] ${
              isActive(s('settings')) && !isActive(paymentsHref) ? 'bg-[hsl(240_4.8%_95.9%)]' : ''
            }`}
          >
            <i className="fas fa-gear text-lg w-[1.2rem] h-[1.2rem]"></i>
            <span className="flex-1 truncate font-sans font-medium text-[#333]">Settings</span>
          </Link>

          <Link
            href={paymentsHref}
            className={`flex p-2 items-center h-6 gap-2 mb-1 text-sm rounded-md outline-none transition-all duration-150 text-[#0097c7] no-underline hover:bg-[hsl(240_4.8%_95.9%)] ${
              isActive(paymentsHref) ? 'bg-[hsl(240_4.8%_95.9%)]' : ''
            }`}
          >
            <i className="fas fa-credit-card text-lg w-[1.2rem] h-[1.2rem]"></i>
            <span className="flex-1 truncate font-sans font-medium text-[#333]">Payments</span>
          </Link>

          <Link
            href={s('themes')}
            className={`flex p-2 items-center h-6 gap-2 mb-1 text-sm rounded-md outline-none transition-all duration-150 text-[#0097c7] no-underline hover:bg-[hsl(240_4.8%_95.9%)] ${
              isActive('/store/themes')
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