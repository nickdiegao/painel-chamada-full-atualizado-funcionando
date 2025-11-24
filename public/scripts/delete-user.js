// tools/delete-user.js
require('ts-node/register'); // permite importar TypeScript
const { deleteUser } = require('../../src/index');

const username = process.argv[2];

if (!username) {
  console.error("Uso: node scripts/delete-user.js <username>");
  process.exit(1);
}

const ok = deleteUser(username);

if (ok) {
  console.log(`Usuário '${username}' deletado com sucesso.`);
} else {
  console.log(`Usuário '${username}' NÃO encontrado.`);
}
