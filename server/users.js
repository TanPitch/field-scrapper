/* server/users.js — identity, session auth, and everything the user can
 * personalise: theme, table layout, named drawings and display areas.
 *
 *   node server/users.js      (mounted by index.js, not run directly)
 *
 * All of this used to live in localStorage, which made "my settings" mean
 * "this browser's settings". It now lives in Postgres keyed by user_id, so it
 * follows the account.
 *
 * Rich text is stored as jsonb ({b,i,u,bg,fg,badge}) and never as HTML. The
 * client renders it from those flags; nothing here builds markup. That is what
 * keeps a user-authored note from becoming stored XSS when another user reads
 * it back.
 */
import express from "express";

export const router = express.Router();

/* ------------------------------------------------------------------ style */

/**
 * Validate and normalise a rich-text style object. Unknown keys are dropped and
 * colours are pattern-checked, so a bad client can neither widen the stored
 * shape nor push arbitrary text into a field the renderer treats as a colour.
 */
const COLOR = /^#[0-9a-fA-F]{3,8}$|^[a-zA-Z]{3,20}$/;

function normStyle(s) {
    if (s === null || typeof s !== "object" || Array.isArray(s)) return {};
    const out = {};
    for (const k of ["b", "i", "u", "bg", "fg", "badge"]) {
        if (!(k in s)) continue;
        const v = s[k];
        if (k === "b" || k === "i" || k === "u") out[k] = Boolean(v);
        else if (k === "bg" || k === "fg") {
            const c = String(v).trim();
            if (COLOR.test(c)) out[k] = c;
        } else {
            /* badge: an emoji or a shape character. Cap the length so a label
             * cannot be pushed off its cell. */
            const b = Array.from(String(v).trim()).slice(0, 4).join("");
            if (b) out.badge = b;
        }
    }
    return out;
}

/* ------------------------------------------------------------------- auth */

const SESSION_COOKIE = "fm_sid";

function requireUser(req, res, next) {
    if (!req.session?.userId) return res.status(401).json({ error: "not signed in" });
    req.userId = req.session.userId;
    next();
}

/**
 * Admin gate. Separate from requireUser rather than a flag on it, so a route
 * that means "signed in" can never quietly become "signed in as admin".
 *
 * Reads is_admin on every request instead of trusting a role copied into the
 * session at sign-in: a demoted admin should stop seeing these pages on their
 * next request, not whenever their cookie happens to expire.
 */
async function requireAdmin(req, res, next) {
    if (!req.session?.userId) return res.status(401).json({ error: "not signed in" });
    let rows;
    try {
        ({ rows } = await req.db.query(`SELECT is_admin FROM app_users WHERE id = $1`, [req.session.userId]));
    } catch (e) {
        console.error("[requireAdmin]", e);
        return res.status(500).json({ error: e.message });
    }
    if (!rows.length) return res.status(401).json({ error: "not signed in" });
    if (!rows[0].is_admin) return res.status(403).json({ error: "admin only" });
    req.userId = req.session.userId;
    next();
}

export { requireUser, requireAdmin };

/** Argon2id via Bun's native implementation. No native module to build. */
async function hashPassword(pw) {
    return Bun.password.hash(pw, { algorithm: "argon2id", memoryCost: 65536, timeCost: 3 });
}
async function verifyPassword(pw, hash) {
    try {
        return await Bun.password.verify(pw, hash);
    } catch {
        return false;
    }
}

/* Registration is open in dev so the app is usable without a seeded admin.
 * Set AUTH_REQUIRE_INVITE=1 to close it once real accounts exist. */
router.post("/auth/register", async (req, res) => {
    if (process.env.AUTH_REQUIRE_INVITE === "1") {
        return res.status(403).json({ error: "registration is closed" });
    }
    const username = String(req.body?.username ?? "").trim().toLowerCase();
    const password = String(req.body?.password ?? "");
    const displayName = String(req.body?.displayName ?? "").trim() || username;

    if (!/^[a-z0-9._-]{3,32}$/.test(username)) {
        return res.status(400).json({ error: "username must be 3-32 chars of a-z 0-9 . _ -" });
    }
    if (password.length < 8) {
        return res.status(400).json({ error: "password must be at least 8 characters" });
    }

    const hash = await hashPassword(password);
    try {
        const { rows } = await req.db.query(
            `INSERT INTO app_users (username, password_hash, display_name)
             VALUES ($1, $2, $3) RETURNING id, username, display_name, avatar_color, is_admin`,
            [username, hash, displayName]);
        const u = rows[0];
        req.session.userId = u.id;
        res.status(201).json({ user: publicUser(u) });
    } catch (e) {
        if (e.code === "23505") return res.status(409).json({ error: "username taken" });
        throw e;
    }
});

