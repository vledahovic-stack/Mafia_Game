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

function buyItem(itemId, quantity) {
    const count = parseInt(quantity, 10) || 1;
    socket.emit('buyItem', { itemId: itemId, count: count });
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