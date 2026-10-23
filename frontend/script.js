let state = {
  name:"", roll:"", semester:7, credits:124, photo:"", courses:[]
};
let cgpaRevealed = false;
let courseRowId = 0;

function showPage(name){
  document.getElementById('page-login').classList.add('hidden');
  document.getElementById('page-register').classList.add('hidden');
  document.getElementById('page-dashboard').classList.add('hidden');
  document.getElementById('page-'+name).classList.remove('hidden');
}

function defaultAvatar(){
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="#dfe2ee"/><circle cx="40" cy="30" r="14" fill="#9aa1ac"/><path d="M14 68c0-16 13-24 26-24s26 8 26 24" fill="#9aa1ac"/></svg>'
  );
}

function addCourseRow(prefill){
  courseRowId++;
  const id = 'crow'+courseRowId;
  const wrap = document.getElementById('courses-container');
  const div = document.createElement('div');
  div.className = 'course-row';
  div.id = id;
  const p = prefill || {code:'',name:'',attended:'',total:''};
  div.innerHTML = `
    <input type="text" placeholder="Course code" value="${p.code}" class="c-code">
    <input type="text" placeholder="Course name" value="${p.name}" class="c-name">
    <input type="number" placeholder="Attended" value="${p.attended}" class="c-attended">
    <input type="number" placeholder="Total" value="${p.total}" class="c-total">
    <button type="button" class="remove-course" onclick="document.getElementById('${id}').remove()">✕</button>
  `;
  wrap.appendChild(div);
}

// ---------------------------------------------------------------- API helper
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));

