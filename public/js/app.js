/* Marketplace: lógica de la página (conectada al servidor) */
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const clp = n => n || n === 0 ? "$" + Number(n).toLocaleString("es-CL") : "A convenir";
const ICON = { Servicios: "🛠️", Productos: "🛍️", Vehículos: "🚗", Propiedades: "🏠", Empleos: "💼" };
const ESTADO = { activa: "Activa", pendiente: "En revisión", pendiente_pago: "Falta pagar", pausada: "Pausada", vencida: "Vencida", rechazada: "Rechazada" };

let CFG, U = null, F = { q: "", cat: "", com: "" }, timer, modo = "login", volver = "#/mis", esNuevo = false;

async function api(ruta, metodo = "GET", cuerpo) {
  const r = await fetch("/api" + ruta, { method: metodo, headers: { "Content-Type": "application/json" }, body: cuerpo ? JSON.stringify(cuerpo) : undefined });
  const d = await r.json().catch(() => null);
  if (!r.ok) { const e = new Error((d && d.error) || "Ocurrió un error"); e.status = r.status; throw e; }
  return d;
}
const toast = m => { const t = $("toast"); t.textContent = m; t.classList.add("on"); setTimeout(() => t.classList.remove("on"), 3200); };
const fallo = e => toast(e.message);
const grad = id => `background:linear-gradient(135deg,hsl(${id * 47 % 360} 85% 62% / .38),hsl(${(id * 47 + 55) % 360} 85% 62% / .12))`;
const thumb = (x, alto) => `<div class="th" style="${grad(x.id)}${alto ? ";height:" + alto + "px" : ""}">${x.tiene_imagen ? `<img src="/api/publicaciones/${x.id}/imagen" alt="" loading="lazy">` : ICON[x.categoria] || "📦"}${x.destacada ? '<span class="bd">Destacado</span>' : ""}</div>`;

function nav() {
  const h = location.hash || "#/";
  const a = (href, t) => `<a href="${href}" class="${h === href ? "on" : ""}">${t}</a>`;
  $("nav").innerHTML = a("#/", "Inicio") + (U ? a("#/mis", "Mis publicaciones") : "") + (U && U.rol === "admin" ? a("#/admin", "Admin") : "") +
    (U ? `<a href="#/" onclick="salir();return false">Salir</a>` : a("#/entrar", "Entrar")) + `<a class="btn hl sm" href="#/publicar">Publicar</a>`;
}
async function salir() { await api("/logout", "POST"); U = null; location.hash = "#/"; go(); toast("Sesión cerrada"); }

/* ---------- Inicio ---------- */
function home() {
  return `<section class="hero"><h1>Compra, vende y contrata cerca de ti</h1>
  <p>Publica tu servicio o producto y llega a personas de tu comuna.</p>
  <div class="search"><input id="q" placeholder="¿Qué estás buscando?" value="${esc(F.q)}" oninput="setF()" aria-label="Buscar">
  <select id="fm" onchange="setF()" aria-label="Comuna"><option value="">Todas las comunas</option>${CFG.coms.map(c => `<option ${F.com == c ? "selected" : ""}>${c}</option>`).join("")}</select></div>
  <div class="chips">${["", ...CFG.cats].map(c => `<button class="chip ${F.cat == c ? "on" : ""}" onclick="setCat('${c}')">${c || "Todo"}</button>`).join("")}</div></section>
  <h2 id="cnt">Cargando…</h2><div class="grid" id="grid"></div>`;
}
function setF() { F.q = $("q").value; F.com = $("fm").value; clearTimeout(timer); timer = setTimeout(grid, 250); }
function setCat(c) { F.cat = c; go(); }
async function grid() {
  try {
    const r = await api("/publicaciones?" + new URLSearchParams(F));
    $("cnt").textContent = r.length + (r.length == 1 ? " publicación" : " publicaciones");
    $("grid").innerHTML = r.map(x => `<a class="card ${x.destacada ? "d" : ""}" href="#/p/${x.id}">${thumb(x)}
      <div class="cb"><h3>${esc(x.titulo)}</h3><div class="pr">${clp(x.precio)}</div><div class="mu">${esc(x.comuna)} · ${esc(x.categoria)}</div></div></a>`).join("")
      || `<p class="mu">Aún no hay publicaciones aquí. <a class="lnk" href="#/publicar">Sé el primero en publicar</a>.</p>`;
  } catch (e) { fallo(e); }
}

