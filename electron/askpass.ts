import net from "node:net";

const port = Number(process.env.GITNEAT_ASKPASS_PORT);
const token = process.env.GITNEAT_ASKPASS_TOKEN ?? "";
const id = Number(process.env.GITNEAT_ASKPASS_ID ?? 0);
const prompt = process.argv[2] ?? "";

const socket = net.connect(port, "127.0.0.1", () => {
  socket.write(`${JSON.stringify({ token, id, prompt })}\n`);
});

let buffer = "";
socket.on("data", (chunk) => {
  buffer += chunk.toString("utf8");
  const end = buffer.indexOf("\n");
  if (end < 0) {
    return;
  }
  const answer = (JSON.parse(buffer.slice(0, end)) as { answer: string | null }).answer;
  if (answer === null) {
    process.exit(1);
  }
  process.stdout.write(`${answer}\n`);
  process.exit(0);
});
socket.on("error", () => process.exit(1));
socket.on("close", () => process.exit(1));
