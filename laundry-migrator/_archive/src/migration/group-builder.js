'use strict'

const ARABIC_LABELS = {
  settings        : 'الإعدادات',
  customers       : 'العملاء',
  subscriptions   : 'الاشتراكات',
  services        : 'الخدمات',
  employees       : 'الموظفين',
  orders          : 'الطلبات',
  order_items     : 'بنود الطلبات',
  invoices        : 'الفواتير',
  payments        : 'المدفوعات',
  categories      : 'الفئات',
  branches        : 'الفروع',
  users           : 'المستخدمين',
  roles           : 'الأدوار',
  permissions     : 'الصلاحيات'
}

const CUSTOMER_TABLES     = ['customers', 'clients', 'عملاء']
const SUBSCRIPTION_TABLES = ['subscriptions', 'اشتراكات']

/**
 * يرتب الجداول طبقاً لمتطلبات المفاتيح الأجنبية (Topological Sort)
 * ثم يجمعّها في مجموعات منطقية بترتيب النقل.
 */
function buildGroups(tables) {
  const sorted = topologicalSort(tables)
  const groups = []

  // نجمعّ بحسب ترتيب التبعية — كل مجموعة = طبقة مستقلة
  // ببساطة: نضع كل جدول في مجموعته الخاصة مع دمج الجداول الخالية من FK أولاً
  const noFk   = sorted.filter(t => t.foreignKeys.length === 0)
  const hasFk  = sorted.filter(t => t.foreignKeys.length > 0)

  if (noFk.length > 0) {
    groups.push(makeGroup('g-base', noFk, 'الجداول الأساسية'))
  }

  // مجموعات ذات مفاتيح أجنبية — واحدة واحدة حسب الترتيب
  for (const table of hasFk) {
    const existing = groups.find(g =>
      g.tables.includes(table.name) === false &&
      table.foreignKeys.every(fk => groups.some(gg => gg.tables.includes(fk.refTable)))
    )
    if (existing && existing.id !== 'g-base') {
      existing.tables.push(table.name)
    } else {
      groups.push(makeGroup('g-' + table.name, [table], null))
    }
  }

  // إعادة تسمية وإضافة القواعد الخاصة
  return groups.map((g, i) => {
    const specialRules = []
    for (const tName of g.tables) {
      if (CUSTOMER_TABLES.some(c => tName.toLowerCase().includes(c))) {
        const t = tables.find(x => x.name === tName)
        if (t && t.primaryKeys.length > 0)
          specialRules.push({ type: 'dedup', table: tName, keyField: t.primaryKeys[0] })
      }
      if (SUBSCRIPTION_TABLES.some(s => tName.toLowerCase().includes(s))) {
        const t = tables.find(x => x.name === tName)
        if (t && t.dateColumns.length > 0)
          specialRules.push({ type: 'latest-only', table: tName, dateField: t.dateColumns[0] })
      }
    }
    return {
      id          : g.id,
      order       : i + 1,
      labelAr     : g.labelAr || arabicLabel(g.tables),
      tables      : g.tables,
      status      : 'pending',
      specialRules,
      stats       : null
    }
  })
}

function makeGroup(id, tables, labelAr) {
  return {
    id,
    tables  : tables.map(t => t.name || t),
    labelAr : labelAr || arabicLabel(tables.map(t => t.name || t))
  }
}

function arabicLabel(tableNames) {
  const first = tableNames[0].toLowerCase()
  for (const [key, ar] of Object.entries(ARABIC_LABELS)) {
    if (first.includes(key)) return ar
  }
  return tableNames.join(' + ')
}

function topologicalSort(tables) {
  const map     = new Map(tables.map(t => [t.name, t]))
  const visited = new Set()
  const result  = []

  function visit(name, ancestors = new Set()) {
    if (visited.has(name)) return
    if (ancestors.has(name)) return  // تجاهل الحلقة الدائرية
    const t = map.get(name)
    if (!t) return
    ancestors.add(name)
    for (const fk of t.foreignKeys) {
      visit(fk.refTable, new Set(ancestors))
    }
    visited.add(name)
    result.push(t)
  }

  for (const t of tables) visit(t.name)
  return result
}

module.exports = { buildGroups }