/* ---------- Detalle ---------- */
async function detail(id) {
  const x = await api("/publicaciones/" + Number(id));
  const msg = encodeURIComponent('Hola, vi tu publicación "' + x.titulo + '" en ' + document.title.split("|")[0].trim() + ".");
  const rep = CFG.contacto ? `<a class="btn ghost sm" href="mailto:${esc(CFG.contacto)}?subject=${encodeURIComponent("Reporte de publicación #" + x.id)}">Reportar publicación</a>` : "";
  return `<p><a class="lnk" href="#/">← Volver</a></p><div class="two"><div class="box">${thumb(x, 240).replace('class="th"', 'class="th" data-big').replace('style="', 'style="border-radius:12px;margin-bottom:16px;')}
    <h1 style="font-size:1.7rem">${esc(x.titulo)}</h1><p class="mu">${esc(x.comuna)} · ${esc(x.categoria)}</p><p>${esc(x.descripcion)}</p></div>
    <div class="box"><div class="pr" style="font-size:1.8rem">${clp(x.precio)}</div><p class="mu">Publicado por ${esc(x.vendedor)}</p>
    <p><a class="btn" style="display:block;text-align:center" target="_blank" rel="noopener" href="https://wa.me/${esc(x.whatsapp)}?text=${msg}">Contactar por WhatsApp</a></p>
    <p>${rep}</p><p class="mu" style="margin:0">Consejo: no pagues por adelantado sin conocer al vendedor.</p></div></div>`;
}

/* ---------- Entrar / Crear cuenta ---------- */
function entrar() {
  const login = modo == "login";
  return `<div class="box" style="max-width:420px;margin:0 auto"><h1 style="font-size:1.7rem">${login ? "Entrar" : "Crear cuenta"}</h1>
  <p id="aerr" class="err"></p>
  <form onsubmit="return enviarAuth(event)">${login ? "" : '<label>Nombre<input id="an" required maxlength="60" autocomplete="name"></label>'}
  <label>Correo<input id="ae" type="email" required autocomplete="email"></label>
  <label>Contraseña${login ? "" : " (mínimo 8 caracteres)"}<input id="ap" type="password" required minlength="${login ? 1 : 8}" autocomplete="${login ? "current-password" : "new-password"}"></label>
  <button class="btn" style="width:100%">${login ? "Entrar" : "Crear mi cuenta"}</button></form>
  <p class="mu" style="margin:14px 0 0">${login ? "¿Primera vez?" : "¿Ya tienes cuenta?"} <a class="lnk" href="#/entrar" onclick="modo='${login ? "registro" : "login"}';go();return false">${login ? "Crear cuenta" : "Entrar"}</a></p></div>`;
}
async function enviarAuth(e) {
  e.preventDefault();
  try {
    const body = { email: $("ae").value, password: $("ap").value };
    if (modo != "login") body.nombre = $("an").value;
    U = await api(modo == "login" ? "/login" : "/registro", "POST", body);
    toast("Hola, " + U.nombre); location.hash = volver; volver = "#/mis"; go();
  } catch (err) { $("aerr").textContent = err.message; }
  return false;
}