router.post("/auth/login", async (req, res) => {
    const username = String(req.body?.username ?? "").trim().toLowerCase();
    const password = String(req.body?.password ?? "");
    const { rows } = await req.db.query(
        `SELECT * FROM app_users WHERE username = $1`, [username]);
    const u = rows[0];

    /* Same message and a comparable amount of work either way, so the response
     * does not reveal whether the account exists. */
    const ok = u ? await verifyPassword(password, u.password_hash) : false;
    if (!ok) return res.status(401).json({ error: "wrong username or password" });

    req.session.userId = u.id;
    res.json({ user: publicUser(u) });
});

router.post("/auth/logout", (req, res) => {
    req.session.destroy(() => res.json({ ok: true }));
});

function publicUser(u) {
    return {
        id: u.id, username: u.username, displayName: u.display_name,
        avatarColor: u.avatar_color, avatarPath: u.avatar_path, isAdmin: u.is_admin,
    };
}

router.get("/me", requireUser, async (req, res) => {
    const { rows } = await req.db.query(
        `SELECT id, username, display_name, avatar_color, avatar_path, is_admin
           FROM app_users WHERE id = $1`, [req.userId]);
    if (!rows.length) return res.status(404).json({ error: "no such user" });
    res.json({ user: publicUser(rows[0]) });
});

router.put("/me", requireUser, async (req, res) => {
    const displayName = req.body?.displayName == null ? null : String(req.body.displayName).trim();
    const avatarColor = req.body?.avatarColor == null ? null : String(req.body.avatarColor).trim();
    if (avatarColor && !COLOR.test(avatarColor)) {
        return res.status(400).json({ error: "avatarColor must be a CSS colour" });
    }
    const { rows } = await req.db.query(
        `UPDATE app_users
            SET display_name = coalesce($2, display_name),
                avatar_color = coalesce($3, avatar_color),
                updated_at = now()
          WHERE id = $1
      RETURNING id, username, display_name, avatar_color, avatar_path, is_admin`,
        [req.userId, displayName, avatarColor]);
    res.json({ user: publicUser(rows[0]) });
});

router.post("/me/password", requireUser, async (req, res) => {
    const current = String(req.body?.currentPassword ?? "");
    const next = String(req.body?.newPassword ?? "");
    if (next.length < 8) return res.status(400).json({ error: "new password must be at least 8 characters" });

    const { rows } = await req.db.query(`SELECT password_hash FROM app_users WHERE id = $1`, [req.userId]);
    if (!await verifyPassword(current, rows[0].password_hash)) {
        return res.status(401).json({ error: "current password is wrong" });
    }
    await req.db.query(
        `UPDATE app_users SET password_hash = $2, updated_at = now() WHERE id = $1`,
        [req.userId, await hashPassword(next)]);
    res.json({ ok: true });
});

/* ------------------------------------------------------------------ prefs */

/* Theme, map style, units, toggles — one row per key so adding a preference
 * needs no migration. */
router.get("/me/prefs", requireUser, async (req, res) => {
    const { rows } = await req.db.query(`SELECT key, value FROM user_prefs WHERE user_id = $1`, [req.userId]);
    res.json({ prefs: Object.fromEntries(rows.map((r) => [r.key, r.value])) });
});

router.put("/me/prefs", requireUser, async (req, res) => {
    const prefs = req.body?.prefs;
    if (!prefs || typeof prefs !== "object" || Array.isArray(prefs)) {
        return res.status(400).json({ error: "prefs must be an object" });
    }
    const entries = Object.entries(prefs).slice(0, 200);
    for (const [k] of entries) {
        if (k.length > 64) return res.status(400).json({ error: "preference key too long" });
    }
    await req.db.query("BEGIN");
    try {
        for (const [key, value] of entries) {
            await req.db.query(
                `INSERT INTO user_prefs (user_id, key, value, updated_at)
                 VALUES ($1, $2, $3, now())
                 ON CONFLICT (user_id, key)
                 DO UPDATE SET value = excluded.value, updated_at = now()`,
                [req.userId, key, JSON.stringify(value)]);
        }
        await req.db.query("COMMIT");
    } catch (e) {
        await req.db.query("ROLLBACK");
        throw e;
    }
    res.json({ ok: true, saved: entries.length });
});

/* ----------------------------------------------------------- table layout */

router.get("/me/tables/:tableKey", requireUser, async (req, res) => {
    const { rows } = await req.db.query(
        `SELECT column_key, label, note, style, visible, pinned, sort_order, width
           FROM user_table_columns
          WHERE user_id = $1 AND table_key = $2
       ORDER BY sort_order, column_key`,
        [req.userId, req.params.tableKey]);
    res.json({ columns: rows.map(colOut) });
});

