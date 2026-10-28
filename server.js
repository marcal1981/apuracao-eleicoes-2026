// Arquivo de entrada para hospedagens que iniciam o app com "node server.js" (ex.: Hostinger, modo "Other").
// Sobe o site já compilado (npm run build) a partir de apps/web, na porta que a hospedagem informar (PORT).
const path = require("node:path");
const { createServer } = require("node:http");

const dir = path.join(__dirname, "apps", "web");
// O app lê arquivos relativos à própria pasta (public/maps, data): trabalha a partir dela.
process.chdir(dir);
process.env.NODE_ENV = "production";

const next = require("next");
const port = Number(process.env.PORT) || 3000;
const hostname = process.env.HOSTNAME || "0.0.0.0";
const app = next({ dev: false, dir, hostname, port });
const handle = app.getRequestHandler();

app
  .prepare()
  .then(() => {
    createServer((req, res) => handle(req, res)).listen(port, hostname, () => {
      console.log(`Apuração Eleições 2026 no ar: http://${hostname}:${port}`);
    });
  })
  .catch((err) => {
    console.error("Falha ao iniciar o site:", err);
    process.exit(1);
  });
