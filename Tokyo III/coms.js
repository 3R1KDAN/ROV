// ---- Configuración ----
const SEND_HZ = 20;          // 20 mensajes/s: fluido sin saturar al ESP32
const RECONNECT_MS = 2000;
const PING_MS = 1000;

const $ = id => document.getElementById(id);
const keys = new Set();
let ws = null, wantConn = false, seq = 0;
let gripperClosed = false, estop = false;
let lastRx = 0, rtt = null, retryTimer = null;

// Guardar direcciones entre sesiones (si el navegador lo permite)
try {
    const s = JSON.parse(localStorage.getItem('robotCfg') || '{}');
    for (const k of ['ws', 'c1', 'c2']) if (s[k]) $(k).value = s[k];
} catch (e) { }
const saveCfg = () => { try { localStorage.setItem('robotCfg', JSON.stringify({ ws: $('ws').value, c1: $('c1').value, c2: $('c2').value })); } catch (e) { } };

function log(msg) {
    const d = $('log'), t = new Date().toLocaleTimeString();
    d.insertAdjacentHTML('beforeend', `<div>${t}  ${msg}</div>`);
    while (d.children.length > 60) d.removeChild(d.firstChild);
    d.scrollTop = d.scrollHeight;
}
function pill(text, cls) { const p = $('pConn'); p.textContent = text; p.className = 'pill ' + cls; }

// ---- Cámaras (etiqueta img con stream por IP) ----
function startCam(n) {
    const url = $('c' + n).value.trim(), img = $('i' + n), off = $('o' + n);
    if (!url) { img.removeAttribute('src'); off.classList.remove('hide'); return; }
    img.onload = () => off.classList.add('hide');
    img.onerror = () => { off.classList.remove('hide'); setTimeout(() => { if (wantConn) img.src = url; }, 3000); };
    img.src = url;
}

// ---- WebSocket ----
function connect() {
    saveCfg(); wantConn = true;
    clearTimeout(retryTimer);
    if (ws) { ws.onclose = null; ws.close(); }
    pill('Conectando…', 'warn');
    try { ws = new WebSocket($('ws').value.trim()); } catch (e) { log('Dirección inválida'); return; }
    ws.onopen = () => { pill('Conectado', 'ok'); log('WebSocket conectado'); };
    ws.onclose = () => {
        pill('Desconectado', 'bad'); rtt = null;
        if (wantConn) { log('Conexión perdida, reintentando…'); retryTimer = setTimeout(connect, RECONNECT_MS); }
    };
    ws.onerror = () => { };
    ws.onmessage = e => {
        lastRx = Date.now();
        let m; try { m = JSON.parse(e.data); } catch (_) { return; }
        if (m.t === 'pong') rtt = Date.now() - m.ts;
        else if (m.t === 'tel') showTel(m);
    };
    startCam(1); startCam(2);
}
const send = o => {
    if (ws && ws.readyState === WebSocket.OPEN) {
        const message = JSON.stringify(o);
        console.log('[WebSocket → ESP32]', message);
        ws.send(message);
    }
};

// ---- Entradas de teclado ----
const axis = (neg, pos) => (keys.has(pos) ? 1 : 0) - (keys.has(neg) ? 1 : 0);
const typing = () => /INPUT|TEXTAREA/.test(document.activeElement.tagName);

addEventListener('keydown', e => {
    if (typing()) return;
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
    if (e.repeat) return;
    if (e.code === 'Space') return toggleEstop();
    if (e.code === 'KeyZ') { gripperClosed = !gripperClosed; $('gripCmd').textContent = gripperClosed ? 'cerrada' : 'abierta'; log('Pinza: ' + (gripperClosed ? 'cerrar' : 'abrir')); }
    keys.add(e.code); paintKeys();
});
addEventListener('keyup', e => { keys.delete(e.code); paintKeys(); });
// Si la pestaña pierde el foco, se sueltan todas las teclas (el robot recibe 0)
function releaseAll() { if (keys.size) { keys.clear(); paintKeys(); } }
addEventListener('blur', releaseAll);
document.addEventListener('visibilitychange', () => { if (document.hidden) releaseAll(); });

function paintKeys() { document.querySelectorAll('.k[data-c]').forEach(k => k.classList.toggle('on', keys.has(k.dataset.c))); }

function toggleEstop() {
    estop = !estop;
    const b = $('estop'); b.classList.toggle('latched', estop);
    b.textContent = estop ? 'PARO ACTIVO · liberar' : 'PARO (Espacio)';
    log(estop ? 'PARO DE EMERGENCIA activado' : 'Paro liberado');
}
$('estop').onclick = toggleEstop;
$('go').onclick = connect;

for (const id of ['armVelocity', 'motVelocity']) {
    $(id).addEventListener('input', () => {
        console.log(`[PWM] ${id} = ${$(id).value}`);
    });
}

// ---- Envío periódico (también funciona como heartbeat) ----
setInterval(() => {
    const x = estop ? 0 : axis('KeyA', 'KeyD'), y = estop ? 0 : axis('KeyS', 'KeyW');
    const a1 = estop ? 0 : axis('ArrowDown', 'ArrowUp'), a2 = estop ? 0 : axis('ArrowLeft', 'ArrowRight');
    $('cmdD').textContent = y + ' / ' + x; $('cmdA').textContent = a1 + ' / ' + a2;
    send({
        t: 'cmd',
        seq: ++seq,
        drive: { x, y },
        arm: { a1, a2 },
        armVelocity: Number($('armVelocity').value),
        motVelocity: Number($('motVelocity').value),
        gripper: gripperClosed ? 1 : 0,
        estop
    });
}, 1000 / SEND_HZ);

setInterval(() => send({ t: 'ping', ts: Date.now() }), PING_MS);

// ---- Telemetría ----
const fmt = (v, u, d = 1) => (v === undefined || v === null) ? '—' : Number(v).toFixed(d) + ' ' + u;
function showTel(m) {
    $('rssi').textContent = fmt(m.rssi, 'dBm', 0);
    $('bat').textContent = fmt(m.bat, 'V', 2);
    $('bat').style.color = m.low ? 'var(--bad)' : '';
    $('cur').textContent = fmt(m.cur, 'A', 2);
    $('mode').textContent = m.mode ?? '—';
    $('a1').textContent = fmt(m.a1, '°', 0);
    $('a2').textContent = fmt(m.a2, '°', 0);
    $('grip').textContent = m.grip ?? '—';
}
setInterval(() => {
    $('lat').textContent = rtt === null ? '—' : rtt + ' ms';
    const age = lastRx ? Date.now() - lastRx : null;
    const rx = $('rx'); rx.textContent = age === null ? '—' : age + ' ms';
    rx.style.color = age !== null && age > 500 ? 'var(--bad)' : '';
}, 250);

