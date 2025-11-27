// scripts/create-user.js
const fs = require('fs');
const bcrypt = require('bcryptjs');
const usersFile = '../../users.json';
const username = '';
const password = '';
const salt = bcrypt.hashSync(password, 10);
const arr = fs.existsSync(usersFile) ? JSON.parse(fs.readFileSync(usersFile,'utf8')) : [];
arr.push({ username, passwordHash: salt });
fs.writeFileSync(usersFile, JSON.stringify(arr, null, 2));
console.log('created', username);
