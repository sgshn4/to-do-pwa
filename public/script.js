let tasks = [];
let tags = [];
let db;
let selectedDate = new Date(); 
let viewDate = new Date();     
let selectedTagsForNewTask = [];
let myRadarChart = null;

// --- 1. ИНИЦИАЛИЗАЦИЯ ---
async function initDB() {
    return new Promise((resolve) => {
        const request = indexedDB.open("TodoPWA_DB", 6);
        request.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains("tasks")) db.createObjectStore("tasks", { keyPath: "id" });
            if (!db.objectStoreNames.contains("tags")) db.createObjectStore("tags", { keyPath: "id" });
        };
        request.onsuccess = (e) => { db = e.target.result; resolve(); };
    });
}

// --- 2. АВТОРИЗАЦИЯ ---
async function login() {
    const password = document.getElementById('loginPass').value;
    try {
        const res = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password })
        });
        if (res.ok) {
            document.getElementById('login-overlay').style.display = 'none';
            document.getElementById('app').style.display = 'block';
            await loadTasks();
        } else {
            document.getElementById('login-error').style.display = 'block';
        }
    } catch (e) { console.error(e); }
}

async function checkAuthStatus() {
    try {
        const res = await fetch('/api/data');
        if (res.ok) {
            document.getElementById('login-overlay').style.display = 'none';
            document.getElementById('app').style.display = 'block';
            await loadTasks();
        } else {
            document.getElementById('login-overlay').style.display = 'flex';
        }
    } catch (e) { await loadTasks(); }
}

// --- 3. ДАННЫЕ ---
async function loadTasks() {
    const tx = db.transaction(["tasks", "tags"], "readonly");
    tasks = await new Promise(r => tx.objectStore("tasks").getAll().onsuccess = (e) => r(e.target.result || []));
    tags = await new Promise(r => tx.objectStore("tags").getAll().onsuccess = (e) => r(e.target.result || []));
    
    // Мягкий сброс для повторов (необязательно при новой логике рендера, но пусть будет)
    localStorage.setItem('lastResetDate', new Date().toDateString());
    
    showScreen('screen-list');
    try {
        const res = await fetch('/api/data');
        if (res.ok) {
            const data = await res.json();
            tasks = data.tasks || []; tags = data.tags || [];
            saveLocal();
            renderTasks();
        }
    } catch (e) {}
}

async function saveAllData() {
    saveLocal();
    renderTasks();
    try {
        await fetch('/api/data', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ tasks, tags })
        });
    } catch (e) {}
}

function saveLocal() {
    const tx = db.transaction(["tasks", "tags"], "readwrite");
    tx.objectStore("tasks").clear();
    tx.objectStore("tags").clear();
    tasks.forEach(t => tx.objectStore("tasks").add(t));
    tags.forEach(t => tx.objectStore("tags").add(t));
}

// --- 4. НАВИГАЦИЯ ---
function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.style.display = 'none');
    const target = document.getElementById(id);
    if (target) target.style.display = 'block';

    document.querySelectorAll('.nav-bar button').forEach(btn => btn.classList.remove('active'));
    const activeBtn = document.getElementById('nav-' + id);
    if (activeBtn) activeBtn.classList.add('active');

    if (id === 'screen-list') { renderCalendar(); renderTasks(); }
    if (id === 'screen-archive') renderArchive();
    if (id === 'screen-tags') renderTagsManagement();
    if (id === 'screen-create') {
        selectedTagsForNewTask = [];
        document.querySelectorAll('#screen-create .day-btn').forEach(b => b.classList.remove('active'));
        renderTagChoices();
    }
    if (id === 'screen-stats') renderAnalytics();
}

function changeWeek(days) {
    viewDate.setDate(viewDate.getDate() + days);
    renderCalendar();
}

