import { supabase } from './supabase.js'

export const DEFAULT_WORKING_HOURS = {
  mon: [{ start: '09:00', end: '17:00' }],
  tue: [{ start: '09:00', end: '17:00' }],
  wed: [{ start: '09:00', end: '17:00' }],
  thu: [{ start: '09:00', end: '17:00' }],
  fri: [{ start: '09:00', end: '17:00' }],
  sat: [],
  sun: [],
}

export const DEFAULT_COMPANY_SETTINGS = {
  company_name: '',
  legal_name: null,
  company_id: null,
  vat_id: null,
  website_url: null,
  public_email: null,
  public_phone: null,
  address_line1: null,
  address_line2: null,
  city: null,
  postal_code: null,
  country: null,
  ai_notes: null,
  timezone: 'Europe/Prague',
  working_hours: DEFAULT_WORKING_HOURS,
  lead_time_minutes: 120,
  max_booking_horizon_days: 60,
  default_buffer_minutes: 0,
  max_bookings_per_day: 0,
  cancellation_policy: null,
  allow_unknown_service: false,
  escalation_phone: null,
  escalation_email: null,
  onboarding_completed: false,
}

export async function getCompanySettings(userId) {
  const { data, error } = await supabase
    .from('company_settings')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle()

  if (error) throw error
  return data
}

export async function saveCompanySettings(userId, settings) {
  const { data, error } = await supabase
    .from('company_settings')
    .upsert({ user_id: userId, ...settings }, { onConflict: 'user_id' })
    .select('*')
    .single()

  if (error) throw error
  return data
}
