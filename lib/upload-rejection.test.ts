import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeRejection, type UploadRejection } from './upload-rejection.ts';

const reject = (r: UploadRejection) => describeRejection(r);

test('describeRejection: nepodržan tip i stari Word imaju uputstvo šta da se uradi', () => {
  const unsupported = reject({ ok: false, reason: 'unsupported_type' });
  assert.equal(unsupported.status, 400);
  assert.equal(unsupported.code, 'unsupported_type');
  assert.match(unsupported.message, /PDF/);
  assert.match(unsupported.message, /\.docx/);
  assert.deepEqual(unsupported.audit, { reason: 'unsupported_type' });

  const legacy = reject({ ok: false, reason: 'legacy_doc' });
  assert.equal(legacy.code, 'legacy_doc');
  assert.match(legacy.message, /\.doc/);
  assert.match(legacy.message, /Sačuvaj/);
  assert.deepEqual(legacy.audit, { reason: 'legacy_doc' });
});

test('describeRejection: lozinka na PDF-u i na Word fajlu, sa uputstvom', () => {
  const pdf = reject({ ok: false, reason: 'encrypted_pdf' });
  assert.equal(pdf.code, 'encrypted_pdf');
  assert.match(pdf.message, /lozink/);
  assert.deepEqual(pdf.audit, { reason: 'encrypted_pdf' });

  const office = reject({ ok: false, reason: 'encrypted_office' });
  assert.equal(office.code, 'encrypted_office');
  assert.match(office.message, /lozink/);
  assert.match(office.message, /\.docx/);
  assert.deepEqual(office.audit, { reason: 'encrypted_office' });
});

test('describeRejection: aktivan sadržaj navodi vrstu na srpskom, a u audit ide samo oznaka nalaza', () => {
  const r = reject({ ok: false, reason: 'active_content', finding: 'pdf_javascript' });
  assert.equal(r.status, 400);
  assert.equal(r.code, 'active_content');
  assert.match(r.message, /JavaScript/);
  assert.match(r.message, /aktivan sadržaj/);
  assert.deepEqual(r.audit, { reason: 'active_content', finding: 'pdf_javascript' });

  const macro = reject({ ok: false, reason: 'active_content', finding: 'docx_macro' });
  assert.match(macro.message, /makro/i);
  assert.deepEqual(macro.audit, { reason: 'active_content', finding: 'docx_macro' });
});

test('describeRejection: svaki nalaz aktivnog sadržaja ima opis, a poruka nikad ne ispisuje internu oznaku', () => {
  const findings = [
    'pdf_javascript', 'pdf_launch', 'pdf_embedded_file', 'pdf_rich_media', 'pdf_xfa', 'pdf_submit_form', 'pdf_import_data',
    'docx_macro', 'docx_embedded_object', 'docx_activex', 'docx_remote_template', 'docx_remote_object', 'docx_remote_frame',
  ] as const;
  const seen = new Set<string>();
  for (const finding of findings) {
    const r = reject({ ok: false, reason: 'active_content', finding });
    assert.ok(!r.message.includes(finding), finding);
    assert.ok(!/pdf_|docx_/.test(r.message), finding);
    seen.add(r.message);
  }
  assert.equal(seen.size, findings.length, 'svaka vrsta ima svoju poruku');
});

test('describeRejection: bomba (arhiva, tok objekata, memorija) ima jednu poruku, a nalaz ide u audit', () => {
  for (const finding of ['zip_ratio', 'pdf_object_stream_too_large', 'worker_out_of_memory'] as const) {
    const r = reject({ ok: false, reason: 'archive_bomb', finding });
    assert.equal(r.status, 400);
    assert.equal(r.code, 'archive_bomb');
    assert.match(r.message, /složen|velik/);
    assert.deepEqual(r.audit, { reason: 'archive_bomb', finding });
  }
});

