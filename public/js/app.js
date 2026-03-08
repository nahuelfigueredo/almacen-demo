/* =========================================================
   ALMACEN APP — app.js (MVP Offline) + CASH SESSIONS (PRO)

   Incluye:
   - Cash Sessions v2 (migración desde legacy)
   - AddSale consistente con cash state
   - Auto-recorte de ventas (MAX_SALES) + limpieza de salesIds
   - Seed demo de productos
   - Auth por PIN + Roles
   - License demo->full

========================================================= */

/* ========= Config ========= */
const LS_KEYS = {
  PRODUCTS: "almacen_products_v1",
  SALES: "almacen_sales_v1",
  CASH: "almacen_cash_v1",
  STOCK_ENTRIES: "almacen_stock_entries_v1",
  PRICE_CHANGES: "almacen_price_changes_v1",
  STOCK_MOVES: "almacen_stock_moves_v1",
  AUTH_USERS: "almacen_users_v1",
  AUTH_SESSION: "almacen_session_v1",
};

// Mantener solo las ventas más recientes (newest-first)
// 4500 ≈ 45 días a 100 ventas/día (recomendado para dejar margen)
const MAX_SALES = 4500;

/* ========= Utils ========= */
function nowISO(){ return new Date().toISOString(); }
function money(n){
  const v = Number(n || 0);
  return v.toLocaleString("es-AR", { style:"currency", currency:"ARS", minimumFractionDigits: 2 });
}
function num(n){
  const v = Number(n);
  return Number.isFinite(v) ? v : 0;
}
function roundQty(q){
  return Math.round(num(q) * 1000) / 1000;
}
function uid(prefix="id"){
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now()}`;
}

/* ========= Toast ========= */
function toast(msg){
  let el = document.getElementById("toast");
  if(!el){
    el = document.createElement("div");
    el.id = "toast";
    el.className = "toast";
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.style.display = "block";
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(()=>{ el.style.display="none"; }, 2200);
}

/* ========= Storage Helpers ========= */
function loadJSON(key, fallback){
  try{
    const raw = localStorage.getItem(key);
    if(!raw) return fallback;
    return JSON.parse(raw);
  }catch{
    return fallback;
  }
}
function saveJSON(key, value){
  localStorage.setItem(key, JSON.stringify(value));
}

/* =========================================================
   Domain: Products
========================================================= */
function getProducts(){ return loadJSON(LS_KEYS.PRODUCTS, []); }
function setProducts(list){ saveJSON(LS_KEYS.PRODUCTS, list); }
function findProductById(id){ return getProducts().find(p => p.id === id) || null; }
function findProductByBarcode(code){
  const c = String(code || "").trim();
  if(!c) return null;
  return getProducts().find(p => String(p.barcode || "").trim() === c) || null;
}
function searchProductsByName(q){
  const s = String(q || "").trim().toLowerCase();
  const all = getProducts().filter(p => p.active !== false);
  if(!s) return all;
  return all.filter(p => (p.name || "").toLowerCase().includes(s));
}
function upsertProduct(product){
  const list = getProducts();
  const idx = list.findIndex(p => p.id === product.id);
  if(idx >= 0) list[idx] = product;
  else list.unshift(product);
  setProducts(list);
}
function deleteProduct(id){
  const list = getProducts().filter(p => p.id !== id);
  setProducts(list);
}

/* =========================================================
   Stock
========================================================= */
function adjustStock(productId, deltaQty){
  const list = getProducts();
  const idx = list.findIndex(p => p.id === productId);
  if(idx < 0) return;
  list[idx].stock = roundQty(num(list[idx].stock) + num(deltaQty));
  setProducts(list);
}

/* =========================================================
   Kardex: Stock Moves
========================================================= */
function getStockMoves(){ return loadJSON(LS_KEYS.STOCK_MOVES, []); }
function addStockMove(move){
  const list = getStockMoves();
  list.unshift(move);
  saveJSON(LS_KEYS.STOCK_MOVES, list);
}
function recordStockMove({ type, productId, qty, unitCost = 0, note = "", refType = "", refId = "" }){
  const pBefore = findProductById(productId);
  if(!pBefore) throw new Error("Producto no encontrado");

  const q = roundQty(qty);
  if(q <= 0) throw new Error("Cantidad inválida");

  const before = roundQty(pBefore.stock);
  const delta = (type === "OUT") ? -q : q;
  adjustStock(productId, delta);

  const pAfter = findProductById(productId);
  const after = roundQty(pAfter.stock);

  const move = {
    id: uid("mv"),
    createdAt: nowISO(),
    type, // IN | OUT | ADJ
    productId,
    productName: pBefore.name,
    qty: q,
    stockBefore: before,
    stockAfter: after,
    unitCost: num(unitCost),
    note: String(note || "").trim(),
    refType: String(refType || "").trim(),
    refId: String(refId || "").trim()
  };

  addStockMove(move);
  return move;
}

function recordStockDelta({ productId, delta, note = "", refType = "ADJUST", refId = "" }){
  const pBefore = findProductById(productId);
  if(!pBefore) throw new Error("Producto no encontrado");

  const d = roundQty(delta);
  if(d === 0) throw new Error("Delta inválido (no puede ser 0)");

  const before = roundQty(pBefore.stock);
  adjustStock(productId, d);

  const pAfter = findProductById(productId);
  const after = roundQty(pAfter.stock);

  const move = {
    id: uid("mv"),
    createdAt: nowISO(),
    type: "ADJ",
    productId,
    productName: pBefore.name,
    qty: roundQty(Math.abs(d)),
    delta: d,
    stockBefore: before,
    stockAfter: after,
    unitCost: 0,
    note: String(note || "").trim(),
    refType: String(refType || "").trim(),
    refId: String(refId || "").trim()
  };

  addStockMove(move);
  return move;
}

function recordStockSet({ productId, newStock, note = "", refType = "INVENTORY", refId = "" }){
  const pBefore = findProductById(productId);
  if(!pBefore) throw new Error("Producto no encontrado");

  const target = roundQty(newStock);
  if(target < 0) throw new Error("Stock inválido (no puede ser negativo)");

  const before = roundQty(pBefore.stock);
  const delta = roundQty(target - before);
  if(delta === 0) throw new Error("No hay diferencia (stock ya coincide)");

  return recordStockDelta({
    productId,
    delta,
    note: `Ajuste por inventario. ${note || ""}`.trim(),
    refType,
    refId
  });
}

/* =========================================================
   Stock Entries
========================================================= */
function getStockEntries(){ return loadJSON(LS_KEYS.STOCK_ENTRIES, []); }
function addStockEntry(entry){
  const list = getStockEntries();
  list.unshift(entry);
  saveJSON(LS_KEYS.STOCK_ENTRIES, list);
}
function registerStockEntry({ productId, qty, unitCost, supplier, note }){
  const p = findProductById(productId);
  if(!p) throw new Error("Producto no encontrado");

  const q = roundQty(qty);
  if(q <= 0) throw new Error("Cantidad inválida");

  recordStockMove({
    type: "IN",
    productId,
    qty: q,
    unitCost: unitCost,
    note: (supplier ? `Proveedor: ${supplier}. ` : "") + (note || "Entrada de mercadería"),
    refType: "ENTRY",
    refId: ""
  });

  const uc = num(unitCost);
  if(uc > 0){
    const updated = findProductById(productId);
    updated.cost = uc;
    upsertProduct(updated);
  }

  const entry = {
    id: uid("in"),
    createdAt: nowISO(),
    productId,
    productName: p.name,
    qty: q,
    unitCost: num(unitCost),
    supplier: String(supplier || "").trim(),
    note: String(note || "").trim()
  };

  addStockEntry(entry);
  return entry;
}

/* =========================================================
   Price Changes
========================================================= */
function getPriceChanges(){ return loadJSON(LS_KEYS.PRICE_CHANGES, []); }
function addPriceChange(change){
  const list = getPriceChanges();
  list.unshift(change);
  saveJSON(LS_KEYS.PRICE_CHANGES, list);
}
function roundPrice(value, rounding){
  const v = num(value);
  if(!rounding || rounding === "NONE") return v;
  const step = num(rounding);
  if(step <= 0) return v;
  return Math.round(v / step) * step;
}
function applyPriceIncrease({ scope, category, percent, rounding }){
  const pct = num(percent);
  if(!Number.isFinite(pct) || pct === 0) throw new Error("Porcentaje inválido (no puede ser 0)");

  const list = getProducts();
  const cat = String(category || "").trim().toLowerCase();
  if(scope !== "ALL" && !cat) throw new Error("Elegí una categoría válida");

  const target = list
    .filter(p => p.active !== false)
    .filter(p => scope === "ALL" ? true : (p.category || "").toLowerCase().includes(cat));

  if(!target.length) throw new Error("No hay productos para aplicar el aumento");

  const items = [];
  const factor = 1 + (pct / 100);

  target.forEach(p => {
    const oldPrice = num(p.price);
    let newPrice = oldPrice * factor;
    newPrice = roundPrice(newPrice, rounding);
    newPrice = Math.max(0, Math.round(newPrice));
    if(newPrice !== oldPrice){
      p.price = newPrice;
      items.push({ productId: p.id, name: p.name, oldPrice, newPrice });
    }
  });

  setProducts(list);

  const change = {
    id: uid("pc"),
    createdAt: nowISO(),
    scope: scope === "ALL" ? "ALL" : "CATEGORY",
    category: scope === "ALL" ? "" : category,
    percent: pct,
    rounding: rounding || "NONE",
    count: items.length,
    items
  };

  addPriceChange(change);
  return change;
}

/* =========================================================
   CASH SESSIONS (PRO)
========================================================= */
function _cashStateDefault(){
  return { version: 2, currentSessionId: null, sessions: [] };
}

function _isLegacyCashShape(obj){
  return obj && typeof obj === "object" && typeof obj.open === "boolean" && "totals" in obj;
}

function _migrateCashIfNeeded(){
  const raw = localStorage.getItem(LS_KEYS.CASH);
  if(!raw) return;

  let parsed = null;
  try{ parsed = JSON.parse(raw); }catch{ return; }

  if(parsed && parsed.version === 2 && Array.isArray(parsed.sessions)) return;

  if(_isLegacyCashShape(parsed)){
    const legacy = parsed;
    const state = _cashStateDefault();

    const sessionId = uid("cs");
    const session = {
      id: sessionId,
      open: !!legacy.open,
      openedAt: legacy.openedAt || null,
      openingAmount: num(legacy.openingAmount),
      closedAt: legacy.closedAt || null,
      totals: legacy.totals || { cash:0, mp:0, dni:0, card:0 },
      salesIds: legacy.salesIds || []
    };

    state.sessions = [session];
    state.currentSessionId = sessionId;

    saveJSON(LS_KEYS.CASH, state);
  }
}

function getCashState(){
  _migrateCashIfNeeded();
  return loadJSON(LS_KEYS.CASH, _cashStateDefault());
}

function setCashState(state){
  saveJSON(LS_KEYS.CASH, state);
}

function getCashSessionById(id){
  const st = getCashState();
  return st.sessions.find(s => s.id === id) || null;
}

function getCurrentCashSession(){
  const st = getCashState();
  if(!st.currentSessionId) return null;
  return st.sessions.find(s => s.id === st.currentSessionId) || null;
}

function listCashSessions(){
  const st = getCashState();
  return Array.isArray(st.sessions) ? st.sessions : [];
}

// Compat
function getCash(){
  const s = getCurrentCashSession();
  if(s) return s;
  return {
    open: false,
    openedAt: null,
    openingAmount: 0,
    closedAt: null,
    totals: { cash:0, mp:0, dni:0, card:0 },
    salesIds: []
  };
}

/* ===== setCash (blindado) — trabaja sobre st ===== */
function setCash(cashLike){
  const st = getCashState();
  const cur = (st.currentSessionId)
    ? st.sessions.find(s => s.id === st.currentSessionId)
    : null;

  if(!cur){
    throw new Error("No hay sesión de caja. Usá openCash(openingAmount) para crear/abrir la caja.");
  }

  const patch = Object.assign({}, cashLike || {});

  // Nunca permitir reabrir o "des-cerrar"
  if(Object.prototype.hasOwnProperty.call(patch, "open") && patch.open === true && cur.open !== true){
    throw new Error("setCash() no puede abrir la caja. Usá openCash(openingAmount).");
  }
  if(Object.prototype.hasOwnProperty.call(patch, "closedAt") && patch.closedAt == null && cur.closedAt != null){
    throw new Error("setCash() no puede borrar closedAt de una sesión cerrada.");
  }

  // Whitelist de campos seguros
  const allowed = { totals:1, salesIds:1, openingAmount:1, openedAt:1 };
  Object.keys(patch).forEach(k => { if(!allowed[k]) delete patch[k]; });

  Object.assign(cur, patch);
  setCashState(st);
}

/* ===== openCash (definido y exportable) ===== */
function openCash(openingAmount){
  const st = getCashState();
  const cur = (st.currentSessionId)
    ? st.sessions.find(s => s.id === st.currentSessionId)
    : null;

  if(cur && cur.open) throw new Error("La caja ya está abierta");

  const id = uid("cs");
  const session = {
    id,
    open: true,
    openedAt: nowISO(),
    openingAmount: num(openingAmount),
    closedAt: null,
    totals: { cash:0, mp:0, dni:0, card:0 },
    salesIds: []
  };

  st.sessions.unshift(session);
  st.currentSessionId = id;
  setCashState(st);

  return session;
}

/* ===== closeCash (robusto) ===== */
function closeCash(){
  const st = getCashState();

  const id = st.currentSessionId;
  if(!id) throw new Error("No hay sesión de caja");

  const cur = st.sessions.find(s => s.id === id);
  if(!cur) throw new Error("Sesión actual no encontrada");
  if(!cur.open) throw new Error("La caja ya está cerrada");

  cur.open = false;
  cur.closedAt = nowISO();

  setCashState(st);
  return cur;
}

/* =========================================================
   Sales
========================================================= */
function getSales(){ return loadJSON(LS_KEYS.SALES, []); }

function _trimCashSalesIdsToExisting(st, keptSales){
  const keep = new Set((keptSales || []).map(x => x.id));
  (st.sessions || []).forEach(sess => {
    if(!Array.isArray(sess.salesIds)) return;
    sess.salesIds = sess.salesIds.filter(id => keep.has(id));
  });
}

function addSale(sale){
  const st = getCashState();
  const cur = (st.currentSessionId)
    ? st.sessions.find(s => s.id === st.currentSessionId)
    : null;

  const s = Object.assign({}, sale);

  if(cur && cur.open){
    s.cashSessionId = cur.id;

    const p = s.payments || {};
    cur.totals.cash = num(cur.totals.cash) + num(p.cash);
    cur.totals.mp   = num(cur.totals.mp)   + num(p.mp);
    cur.totals.dni  = num(cur.totals.dni)  + num(p.dni);
    cur.totals.card = num(cur.totals.card) + num(p.card);

    const prev = Array.isArray(cur.salesIds) ? cur.salesIds : [];
    if(prev.indexOf(s.id) === -1) prev.push(s.id);
    cur.salesIds = prev;

    setCashState(st);
  }else{
    s.cashSessionId = s.cashSessionId || null;
  }

  const sales = getSales();
  sales.unshift(s);

  // ✅ AUTO-RECORTE (newest-first)
  if(sales.length > MAX_SALES){
    sales.length = MAX_SALES;
    _trimCashSalesIdsToExisting(st, sales);
    setCashState(st);
  }

  saveJSON(LS_KEYS.SALES, sales);
}

function findSaleById(id){
  return getSales().find(s => s.id === id) || null;
}

function updateSale(updatedSale){
  const sales = getSales();
  const idx = sales.findIndex(s => s.id === updatedSale.id);
  if(idx < 0) throw new Error("Venta no encontrada");
  sales[idx] = updatedSale;
  saveJSON(LS_KEYS.SALES, sales);
  return updatedSale;
}

function _sumPayments(payments){
  const p = payments || {};
  return {
    cash: num(p.cash),
    mp: num(p.mp),
    dni: num(p.dni),
    card: num(p.card)
  };
}

function voidSale({ saleId, reason = "Anulación", note = "" } = {}){
  const r = requireRole(PERMS.seller_admin_owner);
  if(!r.ok) throw new Error("Sin permiso para anular ventas");

  const sale = findSaleById(saleId);
  if(!sale) throw new Error("Venta no encontrada");
  if(sale.voided) throw new Error("La venta ya está anulada");

  const msg = `${String(reason || "Anulación").trim()}. ${String(note || "").trim()}`.trim();

  (sale.items || []).forEach(it => {
    const productId = it.productId;
    const qty = roundQty(it.qty);
    if(!productId || qty <= 0) return;

    recordStockMove({
      type: "IN",
      productId,
      qty,
      unitCost: 0,
      note: `Anulación venta ${sale.id}. ${msg}`.trim(),
      refType: "VOID",
      refId: sale.id
    });
  });

  const st = getCashState();
  const sessionId = sale.cashSessionId;
  const session = sessionId ? st.sessions.find(x => x.id === sessionId) : null;

  let adjusted = false;

  if(session){
    const pay = _sumPayments(sale.payments);

    session.totals.cash = Math.max(0, num(session.totals.cash) - pay.cash);
    session.totals.mp   = Math.max(0, num(session.totals.mp)   - pay.mp);
    session.totals.dni  = Math.max(0, num(session.totals.dni)  - pay.dni);
    session.totals.card = Math.max(0, num(session.totals.card) - pay.card);

    session.salesIds = (session.salesIds || []).filter(x => x !== sale.id);
    setCashState(st);
    adjusted = true;
  }

  const updated = Object.assign({}, sale, {
    voided: true,
    voidedAt: nowISO(),
    voidReason: String(reason || "").trim(),
    voidNote: String(note || "").trim(),
    voidCashAdjusted: adjusted,
    voidedBy: r.me && r.me.name ? r.me.name : "",
    voidedRole: r.me && r.me.role ? r.me.role : ""
  });

  updateSale(updated);
  return updated;
}

/* =========================================================
   Seed demo (productos de prueba)
========================================================= */
function ensureSeed(){
  const existing = getProducts();
  if(existing.length) return;

  const demo = [
    {
      id: uid("prod"),
      name: "Azúcar (1 kg)",
      barcode: "7790001112223",
      category: "Almacén",
      cost: 700,
      price: 1200,
      stock: 20,
      minStock: 5,
      active: true
    },
    {
      id: uid("prod"),
      name: "Queso cremoso (kg)",
      barcode: "2000000000012",
      category: "Fiambrería",
      cost: 4500,
      price: 7900,
      stock: 8.500,
      minStock: 1.000,
      active: true
    },
    {
      id: uid("prod"),
      name: "Coca-Cola 2.25L",
      barcode: "7790895061114",
      category: "Bebidas",
      cost: 1600,
      price: 2600,
      stock: 24,
      minStock: 6,
      active: true
    }
  ];
  setProducts(demo);
}

/* =========================================================
   AUTH (PIN + Roles)
========================================================= */
function getUsers(){ return loadJSON(LS_KEYS.AUTH_USERS, []); }
function setUsers(list){ saveJSON(LS_KEYS.AUTH_USERS, list); }
function getSession(){ return loadJSON(LS_KEYS.AUTH_SESSION, null); }
function setSession(session){ saveJSON(LS_KEYS.AUTH_SESSION, session); }
function clearSession(){ localStorage.removeItem(LS_KEYS.AUTH_SESSION); }

function pinHash(pin){
  const s = String(pin || "").trim();
  let h = 0;
  for(let i=0;i<s.length;i++){
    h = (h * 31 + s.charCodeAt(i)) >>> 0;
  }
  return "h" + h.toString(16);
}

function isStrongPin(pin){
  const s = String(pin ?? "").trim();
  if(!/^\d+$/.test(s)) return { ok:false, message:"PIN debe ser numérico" };
  if(s.length < 4) return { ok:false, message:"PIN muy corto (mínimo 4)" };
  if(s.length > 8) return { ok:false, message:"PIN muy largo (máximo 8)" };
  const weak = new Set(["0000","1111","2222","3333","4444","5555","6666","7777","8888","9999","1234"]);
  if(weak.has(s)) return { ok:false, message:"PIN muy común. Elegí otro." };
  return { ok:true };
}

function defaultUsers(){
  const ownerPin  = "9999";
  const adminPin  = "1234";
  const sellerPin = "0000";

  return [
    { id: uid("u"), name: "Dueño",    role: "owner",  pin: pinHash(ownerPin),  active: true },
    { id: uid("u"), name: "Admin",    role: "admin",  pin: pinHash(adminPin),  active: true },
    { id: uid("u"), name: "Vendedor", role: "seller", pin: pinHash(sellerPin), active: true },
  ];
}

function ensureAuthSeed(){
  const users = getUsers();
  if(users.length) return;
  setUsers(defaultUsers());
}

function resetUsersToDefault(){
  const r = requireRole(PERMS.owner_only);
  if(!r.ok) throw new Error("Sin permiso para resetear usuarios");
  setUsers(defaultUsers());
  clearSession();
  return true;
}

function updateUserPin(userId, newPin){
  const r = requireRole(PERMS.owner_only);
  if(!r.ok) throw new Error("Sin permiso para cambiar PIN");

  const v = isStrongPin(newPin);
  if(!v.ok) throw new Error(v.message);

  const users = getUsers();
  const u = users.find(x => x.id === userId);
  if(!u) throw new Error("Usuario no encontrado");

  u.pin = pinHash(newPin);
  setUsers(users);
  return true;
}

function toggleUserActive(userId){
  const r = requireRole(PERMS.owner_only);
  if(!r.ok) throw new Error("Sin permiso para activar/desactivar");

  const users = getUsers();
  const u = users.find(x => x.id === userId);
  if(!u) throw new Error("Usuario no encontrado");
  if(u.role === "owner") throw new Error("No podés desactivar al Dueño");

  u.active = !(u.active !== false);
  setUsers(users);
  return u.active;
}

function loginWithPin(pin){
  ensureAuthSeed();
  const h = pinHash(pin);
  const user = getUsers().find(u => u.active !== false && u.pin === h);
  if(!user) return { ok:false, message:"PIN incorrecto" };

  const session = { userId: user.id, name: user.name, role: user.role, loggedAt: nowISO() };
  setSession(session);
  return { ok:true, session };
}

function logout(){ clearSession(); }

function getMe(){
  const s = getSession();
  if(!s) return null;
  const u = getUsers().find(x => x.id === s.userId && x.active !== false);
  if(!u) return null;
  return { id: u.id, name: u.name, role: u.role };
}

const PERMS = {
  owner_only: ["owner"],
  admin_or_owner: ["admin","owner"],
  seller_admin_owner: ["seller","admin","owner"],
};

function requireRole(allowedRoles){
  ensureAuthSeed();
  const me = getMe();
  if(!me) return { ok:false, reason:"no_session" };
  if(!allowedRoles.includes(me.role)) return { ok:false, reason:"no_perm", me };
  return { ok:true, me };
}

function guardPage(allowedRoles){
  const r = requireRole(allowedRoles);
  if(!r.ok){
    const next = encodeURIComponent(location.pathname.split("/").pop() || "index.html");
    location.replace(`./login.html?next=${next}`);
  }
  return r;
}

/* ================= LICENSE (DEMO -> FULL) ================= */
const LICENSE = {
  KEY: "almacen_license_v1",
  SECRET: "NF-ALMACEN-2026"
};
function _b64(str){ return btoa(unescape(encodeURIComponent(str))); }
function _ub64(str){ return decodeURIComponent(escape(atob(str))); }

function buildLicenseToken({ customer = "cliente", date = "" } = {}){
  const payload = `${LICENSE.SECRET}|${String(customer).trim()}|${String(date).trim()}`;
  return _b64(payload);
}
function activateLicense(token){
  try{
    const decoded = _ub64(String(token || "").trim());
    const parts = decoded.split("|");
    if(parts.length < 3) return { ok:false, message:"Token inválido" };
    if(parts[0] !== LICENSE.SECRET) return { ok:false, message:"Token inválido" };

    const licenseData = {
      token: String(token).trim(),
      customer: parts[1],
      date: parts[2],
      activatedAt: nowISO(),
      status: "FULL"
    };

    localStorage.setItem(LICENSE.KEY, JSON.stringify(licenseData));
    return { ok:true, license: licenseData };
  }catch{
    return { ok:false, message:"Token inválido" };
  }
}
function getLicense(){
  try{ return JSON.parse(localStorage.getItem(LICENSE.KEY) || "null"); }
  catch{ return null; }
}
function isLicensed(){
  const lic = getLicense();
  return !!(lic && lic.status === "FULL" && lic.token);
}

/* =========================================================
   Public API
========================================================= */
window.App = {
  // utils
  money, num, roundQty, uid, toast, nowISO,

  // seed
  ensureSeed,

  // products
  getProducts, setProducts, searchProductsByName, findProductById, findProductByBarcode,
  upsertProduct, deleteProduct,

  // cash sessions (new)
  getCashState, setCashState, listCashSessions, getCashSessionById, getCurrentCashSession,

  // cash compat + actions
  getCash, setCash, openCash, closeCash,

  // sales
  getSales, addSale, findSaleById, updateSale, voidSale,

  // stock
  adjustStock,
  getStockMoves, recordStockMove, recordStockDelta, recordStockSet,

  // entradas
  getStockEntries, registerStockEntry,

  // precios
  getPriceChanges, applyPriceIncrease,

  // auth
  ensureAuthSeed,
  getUsers, setUsers,
  updateUserPin, toggleUserActive, resetUsersToDefault,
  isStrongPin,
  loginWithPin, logout, getMe, guardPage, PERMS,

  // license
  getLicense,
  isLicensed,
  activateLicense,
  buildLicenseToken,
};