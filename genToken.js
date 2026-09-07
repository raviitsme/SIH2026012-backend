const jwt = require('jsonwebtoken');
require('dotenv').config();

const secret = process.env.JWT_SECRET;

const admin = {
    id : 1,
    username : "admin_test",
    role : "Admin"
};

const surveyor = {
    id : 1,
    username : "surveyor_test",
    role : "Surveyor"
}

const auditor = {
    id : 1,
    username : "auditor_test",
    role : "Auditor",
}

console.log("Admin : ", jwt.sign(admin, secret));
console.log("Surveyor : ", jwt.sign(surveyor, secret));
console.log("Auditor : ", jwt.sign(auditor, secret));