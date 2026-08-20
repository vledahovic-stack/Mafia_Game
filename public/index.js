const socket = io();

function openModal(id) {
    document.getElementById(id).style.display = 'flex';
}

function closeModal(id) {
    document.getElementById(id).style.display = 'none';
}

// Загрузка текущего баланса пользователя
async function loadBalance() {
    const balanceElem = document.getElementById('user-balance');
    const balanceValueElem = document.getElementById('balance-value');
    if (!balanceElem || !balanceValueElem) return;

    try {
        const response = await fetch('/api/user/balance', {
            credentials: 'include' // Обязательно для передачи Cookie сессии
        });
        if (response.ok) {
            const data = await response.json();
            balanceValueElem.textContent = data.balance;
            balanceElem.style.display = 'inline-block';
        } else {
            balanceElem.style.display = 'none';
        }
    } catch (e) {
        console.error('Ошибка загрузки баланса:', e);
        balanceElem.style.display = 'none';
    }
}

// Функция получения ежедневного бонуса
async function claimDailyBonus() {
    try {
        const response = await fetch('/api/daily-bonus', { 
            method: 'POST',
            credentials: 'include' // Обязательно для передачи Cookie сессии
        });
        const result = await response.json();

        if (result.success) {
            alert(`🎉 Поздравляем! Вы получили ${result.reward} 💰 (Серия входов: ${result.newStreak} дн.)`);
            document.getElementById('balance-value').textContent = result.newBalance;
        } else {
            alert(result.message || result.error || 'Не удалось получить бонус');
        }
    } catch (e) {
        console.error('Ошибка при получении бонуса:', e);
    }
}

function setLoggedInUser(username) {
    document.getElementById('user-name').textContent = username;
    document.getElementById('btn-login').style.display = 'none';
    document.getElementById('btn-register').style.display = 'none';
    document.getElementById('btn-logout').style.display = 'inline-block';
    
    const bonusBtn = document.getElementById('btn-daily-bonus');
    if (bonusBtn) {
        bonusBtn.style.display = 'inline-block';
        bonusBtn.onclick = claimDailyBonus; // Привязываем клик на кнопку бонуса
    }

    loadBalance();
}

function setLoggedOutUser() {
    document.getElementById('user-name').textContent = 'Гость';
    document.getElementById('btn-login').style.display = 'inline-block';
    document.getElementById('btn-register').style.display = 'inline-block';
    document.getElementById('btn-logout').style.display = 'none';
    
    const balanceElem = document.getElementById('user-balance');
    if (balanceElem) balanceElem.style.display = 'none';

    const bonusBtn = document.getElementById('btn-daily-bonus');
    if (bonusBtn) bonusBtn.style.display = 'none';
}

// Загрузка и динамическая генерация стилизованных комнат
async function loadRooms() {
    try {
        const response = await fetch('/api/rooms');
        const rooms = await response.json();
        const roomsList = document.getElementById('rooms-list') || document.querySelector('main section:nth-child(2) ul');
        const onlineCounter = document.getElementById('online-counter');
        
        if (!roomsList) return;
        
        roomsList.innerHTML = '';

        let totalOnline = 0;

        if (!rooms || rooms.length === 0) {
            roomsList.innerHTML = `
                <li class="room-card waiting" style="justify-content: center; padding: 15px; color: #a0aec0;">
                    <span>Нет активных комнат. Будьте первым, кто создаст!</span>
                </li>
            `;
            if (onlineCounter) onlineCounter.textContent = 'В онлайне: 0';
            return;
        }

        rooms.forEach(room => {
            const playersCount = room.players ? room.players.length : 0;
            const maxPlayers = room.maxPlayers || 10;
            totalOnline += playersCount;

            const isPlaying = room.status === 'playing' || room.isStarted;
            const cardClass = isPlaying ? 'playing' : 'waiting';
            const statusBadgeClass = isPlaying ? 'status-playing' : 'status-waiting';
            const statusText = isPlaying ? 'Идёт игра' : 'Ждём';
            const btnText = isPlaying ? 'Смотреть' : 'Заскочить';

            const li = document.createElement('li');
            li.className = `room-card ${cardClass}`;
            li.innerHTML = `
                <div class="room-info">
                    <div class="room-header">
                        <span class="room-title">Комната #${room.id}</span>
                        <span class="badge-status ${statusBadgeClass}">${statusText}</span>
                    </div>
                    <div class="room-details">
                        <span>👥 ${playersCount}/${maxPlayers}</span>
                        <span>🎭 ${room.mode || 'Классика'}</span>
                    </div>
                </div>
                <div class="room-actions">
                    <button class="btn-join ${!isPlaying ? 'active-btn' : ''}" onclick="joinRoom('${room.id}')" ${isPlaying ? 'disabled' : ''}>${btnText}</button>
                </div>
            `;
            roomsList.appendChild(li);
        });

        if (onlineCounter) {
            onlineCounter.textContent = `В онлайне: ${totalOnline}`;
        }
    } catch (e) {
        console.error('Ошибка при загрузке комнат:', e);
    }
}

function joinRoom(roomId) {
    window.location.href = `/game.html?id=${roomId}`;
}

document.addEventListener('DOMContentLoaded', async () => {
    // Проверяем сессию через профиль пользователя
    try {
        const res = await fetch('/api/user/profile', { credentials: 'include' });
        if (res.ok) {
            const user = await res.json();
            if (user && user.username) {
                localStorage.setItem('username', user.username);
                setLoggedInUser(user.username);
            } else {
                checkLocalUser();
            }
        } else {
            checkLocalUser();
        }
    } catch (e) {
        checkLocalUser();
    }

    loadRooms();
});

function checkLocalUser() {
    const savedUsername = localStorage.getItem('username');
    if (savedUsername) {
        setLoggedInUser(savedUsername);
    } else {
        setLoggedOutUser();
    }
}

// Обработка кнопки «Создать комнату»
const createRoomBtn = document.querySelector('.btn-create-room') || document.querySelector('main section:first-child button');
if (createRoomBtn) {
    createRoomBtn.addEventListener('click', async () => {
        const username = localStorage.getItem('username');
        if (!username) {
            alert('Сначала войдите в аккаунт');
            openModal('modal-login');
            return;
        }

        const response = await fetch('/api/rooms/create', { 
            method: 'POST',
            credentials: 'include'
        });
        const result = await response.json();

        if (result.success) {
            window.location.href = `/game.html?id=${result.roomId}`;
        }
    });
}

// Обработка формы регистрации
document.getElementById('form-register').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const inputs = e.target.querySelectorAll('input');
    const username = inputs[0].value;
    const password = inputs[1].value;

    const response = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ username, password })
    });

    const result = await response.json();

    if (result.success) {
        alert('Регистрация прошла успешно!');
        closeModal('modal-register');
        e.target.reset();
    } else {
        alert(result.error || 'Ошибка при регистрации');
    }
});

// Обработка формы входа
document.getElementById('form-login').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const inputs = e.target.querySelectorAll('input');
    const username = inputs[0].value;
    const password = inputs[1].value;

    const response = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ username, password })
    });

    const result = await response.json();

    if (result.success) {
        localStorage.setItem('username', result.username);
        setLoggedInUser(result.username);
        closeModal('modal-login');
        e.target.reset();
    } else {
        alert(result.error || 'Ошибка при входе');
    }
});

// Обработка кнопки выхода
document.getElementById('btn-logout').addEventListener('click', async () => {
    try {
        await fetch('/api/logout', { method: 'POST', credentials: 'include' });
    } catch(e) {}
    localStorage.removeItem('username');
    setLoggedOutUser();
});