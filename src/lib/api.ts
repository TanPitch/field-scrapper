/* api.ts — the only place the frontend talks to the server.
 *
 *   import { api } from '../lib/api';
 *   const rows = await api.get<FeatureCollection>('/api/parcels?province=40');
 *
 * Requests go to same-origin /api, which Vite proxies to the API process in
 * development (see vite.config.ts). That keeps cookies same-origin so the
 * session just works, and avoids CORS entirely.
 *
 * Two rules this module enforces so callers do not have to:
 *
 *  - A failed request never throws a bare Error. Callers get a Result-shaped
 *    object, because "the server is down" is a normal state for this app, not an
 *    exception. The UI shows data-from-cache or an empty state instead of a blank
 *    screen, and never invents numbers to fill the gap.
 *  - Settings writes are fire-and-forget and serialised. The user dragging a
 *    colour picker would otherwise fire a PUT per pixel and arrive out of order,
 *    so the last write always wins rather than whichever was fastest.
 */

export const API_BASE = import.meta.env.VITE_API_BASE ?? '';

export interface ApiResult<T> {
  ok: boolean;
  data: T | null;
  error: string | null;
  /** True when this is the first load and there is nothing cached to fall back on. */
  cold: boolean;
}

const fail = <T,>(error: string): ApiResult<T> => ({ ok: false, data: null, error, cold: false });

/** Session cookie. Same-origin in dev; set explicitly when calling cross-origin. */
const creds: RequestInit = { credentials: 'same-origin' };

async function request<T>(path: string, init: RequestInit = {}): Promise<ApiResult<T>> {
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      ...creds,
      /* `...init` first: it used to be spread last, so any caller that passed its
         own headers replaced the merged object wholesale and the JSON
         Content-Type went with it. The computed headers have to win. */
      ...init,
      headers: init.body ? { 'Content-Type': 'application/json', ...(init.headers ?? {}) } : init.headers,
    });
    if (res.status === 204) return { ok: true, data: null, error: null, cold: false };

    const text = await res.text();
    let body: unknown = null;
    try { body = text ? JSON.parse(text) : null; } catch { /* non-JSON error page */ }

    if (!res.ok) {
      /* The API's own error shape is {error: "..."}. Anything else means the
         server itself failed, and saying "Unauthorized" would be a lie. */
      const msg = (body as { error?: string } | null)?.error
        ?? (res.status >= 500 ? `เซิร์ฟเวอร์ผิดพลาด (${res.status})` : `HTTP ${res.status}`);
      return fail(msg);
    }
    return { ok: true, data: body as T, error: null, cold: false };
  } catch (e) {
    return fail(e instanceof Error ? e.message : 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้');
  }
}

export const api = {
  get: <T,>(path: string) => request<T>(path),
  post: <T,>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) }),
  put: <T,>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PUT', body: JSON.stringify(body ?? {}) }),
    patch: <T,>(path: string, body?: unknown) =>
      request<T>(path, { method: 'PATCH', body: JSON.stringify(body ?? {}) }),
  del: <T,>(path: string) => request<T>(path, { method: 'DELETE' }),
};

/* ------------------------------------------------- serialised settings writes */

/**
 * Coalesce rapid writes to the same key and send them in order.
 *
 * A colour picker produces a change per pointer move. Without this the server
 * would receive dozens of PUTs and the last one to *arrive* would win, which is
 * not necessarily the last one the user chose.
 */
export function makeWriter(delayMs = 400) {
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const pending = new Map<string, () => void>();
  const inflight = new Map<string, Promise<unknown>>();

  return function enqueue(key: string, fn: () => Promise<unknown>): void {
    pending.set(key, fn);
    if (timers.has(key)) return;

    timers.set(key, setTimeout(async () => {
      timers.delete(key);
      const run = pending.get(key);
      pending.delete(key);
      if (!run) return;

      /* Wait for the previous write on this key, so ordering is guaranteed. */
      const prev = inflight.get(key) ?? Promise.resolve();
      const next = prev.then(run, run);
      inflight.set(key, next.catch(() => {}));
      await next;
    }, delayMs));
  };
}

/* ------------------------------------------------------------------ shape */

