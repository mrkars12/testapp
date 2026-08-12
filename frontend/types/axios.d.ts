import 'axios'

declare module 'axios' {
  // 👈 ده مهم لاستدعاء api.get / api.post
  export interface AxiosRequestConfig {
    skipLoader?: boolean
    __skipAuthRedirect?: boolean
    __silent401?: boolean
    __noLoading?: boolean
  }

  // 👈 وده مهم للـ interceptors
  export interface InternalAxiosRequestConfig {
    skipLoader?: boolean
    __skipAuthRedirect?: boolean
    __silent401?: boolean
    __noLoading?: boolean
  }
}
