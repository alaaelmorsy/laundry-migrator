let currentStep = 0;
let sourceConfig = null;
let targetConfig = null;
let productsImageFolder = null;

const stepStates = {
    0: 'active',
    1: 'locked', 2: 'locked', 3: 'locked', 4: 'locked',
    5: 'locked', 6: 'locked', 7: 'locked', 8: 'locked',
    9: 'locked', 10: 'locked'
};

const migrationStatus = {
    settings: 'pending',
    services: 'pending',
    products: 'pending',
    customers: 'pending',
    users: 'pending',
    subscriptions: 'pending',
    orders: 'pending',
    expenses: 'pending',
    backup: 'pending'
};

const TOTAL_STEPS = 11;

window.electronAPI.onMigrationProgress((progress) => { updateProgress(progress); });

document.addEventListener('DOMContentLoaded', () => {
    initializeWizard();
    updateStepperUI();
});

function initializeWizard() {
    updateNavigationButtons();
    updateStepInfo();
}

function updateStepperUI() {
    const steps = document.querySelectorAll('.step');
    steps.forEach((step, index) => {
        const state = stepStates[index];
        step.classList.remove('active', 'completed', 'skipped', 'locked');
        if (state) step.classList.add(state);
        step.onclick = () => {
            if (state === 'completed' || state === 'skipped' || state === 'active') goToStep(index);
        };
    });
}

function updateStepContent(direction = 'forward') {
    const allContent = document.querySelectorAll('.step-content');
    const currentContent = document.querySelector('.step-content.active');
    if (currentContent) {
        currentContent.classList.add(direction === 'forward' ? 'exit-left' : 'exit-right');
        setTimeout(() => currentContent.classList.remove('active', 'exit-left', 'exit-right'), 400);
    }
    setTimeout(() => {
        allContent.forEach((content, index) => { if (index === currentStep) content.classList.add('active'); });
    }, 400);
}

function updateNavigationButtons() {
    const btnPrevious = document.getElementById('btn-previous');
    const btnNext = document.getElementById('btn-next');
    const btnSkip = document.getElementById('btn-skip');
    btnPrevious.disabled = currentStep === 0;
    const nextStepState = stepStates[currentStep + 1];
    btnNext.disabled = currentStep === (TOTAL_STEPS - 1) || nextStepState === 'locked';
    btnSkip.style.display = (currentStep >= 1 && currentStep <= (TOTAL_STEPS - 2)) ? 'flex' : 'none';
    if (currentStep === 0) btnNext.disabled = !(sourceConfig && targetConfig);
}

function updateStepInfo() {
    document.getElementById('step-info').textContent = `الخطوة ${currentStep + 1} من ${TOTAL_STEPS}`;
}

function nextStep() {
    if (currentStep === 0 && (!sourceConfig || !targetConfig)) {
        showToast('يرجى اختبار الاتصال بقواعد البيانات أولاً', 'error');
        return;
    }
    if (currentStep < (TOTAL_STEPS - 1) && stepStates[currentStep + 1] !== 'locked') {
        currentStep++;
        updateStepContent('forward');
        updateNavigationButtons();
        updateStepInfo();
        updateStepperUI();
        if (currentStep === TOTAL_STEPS - 1) setTimeout(() => showConfetti(), 500);
    }
}

function previousStep() {
    if (currentStep > 0) {
        currentStep--;
        updateStepContent('backward');
        updateNavigationButtons();
        updateStepInfo();
        updateStepperUI();
    }
}

function skipStep() {
    if (currentStep >= 1 && currentStep <= (TOTAL_STEPS - 2)) {
        stepStates[currentStep] = 'skipped';
        if (currentStep < TOTAL_STEPS - 1) stepStates[currentStep + 1] = 'active';
        const stepName = getStepNameFromIndex(currentStep);
        if (stepName) migrationStatus[stepName] = 'skipped';
        showToast('تم تخطي الخطوة', 'info');
        nextStep();
    }
}

function goToStep(index) {
    if (stepStates[index] === 'locked') {
        showToast('هذه الخطوة مقفلة. يجب إكمال الخطوات السابقة أولاً', 'warning');
        return;
    }
    const direction = index > currentStep ? 'forward' : 'backward';
    currentStep = index;
    updateStepContent(direction);
    updateNavigationButtons();
    updateStepInfo();
    updateStepperUI();
    if (index === TOTAL_STEPS - 1) setTimeout(() => showConfetti(), 500);
}

function completeCurrentStep() {
    stepStates[currentStep] = 'completed';
    if (currentStep < TOTAL_STEPS - 1) stepStates[currentStep + 1] = 'active';
    updateStepperUI();
    updateNavigationButtons();
}