/* ---------- Publicar ---------- */
async function publicar() {
  if (!U) { volver = "#/publicar"; location.hash = "#/entrar"; toast("Entra o crea tu cuenta para publicar"); return entrar(); }
  esNuevo = (await api("/mis")).esNuevo;
  return `<h1 style="font-size:2rem">Publicar</h1><div class="two"><form class="box" id="pf" onsubmit="return pub(event)">
  <label>Título<input id="ft" required maxlength="70" placeholder="Ej: Clases de inglés online"></label>
  <div class="row2"><label>Categoría<select id="fc">${CFG.cats.map(c => `<option>${c}</option>`).join("")}</select></label>
  <label>Precio (CLP)<input id="fp" type="number" min="0" placeholder="Vacío = a convenir"></label></div>
  <div class="row2"><label>Comuna<select id="fo">${CFG.coms.map(c => `<option>${c}</option>`).join("")}</select></label>
  <label>WhatsApp<input id="fw" required placeholder="56912345678" inputmode="numeric"></label></div>
  <label>Descripción<textarea id="fd" required maxlength="500"></textarea></label>
  <label>Foto (opcional)<input id="ff" type="file" accept="image/*"></label>
  <label style="display:flex;gap:10px;align-items:center;margin:0 0 18px"><input type="checkbox" id="fz" onchange="sum()" style="width:auto;margin:0"> Destacar 7 días (aparece arriba, con etiqueta) · ${clp(CFG.precio.dest)}</label>
  <button class="btn" id="fb" type="submit"></button></form>
  <div class="box sum"><h3>Resumen</h3><div id="sm"></div>
  <p class="mu" style="margin:12px 0 0">Revisamos tu publicación antes de mostrarla. Dura ${esNuevo ? "15 días (la gratuita)" : "30 días"}.</p></div></div>`;
}
const costo = () => ({ pub: esNuevo ? 0 : CFG.precio.pub, dest: $("fz") && $("fz").checked ? CFG.precio.dest : 0 });
function sum() {
  const c = costo(), t = c.pub + c.dest;
  $("sm").innerHTML = `<div><span>Publicación</span><span>${c.pub ? clp(c.pub) : "Gratis"}</span></div><div><span>Destacado</span><span>${c.dest ? clp(c.dest) : "-"}</span></div><div class="t"><span>Total</span><span>${t ? clp(t) : "$0"}</span></div>`;
  $("fb").textContent = t ? "Pagar " + clp(t) + " y publicar" : "Publicar gratis";
}
// Reduce la foto a ~900 px antes de subirla, para que la página cargue rápido
function comprimir(file) {
  return new Promise((ok, mal) => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      const k = Math.min(1, 900 / Math.max(img.width, img.height)), c = document.createElement("canvas");
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
      ok(c.toDataURL("image/jpeg", .75));
    };
    img.onerror = () => mal(new Error("No se pudo leer la foto"));
    img.src = url;
  });
}
async function pub(e) {
  e.preventDefault();
  const b = $("fb"); b.disabled = true;
  try {
    const f = $("ff").files[0];
    const r = await api("/publicaciones", "POST", { titulo: $("ft").value, categoria: $("fc").value, precio: $("fp").value, comuna: $("fo").value, whatsapp: $("fw").value, descripcion: $("fd").value, destacar: $("fz").checked, imagen: f ? await comprimir(f) : null });
    if (r.pagoUrl) { location.href = r.pagoUrl; return false; }
    location.hash = "#/mis"; toast("Publicación enviada. La revisaremos pronto.");
  } catch (err) { fallo(err); b.disabled = false; }
  return false;
}

/* ---------- Mis publicaciones ---------- */
async function mis() {
  if (!U) { volver = "#/mis"; location.hash = "#/entrar"; return entrar(); }
  const r = (await api("/mis")).items;
  const dias = x => Math.max(0, Math.ceil((new Date(x.vence) - Date.now()) / 864e5));
  return `<h1 style="font-size:2rem">Mis publicaciones</h1><div class="box tw">${r.length ? `<table><tr><th>Publicación</th><th>Estado</th><th>Vence</th><th>Acciones</th></tr>
  ${r.map(x => `<tr><td><b>${esc(x.titulo)}</b>${x.destacada ? ' <span class="b activa">Destacada</span>' : ""}<div class="mu">${clp(x.precio)} · ${esc(x.comuna)}</div></td>
  <td><span class="b ${x.estado == "pendiente_pago" ? "pendiente" : x.estado}">${ESTADO[x.estado] || x.estado}</span></td><td>${x.estado == "activa" ? dias(x) + " días" : "-"}</td>
  <td><div class="acts">${x.estado == "pendiente_pago" ? `<button class="btn sm" onclick="accion(${x.id},'pagar')">Pagar</button>` : ""}
  ${x.estado == "activa" && !x.destacada ? `<button class="btn hl sm" onclick="accion(${x.id},'destacar')">Destacar ${clp(CFG.precio.dest)}</button>` : ""}
  ${x.estado == "vencida" ? `<button class="btn sm" onclick="accion(${x.id},'renovar')">Renovar ${clp(CFG.precio.pub)}</button>` : ""}
  ${x.estado == "activa" || x.estado == "pausada" ? `<button class="btn ghost sm" onclick="accion(${x.id},'pausar')">${x.estado == "activa" ? "Pausar" : "Reactivar"}</button>` : ""}</div></td></tr>`).join("")}</table>`
    : `<p>Aún no tienes publicaciones. <a class="lnk" href="#/publicar">Publica la primera gratis</a>.</p>`}</div>`;
}
async function accion(id, a) {
  try { const r = await api("/publicaciones/" + id + "/" + a, "POST"); if (r.pagoUrl) location.href = r.pagoUrl; else go(); } catch (e) { fallo(e); }
}

