import { CircleHelp , Scan, Home, Building, LucideIcon} from 'lucide-react';
import { LandKind } from '../../types/index'

// Scan       ที่ดินว่างเปล่า (vacant_land)
// Home       ที่ดินพร้อมสิ่งปลูกสร้าง (land_with_buildings), ทาวน์เฮ้าส์ (townhouse)
// Building   ห้องชุด (condominium_unit), คอนโดมิเนียม (condo), อพาทเมนต์ (apartment)
// Building2  อาคารพาณิช (commercial_building), อาคารสำนักงาน (office_building), ห้องชุดสำนักงาน (office_suite)
// Warehouse  โกดัง (warehouse), โรงงาน (factory)

// type LandKind = 'ที่ดินว่างเปล่า' | 'ที่ดินพร้อมสิ่งปลูกสร้าง' | 'ห้องชุด'| 'empty' | 'building' | 'vacant_land' | 'land_with_buildings' | 'condominium_unit';  

export const LAND_KIND_LABEL: Record<LandKind, string> = {
  'empty': 'ไม่มีข้อมูล',
  // 'ที่ดินว่างเปล่า': 'ที่ดินว่าง',
  // 'ที่ดินพร้อมสิ่งปลูกสร้าง': 'มีสิ่งปลูกสร้าง',
  // 'ห้องชุด': 'ห้องชุด',

  'vacant_land': 'ที่ดินว่าง',
  'land_with_buildings': 'ที่ดินพร้อมสิ่งปลูกสร้าง',
  'condominium_unit': 'ห้องชุด',
};

/**
 * LED's official ประเภททรัพย์ to a LandKind key.
 *
 * The parcel carries LED's Thai text, but the icon map above is keyed on the
 * English LandKind values. Passing the Thai string straight in matched nothing
 * and fell through to `|| Scan`, so every parcel on the map wore the vacant-land
 * icon. This is the one place the two vocabularies meet.
 *
 * Substring matching, not exact, because LED is inconsistent about wording.
 * Condominium is tested first: a unit can be described as both a unit and a
 * building, and the unit is the more specific answer.
 *
 * Anything unrecognised is 'empty', whose label is ไม่มีข้อมูล - "no data" is
 * honest, where inventing one of the three would not be.
 */
export function landKindOf(assetType: string | null | undefined): LandKind {
  const raw = (assetType ?? '').trim();
  if (!raw) return 'empty';
  if (/ห้องชุด|คอนโด|อพาทเมนต์|condo/i.test(raw)) return 'condominium_unit';
  if (/พร้อมสิ่งปลูกสร้าง|บ้าน|เรือน|อาคาร|โรงงาน|โกดัง|คลังสินค้า|townhouse/i.test(raw)) return 'land_with_buildings';
  if (/ว่างเปล่า|vacant|barren/i.test(raw)) return 'vacant_land';
  return 'empty';
}

/** Small badge icon for what sits on the parcel. */

export function LandKindIcon({ kind, size = 11 }: { kind: string; size?: number }) {
  if (kind === 'empty' || !kind) {
    return null; 
  }
  
  const iconMap: Record<LandKind, LucideIcon> = {
    'empty': CircleHelp,

    // 'ที่ดินว่างเปล่า': Scan,
    // 'ที่ดินพร้อมสิ่งปลูกสร้าง': Home,
    // 'ห้องชุด': Building,

    'vacant_land': Scan,
    'land_with_buildings': Home,
    'condominium_unit': Building,
  };
  
  // แปลง string ทั่วไปให้เข้ากับคีย์ภาษาไทยตรงนี้
  const IconComponent = iconMap[kind as LandKind] || Scan;

  return <IconComponent size={size} strokeWidth={2.2} />;
}
