const $ = id => document.getElementById(id)

const state = {
  sourceTables: [],
  targetTables: [],
  migrationDefinitions: [],
  mappings: [],
  currentStep: 0,
  isRunning: false,
  logEntries: [],
  logFilePath: '',
  activeFilters: new Set(['INFO', 'WARN', 'ERROR', 'SKIP']),
  logSearch: '',
  unsub: [],
  totals: {
    attempted: 0,
    inserted: 0,
    skipped: 0,
    failed: 0,
    rolledBack: 0,
    durationMs: 0
  }
}

function showPage(id) {
  document.querySelectorAll('.page').forEach(page => page.classList.remove('active'))
  $(`page-${id}`).classList.add('active')

  const steps = ['connection', 'mapping', 'migration', 'summary']
  const activeIndex = steps.indexOf(id)
  steps.forEach((stepId, index) => {
    const node = $(`step-${stepId}`)
    const badge = $(`step-num-${index + 1}`)
    node.classList.remove('active', 'done')
    if (index < activeIndex) {
      node.classList.add('done')
      badge.textContent = '✓'
    } else if (index === activeIndex) {
      node.classList.add('active')
      badge.textContent = String(index + 1)
    } else {
      badge.textContent = String(index + 1)
    }
    if (index < 3) {
      $(`sep-${index + 1}`).classList.toggle('done', index < activeIndex)
    }
  })
}

function getConnFields(prefix) {
  return {
    host: $(`${prefix}-host`).value.trim() || 'localhost',
    port: Number($(`${prefix}-port`).value) || 3306,
    user: $(`${prefix}-user`).value.trim() || 'root',
    password: $(`${prefix}-pass`).value,
    database: ''
  }
}

function getFullConfig(prefix) {
  return { ...getConnFields(prefix), database: $(`${prefix}-db-select`).value }
}

function setConnStatus(prefix, ok, message) {
  const node = $(`${prefix}-status`)
  node.className = `conn-status ${ok ? 'ok' : 'fail'}`
  node.textContent = `${ok ? '✅' : '❌'} ${message}`
}

async function loadSavedConfig() {
  const config = await window.api.loadConfig().catch(() => null)
  if (!config) return
  if (config.src) {
    $('src-host').value = config.src.host || 'localhost'
    $('src-port').value = config.src.port || 3306
    $('src-user').value = config.src.user || 'root'
  }
  if (config.tgt) {
    $('tgt-host').value = config.tgt.host || 'localhost'
    $('tgt-port').value = config.tgt.port || 3306
    $('tgt-user').value = config.tgt.user || 'root'
  }
}

async function populateDbSelect(prefix, config) {
  const select = $(`${prefix}-db-select`)
  const hint = $(`${prefix}-db-hint`)
  select.innerHTML = '<option value="">⏳ جارٍ الجلب...</option>'
  select.disabled = true

  const result = await window.api.listDatabases(config)
  if (!result.success) {
    select.innerHTML = '<option value="">لا يمكن جلب القواعد</option>'
    hint.textContent = ''
    return
  }

  select.innerHTML = '<option value="">— اختر قاعدة البيانات —</option>'
  result.databases.forEach(dbName => {
    const option = document.createElement('option')
    option.value = dbName
    option.textContent = dbName
    select.appendChild(option)
  })
  select.disabled = false
  const keyword = prefix === 'src' ? 'laundry_schema' : 'laundry_db'
  const auto = result.databases.find(dbName => dbName.toLowerCase().includes(keyword))
  if (auto) {
    select.value = auto
    hint.textContent = '✓ تم الاختيار التلقائي'
  } else {
    hint.textContent = ''
  }
  updateConnectButton()
}

function updateConnectButton() {
  const sourceReady = $('src-status').classList.contains('ok') && $('src-db-select').value
  const targetReady = $('tgt-status').classList.contains('ok') && $('tgt-db-select').value
  $('btn-connect').disabled = !(sourceReady && targetReady)
}

