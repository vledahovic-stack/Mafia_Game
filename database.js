const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./database.db');

db.serialize(() => {
    // Таблица пользователей
    db.run(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            balance INTEGER DEFAULT 0,
            last_login_date TEXT DEFAULT NULL,
            login_streak INTEGER DEFAULT 0,
            is_admin INTEGER DEFAULT 0
        )
    `);

    // Таблица черного списка
    db.run(`
        CREATE TABLE IF NOT EXISTS blacklists (
            user_id INTEGER NOT NULL,
            blocked_user_id INTEGER NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (user_id, blocked_user_id),
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (blocked_user_id) REFERENCES users(id) ON DELETE CASCADE
        )
    `);

    const alterQueries = [
        `ALTER TABLE users ADD COLUMN balance INTEGER DEFAULT 0`,
        `ALTER TABLE users ADD COLUMN last_login_date TEXT DEFAULT NULL`,
        `ALTER TABLE users ADD COLUMN login_streak INTEGER DEFAULT 0`,
        `ALTER TABLE users ADD COLUMN is_admin INTEGER DEFAULT 0`
    ];

    alterQueries.forEach(query => {
        db.run(query, () => {});
    });
});

module.exports = db;