let isLoggingOut = false;

export const getIsLoggingOut = () => isLoggingOut;

export const forceLogout = () => {
  if (isLoggingOut) return;
  isLoggingOut = true;

  // 🚨 وقف أي حاجة فوراً
  window.stop();

  // 🧹 امسح الكوكيز
  document.cookie = "laravel_session=; expires=Thu, 01 Jan 1970 UTC; path=/;";
  document.cookie = "XSRF-TOKEN=; expires=Thu, 01 Jan 1970 UTC; path=/;";

  // 🚀 خروج فوري
  window.location.replace('/login');
};