# DA-TransJakarta_Bus_Allocated

Optimizing TransJakarta Fleet Allocation using Data Warehouse and Granularity Enrichment (Kelompok 15, Bina Nusantara University).

## Isi repo

| File | Keterangan |
|------|-----------|
| `Data_TransJakarta(Cleaned).csv` | Data trip hasil cleansing Pentaho |
| `transjakarta_enrichment.ipynb` | Granularity enrichment, star schema, fleet recommendation |
| `create_schema.sql` | Star schema PostgreSQL |
| `scripts/build_dashboard_data.py` | Generate data untuk dashboard web |
| `web/` | Dashboard web statis (siap deploy ke Vercel) |

## Dashboard web

Dashboard interaktif: filter tanggal, jenis hari, koridor, dan periode sibuk; KPI; penumpang per jam; tren harian; heatmap hari × jam; top 10 halte; peta sebaran halte; dan tabel rekomendasi armada per koridor dengan asumsi model yang bisa diubah (kapasitas bus, headway, load factor, ambang overload).

Semuanya statis (HTML + JS, Chart.js dan Leaflet dari CDN), tanpa build step.

### Jalankan lokal

```bash
cd web
python3 -m http.server 8000
# buka http://localhost:8000
```

### Deploy ke Vercel

**Opsi 1, lewat dashboard Vercel:**
1. Push repo ini ke GitHub.
2. Di [vercel.com/new](https://vercel.com/new), import repo ini.
3. Biarkan Framework Preset = **Other**. Setting build dan output sudah diatur di `vercel.json` (output dari folder `web`).
4. Klik **Deploy**.

**Opsi 2, lewat CLI:**
```bash
npm i -g vercel
vercel          # preview
vercel --prod   # production
```

### Update data

Kalau CSV berubah, generate ulang `web/data/trips.json`:

```bash
pip install pandas
python scripts/build_dashboard_data.py
```

Catatan: sebagian `tapInTime`/`tapOutTime` hasil Pentaho terpotong (mis. `4/10/2023 17:`). Script mengambil tanggal dan jam pakai regex, jadi baris itu tetap terpakai untuk analisis per jam. Baris tanpa koridor, halte, atau waktu valid dibuang (34.212 dari 36.556 baris dipakai).
