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
        const response = await fetch('/api/user/profile');
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

        const nameElem = document.getElementById('profile-username');
        if (nameElem) nameElem.textContent = user.username;

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

document.addEventListener('DOMContentLoaded', loadProfile);

loadProfile()