require("dotenv").config();
const express = require("express");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { Pool } = require("pg");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const rateLimit = require("express-rate-limit");

const E = process.env;
if (!E.JWT_SECRET || !E.DATABASE_URL) { console.error("Faltan JWT_SECRET o DATABASE_URL en las variables de entorno"); process.exit(1); }

const PORT = E.PORT || 3000;
const BASE = (E.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, "");
const PRECIO = { pub: Number(E.PRECIO_PUBLICACION) || 3000, dest: Number(E.PRECIO_DESTACADO) || 5000 };
const DIAS = { gratis: 15, pago: 30 };
const CATS = ["Servicios", "Productos", "Vehículos", "Propiedades", "Empleos"];
const COMS = ["Santiago", "Providencia", "Las Condes", "Maipú", "Puente Alto", "Ñuñoa", "Valparaíso", "Concepción"];
const SIM = E.PAGO_MODO !== "flow";
const AUTO = E.AUTO_APROBAR === "true";
const FLOW_URL = E.FLOW_URL || "https://sandbox.flow.cl/api";
const ADMIN_EMAIL = (E.ADMIN_EMAIL || "").trim().toLowerCase();
if (SIM && E.NODE_ENV === "production") console.warn("AVISO: PAGO_MODO=simulado en producción. Cualquiera puede publicar sin pagar. Cambia a PAGO_MODO=flow.");

const pool = new Pool({ connectionString: E.DATABASE_URL, ssl: E.DB_SSL === "true" ? { rejectUnauthorized: false } : false });
const app = express();
app.set("trust proxy", 1);
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());

const ah = fn => (req, res, next) => fn(req, res, next).catch(next);
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false, message: { error: "Demasiados intentos. Espera unos minutos." } });

/* ---------- Sesión ---------- */
function sesion(res, u) {
  const token = jwt.sign({ id: u.id, nombre: u.nombre, rol: u.rol }, E.JWT_SECRET, { expiresIn: "7d" });
  res.cookie("t", token, { httpOnly: true, sameSite: "lax", secure: E.NODE_ENV === "production", maxAge: 7 * 864e5 });
}
const auth = (req, res, next) => {
  try { req.u = jwt.verify(req.cookies.t, E.JWT_SECRET); next(); }
  catch { res.status(401).json({ error: "Debes iniciar sesión" }); }
};
const soloAdmin = (req, res, next) => req.u.rol === "admin" ? next() : res.status(403).json({ error: "Solo administradores" });

app.post("/api/registro", limiter, ah(async (req, res) => {
  const nombre = String(req.body.nombre || "").trim().slice(0, 60);
  const email = String(req.body.email || "").trim().toLowerCase().slice(0, 120);
  const pass = String(req.body.password || "");
  if (!nombre || !/^\S+@\S+\.\S+$/.test(email) || pass.length < 8) return res.status(400).json({ error: "Revisa tu nombre, tu correo y que la contraseña tenga al menos 8 caracteres" });
  const rol = ADMIN_EMAIL && email === ADMIN_EMAIL ? "admin" : "usuario";
  try {
    const r = await pool.query("INSERT INTO mk_usuarios(nombre,email,password_hash,rol) VALUES($1,$2,$3,$4) RETURNING id,nombre,email,rol", [nombre, email, await bcrypt.hash(pass, 10), rol]);
    sesion(res, r.rows[0]); res.json(r.rows[0]);
  } catch (e) {
    if (e.code === "23505") return res.status(400).json({ error: "Ese correo ya está registrado" });
    throw e;
  }
}));

app.post("/api/login", limiter, ah(async (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const r = await pool.query("SELECT * FROM mk_usuarios WHERE email=$1", [email]);
  const u = r.rows[0];
  if (!u || !(await bcrypt.compare(String(req.body.password || ""), u.password_hash))) return res.status(401).json({ error: "Correo o contraseña incorrectos" });
  if (ADMIN_EMAIL && email === ADMIN_EMAIL && u.rol !== "admin") { await pool.query("UPDATE mk_usuarios SET rol='admin' WHERE id=$1", [u.id]); u.rol = "admin"; }
  sesion(res, u); res.json({ id: u.id, nombre: u.nombre, email: u.email, rol: u.rol });
}));

