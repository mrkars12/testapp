import {

  Suspense

} from 'react'

import RecoverPasswordClient
from './RecoverPasswordClient'

export default function RecoverPasswordPage() {

  return (

    <Suspense
      fallback={

        <div
          className="
            min-h-screen
            flex
            items-center
            justify-center
            bg-black
            text-white
          "
        >

          Loading...

        </div>
      }
    >

      <RecoverPasswordClient />

    </Suspense>
  )
}