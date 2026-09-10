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

        // Инвентарь
        const roleCardsCount = (user.inventory && user.inventory['role_card']) || 0;
        const roleCardsElement = document.getElementById('profile-role-cards');
        if (roleCardsElement) roleCardsElement.textContent = roleCardsCount;

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

document.addEventListener('DOMContentLoaded', loadProfile);