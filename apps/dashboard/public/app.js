const $ = (s) => document.querySelector(s);
let token = localStorage.getItem('escrow_token') || '';
let session = null;

const api = async (path, opts = {}) => {
  const res = await fetch(path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(opts.headers || {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body;
};

const short = (s) => (s ? `${s.slice(0, 4)}…${s.slice(-4)}` : '');
const cluster = () => (session?.rpc?.includes('devnet') ? 'devnet' : session?.rpc?.includes('127.0.0.1') ? 'custom' : 'mainnet-beta');
const addrLink = (a) => `<a class="mono" target="_blank" rel="noreferrer" href="https://explorer.solana.com/address/${a}?cluster=${cluster()}">${short(a)}</a>`;
const txLink = (s) => `https://explorer.solana.com/tx/${s}?cluster=${cluster()}`;

async function boot() {
  if (!token) return showLogin();
  try {
    session = await api('/api/session');
    showDash();
  } catch {
    token = '';
    localStorage.removeItem('escrow_token');
    showLogin();
  }
}

function showLogin() {
  $('#login').classList.remove('hidden');
  $('#dash').classList.add('hidden');
}

async function login() {
  $('#login-err').textContent = '';
  try {
    const { token: t } = await api('/api/login', { method: 'POST', body: JSON.stringify({ passcode: $('#passcode').value }) });
    token = t;
    localStorage.setItem('escrow_token', token);
    await boot();
  } catch (e) {
    $('#login-err').textContent = e.message;
  }
}

function showDash() {
  $('#login').classList.add('hidden');
  $('#dash').classList.remove('hidden');
  $('#role-badge').textContent = session.role;
  $('#role-badge').className = `badge ${session.role}`;
  $('#master').innerHTML = `master ${addrLink(session.master)}`;
  if (session.role === 'admin' && session.canCreate) $('#create-panel').classList.remove('hidden');
  refresh();
}

async function refresh() {
  const escrows = await api('/api/escrows');
  const canSettle = true; // any authenticated role may settle in this build
  $('#escrows').innerHTML = escrows.length
    ? escrows.map((e) => row(e, canSettle)).join('')
    : '<div class="empty">No escrows yet.</div>';
  document.querySelectorAll('button[data-act]').forEach((b) =>
    b.addEventListener('click', () => settle(b.dataset.id, b.dataset.act, b)),
  );
}

function row(e, canSettle) {
  const active = e.status === 'active';
  const actions = active && canSettle
    ? `<button class="mini release" data-act="release" data-id="${e.id}">Release → seller</button>
       <button class="mini refund" data-act="refund" data-id="${e.id}">Refund → buyer</button>`
    : e.signature
      ? `<a class="mono" target="_blank" rel="noreferrer" href="${txLink(e.signature)}">${short(e.signature)}</a>`
      : '';
  return `
    <div class="escrow ${e.status}">
      <div class="cell"><span class="lbl">escrow</span>${addrLink(e.escrow)}</div>
      <div class="cell"><span class="lbl">buyer</span>${addrLink(e.buyer)}</div>
      <div class="cell"><span class="lbl">seller</span>${addrLink(e.seller)}</div>
      <div class="cell"><span class="lbl">amount</span><b>${e.amount}</b></div>
      <div class="cell"><span class="lbl">status</span><span class="pill ${e.status}">${e.status}</span></div>
      <div class="cell actions">${actions}</div>
    </div>`;
}

async function settle(id, act, btn) {
  btn.disabled = true;
  btn.textContent = act === 'release' ? 'Releasing…' : 'Refunding…';
  try {
    const viaBundle = $('#via-bundle').checked;
    await api(`/api/escrows/${id}/${act}`, { method: 'POST', body: JSON.stringify({ viaBundle }) });
    await refresh();
  } catch (e) {
    alert(`${act} failed: ${e.message}`);
    btn.disabled = false;
  }
}

async function create() {
  $('#create-err').textContent = '';
  try {
    await api('/api/escrows', {
      method: 'POST',
      body: JSON.stringify({ seller: $('#c-seller').value.trim(), mint: $('#c-mint').value.trim(), amount: $('#c-amount').value.trim() }),
    });
    $('#c-seller').value = $('#c-mint').value = $('#c-amount').value = '';
    await refresh();
  } catch (e) {
    $('#create-err').textContent = e.message;
  }
}

$('#login-btn').addEventListener('click', login);
$('#passcode').addEventListener('keydown', (e) => e.key === 'Enter' && login());
$('#logout').addEventListener('click', () => { token = ''; localStorage.removeItem('escrow_token'); showLogin(); });
$('#create-btn').addEventListener('click', create);
boot();
