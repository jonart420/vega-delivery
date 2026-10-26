-- VEGA Delivery – base schema.
-- Files in this folder run once each, in alphabetical order (lib/migrate.ts).

create extension if not exists pgcrypto;
create extension if not exists citext;

-- ── Team ────────────────────────────────────────────────────────────────
create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  user_no serial unique,
  username citext not null unique,
  display_name text,
  password_hash text,
  role text not null default 'driver' check (role in ('admin', 'dispatcher', 'driver')),
  locale text,
  phone text,
  active boolean not null default true,
  login_code_version int not null default 0,
  login_code_hash text,
  login_code_created_at timestamptz,
  login_code_revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists users_login_code_hash on users (login_code_hash) where login_code_hash is not null;

create table if not exists sessions (
  token_hash text primary key,
  user_id uuid not null references users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  token_hash text not null unique,
  name text,
  platform text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz,
  revoked_at timestamptz
);

-- ── Settings (key/value) ────────────────────────────────────────────────
create table if not exists settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

-- ── Address book ────────────────────────────────────────────────────────
-- customer_no is an EAN-8: 7 digits + check digit, used as the customer indicator barcode.
create sequence if not exists customer_no_seq start 1000001 maxvalue 9999999;

create table if not exists customers (
  id uuid primary key default gen_random_uuid(),
  customer_no char(8) not null unique check (customer_no ~ '^[0-9]{8}$'),
  company text,
  first_name text,
  last_name text,
  street text not null,
  house_no text,
  address_extra text,
  zip text not null,
  city text not null,
  country char(2) not null default 'DE',
  lat double precision,
  lon double precision,
  geocode_status text not null default 'pending' check (geocode_status in ('pending', 'ok', 'manual', 'failed')),
  phone text,
  email text,
  whatsapp text,
  notify_email boolean not null default false,
  notify_whatsapp boolean not null default false,
  notify_consent_at timestamptz,
  locale text,
  delivery_notes text,
  time_window_from time,
  time_window_to time,
  dwell_minutes int check (dwell_minutes between 0 and 240),
  barcode_mode text check (barcode_mode in ('per_customer', 'per_delivery')),
  fixed_delivery_ean char(13),
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists customers_search on customers using gin (
  to_tsvector('simple', coalesce(company, '') || ' ' || coalesce(first_name, '') || ' ' || coalesce(last_name, '') || ' ' || street || ' ' || city || ' ' || zip)
);

-- ── Products ────────────────────────────────────────────────────────────
create table if not exists product_categories (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid references product_categories(id) on delete set null,
  name text not null,
  sort int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  category_id uuid references product_categories(id) on delete set null,
  sku text unique,
  name text not null,
  description text,
  unit text not null default 'pcs',
  price_cents int not null default 0 check (price_cents >= 0),
  vat_rate numeric(5, 2) not null default 19,
  ean13 char(13),
  weight_g int,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── Orders ──────────────────────────────────────────────────────────────
create sequence if not exists order_no_seq start 100001;
create sequence if not exists delivery_ean_seq start 1;

create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  order_no bigint not null unique default nextval('order_no_seq'),
  customer_id uuid not null references customers(id) on delete restrict,
  delivery_date date not null,
  time_window_from time,
  time_window_to time,
  status text not null default 'open'
    check (status in ('open', 'planned', 'out_for_delivery', 'delivered', 'failed', 'cancelled')),
  delivery_ean13 char(13) not null,
  notes text,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists orders_date_status on orders (delivery_date, status);
create index if not exists orders_customer on orders (customer_id);
create index if not exists orders_ean on orders (delivery_ean13);

create table if not exists order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  product_id uuid references products(id) on delete set null,
  name_snapshot text not null,
  qty numeric(10, 2) not null check (qty > 0),
  unit text not null default 'pcs',
  unit_price_cents int not null default 0,
  sort int not null default 0
);

-- ── Tours ───────────────────────────────────────────────────────────────
create table if not exists tours (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  title text not null,
  driver_id uuid references users(id) on delete set null,
  vehicle text,
  mode text not null default 'auto' check (mode in ('auto', 'bicycle', 'pedestrian')),
  start_lat double precision,
  start_lon double precision,
  start_label text,
  end_lat double precision,
  end_lon double precision,
  end_label text,
  planned_start time,
  status text not null default 'draft' check (status in ('draft', 'released', 'in_progress', 'done')),
  route jsonb,
  released_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists tours_date on tours (date);

create table if not exists tour_stops (
  id uuid primary key default gen_random_uuid(),
  tour_id uuid not null references tours(id) on delete cascade,
  customer_id uuid not null references customers(id) on delete restrict,
  sort_index int,
  fixed_position int,
  eta timestamptz,
  status text not null default 'pending'
    check (status in ('pending', 'arrived', 'delivered', 'failed', 'skipped')),
  outcome_code text,
  completed_at timestamptz,
  tracking_token text not null unique,
  tracking_active_from timestamptz,
  tracking_expires_at timestamptz,
  created_at timestamptz not null default now(),
  unique (tour_id, customer_id)
);
create index if not exists tour_stops_tour on tour_stops (tour_id, sort_index);

create table if not exists tour_stop_orders (
  stop_id uuid not null references tour_stops(id) on delete cascade,
  order_id uuid not null references orders(id) on delete cascade,
  primary key (stop_id, order_id),
  unique (order_id)
);

-- ── Delivery outcomes & reasons (freely extensible) ─────────────────────
create table if not exists delivery_outcomes (
  code text primary key check (code ~ '^[a-z][a-z0-9_]{1,40}$'),
  label_en text not null,
  label_de text not null,
  kind text not null check (kind in ('success', 'failure', 'neutral')),
  icon text,
  color text,
  requires_reason boolean not null default false,
  requires_photo boolean not null default false,
  requires_signature boolean not null default false,
  requires_recipient boolean not null default false,
  requires_scan boolean not null default false,
  final boolean not null default true,
  active boolean not null default true,
  sort int not null default 0,
  system boolean not null default false
);

create table if not exists delivery_reasons (
  id uuid primary key default gen_random_uuid(),
  outcome_code text not null references delivery_outcomes(code) on delete cascade on update cascade,
  label_en text not null,
  label_de text not null,
  active boolean not null default true,
  sort int not null default 0
);

-- ── Delivery log ────────────────────────────────────────────────────────
create table if not exists delivery_events (
  id uuid primary key default gen_random_uuid(),
  client_id text unique,
  tour_id uuid not null references tours(id) on delete cascade,
  stop_id uuid references tour_stops(id) on delete set null,
  customer_id uuid references customers(id) on delete set null,
  order_id uuid references orders(id) on delete set null,
  user_id uuid references users(id) on delete set null,
  device_id uuid references devices(id) on delete set null,
  type text not null default 'outcome' check (type in ('outcome', 'arrived', 'note', 'notification', 'started', 'finished')),
  outcome_code text references delivery_outcomes(code) on update cascade,
  reason_id uuid references delivery_reasons(id) on delete set null,
  reason_text text,
  recipient_name text,
  neighbor_info text,
  scanned_codes text[],
  photo_path text,
  signature_path text,
  note text,
  lat double precision,
  lon double precision,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists delivery_events_tour on delivery_events (tour_id, occurred_at);
create index if not exists delivery_events_customer on delivery_events (customer_id, occurred_at desc);

-- ── Positions ───────────────────────────────────────────────────────────
create table if not exists track_points (
  tour_id uuid not null references tours(id) on delete cascade,
  device_id uuid references devices(id) on delete set null,
  t timestamptz not null,
  lat double precision not null,
  lon double precision not null,
  acc real,
  speed real,
  heading real
);
create index if not exists track_points_tour on track_points (tour_id, t);

create table if not exists live_positions (
  tour_id uuid primary key references tours(id) on delete cascade,
  device_id uuid references devices(id) on delete set null,
  t timestamptz not null,
  lat double precision not null,
  lon double precision not null,
  acc real,
  speed real,
  heading real
);

-- ── Notifications ───────────────────────────────────────────────────────
create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  stop_id uuid references tour_stops(id) on delete cascade,
  customer_id uuid references customers(id) on delete set null,
  channel text not null check (channel in ('email', 'whatsapp')),
  kind text not null check (kind in ('day_start', 'approaching', 'manual', 'delivered', 'failed', 'test')),
  recipient text not null,
  status text not null default 'queued' check (status in ('queued', 'sent', 'failed', 'skipped')),
  attempts int not null default 0,
  provider text,
  provider_msg_id text,
  error text,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create unique index if not exists notifications_once
  on notifications (stop_id, kind, channel) where kind in ('day_start', 'approaching', 'delivered', 'failed');
create index if not exists notifications_queue on notifications (status, created_at) where status = 'queued';