$('btn-test').addEventListener('click', async () => {
  const button = $('btn-test')
  button.disabled = true
  button.textContent = '⏳ جارٍ الاختبار...'
  $('btn-connect').disabled = true

  const [srcRes, tgtRes] = await Promise.all([
    window.api.testConnection(getConnFields('src')),
    window.api.testConnection(getConnFields('tgt'))
  ])

  setConnStatus('src', srcRes.success, srcRes.success ? `متصل — MySQL ${srcRes.version}` : srcRes.error)
  setConnStatus('tgt', tgtRes.success, tgtRes.success ? `متصل — MySQL ${tgtRes.version}` : tgtRes.error)

  if (srcRes.success) await populateDbSelect('src', getConnFields('src'))
  if (tgtRes.success) await populateDbSelect('tgt', getConnFields('tgt'))

  button.disabled = false
  button.textContent = '🔌 اختبار الاتصال وجلب قواعد البيانات'
  updateConnectButton()
})

$('btn-connect').addEventListener('click', async () => {
  const src = getFullConfig('src')
  const tgt = getFullConfig('tgt')
  const button = $('btn-connect')

  if (!src.database || !tgt.database) {
    alert('يرجى اختيار قاعدة البيانات للطرفين قبل المتابعة.')
    return
  }

  button.disabled = true
  button.textContent = '⏳ جارٍ تحليل المخطط...'

  try {
    await window.api.initPools(src, tgt)
    await window.api.saveConfig(
      { host: src.host, port: src.port, user: src.user, database: src.database },
      { host: tgt.host, port: tgt.port, user: tgt.user, database: tgt.database }
    )

    const analysis = await window.api.analyzeSchema()
    state.sourceTables = analysis.sourceTables || []
    state.targetTables = analysis.targetTables || []
    state.migrationDefinitions = analysis.migrationDefinitions || []
    initMappingPage()
    showPage('mapping')
  } catch (error) {
    alert(`خطأ في تحليل المخطط:\n${error.message}`)
  } finally {
    button.disabled = false
    button.textContent = 'التالي ← ربط الجداول'
  }
})

function initMappingPage() {
  state.mappings = state.sourceTables.map((table, index) => ({
    id: table.migrationId || `map-${index}`,
    srcTable: table.name,
    labelAr: table.labelAr || table.name,
    rowCount: table.rowCount || 0,
    columns: table.columns || [],
    mode: table.migrationMode || 'skipped',
    migrationId: table.migrationId || '',
    tgtTable: table.targetHint || '',
    colMap: [],
    options: {}
  }))

  renderMappingTable()
  updateMappingStats()
}

