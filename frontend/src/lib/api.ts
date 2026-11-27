import type {
  DistrictPrediction,
  DistrictSummary,
  DivisionDetail,
  OfflineSnapshot,
  SummaryResponse,
  TimeseriesPoint,
  Top10Item,
  WhatIfResponse,
} from "@/types/dengue";

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") || "http://127.0.0.1:8000";

let cachedSnapshot: OfflineSnapshot | null = null;

async function getSnapshot(): Promise<OfflineSnapshot> {
  if (cachedSnapshot) return cachedSnapshot;
  const res = await fetch("/offline-snapshot.json");
  if (!res.ok) throw new Error("Failed to load offline snapshot");
  cachedSnapshot = (await res.json()) as OfflineSnapshot;
  return cachedSnapshot;
}

async function fetchWithTimeout<T>(url: string, timeoutMs = 2500): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

export async function loadInitialDashboardData(): Promise<{
  summary: SummaryResponse;
  districts: DistrictSummary[];
  top10: Top10Item[];
  isLiveApi: boolean;
}> {
  try {
    const [summary, districts, top10] = await Promise.all([
      fetchWithTimeout<SummaryResponse>(`${API_BASE}/summary`),
      fetchWithTimeout<DistrictSummary[]>(`${API_BASE}/districts`),
      fetchWithTimeout<Top10Item[]>(`${API_BASE}/top10`),
    ]);
    return { summary, districts, top10, isLiveApi: true };
  } catch {
    const snap = await getSnapshot();
    return {
      summary: snap.summary,
      districts: snap.districts,
      top10: snap.top10,
      isLiveApi: false,
    };
  }
}

export async function fetchDivision(division: string): Promise<DivisionDetail> {
  try {
    return await fetchWithTimeout<DivisionDetail>(
      `${API_BASE}/division/${encodeURIComponent(division)}`
    );
  } catch {
    const snap = await getSnapshot();
    const div = snap.divisions[division];
    if (!div) throw new Error(`Division ${division} not found`);
    return div;
  }
}

export async function fetchDistrictPrediction(district: string): Promise<{
  prediction: DistrictPrediction;
  timeseries: TimeseriesPoint[];
  timeseries2026: TimeseriesPoint[];
}> {
  try {
    const [prediction, ts, ts26] = await Promise.all([
      fetchWithTimeout<DistrictPrediction>(
        `${API_BASE}/predict?district=${encodeURIComponent(district)}`
      ),
      fetchWithTimeout<{ points: TimeseriesPoint[] }>(
        `${API_BASE}/timeseries?district=${encodeURIComponent(district)}&split=test`
      ),
      fetchWithTimeout<{ points: TimeseriesPoint[] }>(
        `${API_BASE}/timeseries?district=${encodeURIComponent(district)}&split=2026`
      ),
    ]);
    return { prediction, timeseries: ts.points, timeseries2026: ts26.points };
  } catch {
    const snap = await getSnapshot();
    const prediction = snap.predictions[district];
    const ts = snap.timeseries[district]?.points ?? [];
    const ts26 = snap.timeseries2026?.[district]?.points ?? [];
    if (!prediction) throw new Error(`District ${district} not found`);
    return { prediction, timeseries: ts, timeseries2026: ts26 };
  }
}

export async function runWhatIfSimulation(
  district: string,
  casesLastWeek: number,
  rainMm3wAgo: number
): Promise<WhatIfResponse> {
  const url = `${API_BASE}/whatif?district=${encodeURIComponent(
    district
  )}&cases_last_week=${casesLastWeek}&rain_mm_3w_ago=${rainMm3wAgo}`;
  return fetchWithTimeout<WhatIfResponse>(url, 5000);
}
