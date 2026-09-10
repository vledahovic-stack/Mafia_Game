console.log('DEBUG URL:', JSON.stringify(process.env.TURSO_DATABASE_URL));
console.log('DEBUG TOKEN LENGTH:', (process.env.TURSO_AUTH_TOKEN || '').trim().length);

const { createClient } = require('@libsql/client');

// Очистка переменных окружения от случайных кавычек и пробелов
function cleanEnv(val) {
    if (!val) return '';
    return val.trim().replace(/^["']|["']$/g, '');
}

let rawUrl = cleanEnv(process.env.TURSO_DATABASE_URL);
let authToken = cleanEnv(process.env.TURSO_AUTH_TOKEN);

if (authToken.startsWith('Bearer ')) {
    authToken = authToken.replace(/^Bearer\s+/, '');
}

if (rawUrl && !rawUrl.startsWith('libsql://') && !rawUrl.startsWith('https://')) {
    rawUrl = `libsql://${rawUrl}`;
}

const client = createClient({
    url: rawUrl || 'file:local.db',
    authToken: authToken,
});

// Преобразование BigInt в Number для предотвращения 500 ошибок в Express res.json
function sanitizeRow(row) {
    if (!row) return row;
    const cleanRow = {};
    for (const key in row) {
        if (typeof row[key] === 'bigint') {
            cleanRow[key] = Number(row[key]);
        } else {
            cleanRow[key] = row[key];
        }
    }
    return cleanRow;
}

// Инициализация структуры таблиц
async function initDb() {
    try {
        await client.execute(`
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT UNIQUE,
                username TEXT NOT NULL,
                password TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                balance INTEGER DEFAULT 0,
                last_login_date TEXT DEFAULT NULL,
                login_streak INTEGER DEFAULT 0,
                is_admin INTEGER DEFAULT 0,
                xp INTEGER DEFAULT 0,
                free_nickname_changes INTEGER DEFAULT 1
            )
        `);

        await client.execute(`
            CREATE TABLE IF NOT EXISTS blacklists (
                user_id INTEGER NOT NULL,
                blocked_user_id INTEGER NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (user_id, blocked_user_id),
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY (blocked_user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        `);

        await client.execute(`
            CREATE TABLE IF NOT EXISTS inventory (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                item_id TEXT NOT NULL,
                quantity INTEGER DEFAULT 0,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        `);

        // Безопасное добавление новых колонок в уже существующую базу данных
        const alterQueries = [
            `ALTER TABLE users ADD COLUMN balance INTEGER DEFAULT 0`,
            `ALTER TABLE users ADD COLUMN last_login_date TEXT DEFAULT NULL`,
            `ALTER TABLE users ADD COLUMN login_streak INTEGER DEFAULT 0`,
            `ALTER TABLE users ADD COLUMN is_admin INTEGER DEFAULT 0`,
            `ALTER TABLE users ADD COLUMN xp INTEGER DEFAULT 0`,
            `ALTER TABLE users ADD COLUMN email TEXT DEFAULT NULL`,
            `ALTER TABLE users ADD COLUMN free_nickname_changes INTEGER DEFAULT 1`
        ];

        for (const query of alterQueries) {
            try {
                await client.execute(query);
            } catch (e) {
                // Игнорируем ошибки, если колонки уже созданы
            }
        }
        console.log('БД Turso успешно инициализирована');
    } catch (err) {
        console.error('Ошибка инициализации БД Turso:', err);
    }
}

initDb();

const dbWrapper = {
    serialize: (fn) => {
        if (typeof fn === 'function') fn();
    },

    run: function (sql, params = [], callback) {
        if (typeof params === 'function') {
            callback = params;
            params = [];
        }
        client.execute({ sql, args: params })
            .then(res => {
                if (callback) {
                    const lastID = res.lastInsertRowid !== undefined ? Number(res.lastInsertRowid) : 0;
                    const changes = res.rowsAffected || 0;
                    callback.call({ lastID, changes }, null);
                }
            })
            .catch(err => {
                if (callback) callback(err);
            });
    },

    get: function (sql, params = [], callback) {
        if (typeof params === 'function') {
            callback = params;
            params = [];
        }
        client.execute({ sql, args: params })
            .then(res => {
                const row = res.rows && res.rows.length > 0 ? sanitizeRow(res.rows[0]) : null;
                if (callback) callback(null, row);
            })
            .catch(err => {
                if (callback) callback(err);
            });
    },

    all: function (sql, params = [], callback) {
        if (typeof params === 'function') {
            callback = params;
            params = [];
        }
        client.execute({ sql, args: params })
            .then(res => {
                const rows = (res.rows || []).map(sanitizeRow);
                if (callback) callback(null, rows);
            })
            .catch(err => {
                if (callback) callback(err);
            });
    },

    on: function (event, listener) {
        // Заглушка для событий
    }
};

module.exports = dbWrapper;