function renderMappingTable(filterText = '') {
  const tbody = $('mapping-tbody')
  const targetOptions = ['<option value="">— لا تنقل —</option>']
    .concat(state.targetTables.map(table => `<option value="${table.name}">${table.name}</option>`))
    .join('')

  const rows = state.mappings.filter(mapping => !filterText || mapping.srcTable.toLowerCase().includes(filterText.toLowerCase()))
  tbody.innerHTML = rows.map((mapping, visibleIndex) => {
    const inspected = mapping.colMap.length > 0
    const disabled = mapping.mode === 'skipped'
    const modeLabel = mapping.mode === 'specialized'
      ? 'مسار متخصص'
      : mapping.mode === 'direct-copy'
        ? 'نسخ مباشر'
        : 'غير مدعوم'
    const modeClass = mapping.mode === 'specialized'
      ? 'colmap-ok'
      : mapping.mode === 'direct-copy'
        ? 'colmap-info'
        : 'colmap-warn'

    return `
      <tr>
        <td><input type="checkbox" class="chk-row" data-id="${mapping.id}" ${disabled ? 'disabled' : 'checked'} /></td>
        <td>
          <div class="src-name">${mapping.labelAr} <span style="font-size:.75rem;color:var(--muted)">(${mapping.srcTable})</span></div>
          <div class="${modeClass}" style="margin-top:4px;">${modeLabel}</div>
        </td>
        <td><span class="row-count">${mapping.rowCount.toLocaleString()}</span></td>
        <td>
          <select class="db-select tgt-select" data-id="${mapping.id}" ${mapping.mode === 'specialized' ? 'disabled' : ''}>
            ${targetOptions}
          </select>
        </td>
        <td id="colmap-${visibleIndex}">
          ${mapping.mode === 'specialized'
            ? '<span class="colmap-ok">✅ الترحيل سيستخدم منطقًا متخصصًا</span>'
            : mapping.mode === 'direct-copy'
              ? (inspected
                ? `<span class="colmap-ok">✅ ${mapping.colMap.length} عمود</span>`
                : `<button class="btn-colmap" data-id="${mapping.id}" data-cell="${visibleIndex}">🔍 فحص الأعمدة</button>`)
              : '<span class="colmap-warn">⚠️ لا يوجد مسار آمن لهذا الجدول</span>'}
        </td>
      </tr>
    `
  }).join('')

  rows.forEach(mapping => {
    const select = tbody.querySelector(`select[data-id="${mapping.id}"]`)
    if (select) {
      select.value = mapping.tgtTable || ''
    }
  })

  tbody.querySelectorAll('.tgt-select').forEach(select => {
    select.addEventListener('change', event => {
      const mapping = state.mappings.find(item => item.id === event.target.dataset.id)
      if (!mapping) return
      mapping.tgtTable = event.target.value
      mapping.colMap = []
      renderMappingTable($('map-search').value.trim())
      updateMappingStats()
    })
  })

  tbody.querySelectorAll('.btn-colmap').forEach(button => {
    button.addEventListener('click', async event => {
      const mapping = state.mappings.find(item => item.id === event.target.dataset.id)
      if (!mapping) return
      inspectColumns(mapping)
      renderMappingTable($('map-search').value.trim())
      updateMappingStats()
    })
  })

  tbody.querySelectorAll('.chk-row').forEach(box => {
    box.addEventListener('change', updateMappingStats)
  })
}

function inspectColumns(mapping) {
  if (!mapping.tgtTable) return
  const target = state.targetTables.find(table => table.name === mapping.tgtTable)
  if (!target) return
  const sourceCols = new Set(mapping.columns.map(column => column.name))
  mapping.colMap = target.columns.map(column => column.name).filter(column => sourceCols.has(column))
}

function updateMappingStats() {
  const checked = [...document.querySelectorAll('.chk-row:checked')].length
  const supported = state.mappings.filter(item => item.mode !== 'skipped').length
  $('map-stats').textContent = `${state.mappings.length} جدول مصدر | ${supported} مدعوم | ${checked} محدد`
  $('btn-confirm-mapping').disabled = checked === 0
}

$('map-search').addEventListener('input', event => renderMappingTable(event.target.value.trim()))
$('chk-all').addEventListener('change', event => {
  document.querySelectorAll('.chk-row:not(:disabled)').forEach(box => {
    box.checked = event.target.checked
  })
  updateMappingStats()
})

$('btn-auto-match').addEventListener('click', () => {
  const targetNames = new Set(state.targetTables.map(table => table.name))
  state.mappings.forEach(mapping => {
    if (!mapping.tgtTable && targetNames.has(mapping.srcTable)) {
      mapping.tgtTable = mapping.srcTable
    }
  })
  renderMappingTable($('map-search').value.trim())
  updateMappingStats()
})

$('btn-confirm-mapping').addEventListener('click', () => {
  const selectedIds = [...document.querySelectorAll('.chk-row:checked')].map(box => box.dataset.id)
  const selected = state.mappings.filter(mapping => selectedIds.includes(mapping.id))

  const valid = selected.filter(mapping => {
    if (mapping.mode === 'specialized') return true
    if (!mapping.tgtTable) return false
    if (!mapping.colMap.length) inspectColumns(mapping)
    return mapping.colMap.length > 0
  })

  if (!valid.length) {
    alert('لا توجد عناصر قابلة للنقل بعد الفحص.')
    return
  }

  state.mappings = valid.map((mapping, index) => ({
    ...mapping,
    id: mapping.id || `map-${index}`,
    status: 'pending',
    stats: null
  }))
  state.currentStep = 0
  state.logEntries = []
  state.logFilePath = ''
  state.totals = { attempted: 0, inserted: 0, skipped: 0, failed: 0, rolledBack: 0, durationMs: 0 }
  initMigrationPage()
  showPage('migration')
})

