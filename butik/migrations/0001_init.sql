-- Varje händelse från butiken, en rad per notis.
CREATE TABLE events (
  uuid TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  signed_at INTEGER NOT NULL,
  day TEXT NOT NULL,
  type TEXT NOT NULL,
  subtype TEXT,
  environment TEXT NOT NULL,
  bundle_id TEXT NOT NULL,
  product_id TEXT,
  sub_id TEXT,
  storefront TEXT,
  offer TEXT,
  price INTEGER,
  currency TEXT
);
CREATE INDEX events_day ON events (environment, day);

-- Senast kända läge per prenumeration.
CREATE TABLE subscriptions (
  sub_id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  environment TEXT NOT NULL,
  bundle_id TEXT NOT NULL,
  product_id TEXT,
  status TEXT NOT NULL,
  auto_renew INTEGER,
  offer TEXT,
  price INTEGER,
  currency TEXT,
  storefront TEXT,
  first_seen INTEGER NOT NULL,
  expires_at INTEGER,
  updated_at INTEGER NOT NULL
);
CREATE INDEX subscriptions_status ON subscriptions (environment, status);
