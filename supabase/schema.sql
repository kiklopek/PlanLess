-- PlanLess — kompletní schéma pro nový Supabase projekt
-- Spusťte tento soubor v SQL Editoru vašeho Supabase projektu

-- ============================================================
-- profiles
-- ============================================================
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  is_subscribed boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "profiles_select_own" ON public.profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "profiles_insert_own" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY "profiles_update_own" ON public.profiles FOR UPDATE USING (auth.uid() = id);

-- Auto-create profile row na signup (kritické — bez toho platba selže)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id) VALUES (new.id) ON CONFLICT (id) DO NOTHING;
  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================
-- company_settings
-- ============================================================
CREATE TABLE IF NOT EXISTS public.company_settings (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  company_name text DEFAULT '',
  legal_name text,
  company_id text,
  vat_id text,
  website_url text,
  public_email text,
  public_phone text,
  address_line1 text,
  address_line2 text,
  city text,
  postal_code text,
  country text,
  ai_notes text,
  company_description text,
  ai_voice text DEFAULT 'nikola',
  ai_tone text DEFAULT 'warm',
  ai_auto_book boolean DEFAULT true,
  ai_confirm_sms boolean DEFAULT true,
  timezone text DEFAULT 'Europe/Prague',
  working_hours jsonb DEFAULT '{"mon":[{"start":"09:00","end":"17:00"}],"tue":[{"start":"09:00","end":"17:00"}],"wed":[{"start":"09:00","end":"17:00"}],"thu":[{"start":"09:00","end":"17:00"}],"fri":[{"start":"09:00","end":"17:00"}],"sat":[],"sun":[]}',
  lead_time_minutes integer DEFAULT 120,
  max_booking_horizon_days integer DEFAULT 60,
  default_buffer_minutes integer DEFAULT 0,
  max_bookings_per_day integer DEFAULT 0,
  cancellation_policy text,
  allow_unknown_service boolean DEFAULT false,
  escalation_phone text,
  escalation_email text,
  onboarding_completed boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.company_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "company_settings_own" ON public.company_settings USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ============================================================
-- services
-- ============================================================
CREATE TABLE IF NOT EXISTS public.services (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  duration_min integer NOT NULL DEFAULT 30,
  buffer_after_min integer DEFAULT 0,
  price numeric(10,2),
  category text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.services ENABLE ROW LEVEL SECURITY;
CREATE POLICY "services_own" ON public.services USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS services_user_id_idx ON public.services(user_id);

-- ============================================================
-- customers
-- ============================================================
CREATE TABLE IF NOT EXISTS public.customers (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  phone text NOT NULL,
  name text,
  notes text,
  vip_status boolean DEFAULT false,
  last_visit_date date,
  created_at timestamptz DEFAULT now(),
  UNIQUE(user_id, phone)
);

ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "customers_own" ON public.customers USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS customers_user_id_idx ON public.customers(user_id);

-- ============================================================
-- bookings
-- ============================================================
CREATE TABLE IF NOT EXISTS public.bookings (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  service_id uuid REFERENCES public.services(id) ON DELETE SET NULL,
  call_id uuid,
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  note text,
  status text DEFAULT 'confirmed',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "bookings_own" ON public.bookings USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS bookings_user_id_idx ON public.bookings(user_id);
CREATE INDEX IF NOT EXISTS bookings_starts_at_idx ON public.bookings(starts_at);

-- ============================================================
-- calls
-- ============================================================
CREATE TABLE IF NOT EXISTS public.calls (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  customer_phone text,
  customer_name text,
  service_id uuid REFERENCES public.services(id) ON DELETE SET NULL,
  preferred_date date,
  booking_id uuid REFERENCES public.bookings(id) ON DELETE SET NULL,
  summary text,
  transcript_full text,
  recording_url text,
  status text DEFAULT 'missed',
  live boolean DEFAULT false,
  duration integer,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.calls ENABLE ROW LEVEL SECURITY;
CREATE POLICY "calls_own" ON public.calls USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS calls_user_id_idx ON public.calls(user_id);
CREATE INDEX IF NOT EXISTS calls_created_at_idx ON public.calls(created_at DESC);

-- ============================================================
-- calendar_blocks
-- ============================================================
CREATE TABLE IF NOT EXISTS public.calendar_blocks (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  reason text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.calendar_blocks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "calendar_blocks_own" ON public.calendar_blocks USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS calendar_blocks_user_id_idx ON public.calendar_blocks(user_id);

-- ============================================================
-- followups
-- ============================================================
CREATE TABLE IF NOT EXISTS public.followups (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  call_id uuid REFERENCES public.calls(id) ON DELETE SET NULL,
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  channel text DEFAULT 'sms',
  message text NOT NULL,
  status text DEFAULT 'queued' CHECK (status IN ('queued','sending','sent','failed','cancelled')),
  scheduled_at timestamptz DEFAULT now(),
  sent_at timestamptz,
  locked_at timestamptz,
  attempt_count integer DEFAULT 0,
  next_retry_at timestamptz,
  last_error text,
  provider text,
  provider_message_id text,
  metadata jsonb,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.followups ENABLE ROW LEVEL SECURITY;
CREATE POLICY "followups_own" ON public.followups USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS followups_status_idx ON public.followups(status, scheduled_at) WHERE status = 'queued';
CREATE INDEX IF NOT EXISTS followups_user_id_idx ON public.followups(user_id);
