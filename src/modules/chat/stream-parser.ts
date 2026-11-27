/**
 * Incremental newline-delimited JSON parser. Each chunk may end in the middle
 * of a line, so incomplete trailing data is buffered until the next chunk.
 */
export function createLineParser(handleLine: (line: string) => void): (chunk: string) => void {
  let buffer = "";
  return (chunk: string) => {
    buffer += chunk;
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line.trim()) handleLine(line);
    }
  };
}
