// Модуль настроек комнаты
const RoomSettings = {
    data: {
        playersCount: 10,
        mafiaCount: 3,
        speechTime: 60,
        discussionTime: 60,
        accessType: 'public',
        password: '',
        roles: {
            sheriff: true,
            don: true,
            doctor: false,
            lucky: false,
            maniac: false
        },
        rules: {
            bestMove: true,
            autoElimination: false
        }
    },

    renderModalHTML() {
        return `
        <div class="modal" id="roomSettingsModal">
            <div class="modal-content">
                <div class="modal-header">
                    <h3 class="modal-title">Точная настройка комнаты</h3>
                    <button class="close-btn" onclick="RoomSettings.close()">&times;</button>
                </div>
                <div class="modal-body">
                    <div id="customSettingsBlock">
                        <!-- 1. Основные параметры -->
                        <div class="section-label" style="font-weight: bold; margin-bottom: 8px; color: #e50914;">1. Основные параметры</div>
                        <div class="form-row" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                            <label for="setPlayersCount">Количество мест:</label>
                            <select id="setPlayersCount">
                                <option value="4">4</option>
                                <option value="5">5</option>
                                <option value="6">6</option>
                                <option value="7">7</option>
                                <option value="8">8</option>
                                <option value="9">9</option>
                                <option value="10" selected>10</option>
                                <option value="11">11</option>
                                <option value="12">12</option>
                            </select>
                        </div>
                        <div class="form-row" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                            <label for="setMafiaCount">Количество Мафии:</label>
                            <select id="setMafiaCount">
                                <option value="1">1</option>
                                <option value="2">2</option>
                                <option value="3" selected>3</option>
                                <option value="4">4</option>
                            </select>
                        </div>

                        <!-- 2. Тайминги -->
                        <div class="section-label" style="font-weight: bold; margin-top: 14px; padding-top: 10px; border-top: 1px solid rgba(229, 9, 20, 0.4); margin-bottom: 8px; color: #e50914;">2. Тайминги</div>
                        <div class="form-row" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                            <label for="setSpeechTime">Дневная речь:</label>
                            <select id="setSpeechTime">
                                <option value="15">15 секунд</option>
                                <option value="30">30 секунд</option>
                                <option value="45">45 секунд</option>
                                <option value="60" selected>60 секунд</option>
                            </select>
                        </div>
                        <div class="form-row" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                            <label for="setDiscussionTime">Общее собрание:</label>
                            <select id="setDiscussionTime">
                                <option value="0">Отключено</option>
                                <option value="30">30 секунд</option>
                                <option value="60" selected>60 секунд</option>
                                <option value="90">90 секунд</option>
                                <option value="120">120 секунд</option>
                            </select>
                        </div>

                        <!-- 3. Дополнительные роли -->
                        <div class="section-label" style="font-weight: bold; margin-top: 14px; padding-top: 10px; border-top: 1px solid rgba(229, 9, 20, 0.4); margin-bottom: 8px; color: #e50914;">3. Дополнительные роли</div>
                        <div class="checkbox-group" style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-bottom: 8px;">
                            <label><input type="checkbox" id="setRoleSheriff" checked> Шериф</label>
                            <label><input type="checkbox" id="setRoleDon" checked> Дон</label>
                            <label><input type="checkbox" id="setRoleDoctor"> Доктор</label>
                            <label><input type="checkbox" id="setRoleLucky"> Счастливчик</label>
                            <label><input type="checkbox" id="setRoleManiac"> Маньяк</label>
                        </div>

                        <!-- 4. Дополнительные правила -->
                        <div class="section-label" style="font-weight: bold; margin-top: 14px; padding-top: 10px; border-top: 1px solid rgba(229, 9, 20, 0.4); margin-bottom: 8px; color: #e50914;">4. Дополнительные правила</div>
                        <div class="checkbox-group" style="display: flex; flex-direction: column; gap: 6px; margin-bottom: 8px;">
                            <label><input type="checkbox" id="setRuleBestMove" checked> Включить «Лучший ход»</label>
                            <label><input type="checkbox" id="setRuleAutoElim"> Автовыбывание при 4 фолах</label>
                        </div>

                        <!-- 5. Доступ -->
                        <div class="section-label" style="font-weight: bold; margin-top: 14px; padding-top: 10px; border-top: 1px solid rgba(229, 9, 20, 0.4); margin-bottom: 8px; color: #e50914;">5. Доступ</div>
                        <div class="form-row" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                            <label for="setAccessType">Тип комнаты:</label>
                            <select id="setAccessType" onchange="RoomSettings.togglePassword()">
                                <option value="public" selected>Публичная</option>
                                <option value="private">По паролю</option>
                            </select>
                        </div>
                        <div class="form-row" id="passwordRow" style="display: none; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                            <label for="setPassword">Пароль:</label>
                            <input type="password" id="setPassword" placeholder="Введите пароль">
                        </div>
                    </div>
                </div>
                <div class="modal-footer" style="margin-top: 15px;">
                    <button class="btn btn-danger" style="width: 100%;" onclick="RoomSettings.save()">Сохранить настройки</button>
                </div>
            </div>
        </div>`;
    },

    init() {
        if (!document.getElementById('roomSettingsModal')) {
            document.body.insertAdjacentHTML('beforeend', this.renderModalHTML());
        }
    },

    togglePassword() {
        const accessSelect = document.getElementById('setAccessType');
        const passwordRow = document.getElementById('passwordRow');
        if (accessSelect && passwordRow) {
            passwordRow.style.display = accessSelect.value === 'private' ? 'flex' : 'none';
        }
    },

    open(onSaveCallback) {
        this.init();
        this.onSaveCallback = onSaveCallback;

        document.getElementById('setPlayersCount').value = this.data.playersCount;
        document.getElementById('setMafiaCount').value = this.data.mafiaCount;
        document.getElementById('setSpeechTime').value = this.data.speechTime;
        document.getElementById('setDiscussionTime').value = this.data.discussionTime;

        document.getElementById('setRoleSheriff').checked = this.data.roles.sheriff;
        document.getElementById('setRoleDon').checked = this.data.roles.don;
        document.getElementById('setRoleDoctor').checked = this.data.roles.doctor;
        document.getElementById('setRoleLucky').checked = this.data.roles.lucky;
        document.getElementById('setRoleManiac').checked = this.data.roles.maniac;

        document.getElementById('setRuleBestMove').checked = this.data.rules.bestMove;
        document.getElementById('setRuleAutoElim').checked = this.data.rules.autoElimination;

        document.getElementById('setAccessType').value = this.data.accessType;
        document.getElementById('setPassword').value = this.data.password || '';
        this.togglePassword();

        document.getElementById('roomSettingsModal').style.display = 'flex';
    },

    close() {
        const modal = document.getElementById('roomSettingsModal');
        if (modal) modal.style.display = 'none';
    },

    save() {
        this.data.playersCount = parseInt(document.getElementById('setPlayersCount').value);
        this.data.mafiaCount = parseInt(document.getElementById('setMafiaCount').value);
        this.data.speechTime = parseInt(document.getElementById('setSpeechTime').value);
        this.data.discussionTime = parseInt(document.getElementById('setDiscussionTime').value);

        this.data.roles.sheriff = document.getElementById('setRoleSheriff').checked;
        this.data.roles.don = document.getElementById('setRoleDon').checked;
        this.data.roles.doctor = document.getElementById('setRoleDoctor').checked;
        this.data.roles.lucky = document.getElementById('setRoleLucky').checked;
        this.data.roles.maniac = document.getElementById('setRoleManiac').checked;

        this.data.rules.bestMove = document.getElementById('setRuleBestMove').checked;
        this.data.rules.autoElimination = document.getElementById('setRuleAutoElim').checked;

        this.data.accessType = document.getElementById('setAccessType').value;
        this.data.password = document.getElementById('setPassword').value;

        this.close();

        if (typeof this.onSaveCallback === 'function') {
            this.onSaveCallback(this.data);
        }
    }
};