// --- 5. ЛОГИКА ЗАДАЧ (ИСПРАВЛЕННАЯ) ---
function addTask() {
    const textInput = document.getElementById('taskText');
    if (!textInput.value) return alert("Введите название задачи");

    // Собираем активные кнопки дней
    const repeatDays = [];
    document.querySelectorAll('#screen-create .day-btn.active').forEach(btn => {
        repeatDays.push(parseInt(btn.dataset.day));
    });

    const newTask = {
        id: Date.now(),
        text: textInput.value,
        date: document.getElementById('taskDate').value || null,
        time: document.getElementById('taskTime').value || null,
        completed: false, // Глобальный статус
        completedAt: null, // Дата последнего выполнения
        difficulty: parseInt(document.getElementById('taskDifficulty').value),
        tagIds: [...selectedTagsForNewTask],
        repeatDays: repeatDays
    };

    tasks.push(newTask);
    saveAllData();
    textInput.value = '';
    showScreen('screen-list');
}

function renderTasks() {
    const list = document.getElementById('taskList');
    if (!list) return;
    
    const viewDayOfWeek = selectedDate.getDay();
    const viewDateStr = selectedDate.toDateString();

    const filtered = tasks.filter(t => {
        // Логика для ПОВТОРЯЮЩИХСЯ задач
        if (t.repeatDays && t.repeatDays.length > 0) {
            // Если сегодня не тот день недели - скрываем
            if (!t.repeatDays.includes(viewDayOfWeek)) return false;
            
            // Если задача была выполнена ИМЕННО в этот день, который мы смотрим - скрываем
            if (t.completedAt && new Date(t.completedAt).toDateString() === viewDateStr) return false;
            
            return true;
        }

        // Логика для ОБЫЧНЫХ задач
        if (t.completed) return false;
        if (t.date) return new Date(t.date).toDateString() === viewDateStr;
        
        return true; // Плавающие задачи без даты
    }).sort((a,b) => (a.time || "99:99").localeCompare(b.time || "99:99"));

    list.innerHTML = filtered.map(t => createTaskHTML(t)).join('') || '<p style="text-align:center;color:#888;padding:20px;">Задач нет</p>';
}

function toggleTask(id) {
    const t = tasks.find(t => t.id === id);
    if (!t) return;

    // Если это повтор - мы не "убиваем" задачу, а просто ставим дату выполнения
    if (t.repeatDays && t.repeatDays.length > 0) {
        // Если мы в будущем/прошлом - записываем ту дату, которую смотрим
        t.completedAt = selectedDate.toISOString();
        t.completed = true; 
    } else {
        t.completed = !t.completed;
        t.completedAt = t.completed ? new Date().toISOString() : null;
    }
    
    saveAllData();
}

function createTaskHTML(t) {
    const tTags = (t.tagIds || []).map(id => tags.find(tag => tag.id === id)).filter(Boolean);
    const timeBadge = t.time ? `<span class="task-time-badge">${t.time}</span>` : '';
    return `
        <div class="task-card ${t.completed && !t.repeatDays?.length ? 'completed' : ''}">
            <input type="checkbox" onchange="toggleTask(${t.id})">
            <div class="task-info">
                <div>${timeBadge} <strong>${t.text}</strong></div>
                <div class="task-tags-row">
                    ${tTags.map(tag => `<span class="tag-badge" style="background:${tag.color}">${tag.name}</span>`).join('')}
                </div>
            </div>
            <button class="delete-btn" onclick="deleteTask(${t.id})"><span class="material-symbols-outlined">delete</span></button>
        </div>
    `;
}

function renderCalendar() {
    const strip = document.getElementById('calendar-strip');
    if (!strip) return; strip.innerHTML = '';
    const daysArr = ['Вс','Пн','Вт','Ср','Чт','Пт','Сб'];
    for (let i = -2; i <= 4; i++) {
        const d = new Date(viewDate); d.setDate(d.getDate() + i);
        const isActive = d.toDateString() === selectedDate.toDateString();
        const item = document.createElement('div');
        item.className = `date-item ${isActive ? 'active' : ''}`;
        item.innerHTML = `<span>${daysArr[d.getDay()]}</span><b>${d.getDate()}</b>`;
        item.onclick = () => { selectedDate = new Date(d); renderCalendar(); renderTasks(); };
        strip.appendChild(item);
    }
}

