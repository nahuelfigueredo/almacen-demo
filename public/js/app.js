



/* =========================================================
   ALMACEN APP — app.js (MVP Offline)
   LocalStorage + POS + Stock + Caja diaria + Auth (PIN)
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
  // 3 decimales (kg/litro)
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
function getProducts(){
  return loadJSON(LS_KEYS.PRODUCTS, []);
}
function setProducts(list){
  saveJSON(LS_KEYS.PRODUCTS, list);
}
function findProductById(id){
  return getProducts().find(p => p.id === id) || null;
}
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
   Stock (simple adjust)
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
function getStockMoves(){
  return loadJSON(LS_KEYS.STOCK_MOVES, []);
}
function addStockMove(move){
  const list = getStockMoves();
  list.unshift(move);
  saveJSON(LS_KEYS.STOCK_MOVES, list);
}

// IN/OUT aplica stock; ADJ se usa desde recordStockDelta/Set
function recordStockMove({ type, productId, qty, unitCost = 0, note = "", refType = "", refId = "" }){
  const pBefore = findProductById(productId);
  if(!pBefore) throw new Error("Producto no encontrado");

  const q = roundQty(qty);
  if(q <= 0) throw new Error("Cantidad inválida");

  const before = roundQty(pBefore.stock);

  const delta = (type === "OUT") ? -q : q; // IN suma, OUT resta
  adjustStock(productId, delta);

  const pAfter = findProductById(productId);
  const after = roundQty(pAfter.stock);

  const move = {
    id: uid("mv"),
    createdAt: nowISO(),
    type, // IN | OUT
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

/* ========= Ajustes (ADJ) ========= */
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
    delta: d, // signed
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
   Domain: Stock Entries (Entradas)
========================================================= */
function getStockEntries(){
  return loadJSON(LS_KEYS.STOCK_ENTRIES, []);
}
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

  // Kardex IN + stock
  recordStockMove({
    type: "IN",
    productId,
    qty: q,
    unitCost: unitCost,
    note: (supplier ? `Proveedor: ${supplier}. ` : "") + (note || "Entrada de mercadería"),
    refType: "ENTRY",
    refId: ""
  });

  // actualiza costo si vino > 0
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
   Domain: Price Changes (Aumentos)
========================================================= */
function getPriceChanges(){
  return loadJSON(LS_KEYS.PRICE_CHANGES, []);
}
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
    newPrice = Math.max(0, Math.round(newPrice)); // precio entero ARS (simple)
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
   Domain: Cash & Sales
========================================================= */
function getCash(){
  return loadJSON(LS_KEYS.CASH, {
    open: false,
    openedAt: null,
    openingAmount: 0,
    closedAt: null,
    totals: { cash:0, mp:0, dni:0, card:0 },
    salesIds: []
  });
}
function setCash(cash){
  saveJSON(LS_KEYS.CASH, cash);
}

function openCash(openingAmount){
  const cash = getCash();
  if(cash.open) throw new Error("La caja ya está abierta");
  const next = {
    open: true,
    openedAt: nowISO(),
    openingAmount: num(openingAmount),
    closedAt: null,
    totals: { cash:0, mp:0, dni:0, card:0 },
    salesIds: []
  };
  setCash(next);
  return next;
}

function closeCash(){
  const cash = getCash();
  if(!cash.open) throw new Error("La caja ya está cerrada");
  cash.open = false;
  cash.closedAt = nowISO();
  setCash(cash);
  return cash;
}

function getSales(){
  return loadJSON(LS_KEYS.SALES, []);
}
function addSale(sale){
  const sales = getSales();
  sales.unshift(sale);
  saveJSON(LS_KEYS.SALES, sales);
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
   Roles: owner | admin | seller
========================================================= */
function getUsers(){
  return loadJSON(LS_KEYS.AUTH_USERS, []);
}
function setUsers(list){
  saveJSON(LS_KEYS.AUTH_USERS, list);
}
function getSession(){
  return loadJSON(LS_KEYS.AUTH_SESSION, null);
}
function setSession(session){
  saveJSON(LS_KEYS.AUTH_SESSION, session);
}
function clearSession(){
  localStorage.removeItem(LS_KEYS.AUTH_SESSION);
}

// hash simple (no criptográfico) para no guardar PIN plano
function pinHash(pin){
  const s = String(pin || "").trim();
  let h = 0;
  for(let i=0;i<s.length;i++){
    h = (h * 31 + s.charCodeAt(i)) >>> 0;
  }
  return "h" + h.toString(16);
}

// crea usuarios default si no existen
function ensureAuthSeed(){
  const users = getUsers();
  if(users.length) return;

  // ✅ Cambiá estos PINs antes de entregar
  const ownerPin  = "9999";
  const adminPin  = "1234";
  const sellerPin = "0000";

  setUsers([
    { id: uid("u"), name: "Dueño",    role: "owner",  pin: pinHash(ownerPin),  active: true },
    { id: uid("u"), name: "Admin",    role: "admin",  pin: pinHash(adminPin),  active: true },
    { id: uid("u"), name: "Vendedor", role: "seller", pin: pinHash(sellerPin), active: true },
  ]);
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

function logout(){
  clearSession();
}

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

// redirige a login si no tiene sesión o permiso
function guardPage(allowedRoles){
  const r = requireRole(allowedRoles);
  if(!r.ok){
    const next = encodeURIComponent(location.pathname.split("/").pop() || "index.html");
    location.replace(`./login.html?next=${next}`);
  }
  return r;
}

/* ================= LICENSE (DEMO -> FULL) =================
- Guarda licencia en localStorage
- Sin backend (MVP)
=========================================================== */
const LICENSE = {
  KEY: "almacen_license_v1",
  // Cambiá este secreto por uno tuyo (no lo compartas)
  SECRET: "NF-ALMACEN-2026"
};

// token muy simple: BASE64("SECRET|cliente|YYYY-MM-DD")
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
  try{
    return JSON.parse(localStorage.getItem(LICENSE.KEY) || "null");
  }catch{
    return null;
  }
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

  // cash & sales
  getCash, setCash, openCash, closeCash,
  getSales, addSale,

  // stock
  adjustStock,
  getStockMoves, recordStockMove, recordStockDelta, recordStockSet,

  // entradas
  getStockEntries, registerStockEntry,

  // precios
  getPriceChanges, applyPriceIncrease,

  // auth
  ensureAuthSeed, loginWithPin, logout, getMe, guardPage, PERMS,


// license
  getLicense,
  isLicensed,
  activateLicense,
  buildLicenseToken,
};


