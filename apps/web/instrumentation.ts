// Inicia a ingestão junto com o servidor Node (não roda no runtime Edge).
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { getIngestor } = await import("./lib/server/ingestor");
    getIngestor();
  }
}
