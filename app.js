/* BOSS InventorLab 2.0 — no accounts, dependencies, or cloud data uploads. */
'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const KEY = 'bossWorkspaceV2';
  const stages = ['Idea', 'Planning', 'Building', 'Testing', 'Complete', 'Archived'];
  const uid = () => globalThis.crypto?.randomUUID?.() || 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const dayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const validDate = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && dayKey(new Date(s + 'T12:00:00')) === s;
  const prettyDate = s => new Date(s + 'T12:00:00').toLocaleDateString(undefined, {month:'short', day:'numeric', year:'numeric'});
  let needsMigration = false;
  let lock = '', selected = dayKey(), month = new Date(), activeProject = null, noticeTimer, draftBackground = null;
  month.setDate(1);

  function text(value, fallback = '', limit = 100000) {
    if (value == null) return fallback;
    if (typeof value !== 'string' || value.length > limit) throw new Error('Invalid or oversized text in workspace data.');
    return value;
  }
  function list(value) {
    if (!Array.isArray(value) || value.length > 5000) throw new Error('Invalid or oversized list in workspace data.');
    return value;
  }
  function record(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid workspace record.');
    return value;
  }
  function normalize(data) {
    record(data);
    if (data.version !== 2) throw new Error('Choose a BOSS version 2 backup.');
    const ids = new Set();
    const idFor = value => {
      let id = typeof value === 'string' && /^[\w-]{1,100}$/.test(value) ? value : uid();
      if (ids.has(id)) id = uid();
      ids.add(id); return id;
    };
    const projects = list(data.projects).map(item => {
      const p = record(item), experiment = {}, design = {};
      for (const k of ['question','hypothesis','change','measure','same','results','next']) experiment[k] = text(p.experiment?.[k]);
      for (const k of ['dimensions','materials','constraints','revision']) design[k] = text(p.design?.[k]);
      return {id:idFor(p.id), name:text(p.name, 'Untitled project', 120), description:text(p.description),
        stage:stages.includes(p.stage) ? p.stage : 'Idea', notes:text(p.notes), experiment, design,
        tasks:list(p.tasks ?? []).map(t => {record(t); return {id:idFor(t.id), title:text(t.title, '', 500), done:t.done === true};})};
    });
    const events = list(data.events).map(e => {
      record(e); if (!validDate(e.date)) throw new Error('A calendar date in this backup is invalid.');
      return {id:idFor(e.id), title:text(e.title, '', 200), date:e.date};
    });
    const parts = list(data.parts).map(p => {
      record(p); const q = Number(p.q);
      if (!Number.isInteger(q) || q < 1 || q > 1000000) throw new Error('Component quantities must be whole numbers from 1 to 1,000,000.');
      return {id:idFor(p.id), n:text(p.n, '', 120), q, note:text(p.note, '', 1000)};
    });
    const prefs = data.prefs || {}, background = text(prefs.background, '', 2000000);
    if (background && !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(background)) throw new Error('Invalid background image.');
    return {version:2, projects, events, parts, prefs:{background,
      brightness:Math.min(130, Math.max(40, Number(prefs.brightness) || 100)),
      blur:Math.min(10, Math.max(0, Number(prefs.blur) || 0))}};
  }
  function blank() { return {version:2, projects:[], events:[], parts:[], prefs:{background:'', brightness:100, blur:0}}; }
  function load() {
    try {
      const current = localStorage.getItem(KEY);
      if (current !== null) return normalize(JSON.parse(current));
      needsMigration = true;
      const oldProjects = localStorage.getItem('bossProjects');
      const legacy = blank();
      legacy.projects = oldProjects === null ? [{name:'Clothing Automation Machine', description:'Wide transfer tunnel, dry intake, sorting by clothing type, and automated garment care.'}] : list(JSON.parse(oldProjects));
      legacy.projects = legacy.projects.map((p, i) => ({...record(p), notes:localStorage.getItem('projectNote_' + i) || p.notes || ''}));
      legacy.events = JSON.parse(localStorage.getItem('bossCalendarEvents') || '[]');
      legacy.parts = JSON.parse(localStorage.getItem('bossParts') || '[]');
      return normalize(legacy); // Original storage keys remain untouched for recovery.
    } catch (error) {
      lock = 'Saved data could not be loaded. It has not been overwritten. Use Settings to download recovery data or restore a backup.';
      console.warn('BOSS storage:', error.message);
      return blank();
    }
  }
  let state = load();
  function notify(message) {
    $('toast').textContent = message; $('toast').classList.add('show');
    clearTimeout(noticeTimer); noticeTimer = setTimeout(() => $('toast').classList.remove('show'), 4500);
  }
  function warn(message) { $('storageWarning').textContent = message; $('storageWarning').hidden = !message; }
  function save() {
    if (lock) { warn(lock); $('saveStatus').textContent = 'Not saved'; return false; }
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
      $('saveStatus').textContent = 'Saved on this device'; warn(''); renderDashboard(); return true;
    } catch (error) {
      $('saveStatus').textContent = 'Not saved';
      warn('Your changes are only in this open tab. Browser storage is unavailable or full. Download a backup in Settings before closing.');
      return false;
    }
  }
  const project = id => state.projects.find(p => p.id === id);
  const pct = p => p.tasks.length ? Math.round(p.tasks.filter(t => t.done).length / p.tasks.length * 100) : 0;
  const options = (values, selectedValue) => values.map(v => `<option${v === selectedValue ? ' selected' : ''}>${esc(v)}</option>`).join('');

  function go(route) {
    if (location.hash.slice(1) !== route) history.pushState(null, '', '#' + route);
    showRoute(route);
  }
  function showRoute(route = location.hash.slice(1) || 'home') {
    const detail = route.startsWith('project/');
    const page = detail ? 'projects' : route;
    const titles = {home:'Your unified workspace', projects:'Project Workspace', engineering:'Engineering Lab', components:'Components Library', maps:'Google Maps', calendar:'Calendar & Schedule', settings:'Settings'};
    if (!titles[page]) { go('home'); return; }
    document.querySelectorAll('.page').forEach(el => el.classList.toggle('active', el.id === page));
    document.querySelectorAll('.nav button').forEach(el => {
      const active = el.dataset.page === page; el.classList.toggle('active', active);
      if (active) el.setAttribute('aria-current', 'page'); else el.removeAttribute('aria-current');
    });
    $('topLabel').textContent = titles[page];
    $('calendarWidget').hidden = ['calendar','engineering','settings','maps'].includes(page) || detail;
    document.querySelector('.layout').classList.toggle('wide', $('calendarWidget').hidden);
    activeProject = detail ? route.slice(8) : null;
    if (page === 'projects') {
      if (detail && project(activeProject)) renderProject(activeProject);
      else { activeProject = null; $('projectsHeader').hidden = false; $('projectTools').hidden = false; renderProjects(); }
    }
    if (page === 'components') renderParts();
    if (page === 'engineering') renderLab();
    renderDashboard(); renderCalendar();
    window.scrollTo({top:0, behavior:'auto'});
  }
  function renderDashboard() {
    const active = state.projects.filter(p => p.stage !== 'Archived');
    const tasks = active.flatMap(p => p.tasks);
    const upcoming = state.events.filter(e => e.date >= dayKey()).sort((a,b) => a.date.localeCompare(b.date));
    $('dashboardStats').innerHTML = `<div class="stat"><strong>${active.length}</strong><span>Projects</span></div><div class="stat"><strong>${tasks.filter(t => !t.done).length}</strong><span>Open tasks</span></div><div class="stat"><strong>${upcoming.length}</strong><span>Upcoming milestones</span></div>`;
    $('continueProjects').innerHTML = active.slice(0,2).map(p => `<button class="card home-action" data-open="${p.id}"><span class="pill">${esc(p.stage)}</span><h3>${esc(p.name)}</h3><p>${p.tasks.filter(t => t.done).length} of ${p.tasks.length} tasks complete</p><progress max="100" value="${pct(p)}" aria-label="Task progress for ${esc(p.name)}"></progress><span class="open-label">Continue building →</span></button>`).join('') || '<div class="empty">Start a project to turn your next idea into a plan.</div>';
    $('upcomingList').innerHTML = upcoming.slice(0,4).map(e => `<button class="upcoming" data-day="${e.date}"><span>${esc(e.title)}</span><small>${prettyDate(e.date)}</small></button>`).join('') || '<p class="muted">No upcoming milestones. Add your next build session to the calendar.</p>';
  }
  function newProject() {
    $('projectForm').reset(); $('projectDialog').showModal(); $('newName').focus();
  }
  function renderProjects() {
    const query = $('projectSearch').value.trim().toLowerCase(), filter = $('stageFilter').value;
    const rows = state.projects.filter(p => (filter === 'All' ? p.stage !== 'Archived' : p.stage === filter) && (p.name + ' ' + p.description).toLowerCase().includes(query));
    $('projectList').innerHTML = rows.map(p => `<article class="card"><span class="pill">${esc(p.stage)}</span><h3>${esc(p.name)}</h3><p class="clamp">${esc(p.description || 'Add a goal for this invention.')}</p><progress max="100" value="${pct(p)}" aria-label="Task progress"></progress><small>${p.tasks.filter(t => t.done).length}/${p.tasks.length} tasks completed</small><div class="actions"><button class="secondary" data-open="${p.id}">Open Workspace →</button></div></article>`).join('') || '<div class="empty">No matching projects. Try another search or create a new project.</div>';
  }
  function renderProject(id) {
    const p = project(id); if (!p) return go('projects');
    $('projectsHeader').hidden = true; $('projectTools').hidden = true; $('topLabel').textContent = p.name;
    $('projectList').innerHTML = `<div class="workspace-detail"><div class="section-title"><button class="secondary" data-nav="projects">← All projects</button><span class="pill">Saves locally as you type</span></div><div class="card"><div class="eyebrow">PROJECT WORKSPACE</div><h1>${esc(p.name)}</h1><div class="form-grid"><label>Project name<input id="editName" data-field="name" value="${esc(p.name)}" maxlength="120" required></label><label>Stage<select data-field="stage">${options(stages,p.stage)}</select></label><label class="full">Project goal<textarea data-field="description" rows="2" maxlength="100000">${esc(p.description)}</textarea></label></div></div><div class="tool-grid detail-grid"><div class="card"><h2>Build checklist</h2><div id="taskProgress"></div><form id="taskForm" class="row"><label class="grow">Next step<input id="taskTitle" placeholder="e.g. Sketch the first prototype" maxlength="500" required></label><button class="primary" type="submit">Add task</button></form><div id="taskList"></div></div><div class="card"><h2>Inventor's notebook</h2><label>Ideas, questions, and discoveries<textarea id="projectNote" data-field="notes" rows="10" maxlength="100000" placeholder="What did you build? What did you learn?">${esc(p.notes)}</textarea></label><small>Notes save as you type. Use Settings → Download backup to keep a separate copy.</small></div></div><div class="card"><h2>Experiment notebook</h2><p class="muted">Plan a fair test, then write what actually happened.</p><div class="form-grid">${[['question','Question'],['hypothesis','My prediction'],['change','What I will change'],['measure','What I will measure'],['same','What I will keep the same'],['results','Results and observations'],['next','What I will try next']].map(([key,label]) => `<label>${label}<textarea rows="3" data-experiment="${key}" maxlength="100000">${esc(p.experiment[key])}</textarea></label>`).join('')}</div></div><div class="card"><h2>Design brief</h2><p class="muted">A planning notebook for your design—not a CAD or 3D editor.</p><div class="form-grid">${[['dimensions','Dimensions and units'],['materials','Materials and components'],['constraints','Requirements and constraints'],['revision','Changes for the next version']].map(([key,label]) => `<label>${label}<textarea rows="3" data-design="${key}" maxlength="100000">${esc(p.design[key])}</textarea></label>`).join('')}</div></div></div>`;
    renderTasks();
  }
  function renderTasks() {
    const p = project(activeProject); if (!p || !$('taskList')) return;
    $('taskProgress').innerHTML = `<progress max="100" value="${pct(p)}" aria-label="Completed tasks"></progress><p class="muted">${p.tasks.filter(t => t.done).length} of ${p.tasks.length} complete</p>`;
    $('taskList').innerHTML = p.tasks.map(t => `<div class="task"><label><input type="checkbox" data-task="${t.id}"${t.done?' checked':''}><span${t.done?' class="done"':''}>${esc(t.title)}</span></label><button class="small-button" data-remove-task="${t.id}" aria-label="Remove task: ${esc(t.title)}">×</button></div>`).join('') || '<p class="muted">Break the invention into small steps. Start with just one.</p>';
  }
  function renderLab() {
    $('labProjects').innerHTML = state.projects.filter(p => p.stage !== 'Archived').map(p => `<button class="secondary" data-open="${p.id}">${esc(p.name)} →</button>`).join('') || '<p class="muted">Create a project to start an experiment notebook.</p>';
  }
  function renderParts() {
    const query = $('partSearch').value.trim().toLowerCase();
    $('partsList').innerHTML = state.parts.filter(p => (p.n+' '+p.note).toLowerCase().includes(query)).map(p => `<div class="event row"><div class="grow"><b>${esc(p.n)}</b><small>Quantity: ${p.q}${p.note ? ' · '+esc(p.note) : ''}</small></div><button class="secondary" data-remove-part="${p.id}">Remove</button></div>`).join('') || '<p class="muted">No matching components.</p>';
  }
  function addPart() {
    const n = $('partName').value.trim(), q = Number($('partQty').value);
    if (!n || !Number.isInteger(q) || q < 1 || q > 1000000) { notify('Enter a name and a whole-number quantity from 1 to 1,000,000.'); return; }
    state.parts.push({id:uid(),n,q,note:$('partNote').value.trim()}); save(); $('partName').value = ''; $('partNote').value=''; renderParts();
  }
  function selectDate(date, navigate = false) {
    if (!validDate(date)) return;
    selected = date; const d = new Date(date+'T12:00:00'); month = new Date(d.getFullYear(),d.getMonth(),1);
    if (navigate) go('calendar'); else renderCalendar();
  }
  function shiftMonth(n) { month.setMonth(month.getMonth()+n); renderCalendar(); }
  function renderCalendar() {
    const year=month.getFullYear(), m=month.getMonth(), count=new Date(year,m+1,0).getDate(), first=new Date(year,m,1).getDay();
    const label=month.toLocaleDateString(undefined,{month:'long',year:'numeric'});
    ['miniMonth','bigMonth'].forEach(id => $(id).textContent = label);
    let html = '<span class="day empty"></span>'.repeat(first);
    for (let d=1;d<=count;d++) {
      const date=dayKey(new Date(year,m,d)), event=state.events.some(e=>e.date===date);
      html+=`<button type="button" class="day ${date===dayKey()?'today':''} ${date===selected?'selected':''} ${event?'has-event':''}" data-select-date="${date}" aria-label="${prettyDate(date)}${event?', has events':''}" aria-pressed="${date===selected}">${d}</button>`;
    }
    ['miniDays','bigDays'].forEach(id => $(id).innerHTML=html);
    const chosen = state.events.filter(e=>e.date===selected);
    $('miniEvents').innerHTML = `<small>${prettyDate(selected)}</small>` + (chosen.map(e=>`<div class="event">${esc(e.title)}</div>`).join('') || '<p>No events for this day.</p>');
    $('bigEvents').innerHTML = `<b>${prettyDate(selected)}</b>` + (chosen.map(e=>`<div class="event row"><span class="grow">${esc(e.title)}</span><button class="secondary" data-edit-event="${e.id}">Edit</button><button class="secondary" data-remove-event="${e.id}">Delete</button></div>`).join('') || '<p class="muted">No events scheduled.</p>');
    $('eventDate').value=selected; $('miniDate').value=selected;
  }
  function addEvent(e) {
    e.preventDefault(); const form=e.currentTarget;
    const titleInput=form.querySelector('input:not([type]),input[type="text"]'), dateInput=form.querySelector('input[type="date"]');
    const title=titleInput.value.trim(), date=dateInput.value;
    if (!title || !validDate(date)) return notify('Enter an event title and a valid date.');
    state.events.push({id:uid(),title,date}); save(); titleInput.value=''; selectDate(date);
  }
  function searchMap(e) { e.preventDefault(); const q=$('mapQuery').value.trim(); if(q) $('mapFrame').src='https://www.google.com/maps?q='+encodeURIComponent(q)+'&output=embed'; }
  function openGoogleMaps() { window.open('https://www.google.com/maps/search/'+encodeURIComponent($('mapQuery').value.trim() || 'science museum'),'_blank','noopener,noreferrer'); }

  function download(data, name, type='application/json') {
    const url=URL.createObjectURL(new Blob([data],{type})), a=document.createElement('a');
    a.href=url; a.download=name; document.body.append(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  function exportWorkspace() { download(JSON.stringify({...state, app:'BOSS InventorLab', exportedAt:new Date().toISOString()},null,2),'boss-backup-'+dayKey()+'.json'); }
  function exportRecovery() {
    const raw={};
    try { for(let i=0;i<localStorage.length;i++) { const k=localStorage.key(i); if(k===KEY || /^boss(Projects|Parts|CalendarEvents)$|^projectNote_\d+$/.test(k)) raw[k]=localStorage.getItem(k); } }
    catch { notify('Browser storage could not be read. Download a workspace backup instead.'); return; }
    download(JSON.stringify(raw,null,2),'boss-recovery-'+dayKey()+'.json');
  }
  async function importWorkspace(file) {
    if (!file) return;
    try {
      if(file.size>5*1024*1024) throw new Error('Choose a backup smaller than 5 MB.');
      const next=normalize(JSON.parse(await file.text()));
      if(!confirm('Restore this backup? This replaces the workspace on this device. A copy of the current workspace will download first.')) return;
      if(lock) exportRecovery(); else exportWorkspace();
      const previous=state, oldLock=lock; state=next; lock='';
      if(!save()) { state=previous; lock=oldLock; throw new Error('The backup could not be saved. Your current workspace is still open.'); }
      applyBackground(); go('home'); notify('Backup restored on this device.');
    } catch(error) { notify('Import stopped: '+error.message); }
    finally { $('backupFile').value=''; }
  }
  function applyBackground() {
    const p=state.prefs, layer=$('customBackground');
    layer.style.backgroundImage=p.background ? `linear-gradient(#07152f66,#07152fcc),url("${p.background}")` : 'none';
    layer.style.filter=`brightness(${p.brightness}%) blur(${p.blur}px)`;
  }
  function openStudio() {
    draftBackground=state.prefs.background; $('brightness').value=state.prefs.brightness; $('blur').value=state.prefs.blur;
    $('bgFile').value=''; $('bgStatus').textContent='Images stay on this device and are included in backups.'; previewBackground(); $('backgroundDialog').showModal();
  }
  function previewBackground() {
    $('preview').innerHTML=draftBackground ? '<img id="bgPreview" alt="Your background preview">' : 'Choose an image to preview it here';
    if($('bgPreview')) { $('bgPreview').src=draftBackground; $('bgPreview').style.filter=`brightness(${$('brightness').value}%) blur(${$('blur').value}px)`; }
  }
  async function chooseBackground(file) {
    if(!file) return;
    if(!/^image\/(png|jpeg|webp)$/.test(file.type) || file.size>12*1024*1024) { $('bgStatus').textContent='Choose a PNG, JPEG, or WebP smaller than 12 MB.'; return; }
    $('bgStatus').textContent='Preparing image…'; $('confirmBackground').disabled=true;
    let url;
    try {
      url=URL.createObjectURL(file); const img=new Image(); img.src=url; await img.decode();
      const scale=Math.min(1,1600/Math.max(img.width,img.height)), canvas=document.createElement('canvas');
      canvas.width=Math.max(1,Math.round(img.width*scale)); canvas.height=Math.max(1,Math.round(img.height*scale));
      canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);
      draftBackground=canvas.toDataURL('image/jpeg',0.8); previewBackground(); $('bgStatus').textContent='Preview ready. Confirm to save it on this device.';
    } catch { $('bgStatus').textContent='This image could not be opened. Choose another image.'; }
    finally { if(url) URL.revokeObjectURL(url); $('confirmBackground').disabled=false; }
  }
  function confirmBg() {
    if(!draftBackground) { $('bgStatus').textContent='Choose an image first.'; return; }
    state.prefs={background:draftBackground, brightness:Number($('brightness').value), blur:Number($('blur').value)};
    applyBackground(); if(save()) { $('backgroundDialog').close(); notify('Background saved on this device.'); }
    else $('bgStatus').textContent='Background is visible, but could not be saved. Download a backup before closing.';
  }

  // Preserve the original page's inline entry points while new controls use event delegation.
  Object.assign(window,{go,newProject,addPart,shiftMonth,selectDate,addEvent,searchMap,openGoogleMaps,openStudio,confirmBg});
  document.querySelectorAll('.nav button').forEach(b=>b.addEventListener('click',()=>go(b.dataset.page)));
  $('projectForm').addEventListener('submit',e=>{
    e.preventDefault(); const name=$('newName').value.trim(); if(!name) return;
    const p=normalize({version:2,projects:[{name,description:$('newGoal').value.trim(),stage:$('newStage').value}],events:[],parts:[]}).projects[0];
    state.projects.push(p); save(); $('projectDialog').close(); go('project/'+p.id);
  });
  $('projectSearch').addEventListener('input',renderProjects); $('stageFilter').addEventListener('change',renderProjects);
  $('partSearch').addEventListener('input',renderParts);
  $('backupFile').addEventListener('change',e=>importWorkspace(e.target.files[0]));
  $('bgFile').addEventListener('change',e=>chooseBackground(e.target.files[0]));
  ['brightness','blur'].forEach(id=>$(id).addEventListener('input',previewBackground));
  $('eventEditForm').addEventListener('submit',e=>{
    e.preventDefault(); const event=state.events.find(x=>x.id===$('editEventId').value);
    const title=$('editEventTitle').value.trim(), date=$('editEventDate').value;
    if(!event || !title || !validDate(date)) return;
    event.title=title; event.date=date; save(); $('eventDialog').close(); selectDate(date);
  });
  document.addEventListener('input',e=>{
    const p=project(activeProject), t=e.target; if(!p) return;
    if(t.dataset.field && t.dataset.field!=='name' && t.dataset.field!=='stage') { p[t.dataset.field]=t.value; save(); }
    if(t.dataset.experiment) { p.experiment[t.dataset.experiment]=t.value; save(); }
    if(t.dataset.design) { p.design[t.dataset.design]=t.value; save(); }
  });
  document.addEventListener('change',e=>{
    const p=project(activeProject), t=e.target; if(!p) return;
    if(t.dataset.field==='name') { if(!t.value.trim()) {t.value=p.name; return;} p.name=t.value.trim(); save(); $('topLabel').textContent=p.name; document.querySelector('.workspace-detail h1').textContent=p.name; }
    if(t.dataset.field==='stage') { p.stage=t.value; save(); }
    if(t.dataset.task) { const task=p.tasks.find(x=>x.id===t.dataset.task); if(task) {task.done=t.checked; save(); renderTasks();} }
  });
  document.addEventListener('submit',e=>{
    if(e.target.id!=='taskForm') return; e.preventDefault(); const p=project(activeProject), title=$('taskTitle').value.trim();
    if(p && title) {p.tasks.push({id:uid(),title,done:false}); save(); $('taskTitle').value=''; renderTasks(); $('taskTitle').focus();}
  });
  document.addEventListener('click',e=>{
    const b=e.target.closest('button'); if(!b) return; const d=b.dataset;
    if(d.nav) go(d.nav);
    if(d.open) go('project/'+d.open);
    if(d.day) selectDate(d.day,true);
    if(d.selectDate) selectDate(d.selectDate);
    if(d.close) $(d.close).close();
    if(d.removeTask && confirm('Remove this task?')) {const p=project(activeProject); p.tasks=p.tasks.filter(t=>t.id!==d.removeTask); save(); renderTasks();}
    if(d.removePart && confirm('Remove this component?')) {state.parts=state.parts.filter(p=>p.id!==d.removePart); save(); renderParts();}
    if(d.removeEvent && confirm('Delete this calendar event?')) {state.events=state.events.filter(x=>x.id!==d.removeEvent); save(); renderCalendar();}
    if(d.editEvent) {const event=state.events.find(x=>x.id===d.editEvent); if(event) {$('editEventId').value=event.id; $('editEventTitle').value=event.title; $('editEventDate').value=event.date; $('eventDialog').showModal();}}
    if(d.action==='today') selectDate(dayKey());
    if(d.action==='backup') exportWorkspace();
    if(d.action==='restore') $('backupFile').click();
    if(d.action==='recovery') exportRecovery();
    if(d.action==='clear-background') {state.prefs.background=''; applyBackground(); save();}
  });

  const units={length:{m:1,cm:0.01,mm:0.001,km:1000,in:0.0254,ft:0.3048}, mass:{kg:1,g:0.001,mg:0.000001,lb:0.45359237,oz:0.028349523125}, temperature:{'°C':1,'°F':1,K:1}};
  function updateUnits() {
    const names=Object.keys(units[$('unitType').value]); $('unitFrom').innerHTML=options(names,names[0]); $('unitTo').innerHTML=options(names,names[1]); $('unitResult').textContent='Enter a value and select Convert.';
  }
  $('unitType').addEventListener('change',updateUnits);
  $('unitForm').addEventListener('submit',e=>{
    e.preventDefault(); const value=Number($('unitValue').value), type=$('unitType').value, from=$('unitFrom').value, to=$('unitTo').value;
    let result;
    if(type==='temperature') {const c=from==='°F'?(value-32)*5/9:from==='K'?value-273.15:value; if(c < -273.15-1e-9) {$('unitResult').textContent='Temperature cannot be below absolute zero.'; return;} result=to==='°F'?c*9/5+32:to==='K'?c+273.15:c;}
    else result=value*units[type][from]/units[type][to];
    $('unitResult').textContent=Number.isFinite(result)?`${value} ${from} = ${Number(result.toPrecision(10))} ${to}`:'Enter a finite number.';
  });
  $('ohmForm').addEventListener('submit',e=>{
    e.preventDefault(); const v=Number($('voltage').value), r=Number($('resistance').value), current=v/r, power=v*v/r;
    $('ohmResult').textContent=(v>=0 && r>0 && Number.isFinite(current) && Number.isFinite(power))?`Current: ${Number(current.toPrecision(6))} A · Power: ${Number(power.toPrecision(6))} W`:'Use a nonnegative voltage and a resistance greater than zero.';
  });
  document.querySelector('.skip-link').addEventListener('click',e=>{e.preventDefault(); $('mainContent').focus(); $('mainContent').scrollIntoView();});
  window.addEventListener('hashchange',()=>showRoute());
  window.addEventListener('storage',e=>{if(e.key===KEY || e.key===null) {lock='Another tab changed the saved workspace. Download a backup of this tab before reloading; saving is paused to avoid overwriting those changes.'; warn(lock); $('saveStatus').textContent='Saving paused';}});
  document.addEventListener('keydown',e=>{if(e.key==='Escape') document.querySelectorAll('dialog[open]').forEach(d=>d.close());});
  updateUnits(); applyBackground(); showRoute(); if(needsMigration && !lock) save(); else if(!lock) $('saveStatus').textContent='Saved on this device'; if(lock) {warn(lock); $('saveStatus').textContent='Check saved data';}
})();
