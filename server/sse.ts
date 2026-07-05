import type { Response } from "express";

export class SseHub<T> {
  private readonly clients = new Set<Response>();

  connect(res: Response) {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();
    res.write("event: ready\ndata: {}\n\n");

    this.clients.add(res);
    res.on("close", () => this.clients.delete(res));
  }

  publish(event: T) {
    const payload = JSON.stringify(event);
    for (const client of this.clients) {
      client.write(`data: ${payload}\n\n`);
    }
  }

  publishNamed(name: string, event: T) {
    const payload = JSON.stringify(event);
    for (const client of this.clients) {
      client.write(`event: ${name}\ndata: ${payload}\n\n`);
    }
  }

  close() {
    for (const client of this.clients) {
      client.end();
    }
    this.clients.clear();
  }
}
