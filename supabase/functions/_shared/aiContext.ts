/**
 * Centralized AI context builder — single source of truth for all call data.
 * Both twilio-realtime and twilio-gather use this to get consistent context.
 */
import { getAvailableSlots, isWithinWorkingHours, nextOpeningTime } from './scheduling.ts'

export interface AIContext {
  company: {
    name: string
    description: string | null
    aiNotes: string | null
    cancellationPolicy: string | null
    timezone: string
    workingHours: Record<string, Array<{ start: string; end: string }>>
    leadTimeMinutes: number
    maxHorizonDays: number
    defaultBufferMinutes: number
    escalationPhone: string | null
    twilioAccountSid: string | null
    twilioAuthToken: string | null
    twilioPhoneNumber: string | null
    aiGreeting: string | null
    aiAutoBook: boolean
    aiConfirmSms: boolean
    allowUnknownService: boolean
    elevenlabsVoiceId: string | null
    language: string
  }
  services: Array<{
    id: string
    name: string
    description: string | null
    prepNote: string | null
    durationMin: number
    bufferAfterMin: number
    price: number | null
    category: string | null
  }>
  staff: Array<{ id: string; name: string; notes: string | null }>
  customer: {
    id: string | null
    name: string | null
    isReturning: boolean
    isVip: boolean
    notes: string | null
    preferredTimeOfDay: string | null
    favoriteService: string | null
    totalVisits: number
    upcomingBookings: Array<{
      id: string
      serviceName: string | null
      startsAt: string
      status: string
    }>
  }
  availability: {
    slotsText: string
    slots: Array<{ startsAt: Date; display: string }>
  }
  workingHoursSummary: string
  isWithinBusinessHours: boolean
  nextOpeningTime: string
}

/**
 * Build full AI context. Pass `preloadedSettings` to skip a second DB round-trip
 * when settings were already fetched for routing (e.g. by twilio_phone_number lookup).
 */
