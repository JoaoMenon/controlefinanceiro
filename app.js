// ===== Configuração: cole aqui os dados do seu projeto Supabase (Project Settings > API) =====
const SUPABASE_URL = 'https://scegjtumfbhexdgogvoq.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNjZWdqdHVtZmJoZXhkZ29ndm9xIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTMzODA2MTksImV4cCI6MjEwODk1NjYxOX0.qhH1n_zpbijL8Dk9oBH6m2-MAXrmUMNJZ4Co70Sem_E';
// ===========================================================================================

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const $ = id => document.getElementById(id);
const brl = v => Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const pad = n => String(n).padStart(2, '0');
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const PAY = { card: 'Cartão', pix: 'Pix', cash: 'Dinheiro', other: 'Outro' };
const DEFAULT_CATS = ['Mercado', 'Moradia', 'Transporte', 'Lazer', 'Saúde', 'Educação', 'Restaurantes', 'Assinaturas', 'Salário', 'Outros'];

let month = new Date(); month.setDate(1);
let cats = [], txs = [], userId = undefined, editing = null;

// Soma n meses a uma data 'YYYY-MM-DD', respeitando o último dia do mês (31/01 + 1 = 28/02)
function addMonths(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const last = new Date(y, m + n, 0).getDate();
  return iso(new Date(y, m - 1 + n, Math.min(d, last)));
}

// ---------- Login ----------
$('loginForm').onsubmit = async e => {
  e.preventDefault();
  const { error } = await sb.auth.signInWithPassword({ email: $('email').value, password: $('password').value });
  $('loginError').textContent = error ? 'E-mail ou senha incorretos.' : '';
};
$('logout').onclick = () => sb.auth.signOut();

sb.auth.onAuthStateChange((_event, session) => {
  setTimeout(async () => {
    const id = session?.user?.id ?? null;
    if (id === userId) return;            // evita recarregar ao voltar para a aba
    userId = id;
    $('login').hidden = !!id;
    $('app').hidden = !id;
    if (id) { await loadCats(); await loadTxs(); }
  }, 0);
});

// ---------- Dados ----------
async function loadCats() {
  let { data } = await sb.from('categories').select('*').order('name');
  if (!data.length) {                      // primeiro acesso: cria as categorias padrão
    await sb.from('categories').upsert(DEFAULT_CATS.map(name => ({ name })), { onConflict: 'user_id,name', ignoreDuplicates: true });
    ({ data } = await sb.from('categories').select('*').order('name'));
  }
  cats = data;
  $('category').innerHTML = '<option value="">Sem categoria</option>' + cats.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
}

async function loadTxs() {
  const from = iso(month);
  const to = iso(new Date(month.getFullYear(), month.getMonth() + 1, 1));
  const { data, error } = await sb.from('transactions').select('*').gte('date', from).lt('date', to).order('date', { ascending: false });
  if (error) { alert('Erro ao carregar: ' + error.message); return; }
  txs = data;
  render();
}

// ---------- Tela ----------
function render() {
  $('monthLabel').textContent = month.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  const sum = t => txs.filter(x => x.type === t).reduce((s, x) => s + Number(x.amount), 0);
  const inc = sum('income'), exp = sum('expense');
  $('income').textContent = brl(inc);
  $('expense').textContent = brl(exp);
  $('balance').textContent = brl(inc - exp);
  $('balance').className = inc - exp >= 0 ? 'pos' : 'neg';

  $('list').innerHTML = txs.length ? txs.map(t => {
    const cat = cats.find(c => c.id === t.category_id)?.name ?? 'Sem categoria';
    const parc = t.installment_total ? ` (${t.installment_no}/${t.installment_total})` : '';
    const day = t.date.split('-').reverse().slice(0, 2).join('/');
    const sign = t.type === 'income' ? '+' : '−';
    return `<li data-id="${t.id}">
      <div>${esc(t.description)}${parc}<small>${esc(cat)} · ${PAY[t.payment_method]} · ${day}</small></div>
      <span class="amt ${t.type === 'income' ? 'pos' : 'neg'}">${sign} ${brl(t.amount)}</span></li>`;
  }).join('') : '<li class="empty">Nenhum lançamento neste mês.</li>';
}

