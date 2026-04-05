/* ── SCREEN NAVIGATION ─────────────────── */
function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const targetScreen = document.getElementById('screen-' + name);
  if (targetScreen) targetScreen.classList.add('active');
  
  document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active-link'));
  window.scrollTo(0, 0);
  
  const mainNav = document.getElementById('mainNav');
  if (mainNav) {
    mainNav.style.display = (name === 'admin' || name === 'case') ? 'none' : 'flex';
  }
  
  if (name === 'case') {
    setTimeout(() => {
      const feed = document.getElementById('caseMsgFeed');
      if (feed) feed.scrollTop = feed.scrollHeight;
    }, 100);
  }
}

/* ── OPEN CASE PAGE ─────────────────────── */
function openCase(id, name, location, avatar) {
  const elements = {
    caseIdLabel: 'حالة # ' + id + ' · مسجّلة 2026/01/15',
    caseIdBreadcrumb: 'حالة #' + id,
    caseName: name,
    caseAvatar: avatar,
    msgPeerAvatar: avatar,
    msgPeerName: name + ' — الأسرة',
    caseLocation: '📍 ' + location,
    caseSubInfo: 'مسجّلة في منطقة ' + location,
    ctaCaseName: 'ادعم ' + (name.split(' ')[1] || name.split(' ')[0]) + ' الآن',
    caseLinkUrl: 'sanaabel.ps/case/' + id,
    modalCaseRef: '#' + id + ' — ' + name
  };

  for (const [id, value] of Object.entries(elements)) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  }
  
  showScreen('case');
}

/* ── CASE PAGE MODALS ─────────────────── */
function openCaseModal(id) { 
  const modal = document.getElementById(id);
  if (modal) modal.classList.add('open'); 
}
function closeModal(id) { 
  const modal = document.getElementById(id);
  if (modal) modal.classList.remove('open'); 
}

/* ── COPY BUTTON ───────────────────────── */
function doCopy(btn) {
  var orig = btn.textContent;
  btn.textContent = '✓ نُسخ';
  btn.classList.add('copied');
  setTimeout(function() { btn.textContent = orig; btn.classList.remove('copied'); }, 2000);
}

/* ── SEND MESSAGE ─────────────────────── */
function sendCaseMsg() {
  var input = document.getElementById('caseMsgInput');
  var text  = input.value.trim();
  if (!text) return;
  var feed  = document.getElementById('caseMsgFeed');
  var ti    = document.getElementById('caseTypingInd');
  var now   = new Date();
  var time  = now.getHours() + ':' + (now.getMinutes()<10?'0':'') + now.getMinutes();
  var row   = document.createElement('div');
  row.className = 'msg-row-c mine';
  row.innerHTML = '<div class="msg-bubble-av">🙋</div><div><div class="msg-bubble"><div class="msg-text-c">' + text + '</div><div class="msg-time-c">' + time + ' <span>✓✓</span></div></div></div>';
  feed.insertBefore(row, ti);
  input.value = '';
  feed.scrollTop = feed.scrollHeight;
  ti.style.display = 'flex';
  feed.scrollTop = feed.scrollHeight;
  var replies = ['جزاكم الله خيراً على تواصلكم 🙏','الله يبارك فيكم على اهتمامكم','نعم، أنا متاحة. شكراً لسؤالكم.','بارك الله فيكم وجزاكم خير الجزاء'];
  setTimeout(function() {
    ti.style.display = 'none';
    var now2 = new Date();
    var t2   = now2.getHours() + ':' + (now2.getMinutes()<10?'0':'') + now2.getMinutes();
    var rep  = document.createElement('div');
    rep.className = 'msg-row-c';
    rep.innerHTML = '<div class="msg-bubble-av">👩</div><div><div class="msg-bubble"><div class="msg-text-c">' + replies[Math.floor(Math.random()*replies.length)] + '</div><div class="msg-time-c">' + t2 + ' <span>✓✓</span></div></div></div>';
    feed.insertBefore(rep, ti);
    feed.scrollTop = feed.scrollHeight;
  }, 2000);
}

/* ── FILE HANDLING ─────────────────────── */
function handleInlineFile(input) {
  if (!input.files.length) return;
  var preview = document.getElementById('inlineFilePreview');
  var fileName = document.getElementById('inlineFileName');
  if (fileName) fileName.textContent = input.files[0].name;
  if (preview) preview.style.display = 'flex';
}

/* ── PROOF SUBMIT ─────────────────────── */
function caseSubmitProof() {
  showCaseSuccess('✅ تم إرسال الإثبات بنجاح','تم الإرسال للأسرة والمؤسسة. ستتلقى الأسرة إشعاراً فورياً.','#PRF-'+Math.floor(1000+Math.random()*9000));
}
function caseSubmitProofModal() {
  closeModal('proofModal');
  showCaseSuccess('✅ تم إرسال الإثبات','تم الإرسال بنجاح.','#PRF-'+Math.floor(1000+Math.random()*9000));
}
function caseSubmitReport() {
  closeModal('reportModal');
  showCaseSuccess('🚩 تم استقبال البلاغ','بلاغك سري وسيعالجه فريقنا خلال 24 ساعة.','#SC-'+Math.floor(100+Math.random()*900));
}
function showCaseSuccess(title, msg, ref) {
  const t = document.getElementById('successTitle');
  const m = document.getElementById('successMsg');
  const r = document.getElementById('successRef');
  if (t) t.textContent = title;
  if (m) m.textContent = msg;
  if (r) r.textContent = ref;
  openCaseModal('successModal');
}
function caseShare(platform) {
  showCaseSuccess('🔗 تمت المشاركة','تم نسخ رابط الحالة جاهزاً للمشاركة عبر '+platform+'!','#SHARE');
}

/* ── UI HELPERS ─────────────────── */
function selectPayment(el) {
  document.querySelectorAll('.payment-option').forEach(function(p) { p.classList.remove('selected'); });
  el.classList.add('selected');
}
function switchTab(el) {
  document.querySelectorAll('.complaint-tab').forEach(function(t) { t.classList.remove('active'); });
  el.classList.add('active');
}

document.addEventListener('DOMContentLoaded', function() {
  document.querySelectorAll('.filter-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      document.querySelectorAll('.filter-btn').forEach(function(b) { b.classList.remove('active'); });
      this.classList.add('active');
    });
  });
});