app.post("/api/logout", (req, res) => { res.clearCookie("t"); res.json({ ok: true }); });
app.get("/api/me", (req, res) => {
  try { const u = jwt.verify(req.cookies.t, E.JWT_SECRET); res.json({ id: u.id, nombre: u.nombre, rol: u.rol }); }
  catch { res.json(null); }
});
app.get("/api/config", (req, res) => res.json({ precio: PRECIO, cats: CATS, coms: COMS, contacto: ADMIN_EMAIL, modoPago: SIM ? "simulado" : "flow" }));

/* ---------- Publicaciones públicas ---------- */
const COLS = `id,titulo,categoria,precio,comuna,descripcion,(imagen IS NOT NULL) AS tiene_imagen,COALESCE(destacada_hasta>now(),false) AS destacada,vence`;

app.get("/api/publicaciones", ah(async (req, res) => {
  const { q, cat, com } = req.query; const p = []; let w = "estado='activa' AND vence>now()";
  if (cat) { p.push(String(cat)); w += ` AND categoria=$${p.length}`; }
  if (com) { p.push(String(com)); w += ` AND comuna=$${p.length}`; }
  if (q) { p.push("%" + String(q).slice(0, 60) + "%"); w += ` AND (titulo ILIKE $${p.length} OR descripcion ILIKE $${p.length})`; }
  const r = await pool.query(`SELECT ${COLS} FROM mk_publicaciones WHERE ${w} ORDER BY COALESCE(destacada_hasta>now(),false) DESC, creado DESC LIMIT 60`, p);
  res.json(r.rows);
}));

app.get("/api/publicaciones/:id", ah(async (req, res) => {
  const r = await pool.query(`SELECT p.id,p.titulo,p.categoria,p.precio,p.comuna,p.descripcion,p.whatsapp,(p.imagen IS NOT NULL) AS tiene_imagen,COALESCE(p.destacada_hasta>now(),false) AS destacada,u.nombre AS vendedor
    FROM mk_publicaciones p JOIN mk_usuarios u ON u.id=p.usuario_id WHERE p.id=$1 AND p.estado='activa' AND p.vence>now()`, [Number(req.params.id) || 0]);
  if (!r.rows[0]) return res.status(404).json({ error: "Publicación no encontrada" });
  res.json(r.rows[0]);
}));

app.get("/api/publicaciones/:id/imagen", ah(async (req, res) => {
  const r = await pool.query("SELECT imagen FROM mk_publicaciones WHERE id=$1 AND imagen IS NOT NULL", [Number(req.params.id) || 0]);
  if (!r.rows[0]) return res.sendStatus(404);
  res.set({ "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=86400" }).send(Buffer.from(r.rows[0].imagen.split(",")[1], "base64"));
}));

/* ---------- Pagos ---------- */
const firmar = params => crypto.createHmac("sha256", E.FLOW_SECRET_KEY || "").update(Object.keys(params).sort().map(k => k + params[k]).join("")).digest("hex");