$('prev').onclick = () => { month.setMonth(month.getMonth() - 1); loadTxs(); };
$('next').onclick = () => { month.setMonth(month.getMonth() + 1); loadTxs(); };
$('list').onclick = e => {
  const li = e.target.closest('li[data-id]');
  if (li) openTx(txs.find(t => t.id === li.dataset.id));
};

// ---------- Lançamento (novo / editar) ----------
function openTx(t = null) {
  editing = t;
  $('txTitle').textContent = t ? 'Editar lançamento' : 'Novo lançamento';
  $('type').value = t?.type ?? 'expense';
  $('amount').value = t?.amount ?? '';
  $('description').value = t?.description ?? '';
  $('category').value = t?.category_id ?? '';
  $('date').value = t?.date ?? iso(new Date());
  $('payment').value = t?.payment_method ?? 'card';
  $('repeat').value = 'once';
  $('repeatBox').hidden = !!t;     // repetição só ao criar
  $('delBtn').hidden = !t;
  updateRepeat();
  $('txDialog').showModal();
}

function updateRepeat() {
  const r = $('repeat').value;
  $('countBox').hidden = r !== 'installments';
  $('amountLabel').textContent = r === 'installments' ? 'Valor de cada parcela (R$)' : 'Valor (R$)';
}
$('repeat').onchange = updateRepeat;
$('addBtn').onclick = () => openTx();
$('cancelTx').onclick = () => $('txDialog').close();

$('txForm').onsubmit = async e => {
  e.preventDefault();
  const base = {
    type: $('type').value,
    amount: Number($('amount').value),
    description: $('description').value.trim(),
    category_id: $('category').value || null,
    payment_method: $('payment').value,
    date: $('date').value,
  };
  let error;
  if (editing) {
    ({ error } = await sb.from('transactions').update(base).eq('id', editing.id));
  } else {
    const mode = $('repeat').value;
    const n = mode === 'installments' ? Number($('count').value) : mode === 'recurring' ? 12 : 1;
    const group = n > 1 ? crypto.randomUUID() : null;
    const rows = Array.from({ length: n }, (_, i) => ({
      ...base,
      date: addMonths(base.date, i),
      group_id: group,
      installment_no: mode === 'installments' ? i + 1 : null,
      installment_total: mode === 'installments' ? n : null,
    }));
    ({ error } = await sb.from('transactions').insert(rows));
  }
  if (error) { alert('Erro ao salvar: ' + error.message); return; }
  $('txDialog').close();
  loadTxs();
};

$('delBtn').onclick = async () => {
  if (!confirm('Excluir este lançamento?')) return;
  const { error } = await sb.from('transactions').delete().eq('id', editing.id);
  if (error) { alert('Erro ao excluir: ' + error.message); return; }
  $('txDialog').close();
  loadTxs();
};

// ---------- Categorias ----------
function renderCats() {
  $('catList').innerHTML = cats.map(c =>
    `<li>${esc(c.name)} <button class="link" data-id="${c.id}">Excluir</button></li>`).join('');
}
$('catBtn').onclick = () => { renderCats(); $('catDialog').showModal(); };
$('closeCat').onclick = () => $('catDialog').close();

$('catForm').onsubmit = async e => {
  e.preventDefault();
  const { error } = await sb.from('categories').insert({ name: $('catName').value.trim() });
  if (error) { alert('Não foi possível adicionar (nome repetido?)'); return; }
  $('catName').value = '';
  await loadCats(); renderCats(); render();
};
$('catList').onclick = async e => {
  const id = e.target.dataset.id;
  if (!id || !confirm('Excluir categoria? Os lançamentos dela ficam "Sem categoria".')) return;
  await sb.from('categories').delete().eq('id', id);
  await loadCats(); renderCats(); await loadTxs();
};
