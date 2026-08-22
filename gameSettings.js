const defaultSettings = {
    timers: {
        generalMeeting: 60, // 0 (отключено), 30, 60, 90, 120
        individualSpeech: 60 // 15, 30, 45, 60
    },
    rules: {
        maxPlayers: 10, // от 4 до 16
        firstDayVoting: true,
        secretVoting: false
    },
    roles: {
        mafia: 1,
        don: 0,
        sheriff: 0,
        doctor: 0,
        zhivchik: 0 // ← ИЗМЕНЕНИЕ: добавлена роль по умолчанию
    }
};

function getDefaultSettings() {
    return JSON.parse(JSON.stringify(defaultSettings));
}

module.exports = {
    getDefaultSettings
};