async function flow(ruta, metodo, params) {
  params = { apiKey: E.FLOW_API_KEY, ...params };
  const body = new URLSearchParams({ ...params, s: firmar(params) }).toString();
  const r = metodo === "GET"
    ? await fetch(FLOW_URL + ruta + "?" + body)
    : await fetch(FLOW_URL + ruta, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
  const d = await r.json();
  if (!r.ok) throw new Error(d.message || "Error al conectar con Flow");
  return d;
}

async function iniciarPago(u, pubId, tipo, monto, concepto) {
  const orden = crypto.randomBytes(8).toString("hex");
  await pool.query("INSERT INTO mk_pagos(usuario_id,publicacion_id,tipo,concepto,monto,medio,orden) VALUES($1,$2,$3,$4,$5,$6,$7)",
    [u.id, pubId, tipo, concepto.slice(0, 120), monto, SIM ? "Simulado" : "Flow", orden]);
  if (SIM) return `/pago/simulado?orden=${orden}`;
  const email = (await pool.query("SELECT email FROM mk_usuarios WHERE id=$1", [u.id])).rows[0].email;
  const d = await flow("/payment/create", "POST", { commerceOrder: orden, subject: concepto.slice(0, 100), currency: "CLP", amount: monto, email, urlConfirmation: BASE + "/pago/confirmacion", urlReturn: BASE + "/pago/retorno" });
  await pool.query("UPDATE mk_pagos SET token=$1 WHERE orden=$2", [d.token, orden]);
  return d.url + "?token=" + d.token;
}

async function activar(id) {
  await pool.query(`UPDATE mk_publicaciones SET estado='activa', vence=now()+(dias||' days')::interval,
    destacada_hasta=CASE WHEN quiere_destacar THEN now()+interval '7 days' ELSE destacada_hasta END, quiere_destacar=false
    WHERE id=$1 AND estado='pendiente'`, [id]);
}

// Marca un pago como pagado y aplica su efecto. Es seguro llamarla varias veces: solo actúa la primera.
async function pagar(orden) {
  const c = await pool.connect();
  let p;
  try {
    await c.query("BEGIN");
    p = (await c.query("UPDATE mk_pagos SET estado='pagado', pagado_en=now() WHERE orden=$1 AND estado='pendiente' RETURNING *", [orden])).rows[0];
    if (p) {
      if (p.tipo === "publicar") await c.query("UPDATE mk_publicaciones SET estado='pendiente' WHERE id=$1", [p.publicacion_id]);
      if (p.tipo === "destacar") await c.query("UPDATE mk_publicaciones SET destacada_hasta=GREATEST(now(),COALESCE(destacada_hasta,now()))+interval '7 days' WHERE id=$1", [p.publicacion_id]);
      if (p.tipo === "renovar") await c.query("UPDATE mk_publicaciones SET estado='activa', vence=now()+interval '30 days' WHERE id=$1", [p.publicacion_id]);
    }
    await c.query("COMMIT");
  } catch (e) { await c.query("ROLLBACK"); throw e; } finally { c.release(); }
  if (p && p.tipo === "publicar" && AUTO) await activar(p.publicacion_id);
  return !!p;
}

// Pregunta a Flow si el pago realmente se hizo (nunca confiamos solo en lo que manda el navegador)
async function verificar(token) {
  const d = await flow("/payment/getStatus", "GET", { token });
  const pago = (await pool.query("SELECT monto FROM mk_pagos WHERE orden=$1", [d.commerceOrder])).rows[0];
  if (d.status === 2 && pago && Number(d.amount) === pago.monto) { await pagar(d.commerceOrder); return true; }
  if (d.status === 3 || d.status === 4) await pool.query("UPDATE mk_pagos SET estado='fallido' WHERE orden=$1 AND estado='pendiente'", [d.commerceOrder]);
  return false;
}

app.post("/pago/confirmacion", ah(async (req, res) => { if (!SIM && req.body.token) await verificar(req.body.token); res.sendStatus(200); }));
app.all("/pago/retorno", ah(async (req, res) => {
  const token = (req.body && req.body.token) || req.query.token;
  const ok = token && !SIM ? await verificar(token) : false;
  res.redirect("/#/mis?pago=" + (ok ? "ok" : "fallo"));
}));

// Pago de prueba: solo existe con PAGO_MODO=simulado
app.get("/pago/simulado", (req, res) => {
  const o = String(req.query.orden || "");
  if (!SIM || !/^[a-f0-9]{16}$/.test(o)) return res.sendStatus(404);
  res.send(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Pago simulado</title>
  <body style="font-family:system-ui;background:#041a1e;color:#e6fbf9;display:grid;place-items:center;min-height:100vh;margin:0">
  <form method="post" action="/pago/simulado" style="background:#0a2a30;padding:28px;border-radius:16px;max-width:360px;text-align:center">
  <h2>Pago simulado</h2><p>Es una prueba: no se cobra nada.</p><input type="hidden" name="orden" value="${o}">
  <button style="background:#2dd4bf;border:0;border-radius:10px;padding:12px 22px;font-weight:700;cursor:pointer">Pagar (simulado)</button></form></body>`);
});
app.post("/pago/simulado", ah(async (req, res) => {
  const o = String(req.body.orden || "");
  if (!SIM || !/^[a-f0-9]{16}$/.test(o)) return res.sendStatus(404);
  await pagar(o); res.redirect("/#/mis?pago=ok");
}));

/* ---------- Mis publicaciones ---------- */
const EST = "CASE WHEN estado='activa' AND vence<now() THEN 'vencida' ELSE estado END";

app.get("/api/mis", auth, ah(async (req, res) => {
  const r = await pool.query(`SELECT id,titulo,categoria,precio,comuna,${EST} AS estado,vence,quiere_destacar,COALESCE(destacada_hasta>now(),false) AS destacada,(imagen IS NOT NULL) AS tiene_imagen
    FROM mk_publicaciones WHERE usuario_id=$1 ORDER BY creado DESC`, [req.u.id]);
  res.json({ items: r.rows, esNuevo: r.rows.length === 0 });
}));

app.post("/api/publicaciones", auth, ah(async (req, res) => {
  const b = req.body;
  const titulo = String(b.titulo || "").trim().slice(0, 70), descripcion = String(b.descripcion || "").trim().slice(0, 500);
  const wa = String(b.whatsapp || "").replace(/\D/g, "");
  const precio = b.precio === "" || b.precio == null ? null : Math.round(Number(b.precio));
  if (!titulo || !descripcion || !CATS.includes(b.categoria) || !COMS.includes(b.comuna) || wa.length < 8 || wa.length > 15 || (precio !== null && !(precio >= 0 && precio <= 1e9)))
    return res.status(400).json({ error: "Revisa los datos del formulario" });
  let img = null;
  if (b.imagen) {
    if (!/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(b.imagen) || b.imagen.length > 450000) return res.status(400).json({ error: "La foto no es válida o pesa demasiado" });
    img = b.imagen;
  }
  const n = (await pool.query("SELECT count(*)::int AS n FROM mk_publicaciones WHERE usuario_id=$1", [req.u.id])).rows[0].n;
  const destacar = !!b.destacar, monto = (n === 0 ? 0 : PRECIO.pub) + (destacar ? PRECIO.dest : 0);
  const ins = await pool.query(`INSERT INTO mk_publicaciones(usuario_id,titulo,categoria,precio,comuna,descripcion,whatsapp,imagen,estado,dias,quiere_destacar)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
    [req.u.id, titulo, b.categoria, precio, b.comuna, descripcion, wa, img, monto ? "pendiente_pago" : "pendiente", n === 0 ? DIAS.gratis : DIAS.pago, destacar]);
  const id = ins.rows[0].id;
  if (!monto) { if (AUTO) await activar(id); return res.json({ ok: true }); }
  res.json({ ok: true, pagoUrl: await iniciarPago(req.u, id, "publicar", monto, "Publicación: " + titulo) });
}));

