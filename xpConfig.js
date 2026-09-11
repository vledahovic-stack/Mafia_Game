const XP_CONFIG = {
    POINTS: {
        CORRECT_VOTE: 1, // Точный голос днём (Мирный в Мафию / Мафия в Шерифа)
        ROLE_ACTION: 2,  // Успешное ночное действие роли (Шериф, Доктор, Мафия)
        WIN: 3           // Победа в матче (только для выживших)
    },
    LEVEL_THRESHOLD: 10 // Количество очков для перехода на следующий уровень
};

function calculateLevel(xp = 0) {
    const level = Math.floor(xp / XP_CONFIG.LEVEL_THRESHOLD) + 1;
    const currentLevelXp = xp % XP_CONFIG.LEVEL_THRESHOLD;
    const maxLevelXp = XP_CONFIG.LEVEL_THRESHOLD;
    const progressPercent = Math.min((currentLevelXp / maxLevelXp) * 100, 100);

    return {
        level,
        currentLevelXp,
        maxLevelXp,
        progressPercent
    };
}

module.exports = {
    XP_CONFIG,
    calculateLevel
};