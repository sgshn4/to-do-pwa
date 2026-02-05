let tasks = [];
let tags = [];
let db;
let selectedDate = new Date();
let viewDate = new Date();
let selectedTagsForNewTask = [];
let myRadarChart = null;
let isLoggedIn = false;

// --- Инициализация ---
async function initDB() {
    return new Promise((resolve) => {
        const request = indexedDB.open("TodoPWA_DB", 5);
        request.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains("tasks")) db.createObjectStore("tasks", { keyPath: "id" });
            if (!db.objectStoreNames.contains("tags")) db.createObjectStore("tags", { keyPath: "id" });
        };
        request.onsuccess = (e) => { db = e.target.result; resolve(); };
    });
}

// --- АВТОРИЗАЦИЯ ---
async function login() {
    const password = document.getElementById('loginPass').value;
    const errorMsg = document.getElementById('login-error');

    try {
        const res = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password })
        });

        if (res.ok) {
            document.getElementById('login-overlay').style.display = 'none';
            document.getElementById('app').style.display = 'block';
            await loadTasks(); // Загружаем данные только после входа
            showScreen('screen-list');
        } else {
            errorMsg.style.display = 'block';
        }
    } catch (e) {
        alert("Ошибка сервера");
    }
}

async function checkAuthStatus() {
    try {
        const res = await fetch('/api/data');
        if (res.ok) {
            isLoggedIn = true;
            document.getElementById('login-overlay').style.display = 'none';
            document.getElementById('app').style.display = 'block';
            await loadTasks(); // Загружаем только если ок
            showScreen('screen-list');
        } else {
            // Если 401 или любой другой статус ошибки
            isLoggedIn = false;
            document.getElementById('login-overlay').style.display = 'flex';
            document.getElementById('app').style.display = 'none';
        }
    } catch (e) {
        console.log("Оффлайн режим или ошибка сети");
        // В оффлайне работаем через IndexedDB (уже реализовано в loadTasks)
    }
}

// --- Навигация ---
function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.style.display = 'none');
    const target = document.getElementById(id);
    if (target) target.style.display = 'block';

    if (id === 'screen-list') { renderCalendar(); renderTasks(); }
    if (id === 'screen-archive') renderArchive();
    if (id === 'screen-tags') renderTagsManagement();
    if (id === 'screen-create') { selectedTagsForNewTask = []; renderTagChoices(); }
    if (id === 'screen-stats') renderAnalytics();
}

function changeWeek(days) {
    viewDate.setDate(viewDate.getDate() + days);
    renderCalendar();
}

