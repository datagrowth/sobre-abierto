// LibreOffice como conversor de documentos: sin él, errores como valor que dicen qué pasa;
// el cerrojo deja pasar un soffice a la vez y suelta los huérfanos. Las conversiones
// reales solo corren donde hay soffice (en CI, en la imagen; en local, si está instalado).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.NODE_ENV = 'test';

const { comprobarConversor, conLock, convertir, convertirBytes, disponible, estadoConversor, pideReinicio } =
  await import('../../src/nucleo/documentos/libreoffice.js');
const { ok } = await import('../../src/nucleo/result.js');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'libreoffice-'));
const RTF =
  '{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0 Arial;}}\\f0\\fs22 Anexo VII: modelo de oferta economica.\\par Segundo parrafo del anexo.\\par}';

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

test('should_report_absent_when_no_candidate_binary_runs', async () => {
  const inexistente = path.join(tmp, 'no-existe-soffice');
  const c = await comprobarConversor({ LIBREOFFICE_BIN: inexistente }, [inexistente]);
  assert.deepEqual(c, { estado: 'ausente', binario: null, version: null });
});

test('should_report_off_when_LIBREOFFICE_ACTIVO_is_0_without_probing_anything', async () => {
  const c = await comprobarConversor({ LIBREOFFICE_ACTIVO: '0', LIBREOFFICE_BIN: '/usr/bin/true' });
  assert.deepEqual(c, { estado: 'apagado', binario: null, version: null });
});

test('should_fail_as_a_value_when_converting_without_libreoffice', async (t) => {
  if ((await disponible()).estado === 'ok') return t.skip('hay LibreOffice: este caso no se puede provocar');
  const origen = path.join(tmp, 'anexo.rtf');
  fs.writeFileSync(origen, RTF);
  const r = await convertir(origen, 'docx');
  assert.equal(r.data, null);
  assert.match(r.error?.code ?? '', /^conversor_(ausente|apagado)$/);
  assert.equal(estadoConversor().hechas, 0);
});

test('should_remove_an_orphan_lock_and_proceed', async () => {
  const lock = path.join(tmp, 'lock-huerfano');
  fs.mkdirSync(lock);
  const hace = new Date(Date.now() - 10 * 60_000);
  fs.utimesSync(lock, hace, hace);
  const r = await conLock(async () => ok('hecho'), { lock, timeoutMs: 1_000 });
  assert.equal(r.data, 'hecho');
  assert.equal(fs.existsSync(lock), false, 'el cerrojo se suelta al terminar');
});

test('should_wait_for_a_live_lock_and_give_up_as_a_timeout', async () => {
  const lock = path.join(tmp, 'lock-vivo');
  fs.mkdirSync(lock);
  let llamado = false;
  const r = await conLock(
    async () => {
      llamado = true;
      return ok(1);
    },
    { lock, timeoutMs: 300 },
  );
  assert.equal(r.error?.code, 'conversion_timeout');
  assert.equal(llamado, false);
  assert.equal(fs.existsSync(lock), true, 'el cerrojo ajeno no se toca');
});

test('should_run_conversions_one_at_a_time', async () => {
  const lock = path.join(tmp, 'lock-serie');
  const marcas: string[] = [];
  const tarea = (nombre: string) =>
    conLock(
      async () => {
        marcas.push(`${nombre}:in`);
        await dormir(60);
        marcas.push(`${nombre}:out`);
        return ok(nombre);
      },
      { lock, timeoutMs: 5_000 },
    );
  const [a, b] = await Promise.all([tarea('a'), tarea('b')]);
  assert.equal(a.data, 'a');
  assert.equal(b.data, 'b');
  for (let i = 0; i < marcas.length; i += 2)
    assert.equal(marcas[i]!.split(':')[0], marcas[i + 1]!.split(':')[0], `nunca se solapan: ${marcas.join(' ')}`);
});

test('should_convert_rtf_to_docx_and_docx_to_pdf_with_libreoffice', async (t) => {
  if ((await disponible()).estado !== 'ok') return t.skip('sin LibreOffice (soffice) en esta máquina');
  const docx = await convertirBytes(Buffer.from(RTF, 'latin1'), '.rtf', 'docx');
  assert.equal(docx.error, null);
  assert.equal(docx.data?.subarray(0, 2).toString('latin1'), 'PK', 'un .docx es un zip');
  const pdf = await convertirBytes(docx.data!, '.docx', 'pdf');
  assert.equal(pdf.error, null);
  assert.equal(pdf.data?.subarray(0, 4).toString('latin1'), '%PDF');
  const e = estadoConversor();
  assert.ok(e.hechas >= 2 && e.en_cola === 0 && e.ultima_ms !== null);
});

test('should_kill_a_conversion_that_exceeds_the_timeout', async (t) => {
  if ((await disponible()).estado !== 'ok') return t.skip('sin LibreOffice (soffice) en esta máquina');
  const r = await convertirBytes(Buffer.from(RTF, 'latin1'), '.rtf', 'docx', { timeoutMs: 1 });
  assert.equal(r.error?.code, 'conversion_timeout');
  assert.equal(estadoConversor().en_cola, 0);
});

test('should_retry_once_when_soffice_asks_to_restart_with_exit_code_81', () => {
  assert.equal(pideReinicio(Object.assign(new Error('Command failed'), { code: 81 })), true);
  assert.equal(pideReinicio(Object.assign(new Error('Command failed'), { code: 1 })), false);
  assert.equal(pideReinicio(null), false);
});
