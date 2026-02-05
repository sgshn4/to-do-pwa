const express = require('express');
const fs = require('fs');
const path = require('path');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const helmet = require('helmet');
const FileStore = require('session-file-store')(session);

const app = express();
const DATA_FILE = path.join(__dirname, 'tasks.json');
const PORT = 3000;

// --- НАСТРОЙКИ БЕЗОПАСНОСТИ ---
app.use(helmet({
    contentSecurityPolicy: false, // Чтобы Chart.js и Google Fonts работали без проблем
}));
app.use(express.json());
app.use(express.static('public'));

app.use(session({
    store: new FileStore({ path: './sessions', retries: 0 }),
    secret: '###',
    resave: true, // Поменяй на true для надежности при тестах
    saveUninitialized: true, // Поменяй на true
    cookie: { 
        secure: false, // Обязательно false для HTTP (без S)
        httpOnly: true,
        sameSite: 'lax', // Важно для работы по IP
        maxAge: 30 * 24 * 60 * 60 * 1000 
    }
}));
// Хеш твоего пароля (сгенерируй его один раз)
// Например, для пароля "12345" хеш будет примерно такой:
const ADMIN_PASSWORD_HASH = '###'; 

// --- MIDDLEWARE ДЛЯ ПРОВЕРКИ ВХОДА ---
const checkAuth = (req, res, next) => {
    if (req.session.isLoggedIn) {
        next();
    } else {
        res.status(401).json({ error: 'Нужна авторизация' });
    }
};

// --- МАРШРУТЫ ---

// Вход
app.post('/api/login', async (req, res) => {
    const { password } = req.body;
    const match = await bcrypt.compare(password, ADMIN_PASSWORD_HASH);
    
    if (match) {
        req.session.isLoggedIn = true;
        res.sendStatus(200);
    } else {
        res.status(401).json({ error: 'Неверный пароль' });
    }
});

// Выход
app.post('/api/logout', (req, res) => {
    req.session.destroy();
    res.sendStatus(200);
});

// Работа с данными (защищена checkAuth)
app.get('/api/data', checkAuth, (req, res) => {
    const data = fs.readFileSync(DATA_FILE, 'utf8');
    res.json(JSON.parse(data || '{"tasks":[], "tags":[]}'));
});

app.post('/api/data', checkAuth, (req, res) => {
    fs.writeFileSync(DATA_FILE, JSON.stringify(req.body, null, 2));
    res.sendStatus(200);
});

// Запуск
app.listen(PORT, () => {
    console.log(`Сервер: http://localhost:${PORT}`);
});