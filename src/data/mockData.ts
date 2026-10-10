import { mulberry32 } from '../lib/geo';
import type { DataSource, Parcel, PriceEvent, Region, SellRound, Status } from '../types';
import { ACCENT } from './constants';
import { districtNames, subDistrictNames } from './thaiGeo';

export const REGIONS: Region[] = [
  { province: 'กรุงเทพมหานคร', center: [100.502, 13.756], spread: 0.085, pricePerWah: [9000, 42000], count: 820, amphoes: districtNames('กรุงเทพมหานคร') },
  { province: 'นนทบุรี', center: [100.485, 13.86], spread: 0.05, pricePerWah: [5000, 20000], count: 190, amphoes: districtNames('นนทบุรี') },
  { province: 'เชียงใหม่', center: [98.985, 18.788], spread: 0.13, pricePerWah: [2600, 13000], count: 330, amphoes: districtNames('เชียงใหม่') },
  { province: 'ชลบุรี', center: [100.985, 12.806], spread: 0.11, pricePerWah: [4200, 19000], count: 300, amphoes: districtNames('ชลบุรี') },
  { province: 'ภูเก็ต', center: [98.387, 7.906], spread: 0.075, pricePerWah: [9500, 45000], count: 210, amphoes: districtNames('ภูเก็ต') },
  { province: 'ขอนแก่น', center: [102.833, 16.442], spread: 0.1, pricePerWah: [1900, 9500], count: 280, amphoes: districtNames('ขอนแก่น') },
  { province: 'นครราชสีมา', center: [102.1, 14.97], spread: 0.12, pricePerWah: [1600, 8200], count: 300, amphoes: districtNames('นครราชสีมา') },
  { province: 'สงขลา', center: [100.592, 7.198], spread: 0.1, pricePerWah: [2100, 9800], count: 230, amphoes: districtNames('สงขลา') },
];

const TYPES = ['ที่ดินเปล่า', 'ที่ดินติดถนน', 'ที่ดินมุมถนน', 'ที่ดินนา', 'ที่ดินสวน', 'ที่ดินสร้างได้', 'ที่ดินริมคลอง'];
const DATA_SOURCES: DataSource[] = ['กรมบังคับคดี', 'ธนาคาร', 'กรมการคลัง', 'กองทุนสินครและสงคราม'];
const VILLAGES = ['ในเมือง', 'หนองใหญ่', 'โพนทะเล', 'บางพลู', 'ท่าข้าม', 'ห้วยทราย', 'นาเวียง', 'ดอยคำ', 'โคกสี่ต้น', 'วังทอง', 'ท่าพระสถูป', 'หนองปรือ'];
const DEED_PREFIX = ['ฉ.', 'น.ส.3ก', 'น.ส.3'];
const COURTS = ['ศาลธนกรรม', 'ศาลแพ่ง', 'ศาลอุทธรณ์', 'ศาลหัวเมือง', 'ศาลเยาวชนและครอบครัว'] as const;
const BANKS = ['กรุงเทพ', 'กสิกรไทย', 'ไทยพาณิชย์', 'ออมสิน', 'ธ.ก.ส.', 'เอเซีย', 'กสิกร'] as const;
const SURNAMES = ['สมชาย', 'สมหญิง', 'ประเสริฐ', 'วิชัย', 'ธนากร', 'สุรชัย', 'อนุชา', 'พิชัย', 'มานี', 'ศรีสุข', 'บุญมี', 'จันทร์', 'พรหม', 'วิเชียร'] as const;
const GIVEN_M = ['สมชาย', 'ประเสริฐ', 'วิชัย', 'ธนากร', 'สุรชัย', 'อนุชา', 'พิชัย', 'บุญมี', 'พรหม', 'วิเชียร', 'ชัยวัฒน์', 'เอกชัย'] as const;
const GIVEN_F = ['สมหญิง', 'วิภา', 'ศิริพร', 'กัลยา', 'ปรียา', 'อรทัย', 'มณีรัตน์', 'นภัสสร', 'สุดารัตน์', 'ธนวรรณ', 'วรรณา', 'จันทร์เพ็ญ'] as const;
/** Thai person name, e.g. "นายสมชาย ใจดี" / "นางสมหญิง ใจดี" */
function personName(rnd: () => number): string {
  const title = rnd() < 0.5 ? 'นาย' : 'นาง';
  const given = rnd() < 0.5 ? pickFrom(GIVEN_M, rnd) : pickFrom(GIVEN_F, rnd);
  return `${title}${given} ${pickFrom(SURNAMES, rnd)}`;
}
function pickFrom<T>(a: readonly T[], rnd: () => number): T { return a[Math.floor(rnd() * a.length)]; }
const ENF_OFFICES = ['บังคับคดีและวางทรัพย์ภูมิภาคที่ 3', 'สำนักงานบังคับคดีแพ่ง', 'กองบังคับคดีแพ่ง', 'กรมบังคับคดี'] as const;
const DAY = 864e5;