function getStepNameFromIndex(index) {
    const stepNames = ['', 'settings', 'services', 'products', 'customers', 'users', 'subscriptions', 'orders', 'expenses', 'backup'];
    return stepNames[index];
}

function checkAndUnlockNextStep() {
    if (sourceConfig && targetConfig && currentStep === 0) {
        stepStates[1] = 'active';
        updateStepperUI();
        updateNavigationButtons();
    }
}

async function testSourceConnection() {
    const config = getSourceConfig();
    const statusEl = document.getElementById('source-status');
    const button = event.target;
    button.disabled = true;
    button.innerHTML = '<span class="spinner"></span> جاري الاختبار...';
    statusEl.textContent = '';
    statusEl.className = 'connection-status';
    try {
        const result = await window.electronAPI.testConnection(config);
        if (result.success) {
            statusEl.textContent = '✓ تم الاتصال بنجاح';
            statusEl.className = 'connection-status success';
            sourceConfig = config;
            checkAndUnlockNextStep();
            updateNavigationButtons();
            showToast('تم الاتصال بقاعدة البيانات المصدر بنجاح', 'success');
        } else {
            statusEl.textContent = '✗ ' + formatErrorMessage(result.error);
            statusEl.className = 'connection-status error';
            showToast(formatErrorMessage(result.error), 'error');
        }
    } catch (error) {
        statusEl.textContent = '✗ خطأ: ' + error.message;
        statusEl.className = 'connection-status error';
    } finally {
        button.disabled = false;
        button.innerHTML = '<svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M10 3v14M3 10h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg> اختبار الاتصال';
    }
}

async function testTargetConnection() {
    const config = getTargetConfig();
    const statusEl = document.getElementById('target-status');
    const button = event.target;
    button.disabled = true;
    button.innerHTML = '<span class="spinner"></span> جاري الاختبار...';
    statusEl.textContent = '';
    statusEl.className = 'connection-status';
    try {
        const result = await window.electronAPI.testConnection(config);
        if (result.success) {
            statusEl.textContent = '✓ تم الاتصال بنجاح';
            statusEl.className = 'connection-status success';
            targetConfig = config;
            checkAndUnlockNextStep();
            updateNavigationButtons();
            showToast('تم الاتصال بقاعدة البيانات الهدف بنجاح', 'success');
        } else {
            statusEl.textContent = '✗ ' + formatErrorMessage(result.error);
            statusEl.className = 'connection-status error';
            showToast(formatErrorMessage(result.error), 'error');
        }
    } catch (error) {
        statusEl.textContent = '✗ خطأ: ' + error.message;
        statusEl.className = 'connection-status error';
    } finally {
        button.disabled = false;
        button.innerHTML = '<svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M10 3v14M3 10h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg> اختبار الاتصال';
    }
}

function formatErrorMessage(error) {
    if (!error) return 'خطأ غير معروف';
    if (error.includes('ECONNREFUSED')) return 'لا يمكن الاتصال بـ MySQL. تأكد من تشغيل MySQL واستخدم 127.0.0.1 بدلاً من localhost';
    if (error.includes('ER_ACCESS_DENIED')) return 'كلمة المرور أو اسم المستخدم خاطئ';
    if (error.includes('ER_BAD_DB_ERROR')) return 'قاعدة البيانات غير موجودة';
    return error;
}

function getSourceConfig() {
    return {
        host: document.getElementById('source-host').value,
        user: document.getElementById('source-user').value,
        password: document.getElementById('source-password').value,
        database: document.getElementById('source-database').value
    };
}

function getTargetConfig() {
    return {
        host: document.getElementById('target-host').value,
        user: document.getElementById('target-user').value,
        password: document.getElementById('target-password').value,
        database: document.getElementById('target-database').value
    };
}

async function migrateSettings()       { await runMigration('settings',       window.electronAPI.migrateSettings); }
async function migrateServices()       { await runMigration('services',       window.electronAPI.migrateServices); }

async function selectImageFolder() {
    try {
        const result = await window.electronAPI.selectImageFolder();
        if (!result.canceled && result.path) {
            productsImageFolder = result.path;
            const input = document.getElementById('image-folder-path');
            const hint  = document.getElementById('image-folder-hint');
            const btn   = input.nextElementSibling;
            input.value = result.path;
            input.style.border = '2px solid #38a169';
            input.style.background = '#f0fff4';
            input.style.color = '#276749';
            if (hint) {
                hint.style.color = '#276749';
                hint.textContent = '✓ تم تحديد المجلد — سيتم نقل الصور تلقائياً.';
            }
            if (btn) { btn.style.background = '#38a169'; btn.style.borderColor = '#38a169'; }
            showToast('تم تحديد مجلد الصور', 'success');
        }
    } catch (error) {
        showToast('حدث خطأ أثناء تحديد المجلد', 'error');
    }
}

