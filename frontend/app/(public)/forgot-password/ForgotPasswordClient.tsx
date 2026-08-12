'use client'

import {
  useMemo,
  useState
} from 'react'

import api from '@/lib/api'
import AuthNavigationLinks from '@/components/AuthNavigationLinks'

export default function ForgotPasswordClient() {

  const [email, setEmail] =
    useState('')

  const [loading, setLoading] =
    useState(false)

  const [success, setSuccess] =
    useState(false)

  const [error, setError] =
    useState('')

  /**
   * ✅ email validation
   */
  const emailValid =
    useMemo(() => {

      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/
        .test(email)

    }, [email])

  const submit = async (
    e: React.FormEvent
  ) => {

    e.preventDefault()

    setError('')

    /**
     * ✅ empty email
     */
    if (!email.trim()) {

      setError(
        'Email is required'
      )

      return
    }

    /**
     * ✅ invalid email
     */
    if (!emailValid) {

      setError(
        'Invalid email address'
      )

      return
    }

    setLoading(true)

    try {

      const res =
        await api.post(
          '/auth/forgot-password',
          {
            email
          }
        )

      /**
       * ✅ backend email not found
       */
      if (
        res?.data?.exists === false
      ) {

        setError(
          'Email does not exist'
        )

        return
      }

      setSuccess(true)

    } catch (err: any) {

      setError(
        err?.response?.data?.message ||
        'Something went wrong'
      )

    } finally {

      setLoading(false)
    }
  }

  return (

    <div
      className="
        min-h-screen
        flex
        items-center
        justify-center
        bg-black
        text-white
        p-4
      "
    >

      <form
        onSubmit={submit}
        className="
          w-full
          max-w-md
          bg-zinc-900
          p-6
          rounded-2xl
          space-y-5
          border
          border-zinc-800
        "
      >

        <div className="space-y-1">

          <h1 className="text-2xl font-bold">
            Forgot Password
          </h1>

          <p className="text-sm text-zinc-400">
            Enter your email to receive a recovery link.
          </p>

        </div>

        {

          success ? (

            <div
              className="
                bg-green-500/20
                text-green-400
                p-4
                rounded-xl
                text-sm
              "
            >

              Recovery email sent successfully.

            </div>

          ) : (

            <>

              {/* EMAIL */}
              <div className="space-y-2">

                <input
                  type="email"
                  placeholder="Enter your email"
                  value={email}
                  onChange={(e) => {

                    setEmail(
                      e.target.value
                    )

                    setError('')
                  }}
                  className={`
                    w-full
                    h-12
                    px-4
                    rounded-xl
                    bg-zinc-800
                    outline-none
                    border
                    transition-all

                    ${
                      error

                        ? 'border-red-500'

                        : email.length > 0

                          ? emailValid

                            ? 'border-green-500'

                            : 'border-red-500'

                          : 'border-zinc-700'
                    }
                  `}
                />

                {/* ❌ INVALID ONLY */}
                {

                  email.length > 0 &&
                  !emailValid && (

                    <p className="text-red-500 text-sm">

                      Invalid email format

                    </p>
                  )
                }
              </div>



              {/* ERROR */}
              {

                error && (

                  <div
                    className="
                      bg-red-500/20
                      text-red-400
                      p-3
                      rounded-xl
                      text-sm
                    "
                  >

                    {error}

                  </div>
                )
              }

              {/* BUTTON */}
              <button
                type="submit"
                disabled={
                  loading ||
                  !emailValid
                }
                className="
                  w-full
                  h-12
                  rounded-xl
                  bg-white
                  text-black
                  font-semibold
                  disabled:opacity-50
                  transition
                "
              >

                {

                  loading

                    ? 'Sending...'

                    : 'Continue'
                }

              </button>


            </>
          )
        }
              <AuthNavigationLinks />
        
      </form>
    </div>
  )
}