test('describeRejection: previše strana navodi broj strana i granicu', () => {
  const r = reject({ ok: false, reason: 'too_many_pages', pages: 412 });
  assert.equal(r.code, 'too_many_pages');
  assert.match(r.message, /412/);
  assert.match(r.message, /300/);
  assert.deepEqual(r.audit, { reason: 'too_many_pages', pages: 412 });
});

test('describeRejection: istek vremena je 422 i kaže koliko sekundi', () => {
  const r = reject({ ok: false, reason: 'parse_timeout' });
  assert.equal(r.status, 422);
  assert.equal(r.code, 'parse_timeout');
  assert.match(r.message, /20 sekundi/);
  assert.deepEqual(r.audit, { reason: 'parse_timeout' });
});

test('describeRejection: oštećen fajl zadržava stari kod za PDF (invalid_pdf), a Word dobija svoj', () => {
  const pdf = reject({ ok: false, reason: 'unreadable_pdf' });
  assert.equal(pdf.code, 'invalid_pdf');
  assert.equal(pdf.status, 400);
  assert.match(pdf.message, /PDF/);
  assert.deepEqual(pdf.audit, { reason: 'unreadable_pdf' });

  const docx = reject({ ok: false, reason: 'unreadable_docx', finding: 'zip_directory' });
  assert.equal(docx.code, 'invalid_docx');
  assert.match(docx.message, /Word/);
  assert.deepEqual(docx.audit, { reason: 'unreadable_docx', finding: 'zip_directory' });
});

test('describeRejection: pad worker-a je greška servera (500), bez zapisa o blokadi', () => {
  const r = reject({ ok: false, reason: 'worker_failed' });
  assert.equal(r.status, 500);
  assert.equal(r.code, 'file_read_failed');
  assert.equal(r.audit, null);
  assert.ok(!/worker/i.test(r.message));
});

test('describeRejection: nijedna poruka ne otkriva interne pojmove (worker, zip, ObjStm, mammoth)', () => {
  const all: UploadRejection[] = [
    { ok: false, reason: 'unsupported_type' }, { ok: false, reason: 'legacy_doc' }, { ok: false, reason: 'encrypted_office' },
    { ok: false, reason: 'encrypted_pdf' }, { ok: false, reason: 'unreadable_pdf' }, { ok: false, reason: 'unreadable_docx', finding: 'mammoth_failed' },
    { ok: false, reason: 'active_content', finding: 'docx_remote_template' }, { ok: false, reason: 'archive_bomb', finding: 'zip_entries' },
    { ok: false, reason: 'too_many_pages', pages: 301 }, { ok: false, reason: 'parse_timeout' }, { ok: false, reason: 'worker_failed' },
  ];
  for (const r of all) {
    const d = reject(r);
    assert.ok(!/worker|mammoth|objstm|zip_|pdf\.js/i.test(d.message), `${r.reason}: ${d.message}`);
    assert.ok(d.message.length > 20 && d.message.endsWith('.'), `${r.reason}: poruka je cela rečenica`);
  }
});

test('describeRejection: za prilog uz pitanje nepodržan tip kaže da je dozvoljen samo Word, ostali razlozi su isti', () => {
  const r = describeRejection({ ok: false, reason: 'unsupported_type' }, 'attachment');
  assert.equal(r.status, 400);
  assert.equal(r.code, 'unsupported_type');
  assert.match(r.message, /prilog/i);
  assert.match(r.message, /\.docx/);
  assert.doesNotMatch(r.message, /Dozvoljeni su PDF/);
  assert.deepEqual(r.audit, { reason: 'unsupported_type' });

  const same: UploadRejection[] = [
    { ok: false, reason: 'legacy_doc' }, { ok: false, reason: 'encrypted_office' },
    { ok: false, reason: 'active_content', finding: 'docx_macro' }, { ok: false, reason: 'parse_timeout' },
  ];
  for (const x of same) assert.deepEqual(describeRejection(x, 'attachment'), describeRejection(x), x.reason);
});
