async function addBalance() {
    const userIdInput = document.getElementById('admin-user-id');
    const amountInput = document.getElementById('admin-amount');

    const userId = userIdInput.value.trim();
    const amount = Number(amountInput.value);
    
    if (!userId || !amount) {
        alert('Заполните все поля корректными значениями');
        return;
    }

    try {
        const response = await fetch('/api/admin/add-balance', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: Number(userId), amount })
        });

        const result = await response.json();

        if (response.ok && result.success) {
            alert(result.message);
            userIdInput.value = '';
            amountInput.value = '';
        } else {
            alert(result.error || 'Ошибка выполнения операции');
        }
    } catch (err) {
        console.error(err);
        alert('Ошибка при отправке запроса');
    }
}

document.getElementById('btn-save-welcome-chest')?.addEventListener('click', async () => {
    const rewards = {
        coins: document.getElementById('welcome-coins-enabled').checked 
            ? parseInt(document.getElementById('welcome-coins-qty').value) || 0 
            : 0,
        items: {
            role_card: document.getElementById('welcome-role_card-enabled').checked 
                ? parseInt(document.getElementById('welcome-role_card-qty').value) || 0 
                : 0,
            chest_bronze: document.getElementById('welcome-chest_bronze-enabled').checked 
                ? parseInt(document.getElementById('welcome-chest_bronze-qty').value) || 0 
                : 0,
            chest_silver: document.getElementById('welcome-chest_silver-enabled').checked 
                ? parseInt(document.getElementById('welcome-chest_silver-qty').value) || 0 
                : 0,
            chest_gold: document.getElementById('welcome-chest_gold-enabled').checked 
                ? parseInt(document.getElementById('welcome-chest_gold-qty').value) || 0 
                : 0
        }
    };

    try {
        const res = await fetch('/api/admin/welcome-chest', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(rewards)
        });

        if (res.ok) {
            alert('Настройки сундука сохранены');
        } else {
            alert('Ошибка при сохранении');
        }
    } catch (e) {
        alert('Ошибка отправки запроса');
    }
});

async function loadWelcomeChestConfig() {
    try {
        const res = await fetch('/api/admin/welcome-chest');
        if (!res.ok) return;

        const config = await res.json();

        if (config.coins !== undefined) {
            document.getElementById('welcome-coins-enabled').checked = config.coins > 0;
            document.getElementById('welcome-coins-qty').value = config.coins;
        }

        if (config.items) {
            Object.entries(config.items).forEach(([itemId, qty]) => {
                const checkbox = document.getElementById(`welcome-${itemId}-enabled`);
                const input = document.getElementById(`welcome-${itemId}-qty`);

                if (checkbox && input) {
                    checkbox.checked = qty > 0;
                    input.value = qty > 0 ? qty : 1;
                }
            });
        }
    } catch (e) {
        console.error('Ошибка загрузки настроек сундука:', e);
    }
}

loadWelcomeChestConfig();

document.getElementById('btn-send-custom-chest')?.addEventListener('click', async () => {
    const targetUserId = document.getElementById('custom-target-userid').value.trim();

    const payload = {
        userId: targetUserId ? parseInt(targetUserId) : null,
        coins: document.getElementById('custom-coins-enabled').checked 
            ? parseInt(document.getElementById('custom-coins-qty').value) || 0 
            : 0,
        items: {
            role_card: document.getElementById('custom-role_card-enabled').checked 
                ? parseInt(document.getElementById('custom-role_card-qty').value) || 0 
                : 0,
            chest_bronze: document.getElementById('custom-chest_bronze-enabled').checked 
                ? parseInt(document.getElementById('custom-chest_bronze-qty').value) || 0 
                : 0,
            chest_silver: document.getElementById('custom-chest_silver-enabled').checked 
                ? parseInt(document.getElementById('custom-chest_silver-qty').value) || 0 
                : 0,
            chest_gold: document.getElementById('custom-chest_gold-enabled').checked 
                ? parseInt(document.getElementById('custom-chest_gold-qty').value) || 0 
                : 0
        }
    };

    try {
        const res = await fetch('/api/admin/send-custom-chest', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const data = await res.json();

        if (res.ok && data.success) {
            alert(data.message || 'Сундук успешно отправлен!');
        } else {
            alert(data.error || 'Ошибка при отправке');
        }
    } catch (e) {
        console.error('Ошибка отправки:', e);
        alert('Ошибка отправки запроса');
    }
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