async function migrateProducts() {
    if (!productsImageFolder) {
        const proceed = confirm(
            'لم تقم بتحديد مجلد الصور!\n\n' +
            'بدون تحديد المجلد لن يتم نقل أي صورة للمنتجات.\n\n' +
            'هل تريد المتابعة بدون صور؟\n' +
            '(اضغط "إلغاء" لتحديد المجلد أولاً)'
        );
        if (!proceed) return;
    }
    await runMigration('products', async (source, target) => {
        return await window.electronAPI.migrateProducts(source, target, productsImageFolder);
    });
}
async function migrateCustomers()      { await runMigration('customers',      window.electronAPI.migrateCustomers); }
async function migrateUsers()          { await runMigration('users',          window.electronAPI.migrateUsers); }
async function migrateSubscriptions()  { await runMigration('subscriptions',  window.electronAPI.migrateSubscriptions); }
async function migrateOrders()         { await runMigration('orders',         window.electronAPI.migrateOrders); }
async function migrateExpenses()       { await runMigration('expenses',       window.electronAPI.migrateExpenses); }

// Any migration step writes to the target database — a restorable backup taken
// BEFORE the first write is the only way back if something goes wrong. The main
// process refuses migration without it; this makes the flow explicit in the UI.
async function ensureBackupBeforeMigration() {
    if (migrationStatus.backup === 'completed') return true;
    // Automatic and silent: saved to Documents/laundry-migration-backups
    // without any dialog. The main process refuses migration without it.
    showToast('جاري إنشاء نسخة احتياطية تلقائية من قاعدة الهدف...', 'info');
    const result = await window.electronAPI.createBackup(targetConfig, null);
    if (!result.success) {
        showToast(`فشل النسخ الاحتياطي: ${result.error} — لن يبدأ النقل`, 'error');
        return false;
    }
    migrationStatus.backup = 'completed';
    showToast(`تم حفظ النسخة الاحتياطية تلقائيًا: ${result.filename}`, 'success');
    return true;
}

async function runMigration(step, migrationFunction) {
    if (!sourceConfig || !targetConfig) {
        showToast('يرجى الاتصال بقواعد البيانات أولاً', 'error');
        goToStep(0);
        return;
    }
    if (!(await ensureBackupBeforeMigration())) return;
    const progressBar = document.querySelector(`#progress-${step} .progress-fill`);
    const progressPercentage = document.querySelector(`[data-step-content="${currentStep}"] .progress-percentage`);
    const button = document.getElementById(`btn-${step}`);
    const logContainer = document.getElementById(`log-${step}`);

    migrationStatus[step] = 'in-progress';
    button.disabled = true;
    button.innerHTML = '<span class="spinner"></span> جاري النقل...';
    logContainer.innerHTML = '';

    try {
        const result = await migrationFunction(sourceConfig, targetConfig);
        if (result.success) {
            migrationStatus[step] = 'completed';
            if (progressBar) progressBar.style.width = '100%';
            if (progressPercentage) progressPercentage.textContent = '100%';
            showToast(`تم نقل ${getStepDisplayName(step)} بنجاح`, 'success');
            completeCurrentStep();
        } else {
            migrationStatus[step] = 'error';
            showToast(`فشل نقل ${getStepDisplayName(step)}: ${result.error}`, 'error');
        }
    } catch (error) {
        migrationStatus[step] = 'error';
        showToast(`خطأ: ${error.message}`, 'error');
        addLog(step, 'ERROR: ' + error.message);
    } finally {
        button.disabled = false;
        button.innerHTML = `
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                <path d="M12 5v14M5 12l7 7 7-7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            بدء نقل ${getStepDisplayName(step)}
        `;
    }
}

function updateProgress(progress) {
    const { step, percentage, message } = progress;
    const progressBar = document.querySelector(`#progress-${step} .progress-fill`);
    const progressPercentage = document.querySelector(`[data-step-content="${currentStep}"] .progress-percentage`);
    if (progressBar) progressBar.style.width = percentage + '%';
    if (progressPercentage) progressPercentage.textContent = percentage + '%';
    if (message) addLog(step, message);
}

function addLog(step, message) {
    const logContainer = document.getElementById(`log-${step}`);
    if (!logContainer) return;
    const entry = document.createElement('div');
    entry.textContent = `[${new Date().toLocaleTimeString('ar-EG')}] ${message}`;
    logContainer.appendChild(entry);
    logContainer.scrollTop = logContainer.scrollHeight;
}

function getStepDisplayName(step) {
    const names = {
        settings: 'إعدادات المغسلة',
        services: 'الخدمات',
        products: 'المنتجات',
        customers: 'العملاء',
        users: 'المستخدمين',
        subscriptions: 'الاشتراكات',
        orders: 'الفواتير',
        expenses: 'المصروفات',
        backup: 'النسخة الاحتياطية'
    };
    return names[step] || step;
}

