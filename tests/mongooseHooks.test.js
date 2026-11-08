const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
const User = require('../models/User');

const baseUser = {
  name: 'Awa Traoré',
  email: 'Awa@Example.com',
  password: 'Motdepasse1!',
  role: 'client',
  phone: '+33612345678',
  address: '5 rue Alfred Bastin, Annemasse',
  country: 'France',
};

test('Mongoose 9 : un utilisateur valide passe la validation (plus de « next is not a function »)', async () => {
  const user = new User(baseUser);
  await user.validate();
  assert.equal(user.email, 'awa@example.com');
});

test('la validation refuse toujours un nom vide ou un mot de passe trop court', async () => {
  await assert.rejects(() => new User({ ...baseUser, name: '' }).validate(), /nom/i);
  await assert.rejects(() => new User({ ...baseUser, password: 'abc' }).validate(), /mot de passe/i);
});

test("le hook d'enregistrement hache le mot de passe", async () => {
  const user = new User(baseUser);
  await user.validate();
  await User.schema.s.hooks.execPre('save', user, []);
  assert.notEqual(user.password, 'Motdepasse1!');
  assert.match(user.password, /^\$2[aby]\$/);
});

test("aucun modèle n'utilise plus next() dans ses hooks (Mongoose 9)", () => {
  for (const file of ['User.js', 'Restaurant.js', 'AdminAuditLog.js', 'Order.js', 'MenuItem.js']) {
    const source = fs.readFileSync(path.join(__dirname, '..', 'models', file), 'utf8');
    assert.doesNotMatch(source, /\.pre\('[a-z]+', (async )?function \(next\)/, file);
    assert.doesNotMatch(source, /return next\(/, file);
  }
});
