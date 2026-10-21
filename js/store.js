/*
 * JobStore — localStorage persistence plus backup/restore. All data stays on the device.
 * Pure helpers (makeBackup / parseBackup) are unit-tested in Node.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.JobStore = factory();
})(this, function () {
  'use strict';
  var BACKUP_FORMAT = 'job-profit-backup';
  var BACKUP_VERSION = 1;

  function keys(prefix) {
    prefix = prefix || 'jpc';
    return {
      jobs: prefix + '.jobs.v1', docs: prefix + '.docs.v1', profile: prefix + '.profile.v1',
      draft: prefix + '.draft.v1', onboarded: prefix + '.onboarded.v1', ui: prefix + '.ui.v1', terms: prefix + '.terms.v1'
    };
  }

  function create(storage, prefix) {
    var K = keys(prefix);
    var ok = true;
    try { var t = '__jpc_test'; storage.setItem(t, '1'); storage.removeItem(t); } catch (e) { ok = false; }
    function read(k, fallback) {
      if (!ok) return fallback;
      try { var v = storage.getItem(k); return v === null ? fallback : JSON.parse(v); } catch (e) { return fallback; }
    }
    function write(k, v) {
      if (!ok) return false;
      try { storage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; }
    }
    return {
      available: ok, keys: K,
      loadJobs: function () { var v = read(K.jobs, []); return Array.isArray(v) ? v : []; },
      saveJobs: function (v) { return write(K.jobs, v); },
      loadDocs: function () { var v = read(K.docs, []); return Array.isArray(v) ? v : []; },
      saveDocs: function (v) { return write(K.docs, v); },
      loadProfile: function () { var v = read(K.profile, null); return v && typeof v === 'object' ? v : null; },
      saveProfile: function (v) { return write(K.profile, v); },
      loadDraft: function () { return read(K.draft, null); },
      saveDraft: function (v) { return write(K.draft, v); },
      loadUi: function () { return read(K.ui, {}) || {}; },
      saveUi: function (v) { return write(K.ui, v); },
      termsAccepted: function () { var v = read(K.terms, null); return !!(v && v.accepted); },
      acceptTerms: function (version) { return write(K.terms, { accepted: true, version: version || '', at: new Date().toISOString() }); },
      isOnboarded: function () { return read(K.onboarded, false) === true; },
      setOnboarded: function () { return write(K.onboarded, true); }
    };
  }

  function makeBackup(data, appName, now) {
    return {
      format: BACKUP_FORMAT, version: BACKUP_VERSION,
      app: appName || '', exportedAt: (now || new Date()).toISOString(),
      profile: data.profile || null,
      jobs: data.jobs || [], docs: data.docs || [], draft: data.draft || null
    };
  }

  /** Validate a backup file's text. Returns { ok, data, summary } or { ok:false, error }. */
  function parseBackup(text) {
    var obj;
    try { obj = JSON.parse(text); } catch (e) { return { ok: false, error: 'That file is not valid JSON. Choose a backup file downloaded from this app.' }; }
    if (!obj || typeof obj !== 'object' || obj.format !== BACKUP_FORMAT) return { ok: false, error: 'That file is not a backup from this app.' };
    if (typeof obj.version !== 'number' || obj.version > BACKUP_VERSION) return { ok: false, error: 'This backup was made by a newer version of the app.' };
    if (!Array.isArray(obj.jobs) || !Array.isArray(obj.docs)) return { ok: false, error: 'The backup is missing its jobs or documents.' };
    var jobs = obj.jobs.filter(function (j) { return j && typeof j === 'object' && j.id; });
    var docs = obj.docs.filter(function (d) { return d && typeof d === 'object' && d.id && Array.isArray(d.lines); });
    var profile = obj.profile && typeof obj.profile === 'object' ? obj.profile : null;
    return {
      ok: true,
      data: { profile: profile, jobs: jobs, docs: docs, draft: obj.draft && typeof obj.draft === 'object' ? obj.draft : null },
      summary: { jobs: jobs.length, estimates: docs.filter(function (d) { return d.type !== 'invoice'; }).length, invoices: docs.filter(function (d) { return d.type === 'invoice'; }).length, exportedAt: obj.exportedAt || '' }
    };
  }

  return { keys: keys, create: create, makeBackup: makeBackup, parseBackup: parseBackup, BACKUP_FORMAT: BACKUP_FORMAT };
});
