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
            // Очищаем поля ввода после успешного начисления
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