export async function buildAIContext(
  db: any,
  userId: string,
  callerPhone: string | null,
  preloadedSettings?: any,
): Promise<AIContext> {
  const settingsPromise = preloadedSettings
    ? Promise.resolve({ data: preloadedSettings })
    : db.from('company_settings').select([
        'user_id', 'company_name', 'company_description', 'ai_greeting', 'ai_notes',
        'working_hours', 'timezone', 'cancellation_policy',
        'lead_time_minutes', 'max_booking_horizon_days', 'default_buffer_minutes',
        'ai_auto_book', 'ai_confirm_sms', 'allow_unknown_service',
        'escalation_phone', 'twilio_phone_number', 'twilio_account_sid', 'twilio_auth_token',
        'elevenlabs_voice_id', 'ai_language',
      ].join(', ')).eq('user_id', userId).maybeSingle()

  const [settingsRes, servicesRes, staffRes, customerRes] = await Promise.all([
    settingsPromise,
    db.from('services')
      .select('id, name, description, prep_note, duration_min, buffer_after_min, price, category')
      .eq('user_id', userId).eq('is_active', true).order('name').limit(30),
    db.from('staff')
      .select('id, name, notes')
      .eq('user_id', userId).eq('is_active', true).limit(20),
    callerPhone
      ? db.from('customers')
          .select('id, name, notes, vip_status, last_visit_date')
          .eq('user_id', userId).eq('phone', callerPhone).maybeSingle()
      : Promise.resolve({ data: null }),
  ])

  const cfg = settingsRes.data
  const services: any[] = servicesRes.data ?? []
  const staff: any[] = staffRes.data ?? []
  const customer = customerRes.data ?? null
  const tz = cfg?.timezone ?? 'Europe/Prague'
  const wh = cfg?.working_hours ?? {}

  const now = new Date()
  const lang = cfg?.ai_language ?? 'cs-CZ'
  const locale = lang === 'en-US' ? 'en-US' : 'cs-CZ'

  const [historyRes, upcomingRes] = customer?.id
    ? await Promise.all([
        db.from('bookings')
          .select('starts_at, services(name)')
          .eq('user_id', userId)
          .eq('customer_id', customer.id)
          .order('starts_at', { ascending: false })
          .limit(15),
        db.from('bookings')
          .select('id, starts_at, status, services(name)')
          .eq('user_id', userId)
          .eq('customer_id', customer.id)
          .gte('starts_at', now.toISOString())
          .neq('status', 'cancelled')
          .order('starts_at', { ascending: true })
          .limit(5),
      ])
    : [{ data: [] }, { data: [] }]

  const history: any[] = historyRes.data ?? []
  const upcomingRaw: any[] = upcomingRes.data ?? []

  // Fetch slots for next 5 days (up to 5 days with slots shown)
  const durationMin = services[0]?.duration_min ?? 60
  const bufferMin = cfg?.default_buffer_minutes ?? 0
  const today = new Date()
  const allSlots: Array<{ startsAt: Date; display: string }> = []
  const slotsLines: string[] = []

  for (let offset = 0; offset < 5 && slotsLines.length < 5; offset++) {
    const day = new Date(today.getTime() + offset * 86400000)
    try {
      const daySlots = await getAvailableSlots(
        db, userId, durationMin, bufferMin, day, tz,
        wh,
        cfg?.lead_time_minutes ?? 120,
        cfg?.max_booking_horizon_days ?? 60,
        6,
      )
      if (!daySlots.length) continue
      const dayLabel = day.toLocaleDateString(locale, {
        weekday: 'long', day: 'numeric', month: 'long', timeZone: tz,
      })
      const times = daySlots.slice(0, 5).map(s =>
        s.startsAt.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', timeZone: tz }),
      )
      slotsLines.push(`${dayLabel}: ${times.join(', ')}`)
      allSlots.push(...daySlots.slice(0, 5))
    } catch { /* skip day on error */ }
  }

  const slotsText = slotsLines.length
    ? (lang === 'en-US'
        ? `Currently available slots:\n${slotsLines.join('\n')}`
        : `Aktuálně volné termíny:\n${slotsLines.join('\n')}`)
    : (lang === 'en-US'
        ? 'No available slots in the near future.'
        : 'Momentálně nejsou volné termíny v nejbližší době.')

  return {
    company: {
      name: cfg?.company_name ?? 'firma',
      description: cfg?.company_description ?? null,
      aiNotes: cfg?.ai_notes ?? null,
      cancellationPolicy: cfg?.cancellation_policy ?? null,
      timezone: tz,
      workingHours: wh,
      leadTimeMinutes: cfg?.lead_time_minutes ?? 120,
      maxHorizonDays: cfg?.max_booking_horizon_days ?? 60,
      defaultBufferMinutes: cfg?.default_buffer_minutes ?? 0,
      escalationPhone: cfg?.escalation_phone ?? null,
      twilioAccountSid: cfg?.twilio_account_sid ?? null,
      twilioAuthToken: cfg?.twilio_auth_token ?? null,
      twilioPhoneNumber: cfg?.twilio_phone_number ?? null,
      aiGreeting: cfg?.ai_greeting ?? null,
      aiAutoBook: cfg?.ai_auto_book !== false,
      aiConfirmSms: cfg?.ai_confirm_sms !== false,
      allowUnknownService: cfg?.allow_unknown_service === true,
      elevenlabsVoiceId: cfg?.elevenlabs_voice_id ?? null,
      language: cfg?.ai_language ?? 'cs-CZ',
    },
    services: services.map(s => ({
      id: s.id,
      name: s.name,
      description: s.description ?? null,
      prepNote: s.prep_note ?? null,
      durationMin: s.duration_min ?? 60,
      bufferAfterMin: s.buffer_after_min ?? 0,
      price: s.price ?? null,
      category: s.category ?? null,
    })),
    staff: staff.map(s => ({ id: s.id, name: s.name, notes: s.notes ?? null })),
    customer: {
      id: customer?.id ?? null,
      name: customer?.name ?? null,
      isReturning: !!customer,
      isVip: customer?.vip_status === true,
      notes: customer?.notes ?? null,
      preferredTimeOfDay: history.length ? inferPreferredTime(history.map(b => b.starts_at), tz) : null,
      favoriteService: history.length ? inferFavoriteService(history) : null,
      totalVisits: history.length,
      upcomingBookings: upcomingRaw.map(b => ({
        id: b.id,
        serviceName: (b.services as any)?.name ?? null,
        startsAt: b.starts_at,
        status: b.status ?? 'booked',
      })),
    },
    availability: { slotsText, slots: allSlots },
    workingHoursSummary: buildWorkingHoursSummary(wh),
    isWithinBusinessHours: isWithinWorkingHours(wh, tz),
    nextOpeningTime: nextOpeningTime(wh, tz),
  }
}

function inferPreferredTime(startsAtList: string[], tz: string): string | null {
  const valid = startsAtList.filter(Boolean)
  if (!valid.length) return null
  const hours = valid
    .map(s => parseInt(new Date(s).toLocaleString('en-US', { hour: 'numeric', hour12: false, timeZone: tz }), 10))
    .filter(h => !isNaN(h))
  if (!hours.length) return null
  const avg = hours.reduce((a, b) => a + b, 0) / hours.length
  if (avg < 11) return 'dopoledne'
  if (avg < 14) return 'okolo poledne'
  if (avg < 17) return 'odpoledne'
  return 'pozdě odpoledne nebo večer'
}

