// Capacitor native plugin wrappers — all calls are no-ops on web
let StatusBar, Keyboard, Haptics, SplashScreen, PushNotifications
let isNative = false

async function init() {
  if (typeof window === 'undefined') return
  try {
    const { Capacitor } = await import('@capacitor/core')
    isNative = Capacitor.isNativePlatform()
    if (!isNative) return

    const [sb, kb, hap, ss, pn] = await Promise.all([
      import('@capacitor/status-bar'),
      import('@capacitor/keyboard'),
      import('@capacitor/haptics'),
      import('@capacitor/splash-screen'),
      import('@capacitor/push-notifications'),
    ])
    StatusBar = sb.StatusBar
    Keyboard = kb.Keyboard
    Haptics = hap.Haptics
    SplashScreen = ss.SplashScreen
    PushNotifications = pn.PushNotifications

    await StatusBar.setStyle({ style: 'Dark' })
    await StatusBar.setBackgroundColor({ color: '#0f0f0f' })
    await SplashScreen.hide()
  } catch {}
}

export function getIsNative() { return isNative }

export async function hapticImpact(style = 'Medium') {
  if (!isNative || !Haptics) return
  try { await Haptics.impact({ style }) } catch {}
}

export async function hapticSuccess() {
  if (!isNative || !Haptics) return
  try { await Haptics.notification({ type: 'Success' }) } catch {}
}

export async function registerPushNotifications(onReceived) {
  if (!isNative || !PushNotifications) return
  try {
    const { receive } = await PushNotifications.requestPermissions()
    if (receive !== 'granted') return
    await PushNotifications.register()
    PushNotifications.addListener('registration', ({ value: token }) => {
      console.log('[Push] Token:', token)
    })
    if (onReceived) {
      PushNotifications.addListener('pushNotificationReceived', onReceived)
    }
  } catch {}
}

export default init