async function createBackup() {
    if (!targetConfig) { showToast('يرجى الاتصال بقاعدة البيانات الهدف أولاً', 'error'); goToStep(0); return; }
    const progressBar = document.querySelector('#progress-backup .progress-fill');
    const progressPercentage = document.querySelector(`[data-step-content="${currentStep}"] .progress-percentage`);
    const button = document.getElementById('btn-backup');
    const logContainer = document.getElementById('log-backup');
    migrationStatus.backup = 'in-progress';
    button.disabled = true;
    button.innerHTML = '<span class="spinner"></span> جاري اختيار المكان...';
    logContainer.innerHTML = '';
    try {
        const locationResult = await window.electronAPI.selectBackupLocation();
        if (locationResult.canceled) {
            showToast('تم إلغاء العملية', 'info');
            return;
        }
        button.innerHTML = '<span class="spinner"></span> جاري الحفظ...';
        const result = await window.electronAPI.createBackup(targetConfig, locationResult.path);
        if (result.success) {
            migrationStatus.backup = 'completed';
            if (progressBar) progressBar.style.width = '100%';
            if (progressPercentage) progressPercentage.textContent = '100%';
            showToast('تم حفظ النسخة الاحتياطية بنجاح', 'success');
            completeCurrentStep();
        } else {
            migrationStatus.backup = 'error';
            showToast(`فشل حفظ النسخة الاحتياطية: ${result.error}`, 'error');
        }
    } catch (error) {
        migrationStatus.backup = 'error';
        showToast(`خطأ: ${error.message}`, 'error');
        addLog('backup', 'ERROR: ' + error.message);
    } finally {
        button.disabled = false;
        button.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M12 4v12M8 12l4 4 4-4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg> حفظ النسخة الاحتياطية`;
    }
}

function finishMigration() {
    // Approval gate: never let a failed or skipped step end as a "successful"
    // migration without the user explicitly acknowledging what is missing.
    const dataSteps = ['settings', 'services', 'products', 'customers', 'users', 'subscriptions', 'orders', 'expenses'];
    const failed = dataSteps.filter(s => migrationStatus[s] === 'error');
    const skipped = dataSteps.filter(s => migrationStatus[s] === 'skipped' || migrationStatus[s] === 'pending');

    if (failed.length > 0) {
        alert(
            'لا يمكن اعتماد النقل: الخطوات التالية فشلت:\n\n' +
            failed.map(getStepDisplayName).join('، ') +
            '\n\nأعد تشغيل هذه الخطوات بنجاح قبل الإنهاء.'
        );
        return;
    }
    if (skipped.length > 0) {
        const acknowledge = confirm(
            'تحذير: الخطوات التالية لم تُنقل (تم تخطيها أو لم تُشغّل):\n\n' +
            skipped.map(getStepDisplayName).join('، ') +
            '\n\nبياناتها لن تكون موجودة في النظام الجديد. هل تؤكد الإنهاء رغم ذلك؟'
        );
        if (!acknowledge) return;
    }
    if (confirm('هل تريد إغلاق البرنامج؟')) window.close();
}

function showConfetti() {
    const colors = ['#0066FF', '#00C853', '#FF9800', '#F44336', '#9C27B0'];
    const container = document.createElement('div');
    container.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:99999;';
    document.body.appendChild(container);
    for (let i = 0; i < 100; i++) {
        setTimeout(() => {
            const c = document.createElement('div');
            const size = Math.random() * 10 + 5;
            c.style.cssText = `position:absolute;width:${size}px;height:${size}px;background:${colors[Math.floor(Math.random()*colors.length)]};top:-20px;left:${Math.random()*100}%;opacity:${Math.random()*0.7+0.3};border-radius:${Math.random()>0.5?'50%':'0'};animation:confettiFall ${Math.random()*3+2}s linear forwards;transform:rotate(${Math.random()*360}deg);`;
            container.appendChild(c);
        }, i * 30);
    }
    const style = document.createElement('style');
    style.textContent = `@keyframes confettiFall{to{transform:translateY(100vh) rotate(720deg);opacity:0;}}`;
    document.head.appendChild(style);
    setTimeout(() => { container.remove(); style.remove(); }, 6000);
}

function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    const icons = { success: '✓', error: '✗', info: 'ℹ', warning: '⚠' };
    toast.innerHTML = `<span style="font-size:1.5rem;">${icons[type]||'ℹ'}</span><div class="toast-content">${message}</div>`;
    container.appendChild(toast);
    setTimeout(() => { toast.style.opacity='0'; toast.style.transform='translateX(-100px)'; setTimeout(()=>toast.remove(),300); }, 4000);
}
