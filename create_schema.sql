-- ============================================================
-- PostgreSQL Star Schema - TransJakarta Data Warehouse
-- Paper: Optimizing TransJakarta Fleet Allocation
-- Kelompok 15 - Bina Nusantara University
-- ============================================================

-- Buat database dulu (jalankan di psql atau pgAdmin):
-- CREATE DATABASE transjakarta_dwh;

-- ─────────────────────────────────────────────
-- DIMENSION TABLES
-- ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS dim_station (
    station_key   SERIAL PRIMARY KEY,
    station_id    VARCHAR(20)  NOT NULL UNIQUE,
    station_name  VARCHAR(100) NOT NULL,
    latitude      FLOAT,
    longitude     FLOAT
);

CREATE TABLE IF NOT EXISTS dim_time (
    time_id      SERIAL PRIMARY KEY,
    date         DATE    NOT NULL,
    hour         INTEGER NOT NULL CHECK (hour BETWEEN 0 AND 23),
    peak_period  VARCHAR(30),
    day_of_week  VARCHAR(15),
    is_weekend   BOOLEAN DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS dim_route (
    route_key  SERIAL PRIMARY KEY,
    route_id   VARCHAR(20)  NOT NULL UNIQUE,
    route_name VARCHAR(200)
);

-- ─────────────────────────────────────────────
-- FACT TABLE
-- ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS fact_passenger_flow (
    id                   SERIAL PRIMARY KEY,
    station_id           VARCHAR(20)  REFERENCES dim_station(station_id),
    route_id             VARCHAR(20)  REFERENCES dim_route(route_id),
    date                 DATE,
    hour                 INTEGER,
    peak_period          VARCHAR(30),
    passenger_count      INTEGER,
    estimated_bus_demand INTEGER,
    is_overloaded        BOOLEAN DEFAULT FALSE
);

-- ─────────────────────────────────────────────
-- INDEX untuk query cepat di Power BI
-- ─────────────────────────────────────────────

CREATE INDEX idx_fact_station   ON fact_passenger_flow(station_id);
CREATE INDEX idx_fact_hour      ON fact_passenger_flow(hour);
CREATE INDEX idx_fact_peak      ON fact_passenger_flow(peak_period);
CREATE INDEX idx_fact_date      ON fact_passenger_flow(date);

-- ─────────────────────────────────────────────
-- LOAD DATA dari CSV (jalankan setelah Python script)
-- Sesuaikan path file CSV-nya
-- ─────────────────────────────────────────────

-- \COPY dim_station(station_id, station_name, latitude, longitude)
-- FROM '/path/to/dim_station.csv' CSV HEADER;

-- \COPY dim_time(date, hour, peak_period, time_id, day_of_week, is_weekend)
-- FROM '/path/to/dim_time.csv' CSV HEADER;

-- \COPY dim_route(route_id, route_name)
-- FROM '/path/to/dim_route.csv' CSV HEADER;

-- \COPY fact_passenger_flow(station_id, station_name_raw, lat, lon,
--       route_id, route_name, date, hour, peak_period,
--       passenger_count, estimated_bus_demand, is_overloaded)
-- FROM '/path/to/fact_passenger_flow.csv' CSV HEADER;

-- ─────────────────────────────────────────────
-- CONTOH QUERY ANALITIK (untuk Power BI)
-- ─────────────────────────────────────────────

-- 1. Penumpang per jam (untuk line chart)
SELECT hour, peak_period, SUM(passenger_count) AS total_passengers
FROM fact_passenger_flow
GROUP BY hour, peak_period
ORDER BY hour;

-- 2. Top 10 stasiun tersibuk
SELECT s.station_name, s.latitude, s.longitude,
       SUM(f.passenger_count) AS total_passengers,
       MAX(f.estimated_bus_demand) AS max_bus_demand
FROM fact_passenger_flow f
JOIN dim_station s ON f.station_id = s.station_id
GROUP BY s.station_name, s.latitude, s.longitude
ORDER BY total_passengers DESC
LIMIT 10;

-- 3. Fleet recommendation per koridor per peak period
SELECT route_id, peak_period,
       SUM(passenger_count) AS total_passengers,
       MAX(estimated_bus_demand) AS buses_needed
FROM fact_passenger_flow
GROUP BY route_id, peak_period
ORDER BY buses_needed DESC;
