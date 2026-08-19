async function loadProfile() {
    try {
        const response = await fetch('/api/user/profile');
        if (!response.ok) {
            if (response.status === 401) {
                alert('Пожалуйста, войдите в систему');
                window.location.href = '/';
                return;
            }
            throw new Error('Ошибка сервера');
        }
        
        const user = await response.json();
        
        document.getElementById('profile-id').textContent = user.id;
        document.getElementById('profile-username').textContent = user.username;
        document.getElementById('profile-balance').textContent = user.balance;
    } catch (err) {
        console.error(err);
        alert('Не удалось загрузить данные профиля');
    }
}

loadProfile();