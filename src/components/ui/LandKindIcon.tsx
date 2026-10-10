import { Building2, Scan } from 'lucide-react';
import type { LandKind } from '../../types';

export const LAND_KIND_LABEL: Record<LandKind, string> = {
  empty: 'ที่ดินว่าง',
  building: 'มีสิ่งปลูกสร้าง',
};

/** Small badge icon for what sits on the parcel. */
export function LandKindIcon({ kind, size = 11 }: { kind: LandKind; size?: number }) {
  return kind === 'building'
    ? <Building2 size={size} strokeWidth={2.2} />
    : <Scan size={size} strokeWidth={2.2} />;
}