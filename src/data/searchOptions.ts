import { ALL_PARCELS } from './liveData';
import {
  districtLabel, districtNames, parentsOfSub, provinceNames, provincesOfDistrict,
  subDistrictLabel, subDistrictNames,
} from './thaiGeo';

export const SELLER_AGENCIES = [
  'กระบี่', 'กรุงเทพ กองล้มละลาย 1', 'กรุงเทพ กองล้มละลาย 2', 'กรุงเทพ กองล้มละลาย 3', 'กรุงเทพ กองล้มละลาย 4',
  'กรุงเทพ กองล้มละลาย 5', 'กรุงเทพ กองล้มละลาย 6', 'กรุงเทพ สำนักฟื้นฟูกิจการของลูกหนี้', 'กาญจนบุรี', 'กาญจนบุรี สาขาทองผาภูมิ',
  'กาฬสินธุ์', 'กำแพงเพชร', 'ขอนแก่น', 'ขอนแก่น สาขาชุมแพ', 'ขอนแก่น สาขาพล', 'จันทบุรี', 'ฉะเชิงเทรา', 'ชลบุรี', 'ชลบุรี สาขาพัทยา',
  'ชัยนาท', 'ชัยภูมิ', 'ชัยภูมิ สาขาเขียว', 'ชุมพร', 'ชุมพร สาขาหลังสวน', 'เชียงราย', 'เชียงราย สาขาเทิง',
  'เชียงใหม่', 'เชียงใหม่ สาขาฝาง', 'เชียงใหม่ สาขาฮอด', 'ตรัง', 'ตราด', 'ตาก', 'ตาก สาขาแม่สอด', 'ทางการราชการ', 'นครนายก',
  'นครปฐม', 'นครพนม', 'นครราชสีมา', 'นครราชสีมา สาขาบัวใหญ่', 'นครราชสีมา สาขาพิมาย', 'นครราชสีมา สาขาสีคิ้ว', 'นครศรีธรรมราช',
  'นครศรีธรรมราช สาขาทุ่งสง', 'นครศรีธรรมราช สาขาปากพนัง', 'นครสวรรค์', 'นนทบุรี', 'นราธิวาส', 'น่าน', 'บึงกาฬ', 'บุรีรัมย์',
  'บุรีรัมย์ สาขานางรอง', 'ปทุมธานี', 'ปทุมธานี สาขาทัญบุรี', 'ประจวบคีรีขันธ์', 'ประจวบคีรีขันธ์ สาขาหัวหิน', 'ปราจีนบุรี',
  'ปราจีนบุรี สาขากบินทร์บุรี', 'ปัตตานี', 'ปาย', 'พระนครศรีอยุธยา', 'พะเยา', 'พะเยา สาขาเชียงคำ', 'พังงา', 'พังงา สาขาตะกั่วป่า',
  'พัทลุง', 'พิจิตร', 'พิษณุโลก', 'เพชรบุรี', 'เพชรบูรณ์', 'เพชรบูรณ์ สาขาเชียงราย', 'เพชรบูรณ์ สาขาลมหลวง', 'แพ่งกรุงเทพมหานคร 1',
  'แพ่งกรุงเทพมหานคร 2', 'แพ่งกรุงเทพมหานคร 3', 'แพ่งกรุงเทพมหานคร 4', 'แพ่งกรุงเทพมหานคร 5', 'แพ่งกรุงเทพมหานคร 6', 'แพ่งกรุงเทพมหานคร 7',
  'แพร่', 'ภูเก็ต', 'มหาสารคาม', 'มุกดาหาร', 'แม่ฮ่องสอน', 'แม่ฮ่องสอน สาขาแม่สะเรียง', 'ยโสธร', 'ยะลา', 'ยะลา สาขาเบตง',
  'ร้อยเอ็ด', 'ระนอง', 'ระยอง', 'ราชบุรี', 'ลพบุรี', 'ลพบุรี สาขาชัยบาดาล', 'ลำปาง', 'ลำพูน', 'เลย', 'ศรีสะเกษ', 'ศรีสะเกษ สาขากันทรลักษ์',
  'สกลนคร', 'สกลนคร สาขาสว่างแดนดิน', 'สงขลา', 'สงขลา สาขานาทวี', 'สตูล', 'สมุทรปราการ', 'สมุทรสงคราม', 'สมุทรสาคร',
  'สระแก้ว', 'สระบุรี', 'สำนักงานบังคับคดีและวางทรัพย์ภูมิภาคที่ 3', 'สิงห์บุรี', 'สุโขทัย', 'สุโขทัย สาขาสวรรคโลก', 'สุพรรณบุรี',
  'สุราษฎร์ธานี', 'สุราษฎร์ธานี สาขาเกาะสมุย', 'สุราษฎร์ธานี สาขาไชยา', 'สุราษฎร์ธานี สาขาเวียงสระ', 'สุรินทร์', 'สุรินทร์ สาขารัตนบุรี',
  'หนองคาย', 'หนองบัวลำภู', 'อ่างทอง', 'อำนาจเจริญ', 'อุดรธานี', 'อุตรดิตถ์', 'อุทัยธานี', 'อุบลราชธานี', 'อุบลราชธานี สาขาเดชอุดม',
] as const;

