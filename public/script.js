let tasks = [];
let tags = [];
let db;
let selectedDate = new Date(); // Выбранный день в календаре
let viewDate = new Date();     // Центр ленты календаря (для навигации по неделям)
let selectedTagsForNewTask = [];
let myRadarChart = null;

// --- 1. ИНИЦИАЛИЗАЦИЯ DATABASE (IndexedDB) ---
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
            await loadTasks();
            showScreen('screen-list');
        } else {
            errorMsg.style.display = 'block';
        }
    } catch (e) { console.error("Ошибка входа:", e); }
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
            document.getElementById('app').style.display = 'none';
        }
    } catch (e) {
        console.log("Оффлайн: работаем локально");
        await loadTasks();
        showScreen('screen-list');
    }
}

// --- 3. СИНХРОНИЗАЦИЯ ДАННЫХ ---
async function loadTasks() {
    const tx = db.transaction(["tasks", "tags"], "readonly");
    tasks = await new Promise(r => tx.objectStore("tasks").getAll().onsuccess = (e) => r(e.target.result || []));
    tags = await new Promise(r => tx.objectStore("tags").getAll().onsuccess = (e) => r(e.target.result || []));
    
    // Сброс повторов (раз в сутки)
    const realToday = new Date().toDateString();
    if (localStorage.getItem('lastResetDate') !== realToday) {
        tasks.forEach(t => {
            if (t.repeatDays && t.repeatDays.length > 0 && !t.date) {
                // Мы не сбрасываем глобальный статус t.completed здесь, 
                // так как логика рендера теперь опирается на t.completedAt
            }
        });
        localStorage.setItem('lastResetDate', realToday);
        await saveAllData(); 
    }
    
    renderTasks();
    try {
        const res = await fetch('/api/data');
        if (res.ok) {
            const data = await res.json();
            tasks = data.tasks || [];
            tags = data.tags || [];
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

// --- 5. ЛОГИКА ЗАДАЧ ---
function addTask() {
    const textInput = document.getElementById('taskText');
    if (!textInput.value) return alert("Введите название задачи");

    const repeatDays = [];
    document.querySelectorAll('#screen-create .day-btn.active').forEach(btn => {
        repeatDays.push(parseInt(btn.dataset.day));
    });

    const newTask = {
        id: Date.now(),
        text: textInput.value,
        date: document.getElementById('taskDate').value || null,
        time: document.getElementById('taskTime').value || null,
        completed: false,
        completedAt: null,
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
    
    const dow = selectedDate.getDay();
    const selDateStr = selectedDate.toDateString();

    const filtered = tasks.filter(t => {
        // Проверяем, была ли задача выполнена именно в этот выбранный день
        let doneToday = false;
        if (t.completedAt) {
            if (new Date(t.completedAt).toDateString() === selDateStr) doneToday = true;
        }

        if (doneToday) return false; // Прячем, если уже сделано сегодня

        // 1. Повторяющиеся
        if (t.repeatDays && t.repeatDays.length > 0) {
            return t.repeatDays.includes(dow);
        }
        // 2. Обычные (скрываем, если выполнены глобально)
        if (t.completed) return false;
        // 3. По дате
        if (t.date) return new Date(t.date).toDateString() === selDateStr;
        
        return true; // Плавающие
    }).sort((a,b) => (a.time || "99:99").localeCompare(b.time || "99:99"));

    list.innerHTML = filtered.map(t => createTaskHTML(t)).join('') || 
        '<p style="text-align:center;color:#888;padding:20px;">Задач нет</p>';
}

function toggleTask(id) {
    const t = tasks.find(t => t.id === id);
    if (!t) return;

    if (t.repeatDays && t.repeatDays.length > 0) {
        // Для повторов фиксируем дату выполнения
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

function renderArchive() {
    const list = document.getElementById('archiveList');
    const done = tasks.filter(t => t.completed).sort((a,b) => new Date(b.completedAt) - new Date(a.completedAt));
    list.innerHTML = done.map(t => createTaskHTML(t)).join('') || '<p style="padding:20px;text-align:center;color:#888;">Архив пуст</p>';
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

// --- 6. ТЕГИ ---
function createTag() {
    const n = document.getElementById('newTagName');
    const c = document.getElementById('newTagColor');
    if (n.value) { tags.push({id:Date.now(), name:n.value, color:c.value}); n.value=''; saveAllData(); renderTagsManagement(); }
}

function renderTagsManagement() {
    const list = document.getElementById('tags-management-list');
    list.innerHTML = tags.map(t => `
        <div class="tag-manage-item">
            <span class="tag-badge" style="background:${t.color}">${t.name}</span>
            <button class="delete-btn" onclick="deleteTag(${t.id})"><span class="material-symbols-outlined">delete</span></button>
        </div>
    `).join('');
}

function deleteTag(id) {
    if (!confirm("Удалить тег?")) return;
    tags = tags.filter(t => t.id !== id);
    tasks.forEach(task => task.tagIds = (task.tagIds || []).filter(tid => tid !== id));
    saveAllData(); renderTagsManagement();
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
    selectedTagsForNewTask.includes(id) ? selectedTagsForNewTask = selectedTagsForNewTask.filter(i => i !== id) : selectedTagsForNewTask.push(id);
    renderTagChoices();
}

// --- 7. АНАЛИТИКА И ЭКСПОРТ ---
function renderAnalytics() {
    renderSummary();
    renderHeatmap();
    renderRadarChart();
}

function renderHeatmap() {
    const heatmap = document.getElementById('heatmap');
    if (!heatmap) return; heatmap.innerHTML = '';
    const counts = {};
    tasks.forEach(t => { 
        if (t.completedAt) {
            const dStr = new Date(t.completedAt).toDateString();
            counts[dStr] = (counts[dStr] || 0) + 1;
        }
    });

    const startDate = new Date(); startDate.setDate(startDate.getDate() - 120);
    const dayOfWeek = startDate.getDay();
    startDate.setDate(startDate.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));

    for (let i = 0; i < 130; i++) {
        const d = new Date(startDate); d.setDate(d.getDate() + i);
        const count = counts[d.toDateString()] || 0;
        let lvl = count > 0 ? (count > 2 ? (count > 4 ? 4 : 3) : 2) : 0;
        const sq = document.createElement('div');
        sq.className = `heat-square level-${lvl}`;
        sq.title = `${d.toDateString()}: ${count} задач`;
        heatmap.appendChild(sq);
    }
    setTimeout(() => heatmap.scrollLeft = heatmap.scrollWidth, 100);
}

function renderRadarChart() {
    const canvas = document.getElementById('radarChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    const tagStats = {};
    tags.forEach(tag => {
        tagStats[tag.name] = tasks.filter(task => 
            task.completed && 
            Array.isArray(task.tagIds) && 
            task.tagIds.includes(tag.id)
        ).length;
    });

    let top = Object.entries(tagStats).sort((a,b) => b[1] - a[1]).slice(0, 5);
    
    if (top.length === 0 || top.every(item => item[1] === 0)) {
        top = [["Нет данных", 0], ["", 0], ["", 0], ["", 0], ["", 0]];
    } else {
        while (top.length < 5) top.push(["-", 0]);
    }

    if (myRadarChart) myRadarChart.destroy();

    myRadarChart = new Chart(ctx, {
        type: 'radar',
        data: {
            labels: top.map(t => t[0]),
            datasets: [{ 
                data: top.map(t => t[1]), 
                backgroundColor: 'rgba(9, 132, 170, 0.4)', 
                borderColor: '#0984aa',
                pointBackgroundColor: '#0984aa'
            }]
        },
        options: { 
            responsive: true,
            maintainAspectRatio: false,
            scales: { r: { suggestedMin: 0, ticks: { display: false } } }, 
            plugins: { legend: { display: false } } 
        }
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

function exportData() {
    const backupData = {
        tasks: tasks,
        tags: tags,
        exportDate: new Date().toISOString()
    };
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(backupData, null, 2));
    const downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute("href", dataStr);
    downloadAnchorNode.setAttribute("download", `todo_backup_${new Date().toISOString().split('T')[0]}.json`);
    document.body.appendChild(downloadAnchorNode);
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
}

function deleteTask(id) {
    if (confirm("Удалить?")) { tasks = tasks.filter(t => t.id !== id); saveAllData(); renderArchive(); }
}

// --- 8. СОБЫТИЯ ---
document.addEventListener('click', (e) => {
    const dayBtn = e.target.closest('#screen-create .day-btn');
    if (dayBtn) {
        dayBtn.classList.toggle('active');
        return;
    }
});

window.addEventListener('DOMContentLoaded', () => {
    initDB().then(() => checkAuthStatus());
});

if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js');
}