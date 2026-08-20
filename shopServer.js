const db = require('./database');

const SHOP_ITEMS = {
    'role_card': { name: 'Карточка выбора роли', price: 1000 }
};

function setupShopEvents(io, socket) {
    socket.on('getShopData', () => {
        const userId = socket.userId || socket.request.session?.userId;

        if (!userId) {
            return socket.emit('shopData', { coins: 0, inventory: {} });
        }

        db.get('SELECT balance FROM users WHERE id = ?', [userId], (err, user) => {
            if (err || !user) {
                return socket.emit('shopData', { coins: 0, inventory: {} });
            }

            db.all('SELECT item_id, quantity FROM inventory WHERE user_id = ?', [userId], (invErr, rows) => {
                const inventory = {};
                if (rows) {
                    rows.forEach(row => {
                        inventory[row.item_id] = row.quantity;
                    });
                }
                socket.emit('shopData', { coins: user.balance || 0, inventory });
            });
        });
    });

    socket.on('buyItem', ({ itemId, count }) => {
        const userId = socket.userId || socket.request.session?.userId;

        if (!userId) {
            return socket.emit('buyResult', { 
                success: false, 
                message: 'Покупка доступна только авторизованным игрокам' 
            });
        }

        const item = SHOP_ITEMS[itemId];
        const buyCount = Math.max(1, parseInt(count, 10) || 1);

        if (!item) {
            return socket.emit('buyResult', { success: false, message: 'Товар не найден' });
        }

        const totalPrice = item.price * buyCount;

        db.get('SELECT balance FROM users WHERE id = ?', [userId], (err, user) => {
            if (err || !user) {
                return socket.emit('buyResult', { success: false, message: 'Ошибка получения профиля' });
            }

            if ((user.balance || 0) < totalPrice) {
                return socket.emit('buyResult', { 
                    success: false, 
                    message: `Недостаточно монет! Требуется: ${totalPrice}, у вас: ${user.balance}` 
                });
            }

            const newBalance = user.balance - totalPrice;

            // Списываем средства
            db.run('UPDATE users SET balance = ? WHERE id = ?', [newBalance, userId], (updateErr) => {
                if (updateErr) {
                    return socket.emit('buyResult', { success: false, message: 'Ошибка списания средств' });
                }

                // Записываем предметы в базу данных
                db.get('SELECT quantity FROM inventory WHERE user_id = ? AND item_id = ?', [userId, itemId], (invErr, row) => {
                    const newQuantity = (row ? row.quantity : 0) + buyCount;

                    if (row) {
                        db.run('UPDATE inventory SET quantity = ? WHERE user_id = ? AND item_id = ?', [newQuantity, userId, itemId]);
                    } else {
                        db.run('INSERT INTO inventory (user_id, item_id, quantity) VALUES (?, ?, ?)', [userId, itemId, buyCount]);
                    }

                    socket.emit('buyResult', {
                        success: true,
                        coins: newBalance,
                        itemCount: newQuantity,
                        message: `Успешно куплено: ${buyCount} шт. (${item.name})`
                    });
                });
            });
        });
    });
}

module.exports = { setupShopEvents };