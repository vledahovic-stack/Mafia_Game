// Вспомогательная функция для расчета уровня и прогресса опыта
function calculateLevel(totalXp = 0) {
    let level = 1;
    let requiredForNext = 10; // XP для первого уровня
    let currentXp = totalXp;

    // Расчет уровня с возрастанием сложности (каждый уровень требует на 10 XP больше)
    while (currentXp >= requiredForNext) {
        currentXp -= requiredForNext;
        level++;
        requiredForNext = level * 10;
    }

    const progress = Math.floor((currentXp / requiredForNext) * 100);

    return {
        level,
        currentXp,
        requiredForNext,
        progress
    };
}

// Вспомогательная функция склонения слова "сундук"
function getChestDeclension(number) {
    const cases = [2, 0, 1, 1, 1, 2];
    const titles = ['сундук', 'сундука', 'сундуков'];
    return titles[(number % 100 > 4 && number % 100 < 20) ? 2 : cases[(number % 10 < 5) ? number % 10 : 5]];
}

async function loadProfile() {
    try {
        const response = await fetch('/api/user/profile', { credentials: 'include' });
        if (!response.ok) {
            if (response.status === 401) {
                alert('Пожалуйста, войдите в систему');
                window.location.href = '/';
                return;
            }
            throw new Error(`Ошибка сервера: ${response.status}`);
        }
        
        const user = await response.json();
        
        // Безопасная установка текстовых значений
        const idElem = document.getElementById('profile-id');
        if (idElem) idElem.textContent = user.id;

        const emailElem = document.getElementById('profile-email');
        if (emailElem) emailElem.textContent = user.email || 'Не указан';

        const nameElem = document.getElementById('profile-username');
        if (nameElem) nameElem.textContent = user.username;

        const freeChangesElem = document.getElementById('profile-free-changes');
        if (freeChangesElem) freeChangesElem.textContent = user.free_nickname_changes ?? 0;

        const balanceElem = document.getElementById('profile-balance');
        if (balanceElem) balanceElem.textContent = user.balance ?? 0;

        // Расчет Уровня и Опыта
        const userXp = user.xp || 0;
        const levelData = calculateLevel(userXp);

        const levelElement = document.getElementById('profile-level');
        if (levelElement) levelElement.textContent = levelData.level;

        const xpTextElement = document.getElementById('profile-xp-text');
        if (xpTextElement) xpTextElement.textContent = `${levelData.currentXp} / ${levelData.requiredForNext} XP`;

        const xpBarElement = document.getElementById('profile-xp-bar');
        if (xpBarElement) xpBarElement.style.width = `${levelData.progress}%`;

        // Инвентарь: карточки ролей
        const roleCardsCount = (user.inventory && user.inventory['role_card']) || 0;
        const roleCardsElement = document.getElementById('profile-role-cards');
        if (roleCardsElement) roleCardsElement.textContent = roleCardsCount;

        // Инвентарь: 3 типа сундуков
        const bronzeCount = (user.inventory && user.inventory['chest_bronze']) || 0;
        const silverCount = (user.inventory && user.inventory['chest_silver']) || 0;
        const goldCount = (user.inventory && user.inventory['chest_gold']) || 0;

        const bronzeElem = document.getElementById('count-chest_bronze');
        if (bronzeElem) bronzeElem.textContent = bronzeCount;

        const silverElem = document.getElementById('count-chest_silver');
        if (silverElem) silverElem.textContent = silverCount;

        const goldElem = document.getElementById('count-chest_gold');
        if (goldElem) goldElem.textContent = goldCount;

        // Поддержка старого элемента общего количества (если он есть)
        const totalChests = bronzeCount + silverCount + goldCount + ((user.inventory && user.inventory['chest_daily']) || 0);
        const chestsElement = document.getElementById('profile-chests');
        if (chestsElement) chestsElement.textContent = totalChests;

        const openBtn = document.getElementById('btn-open-chest');
        if (openBtn) {
            openBtn.disabled = totalChests <= 0;
        }

        // Отображение кнопки админ-панели
        const adminBtn = document.getElementById('admin-panel-btn');
        if (adminBtn) {
            adminBtn.style.display = user.isAdmin ? 'block' : 'none';
        }

    } catch (err) {
        console.error('Ошибка загрузки профиля:', err);
        alert('Не удалось загрузить данные профиля');
    }
}

// Открытие модального окна
function openChest(chestType = 'chest_bronze', count) {
    window.currentChestType = chestType;

    // Если количество передано в функцию, используем его, иначе ищем элемент конкретного типа
    let availableChests = count;
    if (availableChests === undefined) {
        const elem = document.getElementById(`count-${chestType}`) || document.getElementById('profile-chests');
        availableChests = parseInt(elem ? elem.textContent : '0') || 0;
    }

    if (availableChests <= 0) {
        alert('У вас нет доступных сундуков этого типа');
        return;
    }

    document.getElementById('modal-available-chests').textContent = availableChests;
    document.getElementById('chest-count-input').value = 1;
    
    document.getElementById('chest-select-view').style.display = 'block';
    document.getElementById('chest-result-view').style.display = 'none';
    document.getElementById('chest-modal').style.display = 'flex';
}

