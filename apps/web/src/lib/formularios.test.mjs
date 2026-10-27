// Guardia de los formularios: `Boton` se pinta como type="button" salvo con `submit`, así que
// un <form onSubmit> cuyo botón principal no lleva ni `submit` ni `onClick` no envía nada al
// pulsarlo. Pasó en «Registrar presentación», «Calcular» y «Cargar histórico».
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'componentes');

function jsxDe(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const ruta = path.join(dir, e.name);
    if (e.isDirectory()) return jsxDe(ruta);
    return e.name.endsWith('.jsx') ? [ruta] : [];
  });
}

const formularios = (texto) => [...texto.matchAll(/<form onSubmit[\s\S]*?<\/form>/g)].map((m) => m[0]);
const botones = (form) => [...form.matchAll(/<Boton\b[^>]*>/g)].map((m) => m[0]);
const envia = (boton) => /\bsubmit\b/.test(boton) || /\bonClick=/.test(boton);

test('should_give_every_form_a_button_that_submits_it', () => {
  const sinEnvio = jsxDe(RAIZ).flatMap((archivo) =>
    formularios(fs.readFileSync(archivo, 'utf8'))
      .filter(
        (form) =>
          botones(form).length &&
          !botones(form).some((b) => /\bsubmit\b/.test(b)) &&
          botones(form).some((b) => !envia(b)),
      )
      .map(() => path.relative(RAIZ, archivo)),
  );
  assert.deepEqual(sinEnvio, [], 'cada <form onSubmit> necesita un <Boton submit> (o que sus botones lleven onClick)');
});
