'use client'

import {
useEffect,
useMemo,
useState
} from 'react'

import {
useSearchParams,
useRouter
} from 'next/navigation'

import {
Eye,
EyeOff
} from 'lucide-react'

import api from '@/lib/api'

import {
validatePassword
} from '@/lib/passwordStrength'

export default function RecoverPasswordClient() {

const router = useRouter()

const params =
useSearchParams()

const code =
params.get('code')

const [password, setPassword] =
useState('')

const [confirmPassword,
setConfirmPassword] =
useState('')

const [showPassword,
setShowPassword] =
useState(false)

const [showConfirmPassword,
setShowConfirmPassword] =
useState(false)

const [loading, setLoading] =
useState(false)

const [valid, setValid] =
useState<boolean | null>(null)

const [done, setDone] =
useState(false)

const [stopVerify,
setStopVerify] =
useState(false)

const [error, setError] =
useState('')

/**

* ✅ realtime verify
  */
  useEffect(() => {

if (!code) {
  setValid(false)

  return
}

/**
 * ✅ stop verify after success
 */
if (stopVerify) {

  return
}

let mounted = true

const verifyCode =
  async () => {

    try {

      await api.get(

        `/auth/recover-password/verify?code=${code}`
      )

      if (mounted) {

        setValid(true)
      }

    } catch {

      /**
       * ✅ ignore after success
       */
      if (
        mounted &&
        !stopVerify
      ) {

        setValid(false)
      }
    }
  }

/**
 * ✅ initial verify
 */
verifyCode()

/**
 * ✅ realtime expiration
 */
const interval =

  setInterval(() => {

    verifyCode()

  }, 1000)

return () => {

  mounted = false

  clearInterval(interval)
}
}, [code, stopVerify])

/**

* ✅ password strength
  */
  const passwordState =
  useMemo(() => {

  return validatePassword(
  password
  )


}, [password])

/**

* ✅ password match
  */
  const passwordsMatch =


password &&


confirmPassword &&
password === confirmPassword


/**

* ✅ submit
  */
  const submit = async (
  e: React.FormEvent
  ) => {


e.preventDefault()



setError('')

if (
  !passwordState.valid
) {

  setError(
    'Password is too weak'
  )

  return
}

if (!passwordsMatch) {

  setError(
    'Passwords do not match'
  )

  return
}

setLoading(true)

try {

  await api.post(

    '/auth/recover-password/reset',

    {
      code,
      password
    }
  )

  /**
   * ✅ stop realtime verify
   */
  setStopVerify(true)

  /**
   * ✅ success state
   */
  setDone(true)

  /**
   * ✅ redirect safely
   */
  setTimeout(() => {

    router.replace('/login')

  }, 1500)

} catch (err: any) {

  setError(

    err?.response?.data?.message ||

    'Reset failed'
  )

} finally {

  setLoading(false)
}

}

/**

* ✅ block back button
  */
  useEffect(() => {

window.history.pushState(

  null,
  '',
  window.location.href
)

const handleBack = () => {

  window.history.go(1)
}

window.addEventListener(
  'popstate',
  handleBack
)

return () => {

  window.removeEventListener(
    'popstate',
    handleBack
  )
}

}, [])

/**

* ✅ loading
  */
  if (valid === null) {


return (



  <div className="min-h-screen flex items-center justify-center bg-black text-white">

    Loading...

  </div>
)


}

/**

* ✅ expired
  */
  if (!valid && !done) {


return (



  <div className="min-h-screen flex items-center justify-center bg-black text-white">

    <div className="text-center space-y-4">

      <h1 className="text-2xl font-bold text-red-500">

        Recovery link expired

      </h1>

      <p className="text-zinc-400">

        Please request a new password recovery link.

      </p>

      <button
        onClick={() => {

          router.replace(
            '/forgot-password'
          )
        }}
        className="
          h-11
          px-5
          rounded-xl
          bg-white
          text-black
          font-semibold
        "
      >

        Request New Link

      </button>

    </div>

  </div>
)


}

return (

<div className="min-h-screen flex items-center justify-center bg-black text-white p-4">

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

    <h1 className="text-2xl font-bold">

      Reset Password

    </h1>

    {

      done ? (

        <div className="bg-green-500/20 text-green-400 p-3 rounded-lg">

          Password changed successfully

        </div>

      ) : (

        <>
          {/* PASSWORD */}
          <div className="space-y-3">

            <div className="relative">

              <input
                type={
                  showPassword
                    ? 'text'
                    : 'password'
                }
                placeholder="New password"
                value={password}
                onChange={(e) =>
                  setPassword(
                    e.target.value
                  )
                }
                className={`
                  w-full
                  h-12
                  px-4
                  pr-14
                  rounded-xl
                  bg-zinc-800
                  outline-none
                  border
                  transition-all

                  ${
                    password.length > 0 &&
                    !passwordState.valid

                      ? 'border-red-500'

                      : passwordState.valid

                        ? 'border-green-500'

                        : 'border-zinc-700'
                  }
                `}
              />

              <button
                type="button"
                onClick={() =>
                  setShowPassword(
                    !showPassword
                  )
                }
                className="
                  absolute
                  right-4
                  top-1/2
                  -translate-y-1/2
                  text-zinc-400
                "
              >

                {
                  showPassword

                    ? <EyeOff size={20} />

                    : <Eye size={20} />
                }

              </button>
            </div>

            {/* RULES */}
            <div className="space-y-2 text-sm">

              <p className={
                passwordState.checks.lowercase

                  ? 'text-green-500'

                  : 'text-red-500'
              }>
                At least one lowercase letter
              </p>

              <p className={
                passwordState.checks.uppercase

                  ? 'text-green-500'

                  : 'text-red-500'
              }>
                At least one uppercase letter
              </p>

              <p className={
                passwordState.checks.number

                  ? 'text-green-500'

                  : 'text-red-500'
              }>
                At least one number
              </p>

              <p className={
                passwordState.checks.special

                  ? 'text-green-500'

                  : 'text-red-500'
              }>
                At least one special character
              </p>

              <p className={
                passwordState.checks.length

                  ? 'text-green-500'

                  : 'text-red-500'
              }>
                Minimum 8 characters
              </p>

            </div>
          </div>

          {/* CONFIRM */}
          <div className="space-y-2">

            <div className="relative">

              <input
                type={
                  showConfirmPassword

                    ? 'text'

                    : 'password'
                }
                placeholder="Confirm password"
                value={confirmPassword}
                onChange={(e) =>
                  setConfirmPassword(
                    e.target.value
                  )
                }
                className={`
                  w-full
                  h-12
                  px-4
                  pr-14
                  rounded-xl
                  bg-zinc-800
                  outline-none
                  border
                  transition-all

                  ${
                    confirmPassword.length > 0

                      ? passwordsMatch

                        ? 'border-green-500'

                        : 'border-red-500'

                      : 'border-zinc-700'
                  }
                `}
              />

              <button
                type="button"
                onClick={() =>
                  setShowConfirmPassword(
                    !showConfirmPassword
                  )
                }
                className="
                  absolute
                  right-4
                  top-1/2
                  -translate-y-1/2
                  text-zinc-400
                "
              >

                {
                  showConfirmPassword

                    ? <EyeOff size={20} />

                    : <Eye size={20} />
                }

              </button>
            </div>

            {

              confirmPassword && (

                <p
                  className={

                    passwordsMatch

                      ? 'text-green-500 text-sm'

                      : 'text-red-500 text-sm'
                  }
                >

                  {

                    passwordsMatch

                      ? 'Passwords match'

                      : 'Passwords do not match'
                  }

                </p>
              )
            }
          </div>

          {/* ERROR */}
          {

            error && (

              <div className="bg-red-500/20 text-red-400 p-3 rounded-lg text-sm">

                {error}

              </div>
            )
          }

          {/* BUTTON */}
          <button
            disabled={
              loading ||
              !passwordState.valid ||
              !passwordsMatch
            }
            className="
              w-full
              h-12
              rounded-xl
              bg-white
              text-black
              font-semibold
              disabled:opacity-50
            "
          >

            {

              loading
                ? 'Saving...'
                : 'Change Password'
            }

          </button>
        </>
      )
    }
  </form>
</div>

)
}