/* ---------- Administración ---------- */
async function admin() {
  if (!U || U.rol != "admin") return `<div class="box"><p>Esta sección es solo para administradores.</p></div>`;
  const d = await api("/admin/resumen");
  const fecha = f => new Date(f).toLocaleDateString("es-CL");
  return `<h1 style="font-size:2rem">Panel de administración</h1>
  <div class="stats"><div class="box"><span class="mu">Ingresos</span><b>${clp(d.ingresos)}</b></div>
  <div class="box"><span class="mu">Publicaciones activas</span><b>${d.activas}</b></div>
  <div class="box"><span class="mu">Por aprobar</span><b>${d.pendientes.length}</b></div></div>
  <div class="box" style="margin-bottom:20px"><h2>Por aprobar</h2>${d.pendientes.length ? d.pendientes.map(x => `<div style="display:flex;gap:12px;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--ln);flex-wrap:wrap">
  <div><b>${esc(x.titulo)}</b><div class="mu">${esc(x.vendedor)} · ${esc(x.categoria)} · ${esc(x.comuna)}</div></div>
  <div class="acts"><button class="btn sm" onclick="mod(${x.id},'aprobar')">Aprobar</button><button class="btn ghost sm" onclick="mod(${x.id},'rechazar')">Rechazar</button></div></div>`).join("") : `<p class="mu">Nada pendiente.</p>`}</div>
  <div class="box tw"><h2>Pagos recibidos</h2>${d.pagos.length ? `<table><tr><th>Fecha</th><th>Concepto</th><th>Medio</th><th>Monto</th></tr>
  ${d.pagos.map(p => `<tr><td>${fecha(p.pagado_en)}</td><td>${esc(p.concepto)}</td><td>${esc(p.medio)}</td><td><b>${clp(p.monto)}</b></td></tr>`).join("")}</table>` : `<p class="mu">Aún no hay pagos.</p>`}</div>`;
}
async function mod(id, a) { try { await api("/admin/publicaciones/" + id + "/" + a, "POST"); toast(a == "aprobar" ? "Publicación aprobada" : "Publicación rechazada"); go(); } catch (e) { fallo(e); } }

/* ---------- Navegación ---------- */
async function go() {
  const [ruta, qs] = (location.hash || "#/").slice(2).split("?");
  const [r, a] = ruta.split("/");
  try {
    const vista = { "": home, p: () => detail(a), publicar, mis, admin, entrar }[r] || home;
    $("app").innerHTML = await vista();
    if (r === "") grid();
    if (r === "publicar" && U) sum();
    const pg = new URLSearchParams(qs || "").get("pago");
    if (pg) { toast(pg == "ok" ? "Pago recibido. ¡Gracias!" : "El pago no se completó. Puedes intentarlo de nuevo."); history.replaceState(null, "", "#/" + r); }
  } catch (e) {
    if (e.status === 401) { U = null; volver = location.hash; location.hash = "#/entrar"; }
    else $("app").innerHTML = `<div class="box"><p>${esc(e.message)}</p><p><a class="lnk" href="#/">Volver al inicio</a></p></div>`;
  }
  nav(); window.scrollTo(0, 0);
}
window.addEventListener("hashchange", go);
(async () => {
  try { CFG = await api("/config"); U = await api("/me"); } catch (e) { $("app").innerHTML = `<div class="box"><p>No se pudo conectar con el servidor.</p></div>`; return; }
  go();
})();
