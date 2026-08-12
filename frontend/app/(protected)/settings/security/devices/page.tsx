// app/dashboard/devices/page.tsx
'use client'

import { useEffect, useMemo } from 'react'
import { useDevicesStore } from "@/lib/device"

import {
  Monitor,
  Smartphone,
  ShieldCheck,
  RefreshCw,
  Globe,
  ShieldAlert,
  AlertCircle
} from 'lucide-react'

import dayjs from 'dayjs'
import 'dayjs/locale/ar'
import relativeTime from 'dayjs/plugin/relativeTime'

dayjs.extend(relativeTime)
dayjs.locale('ar')

export default function DevicesPage() {

  const devices =
  useDevicesStore(
    s => s.devices
  )

const loading =
  useDevicesStore(
    s => s.loading
  )

const actionLoading =
  useDevicesStore(
    s => s.actionLoading
  )

const fetchDevices =
  useDevicesStore(
    s => s.fetchDevices
  )

const logoutDevice =
  useDevicesStore(
    s => s.logoutDevice
  )

const logoutOthers =
  useDevicesStore(
    s => s.logoutOthers
  )

  /**
   * ✅ fetch
   */
  useEffect(() => {

    fetchDevices()

  }, [fetchDevices])

  /**
   * ✅ grouping
   */
  const {

    current,

    otherDevices

  } = useMemo(() => ({

    /**
     * ✅ current device
     */
    current:
      devices.find(
        d => d.is_current
      ),

    /**
     * ✅ all other devices
     */
    otherDevices:

      devices.filter(
        d => !d.is_current
      )

  }), [devices])

  /**
   * ✅ active only
   */
  const activeCount =

    otherDevices.filter(
      d => !d.logged_out_at
    ).length

  return (

    <div className="max-w-5xl mx-auto p-4 md:p-10 space-y-12 animate-in fade-in duration-700">

      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 border-b border-gray-100 pb-10">

        <div>

          <h1 className="text-4xl font-black text-gray-900 tracking-tight">

            إدارة الأجهزة

          </h1>

          <p className="text-gray-500 font-bold mt-2">

            راقب وتحكم في جميع الجلسات لحماية حسابك

          </p>

        </div>

        <div className="flex items-center gap-3 w-full md:w-auto">

          {

            activeCount > 0 && (

              <button
                onClick={() => logoutOthers()}
                disabled={loading}
                className="flex-1 md:flex-none flex items-center justify-center gap-2 bg-red-50 text-red-600 px-6 py-3.5 rounded-2xl font-black text-sm hover:bg-red-600 hover:text-white transition-all duration-300 shadow-sm"
              >

                <ShieldAlert size={18} />

                خروج من كافة الأجهزة

              </button>
            )
          }

          <button
            onClick={() => fetchDevices()}
            className={`p-3.5 rounded-2xl bg-gray-50 text-gray-600 hover:bg-gray-100 transition-all ${loading ? 'animate-spin' : ''}`}
          >

            <RefreshCw size={22} />

          </button>

        </div>

      </div>

      {/* Current Device */}
      <section className="space-y-6">

        <div className="flex items-center gap-3 text-blue-600">

          <span className="relative flex h-3 w-3">

            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>

            <span className="relative inline-flex rounded-full h-3 w-3 bg-blue-600"></span>

          </span>

          <h2 className="text-xs font-black uppercase tracking-[0.2em]">

            الجهاز المفتوح حالياً

          </h2>

        </div>

        {

          current ? (

            <div className="relative group overflow-hidden bg-gradient-to-br from-indigo-900 via-blue-900 to-blue-800 rounded-[3.5rem] p-8 md:p-14 text-white shadow-2xl">

              <div className="relative z-10 flex flex-col md:flex-row items-center justify-between gap-10">

                <div className="flex items-center gap-8">

                  <div className="bg-white/10 p-7 rounded-[2.5rem] backdrop-blur-2xl border border-white/20 shadow-inner">

                    {

                      current.device_type === 'mobile'

                        ? <Smartphone size={50} />

                        : <Monitor size={50} />
                    }

                  </div>

                  <div>

                    <h3 className="text-3xl md:text-4xl font-black mb-3">

                      {current.os_name} • {current.browser_name}

                    </h3>

                    <div className="flex flex-wrap items-center gap-5 text-blue-100/80 font-bold">

                      <span className="flex items-center gap-2 bg-white/5 px-4 py-1.5 rounded-xl border border-white/5">

                        <Globe size={16} />

                        {current.ip_address}

                      </span>

                      <span className="flex items-center gap-2 text-green-400">

                        <ShieldCheck size={20} />

                        نشط الآن

                      </span>

                    </div>

                  </div>

                </div>

                <div className="bg-white/10 px-8 py-3 rounded-2xl text-[10px] font-black uppercase tracking-[0.3em] border border-white/20 backdrop-blur-xl">

                  هذا الجهاز

                </div>

              </div>

              {/* Glow */}
              <div className="absolute top-0 right-0 -mr-20 -mt-20 w-80 h-80 bg-blue-400/20 rounded-full blur-[100px]"></div>

              <div className="absolute bottom-0 left-0 -ml-20 -mb-20 w-64 h-64 bg-indigo-500/20 rounded-full blur-[100px]"></div>

            </div>

          ) : (

            <div className="h-48 bg-gray-100 animate-pulse rounded-[3.5rem]" />
          )
        }

      </section>

      {/* Other Devices */}
      <section className="space-y-6">

        <h2 className="text-xs font-black text-gray-400 uppercase tracking-[0.2em]">

          أجهزة أخرى نشطة ({activeCount})

        </h2>

        <div className="grid gap-4">

          {

            otherDevices.length > 0 ? (

              otherDevices.map(d => {

                const loggedOut =
                  !!d.logged_out_at

                return (

                  <div
                    key={d.id}
                    className={`group rounded-[2.5rem] p-6 flex flex-col md:flex-row items-center justify-between transition-all duration-300 border

                    ${loggedOut
                      ? 'bg-gray-50 border-gray-200 opacity-80'
                      : 'bg-white border-gray-100 hover:border-blue-200 hover:shadow-xl hover:shadow-blue-500/5'
                    }`}
                  >

                    <div className="flex items-center gap-6">

                      <div className={`p-5 rounded-[1.8rem]

                        ${loggedOut
                          ? 'bg-gray-200 text-gray-500'
                          : 'bg-blue-50 text-blue-600'
                        }`}
                      >

                        {

                          d.device_type === 'mobile'

                            ? <Smartphone size={28}/>

                            : <Monitor size={28}/>
                        }

                      </div>

                      <div>

                        <h4 className={`font-black text-xl

                          ${loggedOut
                            ? 'text-gray-600'
                            : 'text-gray-900'
                          }`}
                        >

                          {d.os_name} • {d.browser_name}

                        </h4>

                        <p className={`text-sm font-bold mt-1 flex items-center gap-2

                          ${loggedOut
                            ? 'text-gray-400'
                            : 'text-gray-500'
                          }`}
                        >

                          <Globe
                            size={14}
                            className="text-gray-300"
                          />

                          {d.ip_address}

                          <span className="w-1 h-1 bg-gray-300 rounded-full"></span>

                          {

                            loggedOut

                              ? `آخر استخدام ${dayjs(d.logged_out_at).fromNow()}`

                              : `نشط الآن`
                          }

                        </p>

                      </div>

                    </div>

                    {

                      !loggedOut ? (

                        <button
                          onClick={() => logoutDevice(d.id)}
                          disabled={actionLoading === d.id}
                          className="mt-4 md:mt-0 px-8 py-4 bg-red-50 text-red-600 rounded-2xl font-black text-xs hover:bg-red-600 hover:text-white transition-all"
                        >

                          {

                            actionLoading === d.id

                              ? 'جاري الإنهاء...'

                              : 'إنهاء الجلسة'
                          }

                        </button>

                      ) : (

                        <div className="mt-4 md:mt-0 px-6 py-3 bg-gray-200 text-gray-500 rounded-2xl font-black text-xs">

                          تم تسجيل الخروج

                        </div>
                      )
                    }

                  </div>
                )
              })

            ) : (

              <div className="py-12 bg-gray-50 rounded-[2.5rem] border-2 border-dashed border-gray-200 text-center">

                <p className="text-gray-400 font-bold">

                  لا توجد أجهزة أخرى

                </p>

              </div>
            )
          }

        </div>

      </section>

      {/* Security Note */}
      <footer className="bg-amber-50 border border-amber-100 rounded-[2.5rem] p-8 flex items-start gap-6">

        <div className="bg-amber-100 p-4 rounded-2xl text-amber-600 shadow-sm">

          <AlertCircle size={28} />

        </div>

        <div>

          <h4 className="text-xl font-black text-amber-900 mb-2">

            هل تلاحظ شيئاً غريباً؟

          </h4>

          <p className="text-amber-800/80 font-bold leading-relaxed">

            إذا رأيت جهازاً لا تعرفه،
            قم بإنهاء الجلسة فوراً
            وتغيير كلمة المرور.

          </p>

        </div>

      </footer>

    </div>
  )
}