// --- 6. ТЕГИ, АРХИВ, АНАЛИТИКА (Остальное без изменений) ---
function deleteTask(id) {
    if (confirm("Удалить?")) { tasks = tasks.filter(t => t.id !== id); saveAllData(); renderArchive(); }
}
function renderArchive() {
    const list = document.getElementById('archiveList');
    const done = tasks.filter(t => t.completed).sort((a,b) => new Date(b.completedAt) - new Date(a.completedAt));
    list.innerHTML = done.map(t => createTaskHTML(t)).join('') || '<p style="padding:20px;text-align:center;color:#888;">Архив пуст</p>';
}
function renderTagsManagement() {
    const list = document.getElementById('tags-management-list');
    list.innerHTML = tags.map(t => `<div class="tag-manage-item"><span class="tag-badge" style="background:${t.color}">${t.name}</span><button class="delete-btn" onclick="deleteTag(${t.id})"><span class="material-symbols-outlined">delete</span></button></div>`).join('');
}
function createTag() {
    const n = document.getElementById('newTagName'); const c = document.getElementById('newTagColor');
    if (n.value) { tags.push({id:Date.now(), name:n.value, color:c.value}); n.value=''; saveAllData(); renderTagsManagement(); }
}
function deleteTag(id) {
    tags = tags.filter(t => t.id !== id);
    tasks.forEach(task => task.tagIds = (task.tagIds || []).filter(tid => tid !== id));
    saveAllData(); renderTagsManagement();
}
function renderTagChoices() {
    const container = document.getElementById('tag-choices');
    container.innerHTML = tags.map(t => `<div class="tag-chip ${selectedTagsForNewTask.includes(t.id) ? 'selected' : ''}" onclick="toggleTagSelection(${t.id})" style="${selectedTagsForNewTask.includes(t.id) ? `background:${t.color};border-color:${t.color}`:''}"> ${t.name} </div>`).join('');
}
function toggleTagSelection(id) {
    selectedTagsForNewTask.includes(id) ? selectedTagsForNewTask = selectedTagsForNewTask.filter(i => i !== id) : selectedTagsForNewTask.push(id);
    renderTagChoices();
}
function renderAnalytics() {
    const total = tasks.length; const comp = tasks.filter(t => t.completed).length;
    document.getElementById('stats-summary').innerHTML = `<div class="stat-card"><h3>Всего</h3><p>${total}</p></div><div class="stat-card"><h3>Сделано</h3><p>${comp}</p></div>`;
    const heatmap = document.getElementById('heatmap'); heatmap.innerHTML = '';
    const counts = {}; tasks.forEach(t => { if(t.completedAt) counts[new Date(t.completedAt).toDateString()] = (counts[new Date(t.completedAt).toDateString()] || 0) + 1; });
    const start = new Date(); start.setDate(start.getDate() - 60);
    for (let i = 0; i < 70; i++) {
        const d = new Date(start); d.setDate(d.getDate() + i);
        const count = counts[d.toDateString()] || 0;
        const sq = document.createElement('div'); sq.className = `heat-square level-${count > 4 ? 4 : count}`;
        heatmap.appendChild(sq);
    }
}

// --- 7. ЕДИНЫЙ ОБРАБОТЧИК КЛИКОВ ---
document.addEventListener('click', (e) => {
    // 1. Кнопки дней в форме создания
    const dayBtn = e.target.closest('#screen-create .day-btn');
    if (dayBtn) {
        dayBtn.classList.toggle('active');
        console.log("Клик по дню:", dayBtn.dataset.day, "Активен:", dayBtn.classList.contains('active'));
        return; // Прекращаем выполнение, чтобы не сработали другие условия
    }
});

window.addEventListener('DOMContentLoaded', () => {
    initDB().then(() => checkAuthStatus());
});

if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js');
}