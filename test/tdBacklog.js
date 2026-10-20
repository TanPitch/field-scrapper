/* tdBacklog.js — which parcels the TD pass still has to look at.
 *
 * The rule is short and the bug in it was long-lived, so it lives apart from
 * the script that uses it and is tested on its own.
 *
 * A parcel needs work when it has no coordinate from any source, and has not
 * recently been found to be a dead end.
 *
 * "Dead end" means the lookup ran and could not place the parcel. A lookup
 * that never ran - because the day's กรมที่ดิน allowance was spent - is not a
 * dead end and must be asked again as soon as there is allowance.
 *
 * The trap: `dol_verdict IN (...)` is NULL, not false, when dol_verdict is
 * NULL, and NOT(NULL AND anything) is NULL too, and a WHERE clause keeps only
 * rows that are TRUE. Every parcel that had never been checked was therefore
 * silently dropped from the query - 131 of them, a third of the backlog, never
 * asked at all and never reported as anything. COALESCE is what keeps the
 * three-valued logic out of it.
 */

/** A verdict that means the lookup ran and failed. */
export const DEAD_ENDS = ["no_result", "district_mismatch", "ambiguous", "no_shape", "error"];

/** Days before a dead end is looked at again. */
export const RETRY_DAYS = Number(process.env.TD_RETRY_DAYS ?? 7);

/**
 * The WHERE fragment, as SQL. $1 is the retry window in days; a province
 * filter, if there is one, takes $2.
 */
export const needsWork = `
      d.td_code IS NOT NULL
  AND p.deed_number IS NOT NULL
  AND p.deed_number <> ''
  AND p.td_lat IS NULL
  AND p.dol_lat IS NULL
  AND NOT (COALESCE(p.dol_verdict, '') IN (${DEAD_ENDS.map((v) => `'${v}'`).join(",")})
         AND p.td_checked_at > now() - ($1 || ' days')::interval)`;