// Закрытие модального окна
function closeChestModal() {
    document.getElementById('chest-modal').style.display = 'none';
    loadProfile(); // Обновляем баланс и инвентарь на странице
}

// Быстрый выбор количества
function setChestCount(val) {
    const availableChests = parseInt(document.getElementById('modal-available-chests').textContent || '0') || 0;
    const input = document.getElementById('chest-count-input');

    if (val === 'all') {
        input.value = availableChests;
    } else {
        input.value = Math.min(val, availableChests);
    }
}

// Подтверждение открытия и показ результата с анимацией
async function confirmOpenChest() {
    const chestType = window.currentChestType || 'chest_bronze';

    // Проверяем количество конкретно для текущего открываемого сундука
    const chestsElement = document.getElementById(`count-${chestType}`) || document.getElementById('profile-chests');
    const availableChests = parseInt(chestsElement ? chestsElement.textContent : '0') || 0;
    const input = document.getElementById('chest-count-input');
    const count = parseInt(input.value);

    // Проверка корректности введенного числа
    if (isNaN(count) || count < 1) {
        alert('Укажите корректное число');
        return;
    }

    if (count > availableChests) {
        alert(`Максимально доступно: ${availableChests}`);
        return;
    }

    // Скрываем выбор количества и показываем окно анимации/результата
    document.getElementById('chest-select-view').style.display = 'none';
    document.getElementById('chest-result-view').style.display = 'block';

    // Находим элементы окна результатов
    const chestImg = document.getElementById('chest-img');
    const titleElem = document.getElementById('chest-result-title');
    const rewardsList = document.getElementById('chest-rewards-list');
    const closeBtn = document.getElementById('close-result-btn');

    // Устанавливаем закрытый сундук и запускаем анимацию
    if (chestImg) {
        chestImg.src = '/chest_closed.png';
        chestImg.className = 'chest-image chest-animating';
    }
    
    titleElem.textContent = 'Открываем...';
    rewardsList.innerHTML = '';
    closeBtn.style.display = 'none';

    try {
        // Передаем и количество, и тип сундука
        const response = await fetch('/api/user/open-chest', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ count, chestType })
        });

        const result = await response.json();

        // Задержка 800 мс для проигрывания анимации
        setTimeout(() => {
            if (response.ok && result.success) {
                if (chestImg) {
                    chestImg.src = '/chest_open.png';
                    chestImg.className = 'chest-image chest-opened';
                }

                const opened = result.openedCount || count;
                titleElem.textContent = `🎉 Вы открыли ${opened} ${getChestDeclension(opened)}!`;

                let html = '';
                if (result.rewards) {
                    if (result.rewards.coins) {
                        html += `<div>💰 Монеты: <strong>+${result.rewards.coins}</strong></div>`;
                    }
                    if (result.rewards.roleCards) {
                        html += `<div>🎴 Карточки роли: <strong>+${result.rewards.roleCards}</strong></div>`;
                    }
                } else if (result.message) {
                    html = `<div>${result.message}</div>`;
                }

                rewardsList.innerHTML = html || '<div>Пусто</div>';
                closeBtn.style.display = 'inline-block';
            } else {
                if (chestImg) {
                    chestImg.className = 'chest-image';
                }
                titleElem.textContent = '❌ Ошибка';
                rewardsList.innerHTML = `<div>${result.error || result.message || 'Ошибка открытия'}</div>`;
                closeBtn.style.display = 'inline-block';
            }
        }, 800);

    } catch (err) {
        console.error('Ошибка открытия сундуков:', err);
        if (chestImg) {
            chestImg.className = 'chest-image';
        }
        titleElem.textContent = '❌ Ошибка';
        rewardsList.innerHTML = '<div>Не удалось связаться с сервером</div>';
        closeBtn.style.display = 'inline-block';
    }
}

// Функция смены никнейма
async function changeNickname() {
    const inputElem = document.getElementById('new-username-input');
    if (!inputElem) return;
    
    const newUsername = inputElem.value.trim();

    if (!newUsername || newUsername.length < 3 || newUsername.length > 20) {
        alert('Никнейм должен содержать от 3 до 20 символов');
        return;
    }

    try {
        const response = await fetch('/api/user/change-nickname', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ newUsername })
        });

        const result = await response.json();

        if (response.ok && result.success) {
            alert('Никнейм успешно изменен!');
            inputElem.value = '';
            loadProfile(); // Перезагружаем профиль для обновления интерфейса
        } else {
            alert(result.error || 'Ошибка при смене никнейма');
        }
    } catch (err) {
        console.error('Ошибка при смене никнейма:', err);
        alert('Не удалось связаться с сервером');
    }
}

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

document.addEventListener('DOMContentLoaded', loadProfile);