// --- Данные ---
async function loadTasks() {
    // ... (загрузка из IndexedDB остается) ...

    try {
        const res = await fetch('/api/data');
        if (res.status === 401) {
            // Если сервер сказал "не авторизован", показываем экран логина
            document.getElementById('login-overlay').style.display = 'flex';
            document.getElementById('app').style.display = 'none';
            return;
        }
        if (res.ok) {
            const data = await res.json();
            tasks = data.tasks || [];
            tags = data.tags || [];
            saveLocal();
            renderTasks();
        }
    } catch (e) {
        console.log("Оффлайн режим");
    }
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

// --- Задачи ---
function addTask() {
    const text = document.getElementById('taskText').value;
    const timeVal = document.getElementById('taskTime').value; // Может быть ""
    if (!text) return alert("Введите текст");

    const newTask = {
        id: Date.now(),
        text,
        date: document.getElementById('taskDate').value || null,
        time: timeVal || null, // Сохраняем null если время не введено
        completed: false,
        completedAt: null,
        difficulty: parseInt(document.getElementById('taskDifficulty').value),
        tagIds: [...selectedTagsForNewTask],
        repeatDays: Array.from(document.querySelectorAll('.day-btn.active')).map(b => parseInt(b.dataset.day)),
    };

    tasks.push(newTask);
    saveAllData();
    document.getElementById('taskText').value = '';
    showScreen('screen-list');
}

function toggleTask(id) {
    const t = tasks.find(t => t.id === id);
    t.completed = !t.completed;
    t.completedAt = t.completed ? new Date().toISOString() : null;
    saveAllData();
}

function deleteTask(id) {
    if (confirm("Удалить?")) {
        tasks = tasks.filter(t => t.id !== id);
        saveAllData();
        renderArchive(); // На случай если мы в архиве
    }
}

// --- Рендеринг ---
function renderCalendar() {
    const strip = document.getElementById('calendar-strip');
    if (!strip) return; strip.innerHTML = '';
    const daysArr = ['Вс','Пн','Вт','Ср','Чт','Пт','Сб'];
    for (let i = -2; i <= 4; i++) {
        const d = new Date(viewDate);
        d.setDate(d.getDate() + i);
        const isActive = d.toDateString() === selectedDate.toDateString();
        const item = document.createElement('div');
        item.className = `date-item ${isActive ? 'active' : ''}`;
        item.innerHTML = `<span>${daysArr[d.getDay()]}</span><b>${d.getDate()}</b>`;
        item.onclick = () => { selectedDate = new Date(d); renderCalendar(); renderTasks(); };
        strip.appendChild(item);
    }
}

function renderTasks() {
    const list = document.getElementById('taskList');
    const dow = selectedDate.getDay();
    
    const filtered = tasks.filter(t => {
        if (t.completed) return false; // ГЛАВНОЕ: выполненные не показываем в активном списке
        if (t.date) return new Date(t.date).toDateString() === selectedDate.toDateString();
        if (t.repeatDays?.length > 0) return t.repeatDays.includes(dow);
        return true; 
    }).sort((a,b) => (a.time || "99:99").localeCompare(b.time || "99:99"));

    list.innerHTML = filtered.map(t => createTaskHTML(t)).join('') || '<p style="text-align:center;color:#888;padding:20px;">Нет активных задач</p>';
}

function renderArchive() {
    const list = document.getElementById('archiveList');
    const doneTasks = tasks.filter(t => t.completed)
                           .sort((a,b) => new Date(b.completedAt) - new Date(a.completedAt));
    
    list.innerHTML = doneTasks.map(t => createTaskHTML(t)).join('') || '<p style="text-align:center;color:#888;padding:20px;">Архив пуст</p>';
}

function createTaskHTML(t) {
    const tTags = (t.tagIds || []).map(id => tags.find(tag => tag.id === id)).filter(Boolean);
    const timeBadge = t.time ? `<span class="task-time-badge">${t.time}</span>` : '';
    
    return `
        <div class="task-card ${t.completed ? 'completed' : ''}">
            <input type="checkbox" ${t.completed ? 'checked' : ''} onchange="toggleTask(${t.id})">
            <div class="task-info">
                <div>${timeBadge} <strong>${t.text}</strong></div>
                <div class="task-tags-row">
                    ${tTags.map(tag => `<span class="tag-badge" style="background:${tag.color}">${tag.name}</span>`).join('')}
                </div>
            </div>
            <button class="delete-btn" onclick="deleteTask(${t.id})">✕</button>
        </div>
    `;
}

// --- Теги и Аналитика ---
function createTag() {
    const name = document.getElementById('newTagName').value;
    const color = document.getElementById('newTagColor').value;
    if (!name) return;
    tags.push({ id: Date.now(), name, color });
    document.getElementById('newTagName').value = '';
    saveAllData();
    renderTagsManagement();
}

function renderTagsManagement() {
    const list = document.getElementById('tags-management-list');
    list.innerHTML = tags.map(t => `
        <div class="tag-manage-item">
            <span class="tag-badge" style="background:${t.color}">${t.name}</span>
            <button class="delete-btn" onclick="deleteTag(${t.id})">✕</button>
        </div>
    `).join('');
}

function deleteTag(id) {
    tags = tags.filter(t => t.id !== id);
    tasks.forEach(task => task.tagIds = (task.tagIds || []).filter(tid => tid !== id));
    saveAllData();
    renderTagsManagement();
}

function renderTagChoices() {
    const container = document.getElementById('tag-choices');
    container.innerHTML = tags.map(t => `
        <div class="tag-chip ${selectedTagsForNewTask.includes(t.id) ? 'selected' : ''}" 
             onclick="toggleTagSelection(${t.id})"
             style="${selectedTagsForNewTask.includes(t.id) ? `background:${t.color};border-color:${t.color}`:''}">
            ${t.name}
        </div>
    `).join('');
}

function toggleTagSelection(id) {
    selectedTagsForNewTask.includes(id) ? 
        selectedTagsForNewTask = selectedTagsForNewTask.filter(i => i !== id) : 
        selectedTagsForNewTask.push(id);
    renderTagChoices();
}

// --- Аналитика ---
function renderAnalytics() {
    renderSummary();
    renderHeatmap();
    renderRadarChart();
}

function renderHeatmap() {
    const heatmap = document.getElementById('heatmap');
    if (!heatmap) return; heatmap.innerHTML = '';
    const counts = {};
    tasks.forEach(t => { if (t.completedAt) counts[new Date(t.completedAt).toDateString()] = (counts[new Date(t.completedAt).toDateString()] || 0) + 1; });

    const startDate = new Date(); startDate.setDate(startDate.getDate() - 120);
    const dayOfWeek = startDate.getDay();
    startDate.setDate(startDate.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));

    for (let i = 0; i < 130; i++) {
        const d = new Date(startDate); d.setDate(d.getDate() + i);
        const count = counts[d.toDateString()] || 0;
        let lvl = count > 0 ? (count > 2 ? (count > 4 ? 4 : 3) : 2) : 0;
        const sq = document.createElement('div');
        sq.className = `heat-square level-${lvl}`;
        sq.title = `${d.toDateString()}: ${count}`;
        heatmap.appendChild(sq);
    }
    setTimeout(() => heatmap.scrollLeft = heatmap.scrollWidth, 100);
}

function renderRadarChart() {
    const ctx = document.getElementById('radarChart').getContext('2d');
    const tagStats = {};
    tags.forEach(tag => {
        tagStats[tag.name] = tasks.filter(task => task.completed && task.tagIds?.includes(tag.id)).length;
    });
    const top = Object.entries(tagStats).sort((a,b) => b[1]-a[1]).slice(0, 5);
    while (top.length < 5) top.push(["-", 0]);
    if (myRadarChart) myRadarChart.destroy();
    myRadarChart = new Chart(ctx, {
        type: 'radar',
        data: {
            labels: top.map(t => t[0]),
            datasets: [{ data: top.map(t => t[1]), backgroundColor: 'rgba(0,123,255,0.4)', borderColor: '#007bff' }]
        },
        options: { scales: { r: { suggestedMin: 0, ticks: { display: false } } }, plugins: { legend: { display: false } } }
    });
}

function renderSummary() {
    const total = tasks.length;
    const comp = tasks.filter(t => t.completed).length;
    document.getElementById('stats-summary').innerHTML = `
        <div class="stat-card"><h3>Всего</h3><p>${total}</p></div>
        <div class="stat-card"><h3>Сделано</h3><p>${comp}</p></div>
    `;
}

// Запуск
document.addEventListener('click', e => { if (e.target.classList.contains('day-btn')) e.target.classList.toggle('active'); });
window.addEventListener('DOMContentLoaded', () => {
    initDB().then(() => {
        checkAuthStatus();
    });
});