function inferFavoriteService(history: Array<{ services?: { name?: string } | null }>): string | null {
  const counts: Record<string, number> = {}
  for (const b of history) {
    const name = (b.services as any)?.name
    if (name) counts[name] = (counts[name] ?? 0) + 1
  }
  const entries = Object.entries(counts)
  if (!entries.length) return null
  return entries.sort((a, b) => b[1] - a[1])[0][0]
}

export function buildWorkingHoursSummary(
  wh: Record<string, Array<{ start: string; end: string }>> | null,
): string {
  if (!wh) return 'dle aktuálního nastavení'
  const days: Record<string, string> = {
    mon: 'Po', tue: 'Út', wed: 'St', thu: 'Čt', fri: 'Pá', sat: 'So', sun: 'Ne',
  }
  const result = Object.entries(days)
    .map(([key, label]) => {
      const slots = wh[key]
      if (!slots?.length) return null
      return `${label} ${slots[0].start}–${slots[0].end}`
    })
    .filter(Boolean)
    .join(', ')
  return result || 'viz web'
}

export function matchService(
  services: Array<{ id: string; name: string }>,
  name: string,
) {
  const n = name.toLowerCase()
  return services.find(
    s => s.name.toLowerCase().includes(n) || n.includes(s.name.toLowerCase()),
  ) ?? null
}

export function sendSmsCancellation(
  cfg: {
    twilio_account_sid?: string | null
    twilio_auth_token?: string | null
    twilio_phone_number?: string | null
    company_name?: string | null
    escalation_phone?: string | null
  },
  callerPhone: string,
  serviceName: string,
  startsAt: Date,
  customerName: string | null,
  tz: string,
) {
  if (!cfg.twilio_account_sid || !cfg.twilio_auth_token || !cfg.twilio_phone_number) return
  const base = `https://api.twilio.com/2010-04-01/Accounts/${cfg.twilio_account_sid}/Messages.json`
  const auth = `Basic ${btoa(`${cfg.twilio_account_sid}:${cfg.twilio_auth_token}`)}`
  const label = startsAt.toLocaleString('cs-CZ', {
    timeZone: tz, day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
  })

  fetch(base, {
    method: 'POST',
    headers: { Authorization: auth, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      To: callerPhone,
      From: cfg.twilio_phone_number,
      Body: `Vaše rezervace byla zrušena: ${serviceName}, ${label}. — ${cfg.company_name ?? ''}`,
    }).toString(),
  }).catch(() => {})

  if (cfg.escalation_phone) {
    fetch(base, {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        To: cfg.escalation_phone,
        From: cfg.twilio_phone_number,
        Body: `Zákazník zrušil rezervaci: ${serviceName}, ${label}. Zákazník: ${customerName ?? callerPhone}`,
      }).toString(),
    }).catch(() => {})
  }
}

export function sendSmsConfirmations(
  cfg: {
    twilio_account_sid?: string | null
    twilio_auth_token?: string | null
    twilio_phone_number?: string | null
    company_name?: string | null
    escalation_phone?: string | null
  },
  callerPhone: string,
  serviceName: string,
  startsAt: Date,
  customerName: string | null,
  tz: string,
) {
  if (!cfg.twilio_account_sid || !cfg.twilio_auth_token || !cfg.twilio_phone_number) return
  const base = `https://api.twilio.com/2010-04-01/Accounts/${cfg.twilio_account_sid}/Messages.json`
  const auth = `Basic ${btoa(`${cfg.twilio_account_sid}:${cfg.twilio_auth_token}`)}`
  const label = startsAt.toLocaleString('cs-CZ', {
    timeZone: tz, day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
  })

  fetch(base, {
    method: 'POST',
    headers: { Authorization: auth, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      To: callerPhone,
      From: cfg.twilio_phone_number,
      Body: `Potvrzení rezervace: ${serviceName}, ${label}. Těšíme se na vás! — ${cfg.company_name ?? ''}`,
    }).toString(),
  }).catch(() => {})

  if (cfg.escalation_phone) {
    fetch(base, {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        To: cfg.escalation_phone,
        From: cfg.twilio_phone_number,
        Body: `Nikola zarezervovala: ${serviceName}, ${label}. Zákazník: ${customerName ?? callerPhone}`,
      }).toString(),
    }).catch(() => {})
  }
}
