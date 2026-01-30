const pdf = require('pdf-parse');

console.log("--- RESULTADOS DE LA PRUEBA ---");
console.log("1. Tipo de dato:", typeof pdf);
console.log("2. ¿Es array?", Array.isArray(pdf));
console.log("3. Contenido:", pdf);
console.log("-------------------------------");