const mia = async (req, res) => {
  const r = await pool.query(`SELECT *,${EST} AS est FROM mk_publicaciones WHERE id=$1 AND usuario_id=$2`, [Number(req.params.id) || 0, req.u.id]);
  if (!r.rows[0]) { res.status(404).json({ error: "Publicación no encontrada" }); return null; }
  return r.rows[0];
};
const bad = (res, m) => res.status(400).json({ error: m });

app.post("/api/publicaciones/:id/pagar", auth, ah(async (req, res) => {
  const p = await mia(req, res); if (!p) return;
  if (p.estado !== "pendiente_pago") return bad(res, "Esta publicación no tiene un pago pendiente");
  res.json({ pagoUrl: await iniciarPago(req.u, p.id, "publicar", PRECIO.pub + (p.quiere_destacar ? PRECIO.dest : 0), "Publicación: " + p.titulo) });
}));
app.post("/api/publicaciones/:id/destacar", auth, ah(async (req, res) => {
  const p = await mia(req, res); if (!p) return;
  if (p.est !== "activa") return bad(res, "Solo puedes destacar publicaciones activas");
  res.json({ pagoUrl: await iniciarPago(req.u, p.id, "destacar", PRECIO.dest, "Destacado 7 días: " + p.titulo) });
}));
app.post("/api/publicaciones/:id/renovar", auth, ah(async (req, res) => {
  const p = await mia(req, res); if (!p) return;
  if (p.est !== "vencida") return bad(res, "Solo puedes renovar publicaciones vencidas");
  res.json({ pagoUrl: await iniciarPago(req.u, p.id, "renovar", PRECIO.pub, "Renovación: " + p.titulo) });
}));
app.post("/api/publicaciones/:id/pausar", auth, ah(async (req, res) => {
  const p = await mia(req, res); if (!p) return;
  if (p.est === "activa") await pool.query("UPDATE mk_publicaciones SET estado='pausada' WHERE id=$1", [p.id]);
  else if (p.estado === "pausada") await pool.query("UPDATE mk_publicaciones SET estado='activa' WHERE id=$1", [p.id]);
  else return bad(res, "No se puede pausar esta publicación");
  res.json({ ok: true });
}));