function initMigrationPage() {
  subscribeEvents()
  $('log-box').innerHTML = ''
  $('log-count').textContent = '0 سجل'
  addLog({
    timestamp: new Date().toISOString(),
    level: 'INFO',
    table: '—',
    rowId: '—',
    message: `تم تجهيز ${state.mappings.length} عنصرًا للنقل`
  })
  renderCurrentStep()
}

function renderCurrentStep() {
  const mapping = state.mappings[state.currentStep]
  if (!mapping) {
    $('group-counter').textContent = 'اكتملت جميع الخطوات'
    $('current-group-name').textContent = '✅ انتهى النقل'
    $('current-group-tables').textContent = ''
    $('btn-start-group').style.display = 'none'
    $('btn-finish').style.display = 'inline-flex'
    return
  }

  $('group-counter').textContent = `العنصر ${state.currentStep + 1} من ${state.mappings.length}`
  $('current-group-name').textContent = mapping.mode === 'specialized'
    ? `${mapping.labelAr} (${mapping.srcTable})`
    : `${mapping.srcTable} → ${mapping.tgtTable}`
  $('current-group-tables').textContent = mapping.mode === 'specialized'
    ? 'سيتم استخدام منطق متخصص للحفاظ على التحويلات والبيانات التابعة.'
    : `${mapping.colMap.length} عمود مشترك | ${mapping.rowCount.toLocaleString()} صف`
  $('group-rule-badges').innerHTML = renderRuleBadges(mapping)
  $('btn-next').style.display = 'none'
  $('btn-finish').style.display = 'none'
  $('btn-start-group').style.display = 'inline-flex'
  $('btn-cancel').style.display = 'none'
  $('progress-card').style.display = 'none'
  $('action-msg').innerHTML = mapping.mode === 'specialized'
    ? '<div class="alert alert-info">سيعمل هذا الترحيل عبر مسار متخصص يحافظ على الصور والأسعار والاشتراكات أو قواعد منع التكرار حسب نوع البيانات.</div>'
    : '<div class="alert alert-info">سيعمل هذا الترحيل عبر النسخ المباشر للأعمدة المشتركة فقط.</div>'
  renderMiniStepper()
}

function renderRuleBadges(mapping) {
  const badges = []
  if (mapping.mode === 'specialized') badges.push('<span class="colmap-ok">متخصص</span>')
  if (mapping.mode === 'direct-copy') badges.push('<span class="colmap-info">مباشر</span>')
  const source = state.sourceTables.find(table => table.name === mapping.srcTable)
  if (source?.requiresImages) badges.push('<span class="colmap-info">صور</span>')
  if (source?.requiresChildWrites) badges.push('<span class="colmap-info">بيانات تابعة</span>')
  if (source?.requiresDedup) badges.push('<span class="colmap-warn">منع تكرار</span>')
  if (source?.requiresLatestOnly) badges.push('<span class="colmap-warn">أحدث اشتراك</span>')
  return badges.join(' ')
}

function renderMiniStepper() {
  const container = $('groups-mini-stepper')
  container.innerHTML = ''
  state.mappings.forEach((mapping, index) => {
    if (index > 0) {
      const separator = document.createElement('div')
      separator.className = `mini-sep${index <= state.currentStep ? ' done' : ''}`
      container.appendChild(separator)
    }

    const dot = document.createElement('div')
    dot.className = 'mini-step'
    dot.textContent = String(index + 1)
    dot.title = mapping.labelAr || mapping.srcTable
    if (index < state.currentStep) {
      dot.classList.add(mapping.status === 'completed' ? 'done' : mapping.status === 'partial' ? 'partial' : 'failed')
    } else if (index === state.currentStep) {
      dot.classList.add('active')
    }
    container.appendChild(dot)
  })
}