async function api(method, url, body, _retried){
  const res = await fetch(url, {
    method,
    credentials: 'same-origin',
    headers: body ? {'Content-Type':'application/json'} : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch(e) {}
  // access token expired -> rotate the refresh token once, then retry
  if(res.status === 401 && !_retried && !url.startsWith('/api/auth/')){
    const r = await fetch('/api/auth/refresh', {method:'POST', credentials:'same-origin'});
    if(r.ok) return api(method, url, body, true);
  }
  if(!res.ok){
    const err = new Error((data && data.error) || 'Something went wrong');
    err.status = res.status;
    err.fields = (data && data.fields) || {};
    throw err;
  }
  return data;
}

function showError(id, msg){
  const el = document.getElementById(id);
  if(!el) return;
  el.textContent = msg || '';
  el.classList.toggle('show', !!msg);
}

function setBusy(id, busy, label){
  const b = document.getElementById(id);
  if(!b) return;
  if(busy){ b.dataset.label = b.textContent; b.textContent = label; b.disabled = true; }
  else { b.textContent = b.dataset.label || b.textContent; b.disabled = false; }
}

// ---------------------------------------------------------------- photo (resized in the browser before upload)
let regPhoto = '';

function previewPhoto(e){
  const file = e.target.files[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = function(ev){
    const img = new Image();
    img.onload = function(){
      const MAX_W = 480, MAX_H = 640;
      const k = Math.min(1, MAX_W / img.width, MAX_H / img.height);
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(img.width * k));
      canvas.height = Math.max(1, Math.round(img.height * k));
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      regPhoto = canvas.toDataURL('image/jpeg', 0.85);
      document.getElementById('photo-preview').innerHTML = '<img src="' + regPhoto + '">';
    };
    img.onerror = function(){ showError('register-error', 'That file could not be read as an image.'); };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
}

// ---------------------------------------------------------------- auth + data
async function loadDashboard(){
  const me = await api('GET', '/api/me');
  state = {
    name: me.name, roll: me.roll, semester: me.semester, credits: me.credits,
    photo: me.photoUrl || '', courses: me.courses,
  };
  renderDashboard();
  showPage('dashboard');
  applyViewFromHash();
}

async function handleLogin(){
  const roll = document.getElementById('login-roll').value.trim();
  const password = document.getElementById('login-password').value;
  showError('login-error', '');
  if(!roll || !password){ showError('login-error', 'Please enter your roll number and password.'); return; }
  setBusy('login-btn', true, 'Signing in…');
  try {
    await api('POST', '/api/auth/login', {roll, password});
    document.getElementById('login-password').value = '';
    await loadDashboard();
  } catch(e){
    showError('login-error', e.status === 401 ? 'Incorrect roll number or password.' : e.message);
  } finally {
    setBusy('login-btn', false);
  }
}

async function handleRegister(){
  showError('register-error', '');
  const courses = [];
  document.querySelectorAll('#courses-container .course-row').forEach(r=>{
    const code = r.querySelector('.c-code').value.trim();
    const name = r.querySelector('.c-name').value.trim();
    const attended = parseInt(r.querySelector('.c-attended').value) || 0;
    const total = parseInt(r.querySelector('.c-total').value) || 0;
    if(code || name) courses.push({code, name, attended, total});
  });

  const details = readDetailInputs('d-');
  const payload = {
    details,
    name: document.getElementById('reg-name').value.trim(),
    roll: document.getElementById('reg-roll').value.trim(),
    password: document.getElementById('reg-password').value,
    semester: document.getElementById('reg-semester').value,
    credits: document.getElementById('reg-credits').value,
    cgpa: document.getElementById('reg-cgpa').value.trim(),
    courses,
  };
  if(regPhoto) payload.photo = regPhoto;

  const missing = [['name','full name'],['roll','roll number'],['password','password'],['semester','semester'],['credits','major credits'],['cgpa','CGPA']]
    .filter(([k]) => !payload[k]).map(([,label]) => label);
  DETAIL_FIELDS.filter(f => f.req && !details[f.k]).forEach(f => missing.push(f.label.toLowerCase()));
  if(missing.length){ showError('register-error', 'Please fill in: ' + missing.join(', ') + '.'); return; }
  const dErr = validateDetails(details);
  if(dErr){ showError('register-error', dErr); return; }

  setBusy('register-btn', true, 'Creating profile…');
  try {
    await api('POST', '/api/auth/register', payload);
    document.getElementById('reg-password').value = '';
    await loadDashboard();
  } catch(e){
    const first = Object.values(e.fields)[0];
    showError('register-error', e.status === 409 ? 'This roll number already has an account. Try logging in instead.' : (first || e.message));
  } finally {
    setBusy('register-btn', false);
  }
}

async function handleLogout(){
  document.getElementById('profile-dropdown').classList.add('hidden');
  try { await api('POST', '/api/auth/logout'); } catch(e) {}
  state = {name:'', roll:'', semester:7, credits:124, photo:'', courses:[]};
  cgpaRevealed = false;
  profileData = null;
  setView('dashboard');
  if(location.hash) history.replaceState(null, '', location.pathname);
  showPage('login');
}

function setTheme(btn){
  document.querySelectorAll('#theme-toggle button').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
}

const NAV_KEYS = ['institute','academics','campus','alumni'];

function toggleNavMenu(key){
  NAV_KEYS.forEach(k=>{
    const menu = document.getElementById('navmenu-'+k);
    const trigger = menu.previousElementSibling;
    if(k === key){
      const wasHidden = menu.classList.contains('hidden');
      menu.classList.toggle('hidden');
      trigger.classList.toggle('open', wasHidden);
    } else {
      menu.classList.add('hidden');
      trigger.classList.remove('open');
    }
  });
  // close profile dropdown if open
  document.getElementById('profile-dropdown').classList.add('hidden');
}

document.addEventListener('click', function(){
  NAV_KEYS.forEach(k=>{
    document.getElementById('navmenu-'+k).classList.add('hidden');
    document.getElementById('navmenu-'+k).previousElementSibling.classList.remove('open');
  });
});

function toggleProfileDropdown(){
  NAV_KEYS.forEach(k=>{
    document.getElementById('navmenu-'+k).classList.add('hidden');
    document.getElementById('navmenu-'+k).previousElementSibling.classList.remove('open');
  });
  document.getElementById('profile-dropdown').classList.toggle('hidden');
}
document.addEventListener('click', function(){
  document.getElementById('profile-dropdown').classList.add('hidden');
});

async function toggleCgpa(){
  const out = document.getElementById('dash-cgpa-value');
  const eye = document.getElementById('cgpa-eye');
  if(cgpaRevealed){
    cgpaRevealed = false;
    out.textContent = '- -';
    if(eye) eye.className = 'fa fa-eye-slash';
    return;
  }
  try {
    out.textContent = '…';
    const r = await api('GET', '/api/me/cgpa');
    cgpaRevealed = true;
    out.textContent = r.cgpa;
    if(eye) eye.className = 'fa fa-eye';
  } catch(e){
    out.textContent = '- -';
  }
}

function switchTab(name){
  ['announcements','attendance','courses'].forEach(t=>{
    document.getElementById('tabbtn-'+t).classList.toggle('active', t===name);
    document.getElementById('tabpanel-'+t).classList.toggle('active', t===name);
  });
}

function classesNeededForSafe(attended, total, threshold){
  // find smallest n such that (attended+n)/(total+n) >= threshold
  if(total<=0) return {needed:0, safe:true};
  const pct = attended/total;
  if(pct >= threshold) return {needed:0, safe:true};
  let n = 0;
  while((attended+n)/(total+n) < threshold && n < 500){ n++; }
  return {needed:n, safe:false};
}

function renderDashboard(){
  document.getElementById('dash-credits').textContent = state.credits;
  document.getElementById('dash-semester').innerHTML = state.semester + '<sup style="font-weight: lighter;">' + ordinalSuffix(state.semester) + '</sup>';
  cgpaRevealed = false;
  document.getElementById('dash-cgpa-value').textContent = '- -';
  var eye0 = document.getElementById('cgpa-eye');
  if (eye0) eye0.className = 'fa fa-eye-slash';

  // Frequently Used links (same structure as the original; labels built from the entered data)
  const fl = document.getElementById('frequent_links');
  if (fl) {
    const links = [];
    const c0 = state.courses && state.courses[0];
    if (c0) links.push((c0.code ? c0.code + ' - ' : '') + c0.name + ' (' + new Date().getFullYear() + ')');
    links.push('Courses', 'Manage your eduroam Account');
    if (state.name) links.push(state.name);
    fl.innerHTML = links.map(t => '<a class="mb-2 mr-2 btn-transition btn btn-outline-secondary">' + esc(t) + ' </a>').join('');
  }

  const avatar = state.photo || defaultAvatar();
  document.getElementById('header-avatar').src = avatar;
  document.getElementById('pd-avatar').src = avatar;
  document.getElementById('pd-name').textContent = state.name;
  document.getElementById('nav-roll-heading').textContent = state.roll || '—';

  const today = new Date();
  const dateStr = String(today.getDate()).padStart(2,'0')+'-'+String(today.getMonth()+1).padStart(2,'0')+'-'+today.getFullYear();

  const attWrap = document.getElementById('attendance-cards');
  const listWrap = document.getElementById('courses-list');
  attWrap.innerHTML = '';
  listWrap.innerHTML = '';

  if(!state.courses.length){
    attWrap.innerHTML = '<div style="color:#9aa1ac;">No courses added yet.</div>';
    listWrap.innerHTML = '<div class="courses-list-row" style="color:#9aa1ac;">No courses added yet.</div>';
    return;
  }

  state.courses.forEach(c=>{
    const pct = c.total>0 ? Math.round((c.attended/c.total)*100) : 0;
    const {needed, safe} = classesNeededForSafe(c.attended, c.total, 0.75);

    // leaves = most classes that can still be missed while staying >= 75%
    const leaves = safe ? Math.max(Math.floor(c.attended*4/3) - c.total, 0) : 0;
    const tone = safe ? 'success' : 'danger';
    const card = document.createElement('div');
    card.className = 'col-md-3 col-lg-3 p-0 mr-3';
    card.innerHTML = `
      <a class="text-decoration-none text-reset" title="View attendance timeline for ${esc(c.code ? c.code+' - ' : '')}${esc(c.name)}">
        <div class="card mb-2 widget-chart text-left">
          <div class="widget-chart-content">
            <div class="widget-subheading">Last marked on: ${dateStr}</div>
            <div class="widget-numbers-xs">${esc(c.code ? c.code+' - ' : '')}${esc(c.name)}</div>
            <div class="mt-0">
              <span class="pr-1">
                <div class="widget-number-xs">Classes Attended: ${c.attended} out of ${c.total} -
                  <span class="widget-description text-${tone}"><b>${pct}%</b></span></div>
                <div class="widget-description text-${tone} m-0" style="font-size: small">
                  ${safe ? `You have <b>${leaves} ${leaves===1?'leave':'leaves'}</b> left` : `You need to attend <b>${needed} classes to be safe</b>`}
                </div>
              </span>
            </div>
          </div>
          <div class="widget-progress-wrapper progress-wrapper-bottom">
            <div class="progress-bar-xs progress-bar-animated-alt progress">
              <div class="progress-bar bg-${tone}" role="progressbar" style="width:${pct}%;"></div>
            </div>
          </div>
        </div>
      </a>
    `;
    attWrap.appendChild(card);

    const row = document.createElement('div');
    row.className = 'courses-list-row';
    row.innerHTML = `<div><span class="code">${esc(c.code||'—')}</span>${esc(c.name)}</div><div class="pct" style="color:${safe?'#17b6a7':'#e0304a'}">${pct}%</div>`;
    listWrap.appendChild(row);
  });
}

function ordinalSuffix(n){
  n = parseInt(n);
  const s = ["th","st","nd","rd"];
  const v = n % 100;
  return s[(v-20)%10] || s[v] || s[0];
}

// register form: details inputs + one empty course row
addCourseRow();

// Enter key submits the login form
document.getElementById('login-password').addEventListener('keydown', e => { if(e.key === 'Enter') handleLogin(); });
document.getElementById('login-roll').addEventListener('keydown', e => { if(e.key === 'Enter') handleLogin(); });

// on page load: restore the session if the cookie is still valid
(async function init(){
  if(location.protocol === 'file:'){
    showError('login-error', 'The backend is not connected. Start it (npm start in the backend folder) and open http://localhost:3000 instead of this file.');
    return;
  }
  try { await loadDashboard(); } catch(e) { /* not signed in: stay on the login page */ }
})();

// Module menu (left sidebar). Same rule as the original IRIS: at 992px and wider it is open beside the page;
// below that (phones, including "desktop site" mode at ~980px) it is closed and opens as an overlay.
const mqMobile = window.matchMedia('(max-width: 991.98px)');

function sidebarIsOpen(){
  if(mqMobile.matches) return document.getElementById('page-dashboard').classList.contains('mobile-menu-open');
  return !document.querySelector('.sidebar').classList.contains('collapsed');
}

function setSidebarOpen(open){
  const page = document.getElementById('page-dashboard');
  const sidebars = document.querySelectorAll('.sidebar');
  if(mqMobile.matches){
    page.classList.toggle('mobile-menu-open', open);
    sidebars.forEach(sb => sb.classList.remove('collapsed'));
  } else {
    page.classList.remove('mobile-menu-open');
    sidebars.forEach(sb => sb.classList.toggle('collapsed', !open));
  }
  document.getElementById('menu-toggle-text').textContent = open ? 'Close Menu' : 'Show Module Menu';
  document.getElementById('menu-icon').classList.toggle('flipped', !open);
}

function toggleSidebar(){ setSidebarOpen(!sidebarIsOpen()); }

// closed by default on small screens, open on large ones; re-applied when the window size class changes
setSidebarOpen(!mqMobile.matches);
mqMobile.addEventListener('change', () => setSidebarOpen(!mqMobile.matches));

// on small screens, tapping outside the menu closes it
document.addEventListener('click', function(e){
  if(mqMobile.matches && sidebarIsOpen() && !e.target.closest('.sidebar') && !e.target.closest('#menu-toggle')) setSidebarOpen(false);
});


// ================================================================ PROFILE DETAILS (register form + Profile page)
// One field list drives the registration inputs, the Profile page rows and the edit form,
// so nothing can be collected in one place and forgotten in another.
const GENDERS = ['Male','Female','Other'];
const BLOOD_GROUPS = ['A+','A-','B+','B-','AB+','AB-','O+','O-'];
const CATEGORIES = ['General','EWS','OBC-NCL','Scheduled Caste','Scheduled Tribe'];
const DEGREES = ['B Tech','M Tech','MCA','MBA','M Sc','Ph D'];

// k = API key, req = required, digits = exact digit count, full = row spans both columns
const DETAIL_SECTIONS = [
  {title:'Personal Details', fields:[
    {k:'fatherName', label:"Father's Name", req:1, ph:"Enter father's name", max:80},
    {k:'gender', label:'Gender', req:1, type:'select', opts:GENDERS},
    {k:'dob', label:'Date of Birth', req:1, type:'date'},
    {k:'bloodGroup', label:'Blood Group Type', req:1, type:'select', opts:BLOOD_GROUPS},
    {k:'nameHindi', label:'Name in Hindi', ph:'Name in Hindi (optional)', max:80},
    {k:'motherTongue', label:'Mother Tongue', ph:'Mother tongue (optional)', max:40},
    {k:'email', label:'Email address', req:1, type:'email', ph:'Enter your email address', max:120},
    {k:'nitkEmail', label:'NITK EDU Email', req:1, type:'email', ph:'Enter your institute email', max:120},
    {k:'nationality', label:'Nationality', req:1, ph:'Enter nationality', max:40},
    {k:'aadhaar', label:'Aadhaar Number', digits:12, ph:'12-digit Aadhaar number (optional)'},
    {k:'phone', label:'Phone', req:1, digits:10, ph:'10-digit phone number'},
    {k:'parentsPhone', label:'Parents Phone Number', req:1, digits:10, ph:'10-digit phone number'},
    {k:'address', label:'Permanent Address', req:1, type:'textarea', full:1, ph:'Enter your permanent address', max:300},
    {k:'pincode', label:'Pincode', req:1, digits:6, ph:'6-digit pincode'},
    {k:'country', label:'Country', req:1, ph:'Enter country', max:40},
  ]},
  {title:'Academic Details', fields:[
    {k:'roll', label:'Roll Number', fixed:1},
    {k:'regNo', label:'Registration Number', req:1, ph:'Enter registration number', max:20},
    {k:'branch', label:'Branch', req:1, ph:'Enter your branch', max:80},
    {k:'degree', label:'Degree', req:1, type:'select', opts:DEGREES},
    {k:'category', label:'Category', req:1, type:'select', opts:CATEGORIES},
    {k:'admissionDate', label:'Date of Admission', req:1, type:'date'},
  ]},
  {title:'Hostel Details', fields:[
    {k:'hostelRoom', label:'Hostel Room', ph:'Hostel name and room number (optional)', max:80},
  ]},
];
const ADDITIONAL_FIELDS = [{k:'apaarId', label:'APAAR ID', digits:12, ph:'12-digit APAAR ID'}];
// fields that exist on the registration form (everything except the fixed roll number)
const DETAIL_FIELDS = DETAIL_SECTIONS.flatMap(s => s.fields).filter(f => !f.fixed).concat(ADDITIONAL_FIELDS);

function inputHtml(f, id, value){
  const v = value == null ? '' : value;
  const req = f.req ? ' required' : '';
  if(f.type === 'select'){
    return '<select id="'+id+'"'+req+'><option value="">Select…</option>' +
      f.opts.map(o => '<option value="'+esc(o)+'"'+(o===v?' selected':'')+'>'+esc(o)+'</option>').join('') + '</select>';
  }
  if(f.type === 'textarea'){
    return '<textarea id="'+id+'" rows="3" maxlength="'+(f.max||300)+'" placeholder="'+esc(f.ph||'')+'"'+req+'>'+esc(v)+'</textarea>';
  }
  const today = new Date().toISOString().slice(0,10);
  const extra = f.type === 'date' ? ' max="'+today+'" min="1950-01-01"'
              : f.digits ? ' inputmode="numeric" maxlength="'+f.digits+'" pattern="\\d{'+f.digits+'}"'
              : ' maxlength="'+(f.max||80)+'"';
  return '<input type="'+(f.type||'text')+'" id="'+id+'" value="'+esc(v)+'" placeholder="'+esc(f.ph||'')+'"'+extra+req+'>';
}

function readDetailInputs(prefix){
  const out = {};
  DETAIL_FIELDS.forEach(f => {
    const el = document.getElementById(prefix + f.k);
    out[f.k] = el ? el.value.trim() : '';
  });
  return out;
}

// returns an error message, or '' when the values look right (the server checks again)
function validateDetails(d){
  for(const f of DETAIL_FIELDS){
    const v = d[f.k];
    if(f.digits && v && !new RegExp('^\\d{'+f.digits+'}$').test(v)) return f.label + ' must be exactly ' + f.digits + ' digits.';
    if(f.type === 'email' && v && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) return 'Enter a valid ' + f.label.toLowerCase() + '.';
    if(f.type === 'date' && v && v > new Date().toISOString().slice(0,10)) return f.label + ' cannot be in the future.';
  }
  if(d.dob && d.admissionDate && d.admissionDate <= d.dob) return 'Date of admission must be after date of birth.';
  return '';
}

function buildRegisterDetails(){
  const host = document.getElementById('reg-details');
  if(!host) return;
  let html = '';
  DETAIL_SECTIONS.forEach(sec => {
    html += '<div class="section-label">'+esc(sec.title)+'</div>';
    const fields = sec.fields.filter(f => !f.fixed);
    let i = 0;
    while(i < fields.length){
      const f = fields[i];
      const cell = g => '<div class="field"><label for="d-'+g.k+'">'+esc(g.label)+(g.req?' *':'')+'</label>'+inputHtml(g,'d-'+g.k,'')+'</div>';
      if(f.full || i === fields.length-1 || fields[i+1].full){ html += '<div class="field-full">'+cell(f)+'</div>'; i += 1; }
      else { html += '<div class="row2">'+cell(f)+cell(fields[i+1])+'</div>'; i += 2; }
    }
  });
  html += '<div class="section-label">Additional Details</div><div class="row2">' +
    ADDITIONAL_FIELDS.map(f => '<div class="field"><label for="d-'+f.k+'">'+esc(f.label)+'</label>'+inputHtml(f,'d-'+f.k,'')+'</div>').join('') + '<div></div></div>';
  host.innerHTML = html;
}

// ---------------------------------------------------------------- views (dashboard / profile)
let profileData = null;   // {roll, name, semester, details|null}
let profileEditing = false;

function setView(name){
  document.getElementById('page-dashboard').dataset.view = name;
}

function applyViewFromHash(){
  const want = location.hash === '#profile' ? 'profile' : 'dashboard';
  if(document.getElementById('page-dashboard').classList.contains('hidden')) return;
  if(want === 'profile') openProfile(false); else setView('dashboard');
}
window.addEventListener('hashchange', applyViewFromHash);

function showView(name, edit){
  document.getElementById('profile-dropdown').classList.add('hidden');
  if(mqMobile.matches) setSidebarOpen(false);
  if(name === 'profile'){
    if(location.hash !== '#profile') history.pushState(null, '', '#profile');
    openProfile(!!edit);
  } else {
    if(location.hash) history.pushState(null, '', location.pathname);
    setView('dashboard');
    window.scrollTo(0, 0);
  }
}

async function openProfile(edit){
  setView('profile');
  window.scrollTo(0, 0);
  showError('profile-error', '');
  try {
    profileData = await api('GET', '/api/me/details');
  } catch(e){
    showError('profile-error', e.message);
    return;
  }
  profileEditing = !!edit || !profileData.details;   // accounts made before these fields existed go straight to the form
  renderProfile();
}

function fmtDate(iso){
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  return m ? m[3]+'-'+m[2]+'-'+m[1] : '';
}

function displayValue(f, d, roll){
  if(f.k === 'roll') return esc(roll);
  const v = d ? d[f.k] : '';
  if(!v) return '';
  if(f.type === 'date') return esc(fmtDate(v));
  if(f.k === 'branch') return esc((d.degree ? d.degree + ' : ' : '') + v);
  if(f.type === 'textarea') return esc(v).replace(/\r?\n/g, '<br>');
  return esc(v);
}

function profileCell(f, d, roll, editing){
  const body = editing && !f.fixed ? inputHtml(f, 'pe-'+f.k, d ? d[f.k] : '') : displayValue(f, d, roll);
  return '<div class="prof-cell"><table class="prof-table"><tbody><tr><th>'+esc(f.label)+(editing&&f.req?' *':'')+'</th><td class="wd2">'+body+'</td></tr></tbody></table></div>';
}

function renderProfile(){
  const p = profileData, d = p.details, editing = profileEditing;
  document.getElementById('prof-photo').src = state.photo || defaultAvatar();
  document.getElementById('prof-name').textContent = p.name;
  document.getElementById('prof-degree-line').textContent = (d && d.degree ? d.degree + ' ' : '') + 'Student @ NITK, Surathkal';
  document.getElementById('prof-edit-btn').style.display = editing ? 'none' : '';

  let html = '';
  if(editing){
    if(!d) html += '<div class="prof-note">Your profile details are not filled in yet. Please complete the form below.</div>';
    html += '<div class="prof-section-title">Name</div><div class="prof-row2">' +
      '<div class="prof-cell"><table class="prof-table"><tbody><tr><th>Full Name *</th><td class="wd2"><input type="text" id="pe-name" maxlength="80" value="'+esc(p.name)+'"></td></tr></tbody></table></div></div>';
  }
  DETAIL_SECTIONS.forEach(sec => {
    html += '<div class="prof-section-title">'+esc(sec.title)+'</div>';
    const fields = sec.fields;
    let i = 0;
    while(i < fields.length){
      const f = fields[i];
      if(f.full){
        html += '<div class="prof-row2 one">'+profileCell(f,d,p.roll,editing)+'</div>'; i += 1;
      } else if(i === fields.length-1 || fields[i+1].full){
        html += '<div class="prof-row2">'+profileCell(f,d,p.roll,editing)+'<div></div></div>'; i += 1;
      } else {
        html += '<div class="prof-row2">'+profileCell(f,d,p.roll,editing)+profileCell(fields[i+1],d,p.roll,editing)+'</div>'; i += 2;
      }
    }
  });
  if(editing){
    html += '<div class="prof-actions"><button type="button" class="prof-btn-primary" id="prof-save-btn" onclick="saveProfile()">Save changes</button>' +
      (d ? '<button type="button" class="prof-btn-secondary" onclick="cancelProfileEdit()">Cancel</button>' : '') + '</div>';
  }
  document.getElementById('profpane-profile').innerHTML = html;

  // Additional Details tab: always editable, as in the original (APAAR ID + submit)
  document.getElementById('profpane-additional').innerHTML =
    '<div class="prof-row2">' + ADDITIONAL_FIELDS.map(f =>
      '<div class="prof-cell"><table class="prof-table"><tbody><tr><th>'+esc(f.label)+'</th><td class="wd2">'+inputHtml(f,'pa-'+f.k, d ? d[f.k] : '')+'</td></tr></tbody></table></div>').join('') + '</div>' +
    '<button type="button" class="prof-btn-primary center" id="prof-additional-btn" onclick="saveAdditional()">Submit details</button>';
}

function switchProfileTab(name){
  ['profile','additional'].forEach(t => {
    document.getElementById('proftab-'+t).classList.toggle('active', t === name);
    document.getElementById('profpane-'+t).classList.toggle('active', t === name);
  });
  showError('profile-error', '');
}

function startProfileEdit(){ switchProfileTab('profile'); profileEditing = true; renderProfile(); }
function cancelProfileEdit(){ profileEditing = false; showError('profile-error',''); renderProfile(); }

async function putDetails(body, btnId, busyLabel){
  showError('profile-error', '');
  setBusy(btnId, true, busyLabel);
  try {
    const r = await api('PUT', '/api/me/details', body);
    profileData = {...profileData, name: r.name, details: r.details};
    state.name = r.name;
    document.getElementById('pd-name').textContent = r.name;
    profileEditing = false;
    renderProfile();
    return true;
  } catch(e){
    showError('profile-error', Object.values(e.fields || {})[0] || e.message);
    window.scrollTo({top: 0, behavior: 'smooth'});
    return false;
  } finally {
    setBusy(btnId, false);
  }
}

async function saveProfile(){
  const d = readDetailInputsFrom('pe-');
  const name = (document.getElementById('pe-name').value || '').trim();
  const missing = [];
  if(!name) missing.push('full name');
  DETAIL_FIELDS.filter(f => f.req && !d[f.k]).forEach(f => missing.push(f.label.toLowerCase()));
  if(missing.length){ showError('profile-error', 'Please fill in: ' + missing.join(', ') + '.'); window.scrollTo({top:0,behavior:'smooth'}); return; }
  const err = validateDetails(d);
  if(err){ showError('profile-error', err); window.scrollTo({top:0,behavior:'smooth'}); return; }
  await putDetails({...d, name}, 'prof-save-btn', 'Saving…');
}

// like readDetailInputs, but fields that are not on screen keep their saved value
function readDetailInputsFrom(prefix){
  const saved = (profileData && profileData.details) || {};
  const out = {};
  DETAIL_FIELDS.forEach(f => {
    const el = document.getElementById(prefix + f.k);
    out[f.k] = el ? el.value.trim() : (saved[f.k] || '');
  });
  return out;
}

async function saveAdditional(){
  if(!profileData.details){ showError('profile-error', 'Please complete your profile details first (Profile tab).'); switchProfileTabKeepError('profile'); return; }
  const apaar = document.getElementById('pa-apaarId').value.trim();
  if(apaar && !/^\d{12}$/.test(apaar)){ showError('profile-error', 'APAAR ID must be exactly 12 digits.'); return; }
  await putDetails({...profileData.details, name: profileData.name, apaarId: apaar}, 'prof-additional-btn', 'Submitting…');
}
function switchProfileTabKeepError(name){ const msg = document.getElementById('profile-error').textContent; switchProfileTab(name); showError('profile-error', msg); }

// build the registration inputs (after the field list above is defined)
buildRegisterDetails();