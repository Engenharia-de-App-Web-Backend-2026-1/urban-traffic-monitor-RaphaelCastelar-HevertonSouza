CREATE TABLE IF NOT EXISTS traffic_readings (
  reading_id TEXT PRIMARY KEY,
  sensor_id TEXT NOT NULL,
  latitude DOUBLE PRECISION NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude DOUBLE PRECISION NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  average_speed_kmh DOUBLE PRECISION NOT NULL CHECK (average_speed_kmh >= 0),
  vehicle_count INTEGER NOT NULL CHECK (vehicle_count >= 0),
  occupancy_percent DOUBLE PRECISION NOT NULL CHECK (occupancy_percent BETWEEN 0 AND 100),
  captured_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS traffic_analyses (
  reading_id TEXT PRIMARY KEY REFERENCES traffic_readings(reading_id),
  status TEXT NOT NULL CHECK (status IN ('NORMAL', 'CONGESTED', 'ACCIDENT')),
  accident_detected BOOLEAN NOT NULL,
  event_id TEXT UNIQUE,
  severity TEXT NOT NULL CHECK (severity IN ('NONE', 'MEDIUM', 'HIGH', 'CRITICAL')),
  message TEXT NOT NULL,
  analyzed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS outbox_events (
  id TEXT PRIMARY KEY,
  aggregate_type TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'PROCESSING', 'PUBLISHED')),
  attempts INTEGER NOT NULL DEFAULT 0,
  available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_at TIMESTAMPTZ,
  published_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_outbox_pending
  ON outbox_events (status, available_at, created_at);
