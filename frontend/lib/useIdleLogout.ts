'use client'

import {
  useEffect,
  useRef,
  useCallback
} from 'react'

import { useAuthState } from '@/lib/authState'
import { dispatchSessionExpired } from '@/lib/api'

const IDLE_TIMEOUT_MS =
  150 * 60 * 1000

const HEARTBEAT_INTERVAL =
  30 * 1000

const MIN_SLEEP_FOR_RELOAD =
  1 * 60 * 1000

const ACTIVITY_EVENTS = [

  'mousemove',
  'mousedown',
  'keydown',
  'touchstart',
  'touchmove',
  'scroll',
  'click',
  'wheel',
  'pointermove',

] as const

export function useIdleLogout(
  enabled: boolean
) {

  const lastActivityRef =
    useRef<number>(Date.now())

  const idleTimerRef =
    useRef<ReturnType<typeof setTimeout> | null>(null)

  const heartbeatRef =
    useRef<ReturnType<typeof setInterval> | null>(null)

  const hiddenAtRef =
    useRef<number | null>(null)

  const isBusyRef =
    useRef(false)

  const hasLoggedOutRef =
    useRef(false)

  const pauseHeartbeatRef =
    useRef(false)

  const { status } =
    useAuthState()

  const isActive =
    enabled &&
    status === 'authenticated'

  const clearTimers =
    useCallback(() => {

      if (idleTimerRef.current)
        clearTimeout(idleTimerRef.current)

      if (heartbeatRef.current)
        clearInterval(heartbeatRef.current)

      idleTimerRef.current = null
      heartbeatRef.current = null

    }, [])

  const triggerLogout =
    useCallback((reason: string) => {

      const { status: s } =
        useAuthState.getState()

      if (

        s === 'refreshing_session' ||

        s === 'logging_out' ||

        s === 'unauthenticated'
      ) {
        return
      }

      if (
        hasLoggedOutRef.current
      ) {
        return
      }

      hasLoggedOutRef.current = true

      clearTimers()

      dispatchSessionExpired(reason)

    }, [clearTimers])

  const resetIdleTimer =
    useCallback(() => {

      if (
        !isActive ||
        hasLoggedOutRef.current
      ) {
        return
      }

      if (idleTimerRef.current)
        clearTimeout(idleTimerRef.current)

      idleTimerRef.current =
        setTimeout(() => {

          triggerLogout(
            'idle_timeout'
          )

        }, IDLE_TIMEOUT_MS)

    }, [isActive, triggerLogout])

  const onActivity =
    useCallback(() => {

      if (
        !isActive ||
        hasLoggedOutRef.current
      ) {
        return
      }

      lastActivityRef.current =
        Date.now()

      resetIdleTimer()

    }, [isActive, resetIdleTimer])

  const sendHeartbeat =
    useCallback(async () => {

      if (
        pauseHeartbeatRef.current
      ) {
        return
      }

      if (

        document.visibilityState !==
        'visible'
      ) {
        return
      }

      const { status: s } =
        useAuthState.getState()

      if (

        hasLoggedOutRef.current ||

        s === 'logging_out' ||

        s === 'unauthenticated' ||

        s === 'refreshing_session'
      ) {

        return
      }

      try {

        const res =
          await fetch(

            `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api'}/auth/heartbeat`,

            {
              method: 'POST',
              credentials: 'include'
            }
          )

        /**
         * ✅ ignore heartbeat 401
         */
        if (
          res.status === 401
        ) {
          return
        }

      } catch {}

    }, [])

  const onWakeUp =
    useCallback(async () => {

      if (

        !isActive ||

        hasLoggedOutRef.current ||

        isBusyRef.current
      ) {
        return
      }

      isBusyRef.current = true

      try {

        const now = Date.now()

        const hiddenDuration =
          hiddenAtRef.current

            ? now - hiddenAtRef.current

            : 0

        const idleDuration =
          now - lastActivityRef.current

        if (

          hiddenDuration >=
            IDLE_TIMEOUT_MS ||

          idleDuration >=
            IDLE_TIMEOUT_MS
        ) {

          triggerLogout(
            'idle_timeout'
          )

          return
        }

        resetIdleTimer()

      } finally {

        isBusyRef.current = false

        hiddenAtRef.current = null
      }

    }, [

      isActive,
      triggerLogout,
      resetIdleTimer
    ])


  useEffect(() => {
    if (!isActive) return;

    let lastTick = Date.now();

    const driftDetector = setInterval(() => {
      if (hasLoggedOutRef.current) {
        clearInterval(driftDetector);
        return;
      }

      const now = Date.now();
      const drift = now - lastTick;

      // إذا تأخرت النبضة لأكثر من 5 ثوانٍ (يعني اللابتوب كان نايم وصحي)
      if (drift > 5000) {
        const absoluteIdleTime = now - lastActivityRef.current;
        
        // إذا كان الجهاز نائماً واكتشفنا أن الوقت تخطى الخمول
        if (absoluteIdleTime >= IDLE_TIMEOUT_MS) {
          console.log('🚨 تم تخطي وقت الخمول أثناء النوم، جاري الطرد الصاروخي...');
          triggerLogout('idle_timeout');
          return;
        }
      }
      
      lastTick = now;
    }, 500);

    return () => clearInterval(driftDetector);
  }, [isActive, triggerLogout]);

  useEffect(() => {

    const stop = () => {

      clearTimers()

      hasLoggedOutRef.current = true
    }

    const pause = () => {

      pauseHeartbeatRef.current = true
    }

    const resume = () => {

      pauseHeartbeatRef.current = false
    }

    window.addEventListener(
      'auth:stop_idle',
      stop
    )

    window.addEventListener(
      'auth:pause_heartbeat',
      pause
    )

    window.addEventListener(
      'auth:resume_heartbeat',
      resume
    )

    return () => {

      window.removeEventListener(
        'auth:stop_idle',
        stop
      )

      window.removeEventListener(
        'auth:pause_heartbeat',
        pause
      )

      window.removeEventListener(
        'auth:resume_heartbeat',
        resume
      )
    }

  }, [clearTimers])

  const onVisibilityChange =
    useCallback(() => {

      if (
        document.visibilityState ===
        'hidden'
      ) {

        hiddenAtRef.current =
          Date.now()

      } else {

        onWakeUp()
      }

    }, [onWakeUp])

  useEffect(() => {

    if (!isActive) {

      clearTimers()

      return
    }

    hasLoggedOutRef.current = false

    lastActivityRef.current =
      Date.now()

    resetIdleTimer()

    heartbeatRef.current =
      setInterval(
        sendHeartbeat,
        HEARTBEAT_INTERVAL
      )

    ACTIVITY_EVENTS.forEach(event => {

      window.addEventListener(
        event,
        onActivity,
        { passive: true }
      )
    })

    document.addEventListener(
      'visibilitychange',
      onVisibilityChange
    )




    return () => {

      clearTimers()

      ACTIVITY_EVENTS.forEach(event => {

        window.removeEventListener(
          event,
          onActivity
        )
      })

      document.removeEventListener(
        'visibilitychange',
        onVisibilityChange
      )
    }

  }, [

    isActive,
    clearTimers,
    resetIdleTimer,
    sendHeartbeat,
    onActivity,
    onVisibilityChange
  ])
}