$('btn-start-group').addEventListener('click', async () => {
  const mapping = state.mappings[state.currentStep]
  if (!mapping) return

  state.isRunning = true
  mapping.status = 'running'
  $('btn-start-group').style.display = 'none'
  $('btn-cancel').style.display = 'inline-flex'
  $('progress-card').style.display = 'block'
  $('progress-group-name').textContent = `⏳ جارٍ النقل — ${mapping.labelAr || mapping.srcTable}`
  $('action-msg').innerHTML = '<div class="alert alert-info running-pulse">جارٍ تنفيذ النقل الآن...</div>'
  resetLiveStats()

  try {
    let result
    if (mapping.mode === 'specialized') {
      if (mapping.migrationId === 'products' && !mapping.options.imageFolder) {
        const imageFolder = window.prompt('أدخل مسار مجلد صور المنتجات إذا كان موجودًا، أو اتركه فارغًا للمتابعة بدون مجلد خارجي:', '')
        mapping.options.imageFolder = imageFolder || ''
      }
      result = await window.api.startSpecialized({
        migrationId: mapping.migrationId,
        options: mapping.options
      })
    } else {
      result = await window.api.startMapped({
        mappingId: mapping.id,
        sourceTable: mapping.srcTable,
        targetTable: mapping.tgtTable,
        colMap: mapping.colMap
      })
    }

    if (result?.logFilePath) {
      state.logFilePath = result.logFilePath
    }
  } catch (error) {
    state.isRunning = false
    mapping.status = 'failed'
    $('btn-cancel').style.display = 'none'
    $('btn-start-group').style.display = 'inline-flex'
    $('action-msg').innerHTML = `<div class="done-banner failed">❌ ${error.message}</div>`
  }
})

$('btn-cancel').addEventListener('click', async () => {
  await window.api.cancelMigration()
  $('btn-cancel').style.display = 'none'
})

$('btn-next').addEventListener('click', () => {
  state.currentStep += 1
  renderCurrentStep()
})

$('btn-finish').addEventListener('click', () => {
  buildSummary()
  showPage('summary')
})

function subscribeEvents() {
  state.unsub.forEach(unsub => unsub && unsub())
  state.unsub = [
    window.api.on('migration:progress', onProgress),
    window.api.on('migration:log', onLogEntry),
    window.api.on('migration:group-done', onGroupDone),
    window.api.on('migration:session-completed', onSessionCompleted)
  ]
}

function onProgress(payload) {
  const pct = payload.totalRows > 0 ? Math.round((payload.processedRows / payload.totalRows) * 100) : 0
  $('progress-fill').style.width = `${pct}%`
  $('progress-pct').textContent = `${pct}%`
  $('progress-table').textContent = payload.table || '—'
  $('speed-rps').textContent = String(payload.rowsPerSecond || 0)
  $('speed-eta').textContent = formatEta(payload.estimatedRemainingMs || 0)
  $('live-inserted').textContent = String(payload.inserted || 0)
  $('live-skipped').textContent = String(payload.skipped || 0)
  $('live-failed').textContent = String((payload.failed || 0) + (payload.rolledBack || 0))
}

function onLogEntry(entry) {
  addLog(entry)
}

function onGroupDone(payload) {
  const mapping = state.mappings.find(item => item.id === payload.groupId || item.migrationId === payload.groupId)
  if (!mapping) return

  mapping.status = payload.status
  mapping.stats = payload.stats
  state.isRunning = false
  $('btn-cancel').style.display = 'none'
  $('progress-group-name').textContent = payload.status === 'completed' ? '✅ اكتمل النقل' : payload.status === 'partial' ? '⚠️ اكتمل جزئيًا' : '❌ فشل النقل'
  $('action-msg').innerHTML = `
    <div class="done-banner ${payload.status === 'completed' ? 'success' : payload.status === 'partial' ? 'partial' : 'failed'}">
      مدرج: <strong>${payload.stats.inserted || 0}</strong> |
      متخطى: <strong>${payload.stats.skipped || 0}</strong> |
      فشل: <strong>${payload.stats.failed || 0}</strong> |
      تراجع: <strong>${payload.stats.rolledBack || 0}</strong>
    </div>`

  renderMiniStepper()
  const isLast = state.currentStep >= state.mappings.length - 1
  $('btn-next').style.display = isLast ? 'none' : 'inline-flex'
  $('btn-finish').style.display = isLast ? 'inline-flex' : 'none'
}