export interface ApiRound {
  idx: number;
  date: string | null;
  status_code: number | null;
  label: string | null;
  is_held: boolean;
  discount_pct: number | null;
  price: number | null;
  /** The winning bid from LED's report sheet (028), for rounds that sold.
   *  Absent on older servers and on every round that did not sell. */
  sold_price?: number | null;
  /** The report's own outcome word for this round (029) — the printed report's
   *  ผลการขาย, kept apart from the lists label. Absent on older servers. */
  led_label?: string | null;
}

export interface ApiParcelProps {
  id: number;
  lotId: number | null;
  /** The parcels row this lot hangs off. Several lots share it when a   *  condominium building is sold unit by unit. */
  parcelId: number | null;
    /**
     * How many lots share this parcel. A condominium building is one cadastral
     * parcel sold as N units, so >1 means the map marker stands for several
     * distinct assets. 1 for ordinary land.
     */
    lotCount: number | null;
  deed: string;
  landTitle: string;
  tambon: string;
  amphur: string;
  provinceCode: number;
  /** Real name, e.g. 'ขอนแก่น' — not a code. The table groups and reads by this,
   *  so 'จ.40' is useless there. */
  provinceName: string | null;
  /** Amphur name from the database, which is more reliable than LED's. */
  districtName: string | null;
  tambonCode: string | null;
  caseNo: string | null;
  caseNoRaw: string | null;
  caseYear: number | null;
  order: string | null;
  /** LED group sale: parcels auctioned as one lot (see groupOf in actions). */
  groupCount: number;
  assetType: string | null;
  sizeUnit: string | null;
  /** Square wa. Null for condo lots, which are in ตร.ม. */
  wah: number | null;
  askingPrice: number | null;
  askingSource: string | null;
  /** The LED cascade's opening price — the "smart price". */
  startPrice: number | null;
  status: string | null;
  nextRound: string | null;
  closeReason: string | null;
  committeePrice: number | null;
  ledPrice: number | null;
  officerPrice: number | null;
  expertPrice: number | null;
  /** LED's reports.asp winning bid (028). Null until the case's sheet has
   *  been pulled — the client prints '-', never the scheduled figure. */
  soldPrice: number | null;
  bidSecurity: number | null;
  publishedDate: string | null;
  firstRoundDate: string | null;
  /** When our scraper last saw this lot's LED page — the freshness stamp the
   *  panel prints as "ข้อมูลจาก LED ณ". Null when the scraper has not set it. */
  ledSeen: string | null;
  remark: string | null;
  court: string | null;
  plaintiff: string | null;
  defendant: string | null;
  owner: string | null;
  department: string | null;
  collateral: number | null;
  spouseCollateral: number | null;
  evaPrice: number | null;
  evaMin: number | null;
  evaMax: number | null;
  rawang: string | null;
  surveyNo: string | null;
  landNo: string | null;
  geoPrecision: 'parcel' | 'subdistrict' | null;
  geoStatus: string | null;
  tdStatus: string | null;
  /** Resolver verdicts. liveData.ts gates what reaches the map on these, so a
   *  field the server sends and this type forgets is a gate that never fires. */
  tdVerdict?: string | null;
  dolVerdict?: string | null;
  imageCount: number;
  /** Bare filenames, served at /img/land/<name>. Empty when the lot has none. */
  images: string[];
  rounds: ApiRound[];
  elevation: number | null;
  elevationUncertainty: number | null;
  elevationSource: string | null;
}

export interface ApiStatus {
  bot: {
    running: number;
    runningPasses: Array<{
      id: number; stage: string; province: string | null; provinceCode: number | null;
      startedAt: string | null; step: string | null; elapsedS: number; status: 'running' | 'stuck';
    }>;
    lastRun: string | null;
    totalRuns: number;
    unfinishedRuns: number;
    failedRuns: number;
  };
  backlog: { td: { enriched: number; neverTried: number; unresolved: number; skipped: number } };
  recent: Array<{
    id: number; stage: string; province: string | null; provinceCode: number | null;
    startedAt: string | null; finishedAt: string | null; durationS: number;
    pages: number | null; lotsSeen: number | null; lotsNew: number | null;
    errors: number; outcome: 'ok' | 'failed'; detail: Record<string, unknown> | null;
    notes: string | null; lastStep: string | null;
  }>;
}
