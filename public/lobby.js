const socket = io();

const urlParams = new URLSearchParams(window.location.search);
// Считываем ID комнаты с поддержкой параметров 'id' и 'room'
const roomId = urlParams.get('room') || urlParams.get('id');
const username = localStorage.getItem('username');

if (!username) {
    alert('Сначала авторизуйтесь');
    window.location.href = '/index.html';
} else if (!roomId) {
    alert('Комната не найдена');
    window.location.href = '/index.html';
} else {
    document.getElementById('room-title').textContent = `Лобби комнаты: ${roomId}`;
    socket.emit('joinRoom', { roomId, username });
}

// Слушаем обновление списка игроков от сервера
socket.on('updatePlayers', (players) => {
    const playersList = document.getElementById('players-list');
    if (playersList) {
        playersList.innerHTML = '';

        players.forEach(player => {
            const li = document.createElement('li');
            const name = player.username || player.name || 'Игрок';
            const statusText = player.ready ? ' (Готов)' : ' (Не готов)';
            li.textContent = `${name}${statusText}`;
            playersList.appendChild(li);
        });
    }

    // Показываем кнопку "Начать игру" первому игроку в списке (хосту)
    const btnStart = document.getElementById('btn-start');
    if (btnStart) {
        if (players.length > 0 && (players[0].username === username || players[0].name === username)) {
            btnStart.style.display = 'inline-block';
        } else {
            btnStart.style.display = 'none';
        }
    }
});

// Нажатие на кнопку "Начать игру"
const btnStart = document.getElementById('btn-start');
if (btnStart) {
    btnStart.addEventListener('click', () => {
        socket.emit('startGame', { roomId });
    });
}

// Слушаем запуск игры от сервера и перенаправляем на game.html с правильным ключом 'room'
socket.on('gameStarted', (data) => {
    if (data) {
        sessionStorage.setItem('playerData', JSON.stringify(data));
    }
    window.location.href = `/game.html?room=${roomId}`;
});

const btnLeave = document.getElementById('btn-leave');
if (btnLeave) {
    btnLeave.addEventListener('click', () => {
        window.location.href = '/index.html';
    });
}

const btnReady = document.getElementById('btn-ready');
if (btnReady) {
    btnReady.addEventListener('click', () => {
        socket.emit('toggleReady', { roomId, username });
    });
}