function onSessionCompleted(payload) {
  state.totals = payload.totals || state.totals
  if (payload.logFilePath) {
    state.logFilePath = payload.logFilePath
  }
}

function addLog(entry) {
  state.logEntries.push(entry)
  if (state.logEntries.length > 5000) {
    state.logEntries.splice(0, 1000)
  }
  rerenderLog()
  $('log-count').textContent = `${state.logEntries.length} سجل`
}

function rerenderLog() {
  const box = $('log-box')
  box.innerHTML = ''
  state.logEntries
    .filter(entry => state.activeFilters.has(entry.level) && matchesSearch(entry))
    .forEach(entry => {
      const row = document.createElement('div')
      row.className = `log-row ${entry.level}`
      const time = new Date(entry.timestamp).toLocaleTimeString('ar-EG')
      row.innerHTML = `
        <span class="log-time">${time}</span>
        <span class="log-level">${entry.level}</span>
        <span class="log-table">${entry.table || '—'}</span>
        <span class="log-msg">${entry.message}</span>`
      box.appendChild(row)
    })
  box.scrollTop = box.scrollHeight
}

function matchesSearch(entry) {
  if (!state.logSearch) return true
  return (entry.message || '').includes(state.logSearch) || (entry.table || '').includes(state.logSearch)
}

document.querySelectorAll('.log-filter-btn').forEach(button => {
  button.addEventListener('click', () => {
    const level = button.dataset.level
    if (state.activeFilters.has(level)) {
      state.activeFilters.delete(level)
      button.className = 'log-filter-btn'
    } else {
      state.activeFilters.add(level)
      button.className = `log-filter-btn active-${level}`
    }
    rerenderLog()
  })
})

$('log-search').addEventListener('input', event => {
  state.logSearch = event.target.value.trim()
  rerenderLog()
})

function buildSummary() {
  $('sum-inserted').textContent = String(state.totals.inserted || 0)
  $('sum-skipped').textContent = String(state.totals.skipped || 0)
  $('sum-failed').textContent = String((state.totals.failed || 0) + (state.totals.rolledBack || 0))
  $('summary-subtitle').textContent = `تم حفظ ${state.totals.inserted || 0} سجل خلال ${formatEta(state.totals.durationMs || 0)}`

  const container = $('summary-groups')
  container.innerHTML = ''
  state.mappings.forEach(mapping => {
    const stats = mapping.stats || { inserted: 0, skipped: 0, failed: 0, rolledBack: 0 }
    const row = document.createElement('div')
    row.className = 'sum-group-row'
    row.innerHTML = `
      <span class="name">${mapping.labelAr || mapping.srcTable}</span>
      <span class="nums">
        <span class="i">↑ ${stats.inserted || 0}</span>
        <span class="s">↷ ${stats.skipped || 0}</span>
        <span class="f">✕ ${(stats.failed || 0) + (stats.rolledBack || 0)}</span>
      </span>`
    container.appendChild(row)
  })
  $('log-file-path').textContent = state.logFilePath || 'لم يتم إنشاء ملف سجل بعد'
}

$('btn-export-log').addEventListener('click', async () => {
  const result = await window.api.exportLog(state.logFilePath)
  if (result?.saved) {
    alert(`تم حفظ السجل في:\n${result.filePath}`)
  }
})

$('btn-restart').addEventListener('click', () => {
  window.location.reload()
})

function resetLiveStats() {
  $('progress-fill').style.width = '0%'
  $('progress-pct').textContent = '0%'
  $('progress-table').textContent = '—'
  $('live-inserted').textContent = '0'
  $('live-skipped').textContent = '0'
  $('live-failed').textContent = '0'
  $('speed-rps').textContent = '—'
  $('speed-eta').textContent = '—'
}

function formatEta(ms) {
  if (!ms) return '—'
  const totalSeconds = Math.round(ms / 1000)
  if (totalSeconds < 60) return `${totalSeconds} ثانية`
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return seconds ? `${minutes} د ${seconds} ث` : `${minutes} دقيقة`
}

loadSavedConfig()
showPage('connection')
