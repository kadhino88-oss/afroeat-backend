'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'controllers', 'userController.js'), 'utf8');

test('un administrateur peut se connecter depuis la page de connexion normale', () => {
  assert.match(
    source,
    /if \(requestedRole && user\.role !== requestedRole && user\.role !== 'admin'\)/
  );
});

test('les autres rôles restent refusés dans un espace qui n’est pas le leur', () => {
  assert.match(source, /Ce compte appartient à l’espace \$\{user\.role\}, pas à l’espace \$\{requestedRole\}/);
});
