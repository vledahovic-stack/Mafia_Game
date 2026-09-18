const socket = io();

document.addEventListener('DOMContentLoaded', () => {
    socket.emit('getShopData');
});

socket.on('shopData', (data) => {
    const coinsElement = document.getElementById('coins-count');
    if (coinsElement) {
        coinsElement.textContent = data.coins || 0;
    }
});

async function buyItem(itemId, quantity) {
    const count = parseInt(quantity, 10) || 1;
    try {
        const response = await fetch('/api/shop/buy', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ itemId, quantity: count })
        });
        const data = await response.json();
        if (response.ok && data.success) {
            const coinsElement = document.getElementById('coins-count');
            if (coinsElement) {
                coinsElement.textContent = data.newBalance ?? data.coins;
            }
            alert(data.message || 'Покупка успешно совершена!');
        } else {
            alert(data.error || data.message || 'Ошибка при покупке');
        }
    } catch (err) {
        console.error('Ошибка покупки через API, пробуем через socket:', err);
        socket.emit('buyItem', { itemId: itemId, count: count });
    }
}

socket.on('buyResult', (response) => {
    if (response.success) {
        const coinsElement = document.getElementById('coins-count');
        if (coinsElement) {
            coinsElement.textContent = response.coins;
        }
        alert(response.message || 'Покупка успешно совершена!');
    } else {
        alert(response.message || 'Ошибка при покупке');
    }
});

// Блокировка масштабирования двухпальцевым жестом на Android
document.addEventListener('touchmove', function(e) {
    if (e.touches.length > 1) {
        e.preventDefault();
    }
}, { passive: false });

// Блокировка двойного тапа
document.addEventListener('dblclick', function(e) {
    e.preventDefault();
}, { passive: false });

document.addEventListener('touchstart', function(e) {
    if (e.touches.length > 1) {
        e.preventDefault();
    }
}, { passive: false });