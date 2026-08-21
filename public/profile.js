async function loadProfile() {
    try {
        const response = await fetch('/api/user/profile'); //[cite: 3]
        if (!response.ok) {
            if (response.status === 401) { //[cite: 3]
                alert('Пожалуйста, войдите в систему'); //[cite: 3]
                window.location.href = '/'; //[cite: 3]
                return; //[cite: 3]
            }
            throw new Error('Ошибка сервера'); //[cite: 3]
        }
        
        const user = await response.json(); //[cite: 3]
        
        document.getElementById('profile-id').textContent = user.id; //[cite: 3]
        document.getElementById('profile-username').textContent = user.username; //[cite: 3]
        document.getElementById('profile-balance').textContent = user.balance; //[cite: 3]

        // Выводим количество карточек выбора роли из инвентаря
        const roleCardsCount = (user.inventory && user.inventory['role_card']) || 0; //[cite: 3]
        const roleCardsElement = document.getElementById('profile-role-cards'); //[cite: 3]
        if (roleCardsElement) { //[cite: 3]
            roleCardsElement.textContent = roleCardsCount; //[cite: 3]
        }

        // Проверка прав администратора и отображение кнопки админ-панели
        const adminBtn = document.getElementById('admin-panel-btn');
        if (adminBtn) {
            adminBtn.style.display = user.isAdmin ? 'block' : 'none';
        }

    } catch (err) {
        console.error(err); //[cite: 3]
        alert('Не удалось загрузить данные профиля'); //[cite: 3]
    }
}

loadProfile(); //[cite: 3]