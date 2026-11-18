const BOUNDS = [0.01, 0.1, 1, 10, 60, 300, 1800];

/** Internal registry: callers supply only fixed metric names and bounded labels. */
export class OperationMetrics {
  private families = new Map<string, { help: string; type: string; values: Map<string, number> }>();

  set(name: string, labels: string, value: number, help: string): void {
    this.add(name, labels, 0, help, "gauge");
    this.families.get(name)!.values.set(labels, value);
  }

  add(name: string, labels: string, value: number, help: string, type = "counter"): void {
    let family = this.families.get(name);
    if (!family) {
      family = { help, type, values: new Map() };
      this.families.set(name, family);
    }
    family.values.set(labels, (family.values.get(labels) ?? 0) + value);
  }

  duration(name: string, labels: string, seconds: number): void {
    // Histogram components share a single HELP/TYPE declaration.
    for (const bound of [...BOUNDS, Infinity]) {
      this.add(`${name}_bucket`, `${labels ? labels + "," : ""}le="${bound === Infinity ? "+Inf" : bound}"`, seconds <= bound ? 1 : 0, "");
    }
    this.add(`${name}_sum`, labels, seconds, "");
    this.add(`${name}_count`, labels, 1, "");
  }

  render(): string {
    const lines: string[] = [];
    for (const [name, family] of this.families) {
      if (family.help) lines.push(`# HELP ${name} ${family.help}`, `# TYPE ${name} ${family.type}`);
      else if (name.endsWith("_bucket")) {
        const base = name.slice(0, -7);
        lines.push(`# HELP ${base} Observed duration in seconds.`, `# TYPE ${base} histogram`);
      }
      for (const [labels, value] of family.values) lines.push(`${name}${labels ? `{${labels}}` : ""} ${value}`);
    }
    return lines.join("\n");
  }

  stream(source: ReadableStream<Uint8Array>, boundary: "download" | "storage_read", labels: string): ReadableStream<Uint8Array> {
    const prefix = `blossom_${boundary}`;
    const reader = source.getReader();
    const start = performance.now();
    let finished = false;
    this.add(`${prefix}_active`, labels, 1, "Open observed body streams.", "gauge");
    this.add(`${prefix}_bytes_total`, labels, 0, "Bytes read from the observed stream, not confirmed client delivery.");
    const finish = (outcome: "completed" | "cancelled" | "error") => {
      if (finished) return;
      finished = true;
      this.add(`${prefix}_active`, labels, -1, "Open observed body streams.", "gauge");
      this.add(`${prefix}_streams_total`, `${labels},outcome="${outcome}"`, 1, "Terminal stream outcomes.");
      this.duration(`${prefix}_duration_seconds`, `${labels},outcome="${outcome}"`, (performance.now() - start) / 1000);
    };
    return new ReadableStream<Uint8Array>({
      pull: async (controller) => {
        try {
          const { value, done } = await reader.read();
          if (finished) return;
          if (done) {
            finish("completed");
            reader.releaseLock();
            controller.close();
          } else {
            this.add(`${prefix}_bytes_total`, labels, value.byteLength, "Bytes read from the observed stream, not confirmed client delivery.");
            controller.enqueue(value);
          }
        } catch (error) {
          if (finished) return;
          finish("error");
          reader.releaseLock();
          controller.error(error);
        }
      },
      cancel: async (reason) => {
        finish("cancelled");
        try {
          await reader.cancel(reason);
        } finally {
          reader.releaseLock();
        }
      },
    }, { highWaterMark: 0 });
  }
}

export function mimeGroup(type: string | null): string {
  const group = type?.split("/")[0].toLowerCase();
  return group && ["image", "video", "audio", "text"].includes(group) ? group : "other";
}
