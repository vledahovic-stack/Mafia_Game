async function addBalance() {
    const userId = document.getElementById('admin-user-id').value;
    const amount = document.getElementById('admin-amount').value;
    
    if (!userId || !amount) {
        alert('Заполните все поля');
        return;
    }

    try {
        const response = await fetch('/api/admin/add-balance', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId, amount })
        });
        const result = await response.json();
        alert(result.message || result.error);
    } catch (err) {
        console.error(err);
        alert('Ошибка при отправке запроса');
    }
}