/** Deterministic mock data set (seeded) — swap for a real API client later. */
function generateParcels(): Parcel[] {
  const rnd = mulberry32(20240915);
  const pick = <T,>(a: readonly T[]): T => a[Math.floor(rnd() * a.length)];
  const rint = (a: number, b: number): number => Math.floor(rnd() * (b - a + 1)) + a;
  const out: Parcel[] = [];
  let id = 1;
  const now = Date.now();

  for (const reg of REGIONS) {
    for (let i = 0; i < reg.count; i++) {
      /* the very first Bangkok parcel is always a "นำกลับมาขายใหม่" sample so the style is testable */
      const forceRe = reg === REGIONS[0] && i === 0;
      const roll = rnd();
      const status: Status = forceRe || roll < 0.62 ? 'sale' : 'sold';
      let perWah = rint(reg.pricePerWah[0], reg.pricePerWah[1]) * (0.75 + rnd() * 0.5);
      const wah = Math.round((Math.pow(rnd(), 1.5) * 2600 + 120) / 10) * 10;
      const price = Math.round((perWah * wah) / 1000) * 1000;
      const announce = now - rint(20, 900) * DAY;
      const soldTs = status === 'sold' ? announce + rint(40, 420) * DAY : null;
      const n = 4 + Math.floor(rnd() * 4);
      const endTs = soldTs != null ? Math.min(soldTs, now) : now - rint(0, 60) * DAY;
      const start = price * (0.72 + rnd() * 0.22);
      const hist = [];
      for (let k = 0; k < n; k++) {
        const f = k / (n - 1);
        let v = start + (price - start) * f;
        v *= 0.97 + rnd() * 0.06;
        if (k === n - 1) v = price;
        hist.push({ d: Math.round(announce + f * (endTs - announce)), v: Math.round(v / 1000) * 1000 });
      }
      const events: PriceEvent[] = [];
      let isRe = false;
      events.push({ idx: 0, label: 'ประกาศขาย', color: ACCENT, ink: '#151B06' });
      if (status === 'sold') events.push({ idx: n - 1, label: 'ขายออกแล้ว', color: '#9BA1A6', ink: '#101211' });
      else if (forceRe || (n >= 5 && rnd() < 0.18)) {
        const m = 2 + Math.floor(rnd() * (n - 3));
        hist[m].v = Math.round((hist[m].v * 0.9) / 1000) * 1000;
        events.push({ idx: m, label: 'นำกลับมาขายใหม่', color: '#E5484D', ink: '#fff' });
        isRe = true;
      }
      /* one deed number per parcel, reused by every field that shows it */
      const deedNo = `${pick(DEED_PREFIX)}${rint(10000, 99999)}`;
      const mortgage = rnd() < 0.35 ? { amount: Math.round(price * (0.25 + rnd() * 0.35) / 1000) * 1000, bank: pick(BANKS) } : null;
      /* Sale rounds every 30 days. Rounds run from the announce date, but the schedule is
         kept anchored around today so some rounds are still upcoming (drives the
         "next selling round" row and the 10-day banner). */
      const rounds: SellRound[] = Array.from({ length: 8 }, (_, idx) => {
        if (status === 'sold') {
          const dateTs = announce + idx * 30 * DAY;
          return { date: dateTs, status: dateTs <= (soldTs ?? now) ? 'ขายออกแล้ว' : 'ยกเลิก' };
        }
        /* current round index: 0..7, cycling every 90 days from the announce date */
        const elapsed = now - announce;
        const current = Math.min(7, Math.floor(elapsed / (30 * DAY)));
        const dateTs = announce + idx * 30 * DAY;
        const past = idx < current;
        return {
          date: idx > current + 2 ? null : dateTs,
          status: past ? 'ประกาศขาย' : idx === current ? 'กำลังขาย' : 'รอประกาศ',
        };
      });
/* district + subdistrict are a real pair from thaiGeo, so the cascade is consistent */
      const amp = pick(reg.amphoes);
      const tambon = pick(subDistrictNames(reg.province, amp)) || pick(VILLAGES);
      out.push({
        id: id++, status, wah, price, perWah: Math.round(price / wah),
        lng: reg.center[0] + (rnd() - 0.5) * 2 * reg.spread,
        lat: reg.center[1] + (rnd() - 0.5) * 2 * reg.spread,
        name: `${pick(TYPES)} ${tambon} บ้าน เลขที่ ${rint(1, 9)}`,
        deed: deedNo,
        province: reg.province, amp, tambon,
        announce, soldTs, hist, events, resell: isRe,
        imgs: 1 + Math.floor(rnd() * 4),
        lastTs: soldTs ?? announce,
saleByText: mortgage ? `${mortgage.amount.toLocaleString('en-US')} ติดจำนอง ${mortgage.bank}` : 'ปลอดการจำนอง',
        dataSource: pick(DATA_SOURCES),
        landKind: rnd() < 0.32 ? 'building' : 'empty',
        ownerFile: personName(rnd),
        propertyType: pick(TYPES),
        deedNo: deedNo,
        court: pick(COURTS),
        caseNo: `ค${rint(1, 999)}/${rint(1, 9999)}`,
        plaintiff: personName(rnd),
        defendant: personName(rnd),
        possessor: personName(rnd),
        enforcementOffice: pick(ENF_OFFICES),
        collateral: price,
        spouseCollateral: rnd() < 0.5 ? Math.round(price * (0.5 + rnd() * 0.5) / 1000) * 1000 : null,
        expertPrice: Math.round(price * (0.75 + rnd() * 0.25) / 1000) * 1000,
        enforcementOfficerPrice: Math.round(price * (0.8 + rnd() * 0.2) / 1000) * 1000,
        assessorPrice: rnd() < 0.5 ? Math.round(price * (0.7 + rnd() * 0.4) / 1000) * 1000 : null,
        committeePrice: rnd() < 0.3 ? Math.round(price * (0.6 + rnd() * 0.5) / 1000) * 1000 : null,
        rounds,
        mortgage,
      });
    }
  }
  return out;
}

export const ALL_PARCELS: Parcel[] = generateParcels();
export const PARCEL_BY_ID: Map<number, Parcel> = new Map(ALL_PARCELS.map(p => [p.id, p]));
export const PROVINCES: string[] = [...new Set(ALL_PARCELS.map(p => p.province))].sort((a, b) => a.localeCompare(b, 'th'));
