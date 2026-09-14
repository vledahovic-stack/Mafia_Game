const socket = io();

function openModal(id) {
    const modal = document.getElementById(id);
    if (modal) {
        modal.style.display = 'flex';
    }
}

function closeModal(id) {
    const modal = document.getElementById(id);
    if (modal) {
        modal.style.display = 'none';
    }
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

function switchAuthTab(tab) {
    const loginContent = document.getElementById('auth-login-content');
    const registerContent = document.getElementById('auth-register-content');
    const tabLoginBtn = document.getElementById('tab-btn-login');
    const tabRegisterBtn = document.getElementById('tab-btn-register');

    if (tab === 'login') {
        loginContent.style.display = 'block';
        registerContent.style.display = 'none';
        tabLoginBtn.classList.add('active');
        tabRegisterBtn.classList.remove('active');
    } else {
        loginContent.style.display = 'none';
        registerContent.style.display = 'block';
        tabRegisterBtn.classList.add('active');
        tabLoginBtn.classList.remove('active');
    }
}

function setLoggedInUser(username) {
    const authBtn = document.getElementById('btn-auth');
    if (authBtn) authBtn.style.display = 'none';

    document.getElementById('btn-logout').style.display = 'inline-block';
    
    const bonusBtn = document.getElementById('btn-daily-bonus');
    if (bonusBtn) {
        bonusBtn.style.display = 'inline-block';
        bonusBtn.onclick = claimDailyBonus;
    }

    loadBalance();
}

function setLoggedOutUser() {
    const authBtn = document.getElementById('btn-auth');
    if (authBtn) authBtn.style.display = 'inline-block';

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
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js');
    }

    try {
        const res = await fetch('/api/user/profile', { credentials: 'include' });
        if (res.ok) {
            const user = await res.json();
            if (user && user.username) {
                localStorage.setItem('username', user.username);
                if (user.id) {
                    localStorage.setItem('userId', user.id);
                }
                setLoggedInUser(user.username);
                if (user.welcome_chest_claimed === 0) {
                    showWelcomeChestModal();
                }

                // Показываем окно только если есть сундуки И количество изменилось с прошлого раза (крестик не сбрасывал повторный показ)
                if (user.pending_chests_count > 0) {
                    const lastShownCount = localStorage.getItem('last_seen_pending_chests');
                    if (lastShownCount !== String(user.pending_chests_count)) {
                        showHomeAdminChestModal(user.pending_chests_count);
                    }
                }
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

// Функция создания и показа интерактивного модального окна сундука
function showHomeAdminChestModal(pendingCount) {
    let modal = document.getElementById('home-admin-chest-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'home-admin-chest-modal';
        modal.className = 'modal';
        modal.style.cssText = 'display: flex; align-items: center; justify-content: center; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.7); z-index: 2000;';
        modal.innerHTML = `
            <div class="modal-content" style="background: #1a202c; padding: 25px; border-radius: 12px; text-align: center; max-width: 400px; width: 90%; color: #fff; box-shadow: 0 4px 20px rgba(0,0,0,0.5); position: relative;">
                <button onclick="closeHomeAdminChestModal(${pendingCount})" style="position: absolute; top: 10px; right: 15px; background: none; border: none; color: #a0aec0; font-size: 20px; cursor: pointer;">&times;</button>
                
                <div id="home-chest-select-view">
                    <h3>📦 Сундук от администратора!</h3>
                    <p style="margin: 15px 0; color: #a0aec0;">Вам назначен специальный сундук с наградами.</p>
                    <div style="margin: 20px 0;">
                        <img id="home-chest-img" src="/chest_closed.png" class="chest-image" style="width: 100px; height: 100px; object-fit: contain;">
                    </div>
                    <button onclick="claimHomeAdminChest(${pendingCount})" style="background: #ffc107; color: #1a202c; border: none; padding: 10px 20px; border-radius: 6px; font-weight: bold; cursor: pointer; width: 100%;">Открыть сундук</button>
                </div>

                <div id="home-chest-result-view" style="display: none;">
                    <h3 id="home-chest-result-title">Открываем...</h3>
                    <div style="margin: 20px 0;">
                        <img id="home-chest-result-img" src="/chest_closed.png" class="chest-image" style="width: 100px; height: 100px; object-fit: contain;">
                    </div>
                    <div id="home-chest-rewards-list" style="margin: 15px 0; font-size: 16px; color: #e2e8f0;"></div>
                    <button onclick="document.getElementById('home-admin-chest-modal').style.display='none'; location.reload();" style="background: #ffc107; color: #1a202c; border: none; padding: 10px 20px; border-radius: 6px; font-weight: bold; cursor: pointer; display: none; width: 100%;" id="home-close-result-btn">Отлично</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    } else {
        modal.style.display = 'flex';
        document.getElementById('home-chest-select-view').style.display = 'block';
        document.getElementById('home-chest-result-view').style.display = 'none';
        const img = document.getElementById('home-chest-img');
        if (img) {
            img.src = '/chest_closed.png';
            img.className = 'chest-image';
        }
    }
}

// Функция закрытия крестиком (запоминает текущее количество, чтобы больше не показывать при обновлении)
function closeHomeAdminChestModal(pendingCount) {
    localStorage.setItem('last_seen_pending_chests', String(pendingCount));
    const modal = document.getElementById('home-admin-chest-modal');
    if (modal) modal.style.display = 'none';
}

// Функция мгновенного открытия сундука с анимацией прямо на главной
async function claimHomeAdminChest(pendingCount) {
    if (pendingCount) {
        localStorage.setItem('last_seen_pending_chests', String(pendingCount));
    }
    const selectView = document.getElementById('home-chest-select-view');
    // ... дальше остальной код функции без изменений ...
    const resultView = document.getElementById('home-chest-result-view');
    const titleElem = document.getElementById('home-chest-result-title');
    const rewardsList = document.getElementById('home-chest-rewards-list');
    const closeBtn = document.getElementById('home-close-result-btn');
    const chestImg = document.getElementById('home-chest-result-img');

    if (selectView) selectView.style.display = 'none';
    if (resultView) resultView.style.display = 'block';

    if (chestImg) {
        chestImg.src = '/chest_closed.png';
        chestImg.className = 'chest-image chest-animating';
    }
    
    if (titleElem) titleElem.textContent = 'Открываем...';
    if (rewardsList) rewardsList.innerHTML = '';
    if (closeBtn) closeBtn.style.display = 'none';

    try {
        const response = await fetch('/api/user/claim-custom-chest', {
            method: 'POST',
            credentials: 'include'
        });
        const data = await response.json();

        setTimeout(() => {
            if (response.ok && data.success) {
                if (chestImg) {
                    chestImg.src = '/chest_open.png';
                    chestImg.className = 'chest-image chest-opened';
                }
                if (titleElem) titleElem.textContent = '🎉 Сундук успешно открыт!';

                let html = '';
                if (data.rewards.coins > 0) {
                    html += `<div>💰 Монеты: <strong>+${data.rewards.coins}</strong></div>`;
                }

                const itemNames = {
                    'role_card': 'Карточки роли',
                    'chest_bronze': 'Бронзовый сундук',
                    'chest_silver': 'Серебряный сундук',
                    'chest_gold': 'Золотой сундук'
                };

                if (data.rewards.items) {
                    for (const [itemId, qty] of Object.entries(data.rewards.items)) {
                        if (qty > 0) {
                            const name = itemNames[itemId] || itemId;
                            html += `<div>🎁 ${name}: <strong>+${qty}</strong></div>`;
                        }
                    }
                }

                if (rewardsList) rewardsList.innerHTML = html || '<div>Пусто</div>';
                if (closeBtn) closeBtn.style.display = 'inline-block';
                if (typeof loadBalance === 'function') loadBalance();
            } else {
                if (titleElem) titleElem.textContent = '❌ Ошибка';
                if (rewardsList) rewardsList.innerHTML = `<div>${data.error || 'Не удалось открыть сундук'}</div>`;
                if (closeBtn) closeBtn.style.display = 'inline-block';
            }
        }, 800);

    } catch (err) {
        console.error('Ошибка запроса:', err);
        if (titleElem) titleElem.textContent = '❌ Ошибка';
        if (rewardsList) rewardsList.innerHTML = '<div>Ошибка связи с сервером</div>';
        if (closeBtn) closeBtn.style.display = 'inline-block';
    }
}

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
    const email = inputs[0].value.trim();
    const password = inputs[1].value;

    const response = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, password })
    });

    const result = await response.json();

    if (result.success) {
        alert(`Регистрация прошла успешно! Ваш стартовый никнейм: ${result.username}`);
        localStorage.setItem('username', result.username);
        setLoggedInUser(result.username);
        closeModal('modal-auth');
        e.target.reset();
    } else {
        alert(result.error || 'Ошибка при регистрации');
    }
});

// Обработка формы входа
document.getElementById('form-login').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const inputs = e.target.querySelectorAll('input');
    const email = inputs[0].value.trim();
    const password = inputs[1].value;

    try {
        const response = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ email, password })
        });

        const result = await response.json();

        if (result.success) {
            localStorage.setItem('username', result.username);
            localStorage.setItem('userId', result.userId);
            setLoggedInUser(result.username);
            closeModal('modal-auth');
            e.target.reset();

            if (result.welcome_chest_claimed === 0) {
                showWelcomeChestModal();
            }
        } else {
            alert(result.error || 'Ошибка при входе');
        }
    } catch (err) {
        console.error('Ошибка входа:', err);
        alert('Произошла ошибка при отправке данных');
    }
});

// Функция просто показывает модальное окно
function showWelcomeChestModal() {
    const modal = document.getElementById('welcome-chest-modal');
    if (modal) {
        modal.style.display = 'flex';
    }
}

// А вот эта функция уже вызывается по клику на кнопку в модальном окне
async function claimWelcomeChest() {
    try {
        const res = await fetch('/api/user/claim-welcome-chest', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });

        const data = await res.json();

        if (res.ok && data.success) {
            let message = `Вы получили награду!\n💰 Монеты: ${data.coins}`;
            
            if (data.items && data.items.length > 0) {
                const itemNames = {
                    role_card: 'Карточка выбора роли',
                    bronze_chest: 'Бронзовый сундук',
                    silver_chest: 'Серебряный сундук',
                    gold_chest: 'Золотой сундук'
                };
                
                message += '\n🎁 Предметы:\n' + data.items.map(i => `- ${itemNames[i.itemId] || i.itemId}: ${i.qty} шт.`).join('\n');
            }

            alert(message);
            
            const modal = document.getElementById('welcome-chest-modal');
            if (modal) modal.style.display = 'none';

            if (typeof loadBalance === 'function') loadBalance();
            if (typeof loadInventory === 'function') loadInventory();
        } else {
            alert(data.error || 'Ошибка при получении сундука');
        }
    } catch (e) {
        console.error('Ошибка отправки запроса:', e);
        alert('Не удалось получить награду');
    }
}

document.getElementById('btn-claim-welcome-chest')?.addEventListener('click', claimWelcomeChest);

async function checkWelcomeChestStatus() {
    try {
        const res = await fetch('/api/user/profile');
        if (!res.ok) return;

        const user = await res.json();

        if (user && !user.welcome_chest_claimed) {
            const modal = document.getElementById('welcome-chest-modal');
            if (modal) modal.style.display = 'flex';
        }
    } catch (e) {
        console.error('Ошибка проверки статуса сундука:', e);
    }
}

checkWelcomeChestStatus();

// Обработка кнопки выхода
document.getElementById('btn-logout').addEventListener('click', async () => {
    try {
        await fetch('/api/logout', { method: 'POST', credentials: 'include' });
    } catch(e) {}
    localStorage.removeItem('username');
    setLoggedOutUser();
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