export const PROPERTY_TYPES = [
  'ทุกประเภท', 'ที่ดินว่างเปล่า ทั้งหมด', 'ที่ดินว่างเปล่า น.ส.3 ก.', 'ที่ดินว่างเปล่า โฉนด', 'หุ้น', 'หน่วยลงทุน', 'พันธบัตร',
  'ใบสำคัญ', 'สลากออมสิน', 'สลากออมทรัพย์', 'ห้องชุด', 'ที่ดินพร้อมสิ่งปลูกสร้าง', 'กรรมสิทธิ์ห้องชุด', 'สิทธิการเช่า',
  'สิทธิการเช่าอาคารพาณิชย์', 'สิทธิการเช่าที่ดิน', 'ทรัพย์สินต่างๆ', 'สิ่งปลูกสร้าง', 'สิทธิการเช่าที่ดินฯ', 'สิทธิการเช่าสิ่งปลูกสร้าง',
  'บัตรธนาคาร(เป็นเงินที่ชำระหนี้ได้ตามกฎหมาย)', 'สิทธิการเช่าอาคารราชพัสดุ', 'สิทธิการเช่าอาคาร', 'สิทธิการไถ่คืน',
  'สิทธิการเช่าช่วงที่ดิน', 'อาวุธปืน', 'บัตรเงินฝาก', 'ธนบัตร',
] as const;

export const NO_QUERY_PLACEHOLDER = '';

/* ------------------------------------------------------------------
   Cascading จังหวัด → เขต/อำเภอ → แขวง/ตำบล

   The option lists come from src/data/thaiGeo (the provinces / districts /
   sub_districts JSON), so the hierarchy is real. Blank parents widen the
   scope instead of emptying it.
   ------------------------------------------------------------------ */
export const getProvinceItems = () => [{ v: '', l: 'ทั้งหมด' }, ...provinceNames().map(v => ({ v, l: v }))];

export const getDistrictItems = (province: string) =>
  [{ v: '', l: 'ทั้งหมด' }, ...districtNames(province).map(v => ({ v, l: districtLabel(v) }))];

export const getSubdistrictItems = (province: string, district: string) =>
  [{ v: '', l: 'ทั้งหมด' }, ...subDistrictNames(province, district).map(v => ({ v, l: subDistrictLabel(v) }))];

/** Districts available for a province, as raw names (used to validate a child). */
export const districtExists = (province: string, district: string): boolean => districtNames(province).includes(district);
export const subDistrictExists = (province: string, district: string, sub: string): boolean =>
  subDistrictNames(province, district).includes(sub);

export const parentsOfDistrict = (district: string): string[] => provincesOfDistrict(district);
export const parentsOfSubdistrict = (subdistrict: string, district: string): { provinces: string[]; districts: string[] } =>
  parentsOfSub(subdistrict, district);

/** Provinces / districts / subdistricts actually present in the parcel set. */
export const parcelProvinces = (): string[] => [...new Set(ALL_PARCELS.map(p => p.province))].sort((a, b) => a.localeCompare(b, 'th'));
export const parcelDistricts = (province: string): string[] => {
  const pool = province ? ALL_PARCELS.filter(p => p.province === province) : ALL_PARCELS;
  return [...new Set(pool.map(p => p.amp))].sort((a, b) => a.localeCompare(b, 'th'));
};
export const parcelSubdistricts = (province: string, district: string): string[] => {
  const pool = ALL_PARCELS.filter(p => (!province || p.province === province) && (!district || p.amp === district));
  return [...new Set(pool.map(p => p.tambon))].sort((a, b) => a.localeCompare(b, 'th'));
};