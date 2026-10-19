/* mapStatus.js — LED lot status -> the status the UI shows.
 *
 * Lives apart from server/index.js so it can be tested. This classifier has
 * already broken silently once: an earlier version matched Thai prose in the
 * close_reason column, and LED writes an enum, so the branch could never fire
 * and every withdrawn lot was reported as an expired listing. */

export function mapStatus(status, closeReason, closeCode) {
  /* The reason is LED's own enum, not prose. Its full set is null, sold,
   * withdrawn and cancelled_remaining_rounds - 4524 / 600 / 321 / 348 lots - and
   * the last two are both dead ends. They are reported as one `cancelled`
   * because as a buying decision they are one answer; the detail panel still
   * shows which of the two it was.
   *
   * Checked before the status tests, because LED leaves some of these lots
   * flagged active and an active lot becomes กำลังขาย, which then advertises a
   * next auction date for land that will not be auctioned again. Neither was
   * sold either, so ขายแล้ว is equally a lie. */
  if (closeReason === 'withdrawn' || closeReason === 'cancelled_remaining_rounds') return 'cancelled';
  if (status === 'active') return 'sale';
  if (status === 'inactive') return 'inactive';
  if (closeCode === 1 || closeReason === 'sold') return 'sold';
  /* Ended without a buyer: seizure revoked, or cancelled with rounds left. */
  return 'inactive';
}