function colOut(r) {
    return {
        key: r.column_key, label: r.label, note: r.note,
        style: r.style, visible: r.visible, pinned: r.pinned,
        order: r.sort_order, width: r.width,
    };
}

/** Replace the whole layout for one table. A PUT of the full set is simpler and
 *  safer than patching column by column, which can leave a half-applied order. */
router.put("/me/tables/:tableKey", requireUser, async (req, res) => {
    const columns = req.body?.columns;
    if (!Array.isArray(columns)) return res.status(400).json({ error: "columns must be an array" });
    if (columns.length > 300) return res.status(400).json({ error: "too many columns" });

    const clean = columns.map((c) => ({
        key: String(c.key ?? "").slice(0, 64),
        label: c.label == null ? null : String(c.label).slice(0, 120),
        note: c.note == null ? null : String(c.note).slice(0, 2000),
        style: normStyle(c.style),
        visible: c.visible !== false,
        pinned: Boolean(c.pinned),
        order: Number.isInteger(c.order) ? c.order : 0,
        width: Number.isInteger(c.width) && c.width > 0 ? Math.min(c.width, 2000) : null,
    })).filter((c) => c.key);

    await req.db.query("BEGIN");
    try {
        await req.db.query(`DELETE FROM user_table_columns WHERE user_id = $1 AND table_key = $2`,
            [req.userId, req.params.tableKey]);
        for (const c of clean) {
            await req.db.query(
                `INSERT INTO user_table_columns
                    (user_id, table_key, column_key, label, note, style, visible, pinned, sort_order, width)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
                [req.userId, req.params.tableKey, c.key, c.label, c.note,
                    JSON.stringify(c.style), c.visible, c.pinned, c.order, c.width]);
        }
        await req.db.query("COMMIT");
    } catch (e) {
        await req.db.query("ROLLBACK");
        throw e;
    }
    res.json({ ok: true, saved: clean.length });
});

/* ---------------------------------------------------------------- layers */

function layerOut(r) {
    return {
        id: r.layer_id, kind: r.kind, geomType: r.geom_type,
        name: r.name, note: r.note, style: r.style,
        geometry: r.geometry, visible: r.visible, order: r.sort_order,
    };
}

router.get("/me/layers", requireUser, async (req, res) => {
    const { rows } = await req.db.query(
        `SELECT * FROM user_layers WHERE user_id = $1 ORDER BY kind, sort_order, id`,
        [req.userId]);
    res.json({ layers: rows.map(layerOut) });
});

router.put("/me/layers/:layerId", requireUser, async (req, res) => {
    const layerId = String(req.params.layerId).slice(0, 64);
    const kind = String(req.body?.kind ?? "");
    /* 'parcel' carries text only — the parcel already exists in parcels, so the
     * annotation row holds just the user's name/note for it. See migration 011. */
    if (!["drawing", "display_area", "parcel"].includes(kind)) {
        return res.status(400).json({ error: "kind must be 'drawing', 'display_area' or 'parcel'" });
    }
    const geomType = req.body?.geomType == null ? null : String(req.body.geomType);
    if (geomType !== null && !["line", "polygon", "circle"].includes(geomType)) {
        return res.status(400).json({ error: "geomType must be line, polygon or circle" });
    }

    /* Geometry is stored as GeoJSON and echoed back untouched. It is never
     * rendered server-side, and clients must draw it, not execute it. */
    const geometry = req.body?.geometry ?? null;
    if (geometry !== null && typeof geometry !== "object") {
        return res.status(400).json({ error: "geometry must be GeoJSON or null" });
    }

    const { rows } = await req.db.query(
        `INSERT INTO user_layers
            (user_id, layer_id, kind, geom_type, name, note, style, geometry, visible, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (user_id, layer_id) DO UPDATE
            SET kind = excluded.kind, geom_type = excluded.geom_type,
                name = excluded.name, note = excluded.note, style = excluded.style,
                geometry = excluded.geometry, visible = excluded.visible,
                sort_order = excluded.sort_order, updated_at = now()
      RETURNING *`,
        [req.userId, layerId, kind, geomType,
            req.body?.name == null ? null : String(req.body.name).slice(0, 200),
            req.body?.note == null ? null : String(req.body.note).slice(0, 4000),
            JSON.stringify(normStyle(req.body?.style)),
            JSON.stringify(geometry),
            req.body?.visible !== false,
            Number.isInteger(req.body?.order) ? req.body.order : 0]);
    res.json({ layer: layerOut(rows[0]) });
});

router.delete("/me/layers/:layerId", requireUser, async (req, res) => {
    await req.db.query(`DELETE FROM user_layers WHERE user_id = $1 AND layer_id = $2`,
        [req.userId, String(req.params.layerId).slice(0, 64)]);
    res.json({ ok: true });
});

export { normStyle, SESSION_COOKIE, hashPassword, verifyPassword };