/* ---------- Administración ---------- */
app.get("/api/admin/resumen", auth, soloAdmin, ah(async (req, res) => {
  const [ing, act, pen, pag] = await Promise.all([
    pool.query("SELECT COALESCE(sum(monto),0)::int AS n FROM mk_pagos WHERE estado='pagado'"),
    pool.query("SELECT count(*)::int AS n FROM mk_publicaciones WHERE estado='activa' AND vence>now()"),
    pool.query("SELECT p.id,p.titulo,p.categoria,p.comuna,u.nombre AS vendedor FROM mk_publicaciones p JOIN mk_usuarios u ON u.id=p.usuario_id WHERE p.estado='pendiente' ORDER BY p.creado"),
    pool.query("SELECT concepto,monto,medio,pagado_en FROM mk_pagos WHERE estado='pagado' ORDER BY pagado_en DESC LIMIT 50")
  ]);
  res.json({ ingresos: ing.rows[0].n, activas: act.rows[0].n, pendientes: pen.rows, pagos: pag.rows });
}));
app.post("/api/admin/publicaciones/:id/aprobar", auth, soloAdmin, ah(async (req, res) => { await activar(Number(req.params.id) || 0); res.json({ ok: true }); }));
app.post("/api/admin/publicaciones/:id/rechazar", auth, soloAdmin, ah(async (req, res) => {
  await pool.query("UPDATE mk_publicaciones SET estado='rechazada' WHERE id=$1 AND estado='pendiente'", [Number(req.params.id) || 0]); res.json({ ok: true });
}));

/* ---------- Archivos de la página y errores ---------- */
app.use(express.static(path.join(__dirname, "public")));
app.use("/api", (req, res) => res.status(404).json({ error: "No encontrado" }));
app.use((err, req, res, next) => { console.error(err); res.status(500).json({ error: "Error del servidor. Intenta de nuevo." }); });

(async () => {
  await pool.query(fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8"));
  setInterval(() => pool.query("UPDATE mk_publicaciones SET estado='vencida' WHERE estado='activa' AND vence<now()").catch(console.error), 3600e3);
  app.listen(PORT, () => console.log(`Marketplace en ${BASE} (pagos: ${SIM ? "simulados" : "Flow"})`));
})().catch(e => { console.error("No se pudo iniciar:", e.message); process.exit(1); });
